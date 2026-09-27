// gate.mjs - the Repo Radar security gate (docs/SECURITY_GATE.md).
//
// For each repo: (1) GitHub security advisories, with patch status checked against the latest
// release; (2) web searches for "<repo> CVE / vulnerability / malware / scam"; (3) a
// stars-vs-activity sanity check. Writes evidence to data/gate-log.json. Auto-verdicts:
//   FAIL   - an open or unreleased-fix advisory (binary rule, no soft-pedaling)
//   REVIEW - a search hit, an activity red flag, or a fix whose release can't be confirmed
//   PASS   - none of the above
// REVIEW entries are settled with `node scripts/gate.mjs --settle owner/repo PASS|FAIL "note"`.
// A settled ruling carries over a later re-gate only if nothing new turned up (gate-lib newConcerns).
//
// Two ways to read GitHub, same rules: the API through `gh` (a Mac with gh signed in), or GitHub's
// public pages (the Friday cloud routine, which can't reach the API; see public-pages.mjs).
// Public pages are used automatically when gh isn't available, or with --web.
//
// Usage:
//   node scripts/gate.mjs owner/repo [...]     gate specific repos
//   node scripts/gate.mjs --catalog            gate every repo the site recommends (scripts/catalog.mjs)
//   node scripts/gate.mjs --recheck [--limit 60] [--stale-days 14] [owner/repo ...]
//        the weekly re-check: every listed repo's advisories; a repo with a new one is gated again,
//        and so are up to --limit repos whose last full gate is --stale-days old or more
//   node scripts/gate.mjs --settle owner/repo PASS|FAIL "why" [--by routine]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ver, cmp, maxVer, tiedToRepo, advisoryStatus, activityFlags, newConcerns, predates } from './gate-lib.mjs';
import * as web from './public-pages.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const LOG = `${ROOT}data/gate-log.json`;
const BLOCK = `${ROOT}data/blocklist.json`;
const TODAY = new Date().toISOString().slice(0, 10);
const load = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
const argv = process.argv.slice(2);
const opt = (name, d) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : d);
const WEB = argv.includes('--web') || !(await run('gh', ['auth', 'status']).then(() => true, () => false));

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

// ---- check 1: advisories ---------------------------------------------------------------------
async function advisories(o, r) {
  if (WEB) return advisoriesWeb(o, r);
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

// The latest published version for an advisory: the GitHub release, or any registry it names.
async function latestFor(packages, ghLatest) {
  const found = [ghLatest];
  for (const p of packages || []) if (p.name && p.ecosystem) found.push(ver(await web.registryLatest(p.ecosystem, p.name)));
  return found.filter(Boolean).sort(cmp).pop() || null;
}

async function advisoriesWeb(o, r) {
  const list = await web.advisoryList(o, r);
  if (list.error) return { source: 'public-page', url: list.url, error: list.error };
  const ghLatest = ver(await web.latestRelease(o, r));
  const items = [];
  for (const it of list.items) {
    const d = await web.repoAdvisory(o, r, it.ghsa);
    if (d.error) return { source: 'public-page', url: list.url, error: d.error };
    const latest = await latestFor(d.packages, ghLatest);
    const s = advisoryStatus(d, latest, o, r);
    items.push({ ghsa: it.ghsa, cve: d.cve, severity: d.severity || it.severity, published: it.published, summary: it.summary, patched: d.packages.map(p => p.patched).filter(Boolean).join('; ') || null, openPackages: s.status === 'partly-patched' ? s.open : [], status: s.status, latestPublished: latest ? latest.join('.') : null });
  }
  return { source: 'public-page', url: list.url, count: items.length, latestRelease: ghLatest ? ghLatest.join('.') : null, items };
}

// Just the IDs, for the weekly re-check.
async function advisoryIds(o, r) {
  if (WEB) { const l = await web.advisoryList(o, r); return l.error ? { error: l.error } : { ids: l.items.map(i => i.ghsa) }; }
  const raw = await gh(`repos/${o}/${r}/security-advisories?per_page=100`);
  if (raw.error) return { error: raw.error };
  return { ids: JSON.parse(raw).filter(a => a.state !== 'withdrawn' && a.state !== 'draft').map(a => a.ghsa_id) };
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
let exaBlockedUntil = 0; // while Exa is rate-limited or missing, skip straight to the fallback sources
async function exa(query) {
  if (Date.now() < exaBlockedUntil) return { error: 'exa unavailable (skipped)' };
  const res = await exaOnce(query);
  if (res.error && /ENOENT|not found|spawn/i.test(res.error)) exaBlockedUntil = Infinity; // no mcporter here (the cloud)
  else if (res.error && /429|rate limit/i.test(res.error)) exaBlockedUntil = Date.now() + 10 * 60000;
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
  } catch (e) { return { error: (e.code === 'ENOENT' ? 'ENOENT ' : '') + (e.stderr || e.message || '').slice(0, 160) }; }
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
  if (WEB) return cveStatusWeb(id, o, r, latest);
  const raw = await gh(`advisories?${id.startsWith('GHSA') ? 'ghsa_id' : 'cve_id'}=${id}`);
  if (raw.error) return { id, status: 'unknown', note: raw.error };
  const adv = JSON.parse(raw)[0];
  if (!adv) return { id, status: 'unknown', note: 'not in GitHub advisory database' };
  const ours = tiedToRepo(adv, o, r);
  const fixes = (adv.vulnerabilities || []).map(v => v.first_patched_version).filter(Boolean);
  const fix = maxVer(fixes);
  let status;
  if (!ours) status = 'other-project';
  else if (!fixes.length) status = 'unpatched';
  else if (!fix || !latest) status = 'patch-unconfirmed';
  else status = cmp(latest, fix) >= 0 ? 'patched' : 'fix-unreleased';
  return { id, ghsa: adv.ghsa_id, severity: adv.severity, fix: fixes.join('; ') || null, status };
}
async function cveStatusWeb(id, o, r, latest) {
  const g = await web.globalAdvisory(id);
  if (g.error) return { id, status: 'unknown', note: g.error };
  if (g.missing) return { id, status: 'unknown', note: 'not in GitHub advisory database' };
  if (!tiedToRepo({ source_code_location: g.sourceCode, references: g.references, description: g.description }, o, r)) return { id, ghsa: g.ghsa, severity: g.severity, status: 'other-project' };
  const s = advisoryStatus(g, await latestFor(g.packages, latest), o, r);
  return { id, ghsa: g.ghsa, severity: g.severity, fix: s.fix ? s.fix.join('.') : null, status: s.status };
}
// The national CVE database (NVD) is read directly for every repo, locally and in the cloud: Exa's
// web results missed firecrawl's CVE-2026-32857 on Sep 27 2026. NVD allows 5 requests per 30 seconds
// without a key, so requests go one at a time, 6.5 s apart, one per repo, retried once.
let nvdTurn = Promise.resolve();
const nvdCache = new Map();
async function nvdOnce(o, r) {
  try {
    const res = await fetch(`https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(`${o} ${r}`)}&resultsPerPage=100`, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) return { error: `nvd ${res.status}` };
    const d = await res.json();
    return (d.vulnerabilities || []).map(v => ({ title: `NVD - ${v.cve.id}`, url: `https://nvd.nist.gov/vuln/detail/${v.cve.id}`, published: (v.cve.published || '').slice(0, 10), text: `${v.cve.id} ${(v.cve.descriptions || []).map(x => x.value).join(' ')}` }));
  } catch (e) { return { error: String(e.message || e).slice(0, 120) }; }
}
function nvd(o, r) {
  const k = `${o}/${r}`.toLowerCase();
  if (!nvdCache.has(k)) {
    const mine = nvdTurn.then(async () => {
      const first = await nvdOnce(o, r);
      if (!first.error) return first;
      await sleep(12000);
      return nvdOnce(o, r);
    });
    nvdTurn = mine.then(() => sleep(6500));
    nvdCache.set(k, mine);
  }
  return nvdCache.get(k);
}
// Hacker News stands in for Exa on the malware and scam questions when Exa isn't available.
async function hn(q, o, r) {
  const kw = q.split(' ').pop();
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`${r} ${kw}`)}&hitsPerPage=10`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { error: `hn ${res.status}` };
    const d = await res.json();
    return (d.hits || []).map(h => ({ from: 'hn', title: h.title || (h.comment_text || '').replace(/<[^>]+>/g, ' ').slice(0, 120), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, published: (h.created_at || '').slice(0, 10), text: `${h.title || ''} ${h.url || ''} ${(h.comment_text || h.story_text || '').replace(/<[^>]+>/g, ' ')}` }));
  } catch (e) { return { error: String(e.message || e).slice(0, 120) }; }
}
async function searches(o, r) {
  const queries = ['CVE', 'vulnerability', 'malware', 'scam'].map(k => `${o}/${r} ${k}`);
  const out = { engine: 'exa', queries, results: 0, errors: 0, hits: [], fallbacks: 0 };
  const own = new RegExp(`${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|github\\.com/${o}/${r}\\b`, 'i');
  const take = (q, res) => {
    for (const x of res) {
      // Hacker News is keyword search over free text: a repo named with an everyday word ("atlas",
      // "impeccable") only counts when the story or comment also names the owner or links the repo.
      if ((x.from === 'hn' || /news\.ycombinator\.com\/item/.test(x.url)) && !own.test(x.text)) continue;
      const ownRepoPage = x.url.toLowerCase().startsWith(`https://github.com/${o}/${r}`.toLowerCase()) && !/security|advisor/i.test(x.url);
      if (!ownRepoPage && mentions(x.text, o, r) && RISK.test(x.text)) {
        const hit = x.text.match(RISK)[0];
        if (!out.hits.some(h => h.url === x.url)) out.hits.push({ query: q, title: x.title.slice(0, 140), url: x.url, published: x.published, matched: hit });
      }
    }
  };
  const n = await nvd(o, r);
  for (const q of queries) {
    let res = await exa(q);
    if (res.error) {
      if (/ (CVE|vulnerability)$/.test(q)) { if (n.error) out.errors++; else out.fallbacks++; continue; } // the CVE database below covers these
      res = await hn(q, o, r);
      if (res.error) { out.errors++; continue; }
      out.fallbacks++;
    }
    out.results += res.length;
    take(q, res);
  }
  if (n.error) out.nvd = { error: n.error };
  else { out.nvd = { results: n.length }; out.results += n.length; take(`${o}/${r} CVE database`, n); }
  out.engine = [exaBlockedUntil === Infinity ? null : 'exa', out.fallbacks ? 'hn' : null, 'nvd'].filter(Boolean).join('+');
  return out;
}

// ---- check 3: activity sanity ----------------------------------------------------------------
async function activity(o, r) {
  if (WEB) {
    const f = await web.repoFacts(o, r);
    if (f.error) return { source: 'public-page', error: f.error };
    const a = { source: 'public-page', canonical: f.canonical || `${o}/${r}`, stars: f.stars, forks: f.forks, watchers: f.watchers, openIssues: f.openIssues, hasIssues: f.hasIssues, contributors: f.contributors, commits: f.commits, created: f.created, pushed: f.pushed, archived: f.archived, ageDays: f.created ? Math.round((Date.now() - Date.parse(f.created)) / 864e5) : null };
    return { ...a, flags: activityFlags(a, o, r) };
  }
  const raw = await gh(`repos/${o}/${r}`);
  if (raw.error) return { error: raw.error };
  const m = JSON.parse(raw);
  const contributors = lastPage(await gh(`repos/${o}/${r}/contributors?per_page=1&anon=true`, true));
  const commits = lastPage(await gh(`repos/${o}/${r}/commits?per_page=1`, true));
  const ageDays = Math.round((Date.now() - Date.parse(m.created_at)) / 864e5);
  const a = { canonical: m.full_name, stars: m.stargazers_count, forks: m.forks_count, watchers: m.subscribers_count, openIssues: m.open_issues_count, hasIssues: m.has_issues, contributors, commits, created: m.created_at.slice(0, 10), pushed: m.pushed_at.slice(0, 10), archived: m.archived, ageDays, homepage: m.homepage || null, license: m.license?.spdx_id || null };
  return { ...a, flags: activityFlags(a, o, r) };
}

// ---- gate one repo ---------------------------------------------------------------------------
const UNSURE = new Set(['unknown', 'patch-unconfirmed', 'fix-unverified', 'partly-patched']);
async function gate(repo, { reuse } = {}) {
  const [o, r] = repo.split('/');
  const [adv, act] = reuse ? [reuse.checks.advisories, reuse.checks.activity] : await Promise.all([advisories(o, r), activity(o, r)]);
  const srch = await searches(o, r);
  for (const h of srch.hits) h.kind = kind(h, o, r);
  const latest = adv.latestRelease ? ver(adv.latestRelease) : null;
  const ids = [...new Set(srch.hits.filter(h => h.kind === 'cve-record').flatMap(h => (h.title + ' ' + h.url).match(/CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) || []).map(x => x.toUpperCase()))];
  const known = new Set((adv.items || []).flatMap(i => [i.ghsa, i.cve]).filter(Boolean).map(x => x.toUpperCase()));
  srch.cves = [];
  const nvdDate = new Map(srch.hits.filter(h => /nvd\.nist\.gov/.test(h.url)).map(h => [(h.url.match(/CVE-\d{4}-\d+/i) || [''])[0].toUpperCase(), h.published]));
  for (const id of ids.filter(x => !known.has(x))) {
    if (predates(nvdDate.get(id), act.created)) { srch.cves.push({ id, status: 'other-project', note: `published ${nvdDate.get(id)}, before the repo existed (${act.created})` }); continue; }
    srch.cves.push(await cveStatus(id.startsWith('GHSA') ? id.toLowerCase().replace(/^ghsa/, 'GHSA') : id, o, r, latest));
  }
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
    const byCommit = adv.items.filter(i => i.status === 'fix-unverified');
    if (!bad.length && byCommit.length) { verdict = 'REVIEW'; reasons.push(`${byCommit.length} advisory(ies) fixed by a commit or pull request that public pages can't trace to a release: ${byCommit.map(b => b.ghsa).join(', ')}`); }
  }
  const openCves = srch.cves.filter(c => c.status === 'unpatched' || c.status === 'fix-unreleased');
  if (openCves.length) { verdict = 'FAIL'; reasons.push(`${openCves.length} open CVE(s) found by search: ${openCves.map(c => `${c.id} ${c.severity || ''} (${c.status})`).join(', ')}`); }
  const unsureCves = srch.cves.filter(c => UNSURE.has(c.status));
  if (verdict !== 'FAIL' && unsureCves.length) { verdict = 'REVIEW'; reasons.push(`${unsureCves.length} CVE(s) to check by hand: ${unsureCves.map(c => c.id).join(', ')}`); }
  const reports = srch.hits.filter(h => h.kind === 'report');
  if (verdict !== 'FAIL' && reports.length) { verdict = 'REVIEW'; reasons.push(`${reports.length} report(s) to read`); }
  if (verdict !== 'FAIL' && srch.nvd?.error) { verdict = 'REVIEW'; reasons.push(`CVE database search failed: ${srch.nvd.error}`); }
  if (verdict !== 'FAIL' && srch.errors === srch.queries.length) { verdict = 'REVIEW'; reasons.push('all searches failed'); }
  if (verdict !== 'FAIL' && act.flags?.length) { verdict = 'REVIEW'; reasons.push(`activity: ${act.flags.join('; ')}`); }
  if (act.error) { verdict = verdict === 'FAIL' ? 'FAIL' : 'REVIEW'; reasons.push(`activity check failed: ${act.error}`); }
  return { repo, checked: TODAY, verdict, reasons, checks: { advisories: adv, searches: srch, activity: act } };
}

// ---- rulings and the blocklist -----------------------------------------------------------------
const log = load(LOG, {});
const block = load(BLOCK, []);
const keyOf = repo => Object.keys(log).find(k => k.toLowerCase() === repo.toLowerCase()) || repo;
const blockOf = repo => block.findIndex(b => b.repo.toLowerCase() === repo.toLowerCase());

// A human ruling stands through a re-gate unless something new turned up (gate-lib newConcerns).
// A `conduct` blocklisting (malware, scam, secret upload) is only ever lifted by JJ.
function withRuling(old, fresh) {
  if (!old?.settled) return fresh;
  const bi = blockOf(fresh.repo);
  if (bi >= 0 && block[bi].kind === 'conduct') return { ...fresh, verdict: 'FAIL', settled: old.settled, reasons: [`blocklisted for conduct: ${block[bi].reason}`, ...fresh.reasons] };
  if (fresh.verdict === 'PASS') return old.verdict === 'PASS' ? { ...fresh, settled: old.settled } : fresh;
  const fresh_ = newConcerns(old, fresh);
  if (!fresh_.length) return { ...fresh, verdict: old.verdict, reasons: old.verdict === 'PASS' ? [] : fresh.reasons, auto: { verdict: fresh.verdict, reasons: fresh.reasons }, settled: { ...old.settled, carried: TODAY } };
  return { ...fresh, reasons: [...fresh.reasons, `new since the ${old.settled.date} ruling: ${fresh_.join('; ')}`], previous: { verdict: old.verdict, settled: old.settled } };
}
function record(res) {
  const k = keyOf(res.repo);
  const entry = withRuling(log[k], res);
  if (k !== res.repo) delete log[k];
  log[res.repo] = entry;
  const bi = blockOf(res.repo);
  if (entry.verdict === 'FAIL' && bi < 0) block.push({ repo: res.repo, date: TODAY, kind: 'open-advisories', reason: entry.reasons.join(' | ') });
  if (entry.verdict === 'PASS' && bi >= 0 && block[bi].kind !== 'conduct') block.splice(bi, 1); // maintainers shipped the fixes
  save(LOG, log); save(BLOCK, block); // save as we go, so a killed run keeps its work
  return entry;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
async function catalogRepos() {
  const { stdout } = await run('node', [`${ROOT}scripts/catalog.mjs`, '--json'], { maxBuffer: 20 << 20 });
  return JSON.parse(stdout).map(e => e.repo);
}

// ---- main ------------------------------------------------------------------------------------
if (argv[0] === '--settle') {
  const [, repo, verdict, note] = argv;
  const key = Object.keys(log).find(k => k.toLowerCase() === (repo || '').toLowerCase());
  if (!key || !['PASS', 'FAIL'].includes(verdict) || !note) { console.error('usage: --settle owner/repo PASS|FAIL "note" [--by routine]'); process.exit(1); }
  log[key].verdict = verdict;
  log[key].settled = { by: opt('--by', 'human review'), date: TODAY, note, reasons: log[key].reasons || [] };
  const bi = blockOf(key);
  if (verdict === 'FAIL' && bi < 0) block.push({ repo: key, date: TODAY, kind: 'open-advisories', reason: note });
  if (verdict === 'PASS' && bi >= 0 && block[bi].kind !== 'conduct') block.splice(bi, 1);
  save(LOG, log); save(BLOCK, block);
  console.log(`${key}: ${verdict} (${note})`);
  process.exit(0);
}

if (argv.includes('--retry-searches')) {
  EXA_PATIENT = true;
  const live = new Set((await catalogRepos()).map(r => r.toLowerCase()));
  const todo = Object.values(log).filter(e => e.checks?.searches?.errors > 0 && !e.settled && live.has(e.repo.toLowerCase()));
  process.stderr.write(`retrying searches for ${todo.length} repos\n`);
  let k = 0;
  for (const e of todo) {
    k++;
    const fresh = record(await gate(e.repo, { reuse: e }));
    process.stderr.write(`[${k}/${todo.length}] ${fresh.verdict.padEnd(6)} ${e.repo}  searches: ${fresh.checks.searches.results} results, ${fresh.checks.searches.errors} errors, ${fresh.checks.searches.fallbacks} via fallback${fresh.reasons.length ? ' - ' + fresh.reasons.join(' | ') : ''}\n`);
  }
  process.exit(0);
}

if (argv.includes('--recheck')) {
  const named = argv.filter(a => /^[\w.-]+\/[\w.-]+$/.test(a));
  const repos = named.length ? named : await catalogRepos();
  const limit = +opt('--limit', 60), staleDays = +opt('--stale-days', 14);
  const age = repo => { const e = log[keyOf(repo)]; return e ? (Date.now() - Date.parse(e.checked)) / 864e5 : Infinity; };
  repos.sort((a, b) => age(b) - age(a)); // the budget goes to the oldest gates first
  let budget = limit;
  const out = { unchanged: 0, regated: [], unreadable: [] };
  process.stderr.write(`re-checking ${repos.length} repos (${WEB ? 'public pages' : 'GitHub API'})\n`);
  await pool(repos, 4, async repo => {
    const [o, r] = repo.split('/');
    const e = log[keyOf(repo)];
    const got = await advisoryIds(o, r);
    if (got.error) { out.unreadable.push(`${repo}: ${got.error}`); return; }
    const known = new Set((e?.checks?.advisories?.items || []).map(i => i.ghsa));
    const added = got.ids.filter(id => !known.has(id));
    const why = !e ? 'never gated' : added.length ? `new advisory ${added.join(', ')}` : age(repo) >= staleDays && budget > 0 ? (budget--, `last full gate ${e.checked}`) : null;
    if (!why) { e.rechecked = TODAY; out.unchanged++; return; }
    const before = e?.verdict || 'none';
    const res = record(await gate(repo));
    out.regated.push(`${res.verdict.padEnd(6)} ${repo} (was ${before}; ${why})${res.verdict !== 'PASS' ? ' - ' + res.reasons.join(' | ') : ''}`);
    process.stderr.write(`${res.verdict.padEnd(6)} ${repo} (${why})\n`);
  });
  save(LOG, log);
  console.log(`advisories re-read for ${repos.length - out.unreadable.length} of ${repos.length} repos; ${out.unchanged} unchanged.`);
  if (out.regated.length) console.log(`gated again (${out.regated.length}):\n  ${out.regated.join('\n  ')}`);
  if (out.unreadable.length) console.log(`could not read (${out.unreadable.length}), retry with --recheck owner/repo ...:\n  ${out.unreadable.join('\n  ')}`);
  process.exit(0);
}

let repos = argv.filter(a => /^[\w.-]+\/[\w.-]+$/.test(a));
if (argv.includes('--catalog')) repos = await catalogRepos();
if (!repos.length) { console.error('nothing to gate'); process.exit(1); }
process.stderr.write(`gating ${repos.length} repo(s) (${WEB ? 'public pages' : 'GitHub API'})\n`);
const results = await pool(repos, 5, async (repo, k) => {
  const res = record(await gate(repo));
  process.stderr.write(`[${k + 1}/${repos.length}] ${res.verdict.padEnd(6)} ${repo}${res.reasons.length ? '  - ' + res.reasons.join(' | ') : ''}\n`);
  return res;
});
const tally = results.reduce((t, x) => ((t[x.verdict] = (t[x.verdict] || 0) + 1), t), {});
console.log(JSON.stringify(tally));
