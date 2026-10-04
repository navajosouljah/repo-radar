// public-pages.mjs - read GitHub's public web pages and the package registries, for runs that have
// no GitHub API. The Friday cloud routine can't call api.github.com or run `gh`, but it can fetch
// github.com pages (the Sep 27 2026 dry run read GitHub Trending that way). Every fact below was
// checked against the API on Sep 27 2026 (atlas, hyperframes, OpenMAIC: same numbers and dates).
//
//   github.com/O/R                               stars, forks, watchers, open issues + PRs, commits,
//                                                created date, archived, canonical name
//   github.com/O/R/contributors_list             number of contributors
//   github.com/O/R/commits.atom                  date of the latest commit
//   github.com/O/R/security/advisories?page=N    published advisories, 10 to a page
//   github.com/O/R/security/advisories/GHSA-...  package, affected and patched versions, severity, CVE
//   github.com/advisories/GHSA-...               the same, from GitHub's global advisory database
//   github.com/advisories?query=CVE-...          which global advisory a CVE belongs to
//   github.com/O/R/releases/latest               redirects to the latest release's tag
//   github.com/search?q=created:>DATE&s=stars    the newest repos by stars, 10 to a page (no login)
//
// Parsers are pure (page text in, facts out) and tested in public-pages.test.mjs. A page that can't
// be read comes back as { error }, never as a guess: the gate treats that as "can't check".
import { ver, cmp } from './gate-lib.mjs';

const UA = { 'User-Agent': 'Mozilla/5.0 (repo-radar; +https://repo-radar-weekly.vercel.app)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- fetching: 4 at a time, patient with rate limits -------------------------------------------
let active = 0;
const queue = [];
const take = () => (active < 4 ? (active++, Promise.resolve()) : new Promise(r => queue.push(r)));
const give = () => { const next = queue.shift(); if (next) next(); else active--; };

export async function fetchPage(url, { tries = 4 } = {}) {
  await take();
  try {
    let last = 'no response';
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(3000 * 2 ** (i - 1));
      let res;
      try { res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30000) }); }
      catch (e) { last = String(e.message || e).slice(0, 120); continue; }
      if (res.status === 429 || res.status >= 500) { last = `HTTP ${res.status}`; continue; }
      if (!res.ok) return { status: res.status, url: res.url, text: '', error: `HTTP ${res.status}` };
      return { status: res.status, url: res.url, text: await res.text(), error: null };
    }
    return { status: 0, url, text: '', error: last };
  } finally { give(); }
}

// ---- parsers ------------------------------------------------------------------------------------
const unesc = s => String(s ?? '').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = s => unesc(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const count = s => (s == null ? null : Number(String(s).replace(/[^\d]/g, '')));

export function parseRepoPage(html) {
  const byId = id => count((html.match(new RegExp(`id="${id}"[^>]*?\\stitle="([^"]*)"`)) || [])[1]);
  const at = html.indexOf('"codeViewLayoutRoute":{"repo":{');
  const repo = at < 0 ? '' : html.slice(at, at + 1500);
  const issues = byId('issues-repo-tab-count');
  const prs = byId('pull-requests-repo-tab-count');
  return {
    canonical: (html.match(/<meta property="og:url" content="https:\/\/github\.com\/([^/"]+\/[^/"?#]+)"/) || [])[1] || null,
    stars: byId('repo-stars-counter-star'),
    forks: byId('repo-network-counter'),
    watchers: count((html.match(/<strong>([\d,]+)<\/strong>\s*watching/) || [])[1]),
    openIssues: issues == null && prs == null ? null : (issues || 0) + (prs || 0),
    hasIssues: issues != null,
    commits: count((html.match(/"commitCount":"([\d,]+)"/) || [])[1]),
    created: (repo.match(/"createdAt":"(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
    archived: (html.match(/"isArchived":(true|false)/) || [])[1] === 'true' || /This repository was archived by the owner/.test(html),
  };
}

export const parseContributors = html => count((html.match(/Contributors\s*<span[^>]*\btitle="([^"]+)"/) || [])[1]);
export const parseLatestCommit = xml => (xml.match(/<entry>[\s\S]*?<updated>(\d{4}-\d{2}-\d{2})/) || [])[1] || null;

// The public search page embeds its results as JSON. null means "could not read", never "no results".
export function parseRepoSearch(html) {
  const m = html.match(/<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/);
  let rows;
  try { rows = JSON.parse(m[1]).payload.blackbirdSearchRoute.results; } catch { return null; }
  if (!Array.isArray(rows)) return null;
  return rows.map(r => ({ repo: `${r.repo?.repository?.owner_login}/${r.repo?.repository?.name}`, stars: r.followers ?? null, description: plain(r.hl_trunc_description) }))
    .filter(r => !/(^|\/)undefined(\/|$)/.test(r.repo));
}

// One <li class="Box-row"> per published advisory; `?page=N+1` is present while more pages follow.
export function parseAdvisoryList(html) {
  const empty = /There aren(?:&#39;|')t any published security advisories/.test(html);
  const items = [];
  for (const row of html.split('<li class="Box-row').slice(1)) {
    const a = row.match(/href="\/[^/"]+\/[^/"]+\/security\/advisories\/(GHSA(?:-[a-z0-9]{4}){3})"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a || items.some(i => i.ghsa === a[1])) continue;
    items.push({
      ghsa: a[1],
      summary: plain(a[2]).slice(0, 140),
      published: (row.match(/<relative-time datetime="(\d{4}-\d{2}-\d{2})/) || [])[1] || '',
      severity: ((row.match(/title="Severity: ([a-z]+)"/i) || [])[1] || '').toLowerCase() || null,
    });
  }
  return { empty, items, pages: [...html.matchAll(/security\/advisories\?page=(\d+)/g)].map(m => +m[1]) };
}

// A repository advisory or a global one: same layout. "Unknown" and "None" mean no value.
export function parseAdvisory(html) {
  const packages = html.split('Package</h2>').slice(1).map(b => {
    const field = label => {
      const v = plain((b.match(new RegExp(`${label}</h2>\\s*<div[^>]*>([\\s\\S]*?)</div>`)) || [])[1] || '');
      return /^(unknown|none)?$/i.test(v) ? null : v;
    };
    return {
      name: unesc((b.match(/<span class="f4 color-fg-default text-bold">([^<]+)<\/span>/) || [])[1] || '').trim() || null,
      ecosystem: ((b.match(/ecosystem%3A([a-z0-9._-]+)/i) || [])[1] || '').toLowerCase() || null,
      affected: field('Affected versions'),
      patched: field('Patched versions'),
    };
  });
  const d0 = html.indexOf('Description</h2>');
  let body = d0 < 0 ? '' : html.slice(d0, d0 + 80000);
  const cut = body.indexOf('discussion-sidebar');
  if (cut > 0) body = body.slice(0, cut);
  return {
    packages,
    severity: ((html.match(/title="Severity: ([a-z]+)"/i) || [])[1] || '').toLowerCase() || null,
    cve: (html.match(/CVE ID<\/h3>\s*<div[^>]*>\s*(CVE-\d{4}-\d+)/) || [])[1] || null,
    sourceCode: (html.match(/Source code<\/h3>\s*<div[^>]*>\s*<a[^>]*href="([^"]+)"/) || [])[1] || null,
    description: plain(body.replace(/^Description<\/h2>/, '')).slice(0, 8000),
    references: [...new Set([...body.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => unesc(m[1])))],
  };
}

// ---- readers ------------------------------------------------------------------------------------
export async function repoFacts(o, r) {
  const page = await fetchPage(`https://github.com/${o}/${r}`);
  if (page.error) return { error: `repo page: ${page.error}` };
  const f = parseRepoPage(page.text);
  if (f.stars == null) return { error: 'repo page unreadable (no star count on it)' };
  const [co, cr] = (f.canonical || `${o}/${r}`).split('/');
  const [c, a] = await Promise.all([
    fetchPage(`https://github.com/${co}/${cr}/contributors_list?count=1&current_repository=${encodeURIComponent(cr)}&deferred=true`),
    fetchPage(`https://github.com/${co}/${cr}/commits.atom`),
  ]);
  return { ...f, contributors: c.error ? null : parseContributors(c.text), pushed: a.error ? null : parseLatestCommit(a.text) };
}

// The most-starred repos created after `since` (YYYY-MM-DD). A pause between pages: the public
// search answers only a few requests a minute.
export async function newestRepos(since, pages = 1) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    if (p > 1) await sleep(2000);
    const page = await fetchPage(`https://github.com/search?q=${encodeURIComponent(`created:>${since}`)}&type=repositories&s=stars&o=desc&p=${p}`);
    const rows = page.error ? null : parseRepoSearch(page.text);
    if (!rows) return { error: `search page ${p}: ${page.error || 'unreadable (no results on it)'}`, rows: out };
    out.push(...rows);
    if (rows.length < 10) break;
  }
  return { rows: out };
}

export async function advisoryList(o, r) {
  const url = `https://github.com/${o}/${r}/security/advisories`;
  const items = [];
  for (let n = 1; n <= 50; n++) {
    const p = await fetchPage(n === 1 ? url : `${url}?page=${n}`);
    if (p.error) return { url, error: `advisories page ${n}: ${p.error}` };
    const l = parseAdvisoryList(p.text);
    if (n === 1 && !l.empty && !l.items.length) return { url, error: 'advisories page unreadable (no list and no "none published" line)' };
    for (const it of l.items) if (!items.some(x => x.ghsa === it.ghsa)) items.push(it);
    if (!l.pages.includes(n + 1)) break;
  }
  return { url, items };
}

export async function repoAdvisory(o, r, ghsa) {
  const p = await fetchPage(`https://github.com/${o}/${r}/security/advisories/${ghsa}`);
  return p.error ? { error: `advisory ${ghsa}: ${p.error}` } : parseAdvisory(p.text);
}

export async function globalAdvisory(id) {
  let ghsa = /^GHSA-/i.test(id) ? id : null;
  if (!ghsa) {
    const s = await fetchPage(`https://github.com/advisories?query=${encodeURIComponent(id)}`);
    if (s.error) return { error: `advisory search: ${s.error}` };
    ghsa = (s.text.match(/href="\/advisories\/(GHSA(?:-[a-z0-9]{4}){3})"/i) || [])[1];
    if (!ghsa) return { missing: true };
  }
  const p = await fetchPage(`https://github.com/advisories/${ghsa}`);
  return p.error ? { error: `advisory ${ghsa}: ${p.error}` } : { ghsa, ...parseAdvisory(p.text) };
}

// The latest release's tag, or failing that the highest version among the tags.
export async function latestRelease(o, r) {
  const p = await fetchPage(`https://github.com/${o}/${r}/releases/latest`, { tries: 2 });
  const m = (p.url || '').match(/\/releases\/tag\/([^/?#]+)$/);
  if (m) return decodeURIComponent(m[1]);
  const t = await fetchPage(`https://github.com/${o}/${r}/tags`, { tries: 2 });
  const tags = [...(t.text || '').matchAll(/\/releases\/tag\/([^"?#]+)"/g)].map(x => decodeURIComponent(x[1]));
  return tags.filter(ver).sort((a, b) => cmp(ver(a), ver(b))).pop() || null;
}

// Latest published version on the package registry an advisory names.
const registryCache = new Map();
export async function registryLatest(eco, name) {
  const key = `${eco}:${name}`;
  if (registryCache.has(key)) return registryCache.get(key);
  const json = async url => { const p = await fetchPage(url, { tries: 2 }); try { return p.error ? null : JSON.parse(p.text); } catch { return null; } };
  const e = String(eco || '').toLowerCase();
  let v = null;
  if (e === 'npm') v = (await json(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`))?.version;
  else if (e === 'pip' || e === 'pypi') v = (await json(`https://pypi.org/pypi/${name}/json`))?.info?.version;
  else if (e === 'rust' || e === 'crates.io') v = (await json(`https://crates.io/api/v1/crates/${name}`))?.crate?.max_version;
  else if (e === 'go') v = (await json(`https://proxy.golang.org/${name.toLowerCase()}/@latest`))?.Version;
  else if (e === 'composer') v = (await json(`https://repo.packagist.org/p2/${name}.json`))?.packages?.[name]?.[0]?.version;
  else if (e === 'rubygems') v = (await json(`https://rubygems.org/api/v1/gems/${name}.json`))?.version;
  registryCache.set(key, v || null);
  return v || null;
}
