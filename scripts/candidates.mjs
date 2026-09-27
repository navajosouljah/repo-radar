// candidates.mjs - gather this week's candidate repos from public sources and score them.
//
// Sources (each reports reached / not reached; a source that fails is listed, never faked):
//   1 GitHub Trending (daily, weekly, monthly; all, JS, TS, Python)   stars today / week / month
//   2 Trendshift (daily, monthly)                                     rank
//   3 skills.sh (all-time, trending, hot)                             installs
//   4 findarepo digests (last 7 days)                                 appearances
//   5 Hacker News stories with 100+ points linking GitHub (14 days)   points
//   6 YouTube videos with 25K+ views linking repos (14 days)          views      (local runs only: yt-dlp)
//   7 npm / PyPI downloads                                            downloads  (for repos that name a package)
// Plus every repo in data/tips.md.
//
// Scoring (docs/EDITION_PLAYBOOK.md): momentum 35, adoption 20, independent coverage 30,
// relative growth 15. Floors, slots and the fit lens are applied by the weekly agent, which adds
// judgment (fit, category) and the security gate. GitHub metadata is added with `gh` when
// available (local); in the cloud the agent enriches the shortlist with its GitHub tool.
//
// Usage: node scripts/candidates.mjs [YYYY-MM-DD] [--no-enrich] [--youtube]
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const argv = process.argv.slice(2);
const DATE = argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
const UA = { 'User-Agent': 'Mozilla/5.0 (repo-radar candidates)' };
const sources = {}; // name -> { reached, detail }
const cand = new Map(); // owner/repo lowercase -> candidate
const NOT_REPOS = /^(sponsors|topics|trending|collections|features|about|orgs|settings|marketplace|apps|login|signup|site|explore|search)$/i;

function add(full, patch) {
  const [o, r] = full.replace(/\.git$/, '').split('/');
  if (!o || !r || NOT_REPOS.test(o)) return;
  const k = `${o}/${r}`.toLowerCase();
  const c = cand.get(k) || { repo: `${o}/${r}`, sources: {}, signals: {} };
  for (const [src, v] of Object.entries(patch.sources || {})) c.sources[src] = { ...(c.sources[src] || {}), ...v };
  Object.assign(c.signals, patch.signals || {});
  if (patch.description && !c.description) c.description = patch.description;
  cand.set(k, c);
}
const num = s => Number(String(s || '').replace(/[^\d.]/g, '')) * (/[kK]\b/.test(s) ? 1e3 : /[mM]\b/.test(s) ? 1e6 : 1);
async function text(url, opts = {}) {
  const r = await fetch(url, { headers: UA, ...opts });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const jina = url => text(`https://r.jina.ai/${url}`);
async function source(name, fn) {
  try { const n = await fn(); sources[name] = { reached: true, detail: n }; }
  catch (e) { sources[name] = { reached: false, detail: String(e.message || e).slice(0, 140) }; }
}

// 1. GitHub Trending
await source('github-trending', async () => {
  let seen = 0;
  for (const since of ['daily', 'weekly', 'monthly']) for (const lang of ['', 'javascript', 'typescript', 'python']) {
    const html = await text(`https://github.com/trending${lang ? '/' + lang : ''}?since=${since}`);
    for (const a of html.split('<article class="Box-row"').slice(1)) {
      const m = a.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"]+)"/);
      if (!m) continue;
      const period = (a.match(/([\d,]+)\s+stars\s+(today|this week|this month)/) || [])[1];
      const total = (a.match(/href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?([\d,]+)\s*<\/a>/) || [])[1];
      const desc = ((a.match(/<p class="col-9[^"]*">\s*([\s\S]*?)\s*<\/p>/) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const sig = { stars: num(total) };
      if (period) sig[{ daily: 'gain1', weekly: 'gain7', monthly: 'gain30' }[since]] = num(period);
      add(m[1], { sources: { 'github-trending': { [since]: true } }, signals: sig, description: desc });
      seen++;
    }
  }
  return `${seen} rows`;
});

// 2. Trendshift
await source('trendshift', async () => {
  let seen = 0;
  for (const path of ['', 'monthly']) {
    const html = await text(`https://trendshift.io/${path}`);
    let rank = 0;
    for (const m of html.matchAll(/href="\/repositories\/\d+">([^<\s]+\/[^<\s]+)</g)) add(m[1], { sources: { trendshift: { [path || 'daily']: ++rank } } }), seen++;
  }
  return `${seen} rows`;
});

// 3. skills.sh (installs are per skill; summed per repo)
await source('skills.sh', async () => {
  const per = new Map();
  for (const path of ['', 'trending', 'hot']) {
    const md = await jina(`https://skills.sh/${path}`);
    for (const m of md.matchAll(/###\s+(\S+)\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s+([\d.,]+[KM]?)/g)) {
      const [, skill, repo, installs] = m;
      const k = repo.toLowerCase();
      const e = per.get(k) || { repo, skills: {}, lists: new Set() };
      e.skills[skill] = Math.max(e.skills[skill] || 0, num(installs));
      e.lists.add(path || 'all-time');
      per.set(k, e);
    }
  }
  for (const e of per.values()) add(e.repo, { sources: { 'skills.sh': { lists: [...e.lists] } }, signals: { installs: Object.values(e.skills).reduce((a, b) => a + b, 0), skills: Object.keys(e.skills).length } });
  return `${per.size} repos`;
});

// 4. findarepo digests, last 7 days
await source('findarepo', async () => {
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(DATE) - i * 864e5).toISOString().slice(0, 10);
    let md;
    try { md = await jina(`https://findarepo.com/digest/${d}/`); } catch { continue; }
    const repos = [...new Set([...md.matchAll(/findarepo\.com\/repo\/([^/\s)]+\/[^/\s)]+)/g)].map(m => m[1]))];
    if (!repos.length) continue;
    days++;
    repos.forEach((r, idx) => add(r, { sources: { findarepo: { [d]: idx + 1 } } }));
  }
  if (!days) throw new Error('no digests found');
  return `${days} digest(s)`;
});

// 5. Hacker News: stories with 100+ points that link GitHub, last 14 days
await source('hacker-news', async () => {
  const since = Math.floor(Date.parse(DATE) / 1000) - 14 * 86400;
  const d = JSON.parse(await text(`https://hn.algolia.com/api/v1/search?query=github.com&tags=story&numericFilters=created_at_i%3E${since},points%3E100&hitsPerPage=100`));
  let n = 0;
  for (const h of d.hits || []) {
    const m = String(h.url || '').match(/github\.com\/([^/?#]+\/[^/?#]+)/);
    if (!m) continue;
    add(m[1], { sources: { 'hacker-news': { points: h.points, id: h.objectID, date: (h.created_at || '').slice(0, 10) } } });
    n++;
  }
  return `${n} stories`;
});

// 6. YouTube (local only): repo links in descriptions of recent 25K+ view videos
if (argv.includes('--youtube')) await source('youtube', async () => {
  let n = 0;
  for (const q of ['github trending repos this week', 'best github repos', 'open source ai tools github', 'claude code skills github']) {
    const { stdout } = await run('yt-dlp', [`ytsearchdate25:${q}`, '--dump-json', '--no-warnings', '--skip-download', '--dateafter', `now-14days`], { maxBuffer: 200 << 20, timeout: 240000 });
    for (const line of stdout.split('\n').filter(Boolean)) {
      const v = JSON.parse(line);
      if ((v.view_count || 0) < 25000) continue;
      for (const m of String(v.description || '').matchAll(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) {
        add(m[1], { sources: { youtube: { [v.id]: { channel: v.channel, views: v.view_count, date: v.upload_date } } } });
        n++;
      }
    }
  }
  return `${n} repo links`;
});
else sources.youtube = { reached: false, detail: 'skipped (run with --youtube on a machine with yt-dlp)' };

// Tips JJ added ("add <repo> to the radar tips")
if (existsSync(`${ROOT}data/tips.md`)) for (const m of readFileSync(`${ROOT}data/tips.md`, 'utf8').matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) add(m[1], { sources: { tips: { yes: true } } });

// Enrich with GitHub metadata when `gh` is available (local runs)
const blocked = new Set((existsSync(`${ROOT}data/blocklist.json`) ? JSON.parse(readFileSync(`${ROOT}data/blocklist.json`, 'utf8')) : []).map(b => b.repo.toLowerCase()));
const list = [...cand.values()];
if (!argv.includes('--no-enrich')) {
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < list.length) {
      const c = list[i++];
      try {
        const m = JSON.parse((await run('gh', ['api', `repos/${c.repo}`], { maxBuffer: 20 << 20 })).stdout);
        Object.assign(c, { repo: m.full_name, description: c.description || m.description, homepage: m.homepage || null, created: m.created_at.slice(0, 10), pushed: m.pushed_at.slice(0, 10), archived: m.archived, topics: m.topics || [] });
        c.signals.stars = m.stargazers_count;
      } catch { c.enrich_error = true; }
    }
  }));
  sources['github-api'] = { reached: list.some(c => c.created), detail: `${list.filter(c => c.created).length}/${list.length} enriched` };
}

// Last time each repo was featured (8-week cool-down), from the edition pages themselves.
const featured = new Map();
try {
  const { readdirSync } = await import('node:fs');
  for (const ed of readdirSync(`${ROOT}editions`).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    for (const f of readdirSync(`${ROOT}editions/${ed}`).filter(f => f.endsWith('.html') && f !== 'index.html')) {
      const m = readFileSync(`${ROOT}editions/${ed}/${f}`, 'utf8').match(/href="https:\/\/github\.com\/([^/"]+\/[^/"#?]+)"/);
      if (m) { const k = m[1].toLowerCase(); if (!featured.has(k) || featured.get(k) < ed) featured.set(k, ed); }
    }
  }
} catch {}
for (const c of list) c.last_featured = featured.get(c.repo.toLowerCase()) || null;

// A repo younger than the window gained every star inside it: exact, not estimated.
for (const c of list) {
  const age = c.created ? (Date.parse(DATE) - Date.parse(c.created)) / 864e5 : null;
  if (age != null && age <= 30 && c.signals.gain30 == null && c.signals.stars != null) { c.signals.gain30 = c.signals.stars; c.signals.gain30_source = 'all stars since launch'; }
  if (age != null && age <= 7 && c.signals.gain7 == null && c.signals.stars != null) { c.signals.gain7 = c.signals.stars; c.signals.gain7_source = 'all stars since launch'; }
}
// Fill missing growth from findarepo's measured numbers (never estimated), strongest candidates first.
const srcCount = c => Object.keys(c.sources).length;
const needs = list.filter(c => (c.signals.stars || 0) >= 3000 && (c.signals.gain7 == null || c.signals.gain30 == null))
  .sort((a, b) => srcCount(b) - srcCount(a) || (b.signals.stars || 0) - (a.signals.stars || 0)).slice(0, 120);
let fr = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (needs.length) {
    const c = needs.shift();
    try {
      const md = await jina(`https://findarepo.com/repo/${c.repo}/`);
      const w7 = md.match(/Over the 7-day window we measured ourselves, it added \+([\d.,]+[kK]?) stars/);
      const pd = md.match(/gaining about ([\d.,]+) stars per day/) || md.match(/Measured pace\**\s*([\d.,]+)\s*★\/day/);
      if (c.signals.gain7 == null && w7) { c.signals.gain7 = num(w7[1]); c.signals.gain7_source = 'findarepo'; fr++; }
      else if (c.signals.gain7 == null && pd) { c.signals.gain7 = Math.round(num(pd[1]) * 7); c.signals.gain7_source = 'findarepo (per-day x 7)'; fr++; }
      if (/Looks organic/.test(md)) c.star_check = 'findarepo: looks organic';
      else if (/Looks inflated|Suspicious/i.test(md)) c.star_check = 'findarepo: FLAGGED';
    } catch {}
  }
}));
sources['findarepo-growth'] = { reached: fr > 0, detail: `${fr} repos filled` };

// Our own history: measured growth from earlier snapshots, then today's snapshot appended.
const METRICS = `${ROOT}metrics.json`;
const metrics = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, 'utf8')) : { history: {} };
metrics.history ||= {};
const hkey = r => Object.keys(metrics.history).find(k => k.toLowerCase() === r.toLowerCase());
const near = (rows, daysAgo) => {
  const t = Date.parse(DATE) - daysAgo * 864e5;
  const best = rows.map(([d, n]) => ({ d, n, off: Math.abs(Date.parse(d) - t) / 864e5 })).filter(x => x.off <= 3).sort((a, b) => a.off - b.off)[0];
  return best || null;
};
for (const c of list) {
  const rows = metrics.history[hkey(c.repo)] || [];
  if (c.signals.stars == null) continue;
  const w = near(rows, 7), m = near(rows, 30);
  if (c.signals.gain7 == null && w) { c.signals.gain7 = c.signals.stars - w.n; c.signals.gain7_source = `our snapshot ${w.d}`; }
  if (c.signals.gain30 == null && m) { c.signals.gain30 = c.signals.stars - m.n; c.signals.gain30_source = `our snapshot ${m.d}`; }
}
if (!argv.includes('--dry')) {
  for (const c of list) {
    if (c.signals.stars == null) continue;
    const k = hkey(c.repo) || c.repo;
    const rows = (metrics.history[k] ||= []);
    if (!rows.length || rows[rows.length - 1][0] !== DATE) rows.push([DATE, c.signals.stars]);
  }
  writeFileSync(METRICS, JSON.stringify(metrics, null, 1) + '\n');
}

// Score (see the playbook). Log scales keep one huge number from drowning everything else.
const lg = x => Math.log10(1 + Math.max(0, x || 0));
const maxOf = f => Math.max(1e-9, ...list.map(f));
const g7 = c => c.signals.gain7 ?? (c.signals.gain1 != null ? c.signals.gain1 * 7 : null);
const g30 = c => c.signals.gain30 ?? null;
const coveragePoints = c => {
  const s = c.sources; let p = 0;
  if (s.youtube) p += Math.min(9, 3 * Object.keys(s.youtube).length);
  if (s['hacker-news']) p += 3;
  if (s['github-trending']) p += 2;
  if (s.findarepo) p += 2;
  if (s.trendshift) p += 1;
  return Math.min(30, p);
};
const independent = c => ['github-trending', 'trendshift', 'skills.sh', 'findarepo', 'hacker-news', 'youtube'].filter(k => c.sources[k]).length;
const m7 = maxOf(c => lg(g7(c))), m30 = maxOf(c => lg(g30(c))), mA = maxOf(c => lg(c.signals.installs)), mR = maxOf(c => (g7(c) || 0) / Math.max(1, c.signals.stars || 1));
for (const c of list) {
  const rel = (g7(c) || 0) / Math.max(1, c.signals.stars || 1);
  c.score = +(15 * lg(g7(c)) / m7 + 20 * lg(g30(c)) / m30 + 20 * lg(c.signals.installs) / mA + coveragePoints(c) + 15 * rel / mR).toFixed(1);
  c.independent_sources = independent(c);
  c.age_days = c.created ? Math.round((Date.parse(DATE) - Date.parse(c.created)) / 864e5) : null;
  const floors = [];
  if ((c.signals.stars || 0) < 3000) floors.push('under 3K stars');
  if (!((g7(c) || 0) >= 1500 || (g30(c) || 0) >= 5000)) floors.push('growth below 1.5K/7d and 5K/30d');
  if (c.independent_sources < 2) floors.push('fewer than 2 independent sources');
  if (c.pushed && (Date.parse(DATE) - Date.parse(c.pushed)) / 864e5 > 30) floors.push('no commit in 30 days');
  if (c.archived) floors.push('archived');
  if (blocked.has(c.repo.toLowerCase())) floors.push('on the blocklist');
  if (c.last_featured && (Date.parse(DATE) - Date.parse(c.last_featured)) / 864e5 < 56) floors.push(`featured ${c.last_featured} (8-week cool-down)`);
  if (c.star_check === 'findarepo: FLAGGED') floors.push('findarepo flags the stars');
  c.floors_failed = floors;
}
list.sort((a, b) => b.score - a.score);
mkdirSync(`${ROOT}data/candidates`, { recursive: true });
const out = { date: DATE, sources, count: list.length, candidates: list };
writeFileSync(`${ROOT}data/candidates/${DATE}.json`, JSON.stringify(out, null, 2) + '\n');
const ok = list.filter(c => !c.floors_failed.length);
console.log(`sources: ${Object.entries(sources).map(([k, v]) => `${k}=${v.reached ? 'ok' : 'NO'}(${v.detail})`).join(' | ')}`);
console.log(`${list.length} candidates, ${ok.length} clear every floor. Top 20 that clear:`);
for (const c of ok.slice(0, 20)) console.log(`  ${String(c.score).padStart(5)}  ${c.repo.padEnd(42)} ${String(c.signals.stars ?? '?').padStart(7)} stars  +${g7(c) ?? '?'}/7d  +${g30(c) ?? '?'}/30d  ${c.age_days ?? '?'}d old  src=${c.independent_sources} ${Object.keys(c.sources).join(',')}${c.last_featured ? ` (last featured ${c.last_featured})` : ''}`);
