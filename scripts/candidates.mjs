// candidates.mjs - gather this week's candidate repos from public sources and score them.
//
// Discovery sources (each reports reached / not reached; a source that fails is listed, never faked):
//   1 GitHub Trending (daily, weekly, monthly; all, JS, TS, Python)   stars today / week / month
//   2 Trendshift (daily, monthly)                                     rank
//   3 skills.sh (all-time, trending, hot)                             installs
//   4 findarepo digests (last 7 days)                                 appearances
//   5 Hacker News stories with 100+ points linking GitHub (14 days)   points
//   6 YouTube videos with 25K+ views linking repos (14 days)          views      (local runs only: yt-dlp)
//   + GitHub search: the most-starred repos born in the last 7 and 45 days  (finds candidates only:
//     a star count is not someone vouching for a tool, so it never counts as an independent source)
// Plus every repo in data/tips.md. npm and PyPI downloads are not wired in yet: adoption comes from
// skills.sh installs only.
//
// Every candidate is then read on GitHub (stars, created, last commit, archived): through `gh` when
// it is signed in, otherwise through GitHub's public pages (the cloud routine; public-pages.mjs).
//
// Scoring (docs/EDITION_PLAYBOOK.md): momentum 35, adoption 20, independent coverage 30, relative
// growth 15. Floors are applied here; slots, the fit lens and the security gate are the weekly
// agent's job. Star snapshots are appended to metrics.json dated the day they were measured.
//
// Usage: node scripts/candidates.mjs [YYYY-MM-DD] [--no-enrich] [--youtube] [--dry]
//        node scripts/candidates.mjs YYYY-MM-DD --rescore
//   --rescore  recompute floors and scores from data/candidates/<date>.json without fetching
//              anything, after adding sources or facts by hand. Facts go in
//              data/candidates/<date>.facts.json: {"owner/repo": {"created", "pushed", "stars", "archived"}}
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as web from './public-pages.mjs';
import { capGain, windowGain } from './picks-lib.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const argv = process.argv.slice(2);
const TODAY = new Date().toISOString().slice(0, 10);
const DATE = argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || TODAY;
const FILE = `${ROOT}data/candidates/${DATE}.json`;
const FACTS = `${ROOT}data/candidates/${DATE}.facts.json`;
const RESCORE = argv.includes('--rescore');
const UA = { 'User-Agent': 'Mozilla/5.0 (repo-radar candidates)' };
const DISCOVERY = ['github-trending', 'trendshift', 'skills.sh', 'findarepo', 'hacker-news', 'youtube'];
const NOT_REPOS = /^(sponsors|topics|trending|collections|features|about|orgs|settings|marketplace|apps|login|signup|site|explore|search)$/i;
const num = s => Number(String(s || '').replace(/[^\d.]/g, '')) * (/[kK]\b/.test(s) ? 1e3 : /[mM]\b/.test(s) ? 1e6 : 1);
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;

let sources = {}; // name -> { reached, detail }
let list = [];
let measured = TODAY;

if (RESCORE) {
  if (!existsSync(FILE)) { console.error(`no ${FILE} to rescore: run without --rescore first`); process.exit(1); }
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  sources = saved.sources;
  list = saved.candidates;
  measured = saved.measured || null;
} else {
  const cand = new Map(); // owner/repo lowercase -> candidate
  const add = (full, patch) => {
    const [o, r] = full.replace(/\.git$/, '').split('/');
    if (!o || !r || NOT_REPOS.test(o)) return;
    const k = `${o}/${r}`.toLowerCase();
    const c = cand.get(k) || { repo: `${o}/${r}`, sources: {}, signals: {} };
    for (const [src, v] of Object.entries(patch.sources || {})) c.sources[src] = { ...(c.sources[src] || {}), ...v };
    Object.assign(c.signals, patch.signals || {});
    if (patch.description && !c.description) c.description = patch.description;
    cand.set(k, c);
  };
  const text = async url => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45000) }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); };
  const jina = url => text(`https://r.jina.ai/${url}`);
  const source = async (name, fn) => {
    try { sources[name] = { reached: true, detail: await fn() }; }
    catch (e) { sources[name] = { reached: false, detail: String(e.message || e).slice(0, 140) }; }
  };

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
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.parse(DATE) - i * 864e5).toISOString().slice(0, 10);
      let md;
      try { md = await jina(`https://findarepo.com/digest/${d}/`); } catch { continue; }
      const repos = [...new Set([...md.matchAll(/findarepo\.com\/repo\/([^/\s)]+\/[^/\s)]+)/g)].map(m => m[1]))];
      if (!repos.length) continue;
      n++;
      repos.forEach((r, idx) => add(r, { sources: { findarepo: { [d]: idx + 1 } } }));
    }
    if (!n) throw new Error('no digests found');
    return `${n} digest(s)`;
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

  // GitHub search: the newest repos by stars (JJ, Oct 3 2026). The trending pages show who is hot
  // that morning; a repo that peaked on Tuesday is gone by Friday. This asks GitHub directly, so a
  // young repo stays in the pool every week. It is not in DISCOVERY: it never counts toward the two
  // independent sources or toward the fail-closed count.
  await source('github-search', async () => {
    const before = n => new Date(Date.parse(DATE) - n * 864e5).toISOString().slice(0, 10);
    let seen = 0;
    for (const [window, since, pages] of [['7d', before(7), 1], ['45d', before(45), 3]]) {
      const r = await web.newestRepos(since, pages);
      for (const x of r.rows) add(x.repo, { sources: { 'github-search': { [window]: true } }, signals: { stars: x.stars }, description: x.description }), seen++;
      if (r.error) throw new Error(r.error);
    }
    return `${seen} rows`;
  });

  // Tips JJ added ("add <repo> to the radar tips")
  if (existsSync(`${ROOT}data/tips.md`)) for (const m of readFileSync(`${ROOT}data/tips.md`, 'utf8').matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) add(m[1], { sources: { tips: { yes: true } } });

  list = [...cand.values()];

  // Read every candidate on GitHub: the API through gh when signed in, else the public pages.
  if (!argv.includes('--no-enrich')) {
    const viaApi = await run('gh', ['auth', 'status']).then(() => true, () => false);
    let i = 0;
    await Promise.all(Array.from({ length: viaApi ? 6 : 4 }, async () => {
      while (i < list.length) {
        const c = list[i++];
        try {
          if (viaApi) {
            const m = JSON.parse((await run('gh', ['api', `repos/${c.repo}`], { maxBuffer: 20 << 20 })).stdout);
            Object.assign(c, { repo: m.full_name, description: c.description || m.description, homepage: m.homepage || null, created: m.created_at.slice(0, 10), pushed: m.pushed_at.slice(0, 10), archived: m.archived, topics: m.topics || [] });
            c.signals.stars = m.stargazers_count;
          } else {
            const f = await web.repoFacts(...c.repo.split('/'));
            if (f.error) throw new Error(f.error);
            Object.assign(c, { repo: f.canonical || c.repo, created: f.created, pushed: f.pushed, archived: f.archived });
            c.signals.stars = f.stars;
          }
        } catch { c.enrich_error = true; }
      }
    }));
    sources.github = { reached: list.some(c => c.created), detail: `${list.filter(c => c.created).length}/${list.length} read via ${viaApi ? 'the API' : 'public pages'}` };
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

  // Our own history: measured growth from earlier snapshots, then today's snapshot appended, dated
  // the day it was measured (a dry run for a future Friday must not stamp that Friday's date).
  const METRICS = `${ROOT}metrics.json`;
  const metrics = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, 'utf8')) : { history: {} };
  metrics.history ||= {};
  const hkey = r => Object.keys(metrics.history).find(k => k.toLowerCase() === r.toLowerCase());
  const near = (rows, daysAgo) => {
    const t = Date.parse(TODAY) - daysAgo * 864e5;
    return rows.map(([d, n]) => ({ d, n, off: Math.abs(Date.parse(d) - t) / 864e5 })).filter(x => x.off <= 3).sort((a, b) => a.off - b.off)[0] || null;
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
      const rows = (metrics.history[hkey(c.repo) || c.repo] ||= []);
      if (!rows.length || rows[rows.length - 1][0] !== TODAY) rows.push([TODAY, c.signals.stars]);
    }
    writeFileSync(METRICS, JSON.stringify(metrics, null, 1) + '\n');
  }
}

// Facts added by hand (the agent's GitHub tool, when a page couldn't be read).
if (existsSync(FACTS)) {
  const facts = JSON.parse(readFileSync(FACTS, 'utf8'));
  for (const [repo, f] of Object.entries(facts)) {
    const c = list.find(x => x.repo.toLowerCase() === repo.toLowerCase());
    if (!c) continue;
    for (const k of ['created', 'pushed', 'archived']) if (f[k] != null) c[k] = f[k];
    if (f.stars != null) c.signals.stars = f.stars;
    c.facts_by_hand = true;
  }
}

// The 8-week cool-down: the last edition each repo appeared in (this Friday's own edition excluded).
const blocked = new Set((existsSync(`${ROOT}data/blocklist.json`) ? JSON.parse(readFileSync(`${ROOT}data/blocklist.json`, 'utf8')) : []).map(b => b.repo.toLowerCase()));
const featured = new Map();
const feature = (repo, ed) => { const k = repo.toLowerCase(); if (!featured.has(k) || featured.get(k) < ed) featured.set(k, ed); };
const isEd = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== DATE;
if (existsSync(`${ROOT}editions`)) for (const ed of readdirSync(`${ROOT}editions`).filter(isEd)) {
  for (const f of readdirSync(`${ROOT}editions/${ed}`).filter(f => f.endsWith('.html') && f !== 'index.html')) {
    const m = readFileSync(`${ROOT}editions/${ed}/${f}`, 'utf8').match(/href="https:\/\/github\.com\/([^/"]+\/[^/"#?]+)"/);
    if (m) feature(m[1], ed);
  }
}
if (existsSync(`${ROOT}data/editions`)) for (const ed of readdirSync(`${ROOT}data/editions`).filter(isEd)) {
  const p = `${ROOT}data/editions/${ed}/edition.json`;
  if (existsSync(p)) for (const pick of JSON.parse(readFileSync(p, 'utf8')).picks || []) feature(pick.repo, ed);
}

// Score (see the playbook). Log scales keep one huge number from drowning everything else.
for (const c of list) {
  c.last_featured = featured.get(c.repo.toLowerCase()) || null;
  // A repo younger than the window gained every star inside it: exact, not estimated.
  const age = c.created ? days(DATE, c.created) : null;
  // An outside estimate never beats that, and no gain can exceed the total (picks-lib windowGain:
  // Strata's 11.2K "this week" on 5.3K stars, AIHOT's 1.3K "this week" at 5 days old and 5.5K stars).
  for (const [k, win] of [['gain7', 7], ['gain30', 30]]) {
    const g = windowGain(c.signals[k], c.signals.stars, age, win);
    if (g === (c.signals[k] ?? null)) continue;
    c.signals[`${k}_source`] = age != null && age <= win ? 'all stars since launch' : `${c.signals[`${k}_source`] || 'measured'} (capped at total stars)`;
    c.signals[k] = g;
  }
}
const lg = x => Math.log10(1 + Math.max(0, x || 0));
const maxOf = f => Math.max(1e-9, ...list.map(f));
const g7 = c => c.signals.gain7 ?? (c.signals.gain1 != null ? capGain(c.signals.gain1 * 7, c.signals.stars) : null);
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
const m7 = maxOf(c => lg(g7(c))), m30 = maxOf(c => lg(g30(c))), mA = maxOf(c => lg(c.signals.installs)), mR = maxOf(c => (g7(c) || 0) / Math.max(1, c.signals.stars || 1));
for (const c of list) {
  const rel = (g7(c) || 0) / Math.max(1, c.signals.stars || 1);
  c.score = +(15 * lg(g7(c)) / m7 + 20 * lg(g30(c)) / m30 + 20 * lg(c.signals.installs) / mA + coveragePoints(c) + 15 * rel / mR).toFixed(1);
  c.independent_sources = DISCOVERY.filter(k => c.sources[k]).length;
  c.age_days = c.created ? Math.round(days(DATE, c.created)) : null;
  const floors = [];
  if (c.signals.stars == null) floors.push('star count unknown');
  else if (c.signals.stars < 3000) floors.push('under 3K stars');
  if (!((g7(c) || 0) >= 1500 || (g30(c) || 0) >= 5000)) floors.push('growth below 1.5K/7d and 5K/30d');
  if (c.independent_sources < 2) floors.push('fewer than 2 independent sources');
  if (!c.pushed) floors.push('commit date unknown');
  else if (days(DATE, c.pushed) > 30) floors.push('no commit in 30 days');
  if (c.archived) floors.push('archived');
  if (blocked.has(c.repo.toLowerCase())) floors.push('on the blocklist');
  if (c.last_featured && days(DATE, c.last_featured) < 56) floors.push(`featured ${c.last_featured} (8-week cool-down)`);
  if (c.star_check === 'findarepo: FLAGGED') floors.push('findarepo flags the stars');
  c.floors_failed = floors;
}
list.sort((a, b) => b.score - a.score);
mkdirSync(`${ROOT}data/candidates`, { recursive: true });
writeFileSync(FILE, JSON.stringify({ date: DATE, measured, sources, count: list.length, candidates: list }, null, 2) + '\n');

// ---- report ------------------------------------------------------------------------------------
const reached = DISCOVERY.filter(k => sources[k]?.reached);
console.log(`sources: ${reached.length} of ${DISCOVERY.length} discovery sources reached | ${Object.entries(sources).map(([k, v]) => `${k}=${v.reached ? 'ok' : 'NO'}(${v.detail})`).join(' | ')}`);
const ok = list.filter(c => !c.floors_failed.length);
const row = c => `  ${String(c.score).padStart(5)}  ${c.repo.padEnd(42)} ${String(c.signals.stars ?? '?').padStart(7)} stars  +${g7(c) ?? '?'}/7d  +${g30(c) ?? '?'}/30d  ${c.age_days ?? '?'}d old  src=${c.independent_sources} ${Object.keys(c.sources).join(',')}`;
console.log(`${list.length} candidates, ${ok.length} clear every floor.`);
console.log(`By score:\n${ok.slice(0, 20).map(row).join('\n') || '  (none)'}`);
console.log(`New this week (under 45 days old):\n${ok.filter(c => c.age_days != null && c.age_days < 45).map(row).join('\n') || '  (none)'}`);
console.log(`Still climbing (over 90 days old, biggest 30-day gain first):\n${ok.filter(c => c.age_days != null && c.age_days > 90).sort((a, b) => (g30(b) || 0) - (g30(a) || 0)).slice(0, 5).map(row).join('\n') || '  (none)'}`);
// Young repos that clear every floor except the second sighting. The search finds them; only real
// coverage qualifies them (playbook step 1).
const oneShort = list.filter(c => c.age_days != null && c.age_days < 45 && c.floors_failed.length === 1 && /independent sources/.test(c.floors_failed[0])).sort((a, b) => (b.signals.stars || 0) - (a.signals.stars || 0));
if (oneShort.length) console.log(`Young, missing only independent coverage (${oneShort.length}): look for real coverage of the top ones (playbook step 1)\n${oneShort.slice(0, 10).map(row).join('\n')}`);
const unknownOnly = list.filter(c => c.floors_failed.length && c.floors_failed.every(f => /unknown/.test(f)));
if (unknownOnly.length) console.log(`Missing facts only (${unknownOnly.length}): add them to ${FACTS.replace(ROOT, '')} and run with --rescore:\n${unknownOnly.slice(0, 30).map(c => `  ${c.repo}: ${c.floors_failed.join(', ')}`).join('\n')}`);
if (!RESCORE && reached.length < 3) {
  console.log(`FAIL CLOSED: only ${reached.length} of ${DISCOVERY.length} discovery sources were reached. Do not publish this week; report which failed.`);
  process.exit(3);
}
