// gate-recheck.mjs - second look at every advisory or CVE the gate marked open.
//
// gate.mjs compares fix versions with the repo's GitHub releases. Many projects ship fixes to a
// package registry (npm, PyPI, crates.io, Go) and tag GitHub releases late or never, and many
// maintainers write the fixed version only in the advisory text. This pass re-reads each open
// item: the fix version from the structured data OR the advisory text ("fixed in 1.2.3"), and the
// latest version from the package registry the advisory names. It never loosens the rule:
//   fix found and the registry (or a GitHub release) already has it -> patched
//   fix found but not yet published                                   -> fix-unreleased (FAIL)
//   no fix version anywhere                                           -> unpatched (FAIL)
//   latest version can't be determined                                -> unconfirmed (REVIEW)
// Rewrites the verdicts in data/gate-log.json and data/blocklist.json accordingly.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = `${ROOT}data/gate-log.json`;
const BLOCK = `${ROOT}data/blocklist.json`;
const log = JSON.parse(readFileSync(LOG, 'utf8'));
const OPEN = new Set(['unpatched', 'fix-unreleased', 'patch-unconfirmed', 'partly-patched', 'unknown']);

const ver = s => { const m = String(s || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/); return m ? [+m[1], +m[2], +(m[3] || 0)] : null; };
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const maxVer = l => l.map(ver).filter(Boolean).sort(cmp).pop() || null;
const vs = v => (v ? v.join('.') : null);

async function gh(path) {
  try { return JSON.parse((await run('gh', ['api', path], { maxBuffer: 50 << 20 })).stdout); } catch { return null; }
}
async function getJSON(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'repo-radar-gate' } }); return r.ok ? await r.json() : null; } catch { return null; }
}
const tagCache = new Map();
async function latestTag(o, r) {
  const k = `${o}/${r}`;
  if (tagCache.has(k)) return tagCache.get(k);
  let tag = (await gh(`repos/${o}/${r}/releases/latest`))?.tag_name || null;
  if (!tag) tag = (await gh(`repos/${o}/${r}/tags?per_page=1`))?.[0]?.name || null;
  tagCache.set(k, tag);
  return tag;
}
const registryCache = new Map();
async function registryLatest(eco, name) {
  const key = `${eco}:${name}`;
  if (registryCache.has(key)) return registryCache.get(key);
  let v = null;
  const e = (eco || '').toLowerCase();
  if (e === 'npm') v = (await getJSON(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`))?.version;
  else if (e === 'pip' || e === 'pypi') v = (await getJSON(`https://pypi.org/pypi/${name}/json`))?.info?.version;
  else if (e === 'rust' || e === 'crates.io') v = (await getJSON(`https://crates.io/api/v1/crates/${name}`))?.crate?.max_version;
  else if (e === 'go') v = (await getJSON(`https://proxy.golang.org/${name.toLowerCase()}/@latest`))?.Version;
  else if (e === 'composer') { const d = await getJSON(`https://repo.packagist.org/p2/${name}.json`); v = d?.packages?.[name]?.[0]?.version; }
  else if (e === 'rubygems') v = (await getJSON(`https://rubygems.org/api/v1/gems/${name}.json`))?.version;
  registryCache.set(key, v || null);
  return v || null;
}
// "fixed in 1.2.3", "patched in version 1.2.3", "upgrade to 1.2.3", "1.2.3 contains a fix", "resolved in v1.2.3"
const FIX_TEXT = /(?:fixed|patched|resolved|addressed|remediated)\s+(?:in|with|by)\s+(?:version\s+|release\s+|v)?(\d+\.\d+(?:\.\d+)?)|upgrad\w*\s+to\s+(?:version\s+|v)?(\d+\.\d+(?:\.\d+)?)|(?:version|release)\s+v?(\d+\.\d+(?:\.\d+)?)\s+(?:contains|includes|fixes|patches|addresses)|(?:before|prior to)\s+(?:version\s+|v)?(\d+\.\d+(?:\.\d+)?)|:?v?(\d+\.\d+(?:\.\d+)?)`?\s+is the first (?:patched|fixed) version/gi;
function fixFromText(text) {
  const found = [];
  for (const m of String(text || '').matchAll(FIX_TEXT)) found.push(m[1] || m[2] || m[3] || m[4] || m[5]);
  return maxVer(found);
}
// "prior to commit 92c7a20", "fixed in commit 1518530", "patched in commit `4dc2c0a...`"
const FIX_COMMIT = /(?:prior to|before|fixed in|patched in|fixed by|addressed in)\s+commit\s+`?([0-9a-f]{7,40})`?/gi;
const commitsFromText = text => [...new Set([...String(text || '').matchAll(FIX_COMMIT)].map(m => m[1]))];
// GitHub convention: a strict "< X" range bound means X is the first fixed version ("<= X" means X is still affected).
const fixFromRanges = vulns => maxVer(vulns.map(v => (String(v.vulnerable_version_range || '').match(/(?:^|,\s*)<\s*v?(\d+\.\d+(?:\.\d+)?)/) || [])[1]).filter(Boolean));
async function commitInRelease(o, r, sha, tag) {
  if (!tag) return false;
  const inTag = async s => { const c = await gh(`repos/${o}/${r}/compare/${s}...${encodeURIComponent(tag)}`); return !!c && (c.status === 'ahead' || c.status === 'identical'); };
  if (await inTag(sha)) return true;
  // A PR-branch commit that was squash-merged lives on main under the PR's merge commit.
  const prs = (await gh(`repos/${o}/${r}/commits/${sha}/pulls`)) || [];
  for (const pr of prs) if (pr.merged_at && pr.merge_commit_sha && (await inTag(pr.merge_commit_sha))) return true;
  return false;
}

async function recheckItem(o, r, item, githubLatest) {
  // Load the full advisory: repository-level first, then the global database.
  const id = item.ghsa || item.id;
  let adv = id?.startsWith('GHSA') ? await gh(`repos/${o}/${r}/security-advisories/${id}`) : null;
  if (!adv || adv.message) adv = (await gh(`advisories?${id?.startsWith('GHSA') ? 'ghsa_id' : 'cve_id'}=${id}`))?.[0] || null;
  if (!adv) return { ...item, recheck: 'unconfirmed', why: 'advisory could not be loaded' };
  const vulns = adv.vulnerabilities || [];
  const structured = vulns.map(v => v.patched_versions || v.first_patched_version).filter(Boolean).flatMap(p => String(p).split(','));
  const text = `${adv.description || ''} ${adv.summary || ''}`;
  const fix = maxVer(structured) || fixFromText(text) || fixFromRanges(vulns);
  // A fix shipped as a commit counts only if the latest release actually contains that commit.
  const commits = commitsFromText(text);
  if (!fix && commits.length) {
    const tag = await latestTag(o, r);
    const inRel = [];
    for (const c of commits) inRel.push(await commitInRelease(o, r, c, tag));
    if (inRel.every(Boolean)) return { ...item, recheck: 'patched', why: `fix commit(s) ${commits.join(', ')} are in release ${tag}` };
    return { ...item, recheck: 'fix-unreleased', why: `fix commit(s) ${commits.filter((c, i) => !inRel[i]).join(', ')} not in latest release ${tag || '(none)'}` };
  }
  // Latest published version: every package the advisory names, plus GitHub's latest release/tag.
  const latestCandidates = [githubLatest];
  for (const v of vulns) if (v.package?.name) latestCandidates.push(ver(await registryLatest(v.package.ecosystem, v.package.name)));
  const latest = latestCandidates.filter(Boolean).sort(cmp).pop() || null;
  let recheck, why;
  if (!fix) { recheck = 'unpatched'; why = 'no fixed version in the advisory data or text'; }
  else if (!latest) { recheck = 'unconfirmed'; why = `fix ${vs(fix)} but no published version found to compare`; }
  else if (cmp(latest, fix) >= 0) { recheck = 'patched'; why = `fix ${vs(fix)}, latest published ${vs(latest)}`; }
  else { recheck = 'fix-unreleased'; why = `fix ${vs(fix)} newer than latest published ${vs(latest)}`; }
  return { ...item, recheck, why, packages: vulns.map(v => `${v.package?.ecosystem}:${v.package?.name}`).filter(x => !x.endsWith(':undefined')) };
}

const block = JSON.parse(readFileSync(BLOCK, 'utf8'));
const changed = [];
for (const [repo, e] of Object.entries(log)) {
  const [o, r] = repo.split('/');
  const adv = e.checks?.advisories || {};
  const githubLatest = adv.latestRelease ? ver(adv.latestRelease) : null;
  const openAdv = (adv.items || []).filter(i => OPEN.has(i.status));
  const openCve = (e.checks?.searches?.cves || []).filter(c => OPEN.has(c.status) && c.status !== 'other-project');
  if (!openAdv.length && !openCve.length) {
    // Nothing open any more: recompute from the remaining (non-advisory) reasons.
    if (e.verdict === 'FAIL' && !e.settled) {
      const other = (e.reasons || []).filter(x => !/advisor|CVE|patch/i.test(x));
      e.verdict = other.length ? 'REVIEW' : 'PASS'; e.reasons = other;
      const i = block.findIndex(b => b.repo.toLowerCase() === repo.toLowerCase());
      if (i >= 0) block.splice(i, 1);
      changed.push(`${repo}: FAIL -> ${e.verdict}`);
    }
    continue;
  }
  const before = e.verdict;
  const rechecked = [];
  for (const i of [...openAdv, ...openCve]) rechecked.push(await recheckItem(o, r, i, githubLatest));
  e.recheck = { date: new Date().toISOString().slice(0, 10), items: rechecked };
  const bad = rechecked.filter(x => x.recheck === 'unpatched' || x.recheck === 'fix-unreleased');
  const unsure = rechecked.filter(x => x.recheck === 'unconfirmed');
  // Rebuild the advisory part of the verdict; keep any non-advisory REVIEW reasons.
  const other = (e.reasons || []).filter(x => !/advisor|CVE|patch/i.test(x));
  if (bad.length) { e.verdict = 'FAIL'; e.reasons = [`${bad.length} open after registry recheck: ${bad.map(b => `${b.ghsa || b.id} ${b.severity || ''} (${b.why})`).join('; ')}`, ...other]; }
  else if (unsure.length) { e.verdict = 'REVIEW'; e.reasons = [`${unsure.length} advisory(ies) unconfirmed: ${unsure.map(u => `${u.ghsa || u.id} (${u.why})`).join('; ')}`, ...other]; }
  else { e.verdict = other.length ? 'REVIEW' : 'PASS'; e.reasons = other; }
  const i = block.findIndex(b => b.repo.toLowerCase() === repo.toLowerCase());
  if (e.verdict === 'FAIL' && i < 0) block.push({ repo, date: e.recheck.date, reason: e.reasons[0] });
  if (e.verdict !== 'FAIL' && i >= 0 && !e.settled) block.splice(i, 1);
  if (before !== e.verdict) changed.push(`${repo}: ${before} -> ${e.verdict}`);
  process.stderr.write(`${e.verdict.padEnd(6)} ${repo}  ${rechecked.map(x => `${x.ghsa || x.id}=${x.recheck}`).join(', ')}\n`);
}
writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
writeFileSync(BLOCK, JSON.stringify(block, null, 2) + '\n');
console.log(`changed ${changed.length}:\n${changed.join('\n')}`);
