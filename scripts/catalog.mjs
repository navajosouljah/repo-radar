// catalog.mjs - list every repo the live site recommends, with the page(s) that recommend it.
// Usage: node scripts/catalog.mjs [--json]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const GH = /href="https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?"/g;
const NOT_REPOS = new Set(['sponsors', 'topics', 'trending', 'collections', 'features', 'about', 'orgs', 'settings', 'marketplace']);

const catalog = new Map(); // "owner/repo" (lowercase) -> { repo, where: [...] }
function add(owner, repo, where) {
  if (NOT_REPOS.has(owner.toLowerCase())) return;
  const key = `${owner}/${repo}`.toLowerCase();
  if (!catalog.has(key)) catalog.set(key, { repo: `${owner}/${repo}`, where: [] });
  const e = catalog.get(key);
  if (!e.where.includes(where)) e.where.push(where);
}

// 1. Edition briefing pages: the first GitHub link on each page is the repo being briefed.
const edDir = join(ROOT, 'editions');
for (const ed of readdirSync(edDir).sort()) {
  for (const f of readdirSync(join(edDir, ed)).filter(f => f.endsWith('.html') && f !== 'index.html')) {
    const html = readFileSync(join(edDir, ed, f), 'utf8');
    const m = [...html.matchAll(GH)][0];
    if (m) add(m[1], m[2], `editions/${ed}/${f}`);
    else console.error(`WARN no GitHub link: editions/${ed}/${f}`);
  }
}

// 2. Hub and the old v2 hub: every GitHub repo link is a recommendation (Category Radar, Claude Board).
for (const f of ['index.html', 'index-v2.html']) {
  if (!existsSync(join(ROOT, f))) continue;
  const html = readFileSync(join(ROOT, f), 'utf8');
  for (const m of html.matchAll(GH)) add(m[1], m[2], f);
}

// 3. Lookup briefings held on the backup branch (not live yet; gated before they return).
const BACKUP = 'backup/local-2026-08-29';
try {
  const files = execFileSync('git', ['-C', ROOT, 'ls-tree', '--name-only', BACKUP, 'lookups/'], { encoding: 'utf8' })
    .split('\n').filter(f => f.endsWith('.html') && !f.endsWith('index.html'));
  for (const f of files) {
    const html = execFileSync('git', ['-C', ROOT, 'show', `${BACKUP}:${f}`], { encoding: 'utf8' });
    const repos = [...html.matchAll(GH)];
    if (f.includes('/search-')) for (const m of repos) add(m[1], m[2], `${f} (held)`);
    else if (repos[0]) add(repos[0][1], repos[0][2], `${f} (held)`);
  }
} catch { console.error('WARN backup branch not found; held lookups skipped'); }

const list = [...catalog.values()].sort((a, b) => a.repo.localeCompare(b.repo));
if (process.argv.includes('--json')) console.log(JSON.stringify(list, null, 2));
else { for (const e of list) console.log(`${e.repo}\t${e.where.join(', ')}`); console.error(`TOTAL ${list.length}`); }
