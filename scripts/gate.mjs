// gate.mjs - the Repo Radar security gate (repo-lookup SKILL.md section 1c), run locally.
//
// For each repo: (1) GitHub security advisories, with patch status checked against the latest
// release; (2) web searches for "<repo> CVE / vulnerability / malware / scam"; (3) a
// stars-vs-activity sanity check. Writes evidence to data/gate-log.json. Auto-verdicts:
//   FAIL   - an open or unreleased-fix advisory (binary rule, no soft-pedaling)
//   REVIEW - a search hit, an activity red flag, or a High/Critical fix whose release can't be confirmed
//   PASS   - none of the above
// REVIEW entries are settled by a human with `node scripts/gate.mjs --settle owner/repo PASS|FAIL "note"`.
//
// Usage:
//   node scripts/gate.mjs --catalog            gate every repo the site recommends (scripts/catalog.mjs)
//   node scripts/gate.mjs owner/repo [...]     gate specific repos
//   node scripts/gate.mjs --settle owner/repo PASS|FAIL "why"
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = `${ROOT}data/gate-log.json`;
const BLOCK = `${ROOT}data/blocklist.json`;
const TODAY = new Date().toISOString().slice(0, 10);
const load = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

async function gh(path, headers = false) {
  const args = ['api', ...(headers ? ['-i'] : []), path];
  try { return (await run('gh', args, { maxBuffer: 50 << 20 })).stdout; }
  catch (e) { return { error: (e.stderr || e.message).trim().slice(0, 200) }; }
}
const lastPage = raw => {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/[?&]page=(\d+)>; rel="last"/);
  if (m) return +m[1];
  const body = raw.slice(raw.indexOf('\r\n\r\n') + 4 || raw.indexOf('\n\n') + 2);
  try { return JSON.parse(body).length; } catch { return null; }
};

// ---- versions -------------------------------------------------------------------------------
const ver = s => { const m = String(s || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/); return m ? [+m[1], +m[2], +(m[3] || 0)] : null; };
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
const maxVer = list => list.map(ver).filter(Boolean).sort(cmp).pop() || null;

// ---- check 1: advisories ---------------------------------------------------------------------
async function advisories(o, r) {
  const url = `https://github.com/${o}/${r}/security/advisories`;
  const raw = await gh(`repos/${o}/${r}/security-advisories?per_page=100`);
  if (raw.error) return { source: 'github-api', url, error: raw.error };
  const list = JSON.parse(raw).filter(a => a.state !== 'withdrawn' && a.state !== 'draft');
  let latest = null;
  const rel = await gh(`repos/${o}/${r}/releases/latest`);
  if (!rel.error) latest = ver(JSON.parse(rel).tag_name);
  if (!latest) {
    const tags = await gh(`repos/${o}/${r}/tags?per_page=50`);
    if (!tags.error) latest = maxVer(JSON.parse(tags).map(t => t.name));
  }
  const items = list.map(a => {
    const patched = (a.vulnerabilities || []).map(v => v.patched_versions).filter(Boolean);
    const fix = maxVer(patched.flatMap(p => p.split(',')));
    const vulns = a.vulnerabilities || [];
    const openPkgs = vulns.filter(v => !v.patched_versions).map(v => v.package?.name || '?');
    let status;
    if (!patched.length) status = 'unpatched';
    else if (openPkgs.length) status = 'partly-patched';
    else if (!fix || !latest) status = 'patch-unconfirmed';
    else status = cmp(latest, fix) >= 0 ? 'patched' : 'fix-unreleased';
    return { ghsa: a.ghsa_id, cve: a.cve_id, severity: a.severity, published: (a.published_at || '').slice(0, 10), summary: (a.summary || '').slice(0, 140), patched: patched.join('; ') || null, openPackages: openPkgs, status };
  });
  return { source: 'github-api', url, count: items.length, latestRelease: latest ? latest.join('.') : null, items };
}

// ---- check 2: searches -----------------------------------------------------------------------
const RISK = /\bCVE-\d{4}-\d+|vulnerab|malware|malicious|backdoor|exploit|remote code execution|\bRCE\b|compromis|supply[- ]chain attack|stealer|trojan|\bscam|phishing|exfiltrat|data leak|secretly|silently upload|security incident|hijack/i;
const GENERIC = new Set(['skills', 'agents', 'cli', 'crm', 'computer', 'improve', 'qm', 'core', 'code', 'harness', 'reef', 'kev', 'pi', 'odysseus', 'orca', 'caveman', 'utopia', 'colibri', 'artemis', 'hypit', 'shannon', 'superset', 'grafana', 'huginn', 'windmill', 'khoj', 'twenty', 'dagger', 'coolify', 'onlook', 'penpot']);
function mentions(text, o, r) {
  const t = text.toLowerCase();
  if (t.includes(`${o}/${r}`.toLowerCase())) return true;
  if (GENERIC.has(r.toLowerCase()) || r.length < 5) return t.includes(o.toLowerCase()) && new RegExp(`\\b${r.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t);
  return t.includes(r.toLowerCase());
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let EXA_PATIENT = false; // --retry-searches: wait out rate limits instead of failing fast
let exaBlockedUntil = 0; // while Exa is rate-limited, skip straight to the fallback sources
async function exa(query) {
  if (Date.now() < exaBlockedUntil) return { error: 'exa rate limited (skipped)' };
  const res = await exaOnce(query);
  if (res.error && /429|rate limit/i.test(res.error)) exaBlockedUntil = Date.now() + 10 * 60000;
  return res;
}
async function exaOnce(query) {
  try {
    const { stdout } = await run('mcporter', ['call', 'exa', 'web_search_exa', '--args', JSON.stringify({ query, numResults: 5 })], { maxBuffer: 20 << 20, timeout: 60000 });
    return stdout.split(/\n---\n/).map(b => ({
      title: (b.match(/^Title: (.*)$/m) || [])[1] || '',
      url: (b.match(/^URL: (.*)$/m) || [])[1] || '',
      published: ((b.match(/^Published: (.*)$/m) || [])[1] || '').slice(0, 10),
      text: b,
    })).filter(x => x.url);
  } catch (e) { return { error: (e.stderr || e.message || '').slice(0, 160) }; }
}
const SCANNERS = /mondoo\.com|clawsecure\.ai|snyk\.io\/(?:advisor|package)|socket\.dev|reversinglabs|oathe|skillsafe|agentaudit|security audit report|security scan/i;
const CVE_RECORD = /nvd\.nist\.gov|cve\.org|cve\.mitre\.org|opencve\.io|osv\.dev|github\.com\/advisories|gcve\.eu|vulnerability-lookup|cvedetails|vuldb\.com|security\.snyk\.io\/vuln|cvefeed|tenable\.com\/cve/i;
function kind(h, o, r) {
  if (h.url.toLowerCase().startsWith(`https://github.com/${o}/${r}/security`.toLowerCase())) return 'own-security-page';
  if (SCANNERS.test(h.url) || SCANNERS.test(h.title)) return 'scanner';
  if (CVE_RECORD.test(h.url) || /^(NVD|CVE)/.test(h.title)) return 'cve-record';
  return 'report';
}
async function cveStatus(id, o, r, latest) {
  const raw = await gh(`advisories?${id.startsWith('GHSA') ? 'ghsa_id' : 'cve_id'}=${id}`);
  if (raw.error) return { id, status: 'unknown', note: raw.error };
  const adv = JSON.parse(raw)[0];
  if (!adv) return { id, status: 'unknown', note: 'not in GitHub advisory database' };
  const src = (adv.source_code_location || '').toLowerCase();
  // An unreviewed record with no package and no source repo can't be tied to this project.
  if (!src && !(adv.vulnerabilities || []).length) return { id, ghsa: adv.ghsa_id, severity: adv.severity, status: 'other-project', note: 'unreviewed record not tied to this repo' };
  const ours = !src || src.includes(`github.com/${o}/${r}`.toLowerCase());
  const fixes = (adv.vulnerabilities || []).map(v => v.first_patched_version).filter(Boolean);
  const fix = maxVer(fixes);
  let status;
  if (!ours) status = 'other-project';
  else if (!fixes.length) status = 'unpatched';
  else if (!fix || !latest) status = 'patch-unconfirmed';
  else status = cmp(latest, fix) >= 0 ? 'patched' : 'fix-unreleased';
  return { id, ghsa: adv.ghsa_id, severity: adv.severity, fix: fixes.join('; ') || null, status };
}
async function fallback(q, o, r) {
  // CVE / vulnerability -> NVD keyword search; malware / scam -> Hacker News stories and comments.
  const kw = q.split(' ').pop();
  try {
    if (kw === 'CVE' || kw === 'vulnerability') {
      await sleep(6500); // NVD allows 5 requests per 30 seconds without a key
      const res = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(`${o} ${r}`)}&resultsPerPage=20`);
      if (!res.ok) return { error: `nvd ${res.status}` };
      const d = await res.json();
      return (d.vulnerabilities || []).map(v => ({ title: `NVD - ${v.cve.id}`, url: `https://nvd.nist.gov/vuln/detail/${v.cve.id}`, published: (v.cve.published || '').slice(0, 10), text: `${v.cve.id} ${(v.cve.descriptions || []).map(x => x.value).join(' ')}` }));
    }
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`${r} ${kw}`)}&hitsPerPage=10`);
    if (!res.ok) return { error: `hn ${res.status}` };
    const d = await res.json();
    return (d.hits || []).map(h => ({ title: h.title || (h.comment_text || '').replace(/<[^>]+>/g, ' ').slice(0, 120), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, published: (h.created_at || '').slice(0, 10), text: `${h.title || ''} ${h.url || ''} ${(h.comment_text || h.story_text || '').replace(/<[^>]+>/g, ' ')}` }));
  } catch (e) { return { error: String(e.message || e).slice(0, 120) }; }
}
async function searches(o, r) {
  const queries = ['CVE', 'vulnerability', 'malware', 'scam'].map(k => `${o}/${r} ${k}`);
  const out = { engine: 'exa', queries, results: 0, errors: 0, hits: [], fallbacks: 0 };
  for (const q of queries) {
    let res = await exa(q);
    if (res.error) { res = await fallback(q, o, r); if (!res.error) out.fallbacks++; }
    if (res.error) { out.errors++; continue; }
    out.results += res.length;
    for (const x of res) {
      const ownRepoPage = x.url.toLowerCase().startsWith(`https://github.com/${o}/${r}`.toLowerCase()) && !/security|advisor/i.test(x.url);
      if (!ownRepoPage && mentions(x.text, o, r) && RISK.test(x.text)) {
        const hit = x.text.match(RISK)[0];
        if (!out.hits.some(h => h.url === x.url)) out.hits.push({ query: q, title: x.title.slice(0, 140), url: x.url, published: x.published, matched: hit });
      }
    }
  }
  return out;
}

// ---- check 3: activity sanity ----------------------------------------------------------------
async function activity(o, r) {
  const raw = await gh(`repos/${o}/${r}`);
  if (raw.error) return { error: raw.error };
  const m = JSON.parse(raw);
  const contributors = lastPage(await gh(`repos/${o}/${r}/contributors?per_page=1&anon=true`, true));
  const commits = lastPage(await gh(`repos/${o}/${r}/commits?per_page=1`, true));
  const ageDays = Math.round((Date.now() - Date.parse(m.created_at)) / 864e5);
  const a = { canonical: m.full_name, stars: m.stargazers_count, forks: m.forks_count, watchers: m.subscribers_count, openIssues: m.open_issues_count, hasIssues: m.has_issues, contributors, commits, created: m.created_at.slice(0, 10), pushed: m.pushed_at.slice(0, 10), archived: m.archived, ageDays, homepage: m.homepage || null, license: m.license?.spdx_id || null };
  const flags = [];
  if (a.canonical.toLowerCase() !== `${o}/${r}`.toLowerCase()) flags.push(`renamed/moved to ${a.canonical}`);
  if (a.stars >= 5000 && contributors !== null && contributors <= 2) flags.push(`${a.stars} stars on ${contributors} contributor(s)`);
  if (a.stars >= 5000 && commits !== null && commits < 30) flags.push(`${a.stars} stars on only ${commits} commit(s)`);
  if (a.stars >= 10000 && a.watchers / a.stars < 0.001) flags.push(`very few watchers for the stars (${a.watchers})`);
  if (a.stars >= 10000 && a.hasIssues && a.openIssues === 0 && ageDays > 30) flags.push('no open issues or PRs despite the stars');
  if (a.archived) flags.push('archived');
  return { ...a, flags };
}

// ---- gate one repo ---------------------------------------------------------------------------
async function gate(repo, { reuse } = {}) {
  const [o, r] = repo.split('/');
  const [adv, act] = reuse ? [reuse.checks.advisories, reuse.checks.activity] : await Promise.all([advisories(o, r), activity(o, r)]);
  const srch = await searches(o, r);
  for (const h of srch.hits) h.kind = kind(h, o, r);
  const latest = adv.latestRelease ? ver(adv.latestRelease) : null;
  const ids = [...new Set(srch.hits.filter(h => h.kind === 'cve-record').flatMap(h => (h.title + ' ' + h.url).match(/CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) || []).map(x => x.toUpperCase().replace(/^GHSA/, 'GHSA')))];
  const known = new Set((adv.items || []).flatMap(i => [i.ghsa, i.cve]).filter(Boolean).map(x => x.toUpperCase()));
  srch.cves = [];
  for (const id of ids.filter(x => !known.has(x))) srch.cves.push(await cveStatus(id.startsWith('GHSA') ? id.toLowerCase().replace(/^ghsa/, 'GHSA') : id, o, r, latest));
  const reasons = [];
  let verdict = 'PASS';
  if (adv.error) { verdict = 'REVIEW'; reasons.push(`advisories check failed: ${adv.error}`); }
  else {
    const bad = adv.items.filter(i => i.status === 'unpatched' || i.status === 'fix-unreleased');
    if (bad.length) { verdict = 'FAIL'; reasons.push(`${bad.length} open advisory(ies): ${bad.map(b => `${b.ghsa} ${b.severity} (${b.status})`).join(', ')}`); }
    const unconf = adv.items.filter(i => i.status === 'patch-unconfirmed' && /high|critical/i.test(i.severity || ''));
    if (!bad.length && unconf.length) { verdict = 'REVIEW'; reasons.push(`${unconf.length} High/Critical advisory(ies) with an unconfirmed patch release`); }
    const partly = adv.items.filter(i => i.status === 'partly-patched');
    if (!bad.length && partly.length) { verdict = 'REVIEW'; reasons.push(`${partly.length} advisory(ies) patched for one package but open for: ${[...new Set(partly.flatMap(i => i.openPackages))].join(', ')}`); }
  }
  const openCves = srch.cves.filter(c => c.status === 'unpatched' || c.status === 'fix-unreleased');
  if (openCves.length) { verdict = 'FAIL'; reasons.push(`${openCves.length} open CVE(s) found by search: ${openCves.map(c => `${c.id} ${c.severity || ''} (${c.status})`).join(', ')}`); }
  const unsureCves = srch.cves.filter(c => c.status === 'unknown' || c.status === 'patch-unconfirmed');
  if (verdict !== 'FAIL' && unsureCves.length) { verdict = 'REVIEW'; reasons.push(`${unsureCves.length} CVE(s) to check by hand: ${unsureCves.map(c => c.id).join(', ')}`); }
  const reports = srch.hits.filter(h => h.kind === 'report');
  if (verdict !== 'FAIL' && reports.length) { verdict = 'REVIEW'; reasons.push(`${reports.length} report(s) to read`); }
  if (verdict !== 'FAIL' && srch.errors === srch.queries.length) { verdict = 'REVIEW'; reasons.push('all searches failed'); }
  if (verdict !== 'FAIL' && act.flags?.length) { verdict = 'REVIEW'; reasons.push(`activity: ${act.flags.join('; ')}`); }
  if (act.error) { verdict = verdict === 'FAIL' ? 'FAIL' : 'REVIEW'; reasons.push(`activity check failed: ${act.error}`); }
  return { repo, checked: TODAY, verdict, reasons, checks: { advisories: adv, searches: srch, activity: act } };
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---- main ------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const log = load(LOG, {});
const block = load(BLOCK, []);

if (argv[0] === '--settle') {
  const [, repo, verdict, note] = argv;
  const key = Object.keys(log).find(k => k.toLowerCase() === repo.toLowerCase());
  if (!key || !['PASS', 'FAIL'].includes(verdict) || !note) { console.error('usage: --settle owner/repo PASS|FAIL "note"'); process.exit(1); }
  log[key].verdict = verdict; log[key].settled = { by: 'human review', date: TODAY, note };
  if (verdict === 'FAIL' && !block.some(b => b.repo.toLowerCase() === key.toLowerCase())) block.push({ repo: key, date: TODAY, reason: note });
  save(LOG, log); save(BLOCK, block);
  console.log(`${key}: ${verdict} (${note})`);
  process.exit(0);
}

if (argv.includes('--retry-searches')) {
  EXA_PATIENT = true;
  const { stdout: cat } = await run('node', [`${ROOT}scripts/catalog.mjs`, '--json'], { maxBuffer: 20 << 20 });
  const live = new Set(JSON.parse(cat).map(e => e.repo.toLowerCase()));
  const todo = Object.values(log).filter(e => e.checks?.searches?.errors > 0 && !e.settled && live.has(e.repo.toLowerCase()));
  process.stderr.write(`retrying searches for ${todo.length} repos\n`);
  let k = 0;
  for (const e of todo) {
    k++;
    const [o, r] = e.repo.split('/');
    const fresh = await gate(e.repo, { reuse: e });
    log[e.repo] = fresh;
    const bi = block.findIndex(b => b.repo.toLowerCase() === e.repo.toLowerCase());
    if (fresh.verdict === 'FAIL' && bi < 0) block.push({ repo: e.repo, date: TODAY, reason: fresh.reasons.join(' | ') });
    save(LOG, log); save(BLOCK, block);
    process.stderr.write(`[${k}/${todo.length}] ${fresh.verdict.padEnd(6)} ${e.repo}  searches: ${fresh.checks.searches.results} results, ${fresh.checks.searches.errors} errors, ${fresh.checks.searches.fallbacks} via fallback${fresh.reasons.length ? ' - ' + fresh.reasons.join(' | ') : ''}\n`);
  }
  process.exit(0);
}
let repos = argv.filter(a => !a.startsWith('--'));
if (argv.includes('--catalog')) {
  const { stdout } = await run('node', [`${ROOT}scripts/catalog.mjs`, '--json'], { maxBuffer: 20 << 20 });
  repos = JSON.parse(stdout).map(e => e.repo);
}
if (!repos.length) { console.error('nothing to gate'); process.exit(1); }

const results = await pool(repos, 5, async (repo, k) => {
  const res = await gate(repo);
  process.stderr.write(`[${k + 1}/${repos.length}] ${res.verdict.padEnd(6)} ${repo}${res.reasons.length ? '  - ' + res.reasons.join(' | ') : ''}\n`);
  log[res.repo] = res; // save as we go, so a killed run keeps its work
  if (res.verdict === 'FAIL' && !block.some(b => b.repo.toLowerCase() === res.repo.toLowerCase()))
    block.push({ repo: res.repo, date: TODAY, reason: res.reasons.join(' | ') });
  save(LOG, log); save(BLOCK, block);
  return res;
});
const tally = results.reduce((t, x) => ((t[x.verdict] = (t[x.verdict] || 0) + 1), t), {});
console.log(JSON.stringify(tally));
