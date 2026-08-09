# Radar Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-mode search (paste GitHub URL -> instant snapshot + queued deep briefing; describe a need -> instant raw results + queued curated Top 3) to the static Repo Radar site, backed by a Google Apps Script queue and an agent-side "run repo lookups" skill.

**Architecture:** Pure static frontend (lookup.html + lookup.js ES module) calling the GitHub API unauthenticated from the browser. Queue writes go to a Google Apps Script /exec endpoint (fire-and-forget, no-cors) and mirror to localStorage. Deep briefings are generated later by a Claude Code skill triggered by "run repo lookups", which publishes pages under /lookups/ and redeploys.

**Tech Stack:** Plain HTML/CSS/JS (ES modules), GitHub REST API, Google Apps Script + Google Sheet, node:test for unit tests, Vercel CLI for deploy.

**Working directory:** `/Users/jjgilmore/Projects/repo-radar` (git repo, Vercel project `repo-radar`, alias repo-radar-weekly.vercel.app).

**Site design tokens (reuse everywhere):** fonts Space Grotesk / Inter / JetBrains Mono; colors `--bg:#080b0f --panel:#0e131a --panel2:#131a23 --line:#1c2530 --text:#e9edf2 --dim:#8593a5 --radar:#4ade80 --radar-dim:rgba(74,222,128,.12)`. No em dashes anywhere (use " - "). All dates human-readable. Numbers human-readable (85K not 85319).

---

### Task 1: lookup.js core logic (parseInput, formatCount) - TDD

**Files:**
- Create: `lookup.js`
- Test: `scripts/lookup.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// scripts/lookup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, formatCount } from '../lookup.js';

test('full https URL', () => {
  assert.deepEqual(parseInput('https://github.com/usestrix/strix'),
    { mode: 'url', owner: 'usestrix', repo: 'strix' });
});
test('URL with www, trailing path and .git', () => {
  assert.deepEqual(parseInput('http://www.github.com/antirez/ds4.git/tree/main/src'),
    { mode: 'url', owner: 'antirez', repo: 'ds4' });
});
test('bare owner/repo shorthand', () => {
  assert.deepEqual(parseInput('earendil-works/pi'),
    { mode: 'url', owner: 'earendil-works', repo: 'pi' });
});
test('free text is search mode', () => {
  assert.deepEqual(parseInput('website builder'),
    { mode: 'search', query: 'website builder' });
});
test('free text with slash-y words stays search when spaces present', () => {
  assert.deepEqual(parseInput('ci/cd pipeline tool'),
    { mode: 'search', query: 'ci/cd pipeline tool' });
});
test('empty input is null', () => {
  assert.equal(parseInput('   '), null);
});
test('formatCount', () => {
  assert.equal(formatCount(85319), '85K');
  assert.equal(formatCount(5336), '5.3K');
  assert.equal(formatCount(294), '294');
  assert.equal(formatCount(238563), '239K');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lookup.test.mjs`
Expected: FAIL (cannot find module '../lookup.js')

- [ ] **Step 3: Write minimal implementation**

```js
// lookup.js - Radar Lookup core. Pure functions exported for tests; DOM wiring lives in lookup.html.
export const QUEUE_ENDPOINT = ''; // paste Google Apps Script /exec URL here when deployed (see queue/SETUP.md)

export function parseInput(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  const url = s.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (url) return { mode: 'url', owner: url[1], repo: url[2].replace(/\.git$/, '') };
  if (!s.includes(' ')) {
    const short = s.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (short) return { mode: 'url', owner: short[1], repo: short[2].replace(/\.git$/, '') };
  }
  return { mode: 'search', query: s };
}

export function formatCount(n) {
  if (n == null) return '?';
  if (n >= 100000) return Math.round(n / 1000) + 'K';
  if (n >= 10000) return Math.round(n / 1000) + 'K';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function queueKey() { return 'rr_lookup_queue'; }

export function readQueue(storage) {
  try { return JSON.parse(storage.getItem(queueKey())) || []; } catch { return []; }
}

export function addToQueue(storage, item) {
  const q = readQueue(storage);
  const norm = (x) => (x.type + ':' + x.query).toLowerCase();
  if (!q.some((x) => norm(x) === norm(item))) q.push(item);
  storage.setItem(queueKey(), JSON.stringify(q));
  return q;
}

export async function postToQueue(item) {
  if (!QUEUE_ENDPOINT) return { sent: false };
  try {
    await fetch(QUEUE_ENDPOINT, { method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(item) });
    return { sent: true };
  } catch { return { sent: false }; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lookup.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Add queue-helper tests, run, verify pass**

Append to `scripts/lookup.test.mjs`:

```js
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}
test('addToQueue dedupes case-insensitively', async (t) => {
  const { addToQueue, readQueue } = await import('../lookup.js');
  const st = fakeStorage();
  addToQueue(st, { type: 'url', query: 'usestrix/strix', ts: 1 });
  addToQueue(st, { type: 'url', query: 'USEstrix/Strix', ts: 2 });
  assert.equal(readQueue(st).length, 1);
});
```

Run: `node --test scripts/lookup.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add lookup.js scripts/lookup.test.mjs
git commit -m "feat: lookup core - input mode detection, count formatting, local queue"
```

---

### Task 2: lookup.html search page

**Files:**
- Create: `lookup.html`

- [ ] **Step 1: Create the page**

Full file (reuses site design system; imports lookup.js as module):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lookup · Repo Radar</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{--bg:#080b0f;--panel:#0e131a;--panel2:#131a23;--line:#1c2530;--text:#e9edf2;--dim:#8593a5;--radar:#4ade80;--radar-dim:rgba(74,222,128,.12);--amber:#fbbf24;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:880px;margin:0 auto;padding:0 28px 80px}
  nav{display:flex;justify-content:space-between;align-items:center;padding:24px 0;border-bottom:1px solid var(--line)}
  .logo{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:19px;display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none}
  .logo .dot{width:11px;height:11px;border-radius:50%;background:var(--radar);box-shadow:0 0 12px var(--radar)}
  nav .links a{color:var(--dim);text-decoration:none;font-size:13.5px;margin-left:24px}
  nav .links a:hover{color:var(--text)}
  .hero{padding:64px 0 8px}
  .kicker{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--radar);margin-bottom:16px}
  h1{font-family:'Space Grotesk',sans-serif;font-size:clamp(30px,5vw,44px);font-weight:700;margin-bottom:12px}
  .sub{color:var(--dim);font-size:15.5px;margin-bottom:32px;max-width:640px}
  .bar{display:flex;gap:10px;margin-bottom:14px}
  .bar input{flex:1;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 20px;color:var(--text);font-family:'Inter',sans-serif;font-size:15px;outline:none}
  .bar input:focus{border-color:var(--radar)}
  .bar button{background:var(--radar);color:#04150b;border:none;border-radius:12px;padding:0 26px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:14.5px;cursor:pointer}
  .bar button:hover{opacity:.9}
  .hint{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--dim);margin-bottom:40px}
  .hint b{color:var(--radar);font-weight:500}
  #out{min-height:120px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:26px;margin-bottom:14px}
  .card h2{font-family:'Space Grotesk',sans-serif;font-size:20px;margin-bottom:4px}
  .card h2 span{color:var(--dim);font-weight:500}
  .card .desc{color:var(--dim);font-size:14px;margin-bottom:16px;max-width:640px}
  .statrow{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
  .stat{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--dim)}
  .stat b{color:var(--radar);font-weight:500;margin-right:6px}
  .stat.warn b{color:var(--amber)}
  .actions{display:flex;gap:10px;flex-wrap:wrap}
  .btn{display:inline-block;border-radius:9px;padding:10px 18px;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:13px;text-decoration:none;cursor:pointer;border:1px solid var(--line);color:var(--text);background:var(--panel2)}
  .btn.primary{background:var(--radar);border-color:var(--radar);color:#04150b}
  .btn:hover{border-color:var(--radar)}
  .note{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--radar);margin-top:12px}
  .rawlabel{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin:6px 0 14px}
  .rrow{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:15px 20px;margin-bottom:10px;text-decoration:none;color:var(--text)}
  .rrow:hover{border-color:var(--radar)}
  .rrow .rname{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:15px}
  .rrow .rname span{color:var(--dim);font-weight:500}
  .rrow .rdesc{color:var(--dim);font-size:12.5px}
  .rrow .rstat{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--radar);white-space:nowrap}
  .err{border:1px solid rgba(251,191,36,.4);background:rgba(251,191,36,.06);border-radius:14px;padding:22px 26px;color:var(--dim);font-size:14px}
  .err b{color:var(--amber)}
  footer{padding:44px 0 60px;border-top:1px solid var(--line);color:var(--dim);font-size:13px;margin-top:56px}
  footer a{color:var(--radar);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a class="logo" href="index.html"><span class="dot"></span>Repo Radar</a>
    <div class="links"><a href="index.html">Current Edition</a><a href="lookups/index.html">Library</a><a href="archive.html">Archive</a></div>
  </nav>

  <div class="hero">
    <div class="kicker">Radar Lookup</div>
    <h1>Point the radar at anything.</h1>
    <p class="sub">Paste a GitHub repo URL for an instant snapshot, or describe what you need and get the raw field of candidates. Queue a deep briefing and the full researcher's breakdown lands in your <a href="lookups/index.html" style="color:var(--radar)">library</a>.</p>
    <form class="bar" id="f">
      <input id="q" type="text" placeholder="github.com/owner/repo - or describe it: &quot;website builder&quot;" autocomplete="off" autofocus>
      <button type="submit">Scan</button>
    </form>
    <div class="hint"><b>URL</b> = instant snapshot + deep briefing queue &nbsp;·&nbsp; <b>words</b> = raw results + curated Top 3 queue</div>
  </div>

  <div id="out"></div>

  <footer>
    Repo Radar · Snapshot data straight from the GitHub API, never estimated · <a href="lookups/index.html">Lookup library</a>
  </footer>
</div>

<script type="module">
import { parseInput, formatCount, addToQueue, postToQueue } from './lookup.js';

const out = document.getElementById('out');
const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

async function gh(path) {
  const r = await fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 403) throw new Error('rate');
  if (!r.ok) throw new Error('http' + r.status);
  return r.json();
}

function queueIt(type, query, label) {
  const item = { type, query, ts: Date.now() };
  addToQueue(localStorage, item);
  postToQueue(item);
  return `<div class="note">✓ ${esc(label)} queued - say "run repo lookups" to Claude and it lands in the library.</div>`;
}

async function runUrl(owner, repo) {
  out.innerHTML = '<div class="card"><div class="desc">Scanning ' + esc(owner + '/' + repo) + '...</div></div>';
  try {
    const d = await gh('/repos/' + owner + '/' + repo);
    const lic = d.license ? d.license.spdx_id : 'No license';
    out.innerHTML = `
      <div class="card">
        <h2><span>${esc(d.owner.login)}/</span>${esc(d.name)}${d.archived ? ' <span style="color:var(--amber);font-size:13px">· ARCHIVED</span>' : ''}</h2>
        <div class="desc">${esc(d.description || 'No description.')}</div>
        <div class="statrow">
          <div class="stat"><b>★ ${formatCount(d.stargazers_count)}</b>stars</div>
          <div class="stat"><b>${formatCount(d.forks_count)}</b>forks</div>
          <div class="stat"><b>${formatCount(d.open_issues_count)}</b>open issues</div>
          <div class="stat"><b>${esc(d.language || '?')}</b>language</div>
          <div class="stat${lic === 'No license' || lic === 'NOASSERTION' ? ' warn' : ''}"><b>${esc(lic)}</b>license</div>
          <div class="stat"><b>${fmtDate(d.pushed_at)}</b>last push</div>
          <div class="stat"><b>${fmtDate(d.created_at)}</b>created</div>
        </div>
        <div class="actions">
          <button class="btn primary" id="qbtn">Queue deep briefing</button>
          <a class="btn" href="${esc(d.html_url)}" target="_blank" rel="noopener">GitHub ↗</a>
        </div>
        <div id="qmsg"></div>
      </div>`;
    document.getElementById('qbtn').onclick = () => {
      document.getElementById('qmsg').innerHTML = queueIt('url', d.full_name, 'Deep briefing for ' + d.full_name);
    };
  } catch (e) {
    out.innerHTML = e.message === 'rate'
      ? '<div class="err"><b>GitHub rate limit hit.</b> Unauthenticated lookups are capped at 60/hr - try again in a few minutes.</div>'
      : '<div class="err"><b>Couldn\'t verify this repo.</b> It may be private, renamed, or gone. No briefing will be generated for an unverifiable repo.</div>';
  }
}

async function runSearch(query) {
  out.innerHTML = '<div class="card"><div class="desc">Sweeping GitHub for "' + esc(query) + '"...</div></div>';
  try {
    const d = await gh('/search/repositories?q=' + encodeURIComponent(query) + '&sort=stars&order=desc&per_page=8');
    const rows = (d.items || []).map((r) => `
      <a class="rrow" href="${esc(r.html_url)}" target="_blank" rel="noopener">
        <div><div class="rname"><span>${esc(r.owner.login)}/</span>${esc(r.name)}</div>
        <div class="rdesc">${esc((r.description || '').slice(0, 110))}</div></div>
        <div class="rstat">★ ${formatCount(r.stargazers_count)}</div>
      </a>`).join('');
    out.innerHTML = `
      <div class="rawlabel">Raw radar - unverified, ranked by stars</div>
      ${rows || '<div class="err"><b>Nothing found.</b> Try different words.</div>'}
      <div class="card">
        <div class="desc">Want the curated read? Queue a Top 3 hunt - community-verified picks with a mini-brief each, not just star counts.</div>
        <div class="actions"><button class="btn primary" id="qbtn">Queue Top 3 hunt: "${esc(query)}"</button></div>
        <div id="qmsg"></div>
      </div>`;
    document.getElementById('qbtn').onclick = () => {
      document.getElementById('qmsg').innerHTML = queueIt('search', query, 'Top 3 hunt for "' + query + '"');
    };
  } catch (e) {
    out.innerHTML = e.message === 'rate'
      ? '<div class="err"><b>GitHub rate limit hit.</b> Try again in a few minutes.</div>'
      : '<div class="err"><b>Search failed.</b> GitHub may be having a moment - try again.</div>';
  }
}

document.getElementById('f').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const p = parseInput(document.getElementById('q').value);
  if (!p) return;
  if (p.mode === 'url') runUrl(p.owner, p.repo); else runSearch(p.query);
});

// Deep-link support: /lookup.html?q=owner/repo auto-runs (used by Top 3 pages' "Full briefing" buttons)
const qp = new URLSearchParams(location.search).get('q');
if (qp) {
  document.getElementById('q').value = qp;
  const p = parseInput(qp);
  if (p) { if (p.mode === 'url') runUrl(p.owner, p.repo); else runSearch(p.query); }
}
</script>
</body>
</html>
```

- [ ] **Step 2: Verify in a real browser over HTTP**

Run: `python3 -m http.server 8123 --directory /Users/jjgilmore/Projects/repo-radar &` then `open http://localhost:8123/lookup.html`
Check: paste `https://github.com/usestrix/strix` -> snapshot card renders with stars/forks/license/dates; click "Queue deep briefing" -> green queued note appears. Type `website builder` -> raw rows render with amber label; queue button works. Paste `github.com/nonexistent/nope-nope-404` -> "Couldn't verify" card. No console errors.

- [ ] **Step 3: Commit**

```bash
git add lookup.html
git commit -m "feat: lookup page - instant snapshot (URL mode) + raw search (describe mode) + queue actions"
```

---

### Task 3: lookups/index.html library page

**Files:**
- Create: `lookups/index.html`

- [ ] **Step 1: Create the page**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lookup Library · Repo Radar</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{--bg:#080b0f;--panel:#0e131a;--line:#1c2530;--text:#e9edf2;--dim:#8593a5;--radar:#4ade80;--amber:#fbbf24;}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:880px;margin:0 auto;padding:0 28px 80px}
  nav{display:flex;justify-content:space-between;align-items:center;padding:24px 0;border-bottom:1px solid var(--line);margin-bottom:56px}
  .logo{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:19px;display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none}
  .logo .dot{width:11px;height:11px;border-radius:50%;background:var(--radar);box-shadow:0 0 12px var(--radar)}
  nav .links a{color:var(--dim);text-decoration:none;font-size:13.5px;margin-left:24px}
  .kicker{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--radar);margin-bottom:16px}
  h1{font-family:'Space Grotesk',sans-serif;font-size:clamp(30px,5vw,44px);font-weight:700;margin-bottom:12px}
  .sub{color:var(--dim);font-size:15.5px;margin-bottom:44px;max-width:600px}
  .label{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--radar);margin:34px 0 12px}
  .label.pend{color:var(--amber)}
  .row{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 24px;margin-bottom:10px;text-decoration:none;color:var(--text);transition:border-color .15s}
  .row:hover{border-color:var(--radar)}
  .row h2{font-family:'Space Grotesk',sans-serif;font-size:16px}
  .row h2 span{color:var(--dim);font-weight:500}
  .row .meta{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--dim)}
  .row .tag{font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--radar);background:rgba(74,222,128,.12);border-radius:99px;padding:3px 11px}
  .row.pending{border-style:dashed;opacity:.75}
  .row.pending .tag{color:var(--amber);background:rgba(251,191,36,.1)}
  .empty{color:var(--dim);font-size:14px;background:var(--panel);border:1px dashed var(--line);border-radius:12px;padding:24px}
  .empty a{color:var(--radar);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a class="logo" href="../index.html"><span class="dot"></span>Repo Radar</a>
    <div class="links"><a href="../lookup.html">Lookup</a><a href="../index.html">Current Edition</a><a href="../archive.html">Archive</a></div>
  </nav>
  <div class="kicker">Lookup Library</div>
  <h1>Every repo you've pointed the radar at.</h1>
  <p class="sub">Deep briefings and Top 3 hunts, newest first. Queue new ones from the <a href="../lookup.html" style="color:var(--radar)">Lookup</a> page.</p>

  <div class="label">Completed briefings</div>
  <div id="done">
    <!-- AGENT: insert completed lookup rows here, newest first. Row template:
    <a class="row" href="SLUG.html"><div><h2><span>owner/</span>repo</h2><div class="meta">briefed Mon D, YYYY</div></div><div class="tag">Repo Brief</div></a>
    <a class="row" href="search-SLUG.html"><div><h2>Top 3: query</h2><div class="meta">hunted Mon D, YYYY</div></div><div class="tag">Top 3</div></a>
    -->
  </div>
  <div class="empty" id="doneEmpty">Nothing briefed yet. Queue your first lookup from the <a href="../lookup.html">Lookup page</a>, then tell Claude to <b>run repo lookups</b>.</div>

  <div class="label pend">In the queue (this device)</div>
  <div id="pending"></div>
  <div class="empty" id="pendEmpty">Queue is clear.</div>
</div>

<script>
  // Completed slugs baked in by the agent at publish time (lowercased queries):
  window.RR_COMPLETED = [];
  (function () {
    const doneRows = document.querySelectorAll('#done .row');
    if (doneRows.length) document.getElementById('doneEmpty').style.display = 'none';
    let q = [];
    try { q = JSON.parse(localStorage.getItem('rr_lookup_queue')) || []; } catch {}
    const completed = (window.RR_COMPLETED || []).map((s) => s.toLowerCase());
    const pending = q.filter((x) => !completed.includes((x.type + ':' + x.query).toLowerCase()));
    const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    if (pending.length) {
      document.getElementById('pendEmpty').style.display = 'none';
      document.getElementById('pending').innerHTML = pending.map((x) => `
        <div class="row pending"><div><h2>${x.type === 'url' ? esc(x.query) : 'Top 3: ' + esc(x.query)}</h2>
        <div class="meta">queued ${new Date(x.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div></div>
        <div class="tag">Queued</div></div>`).join('');
    }
  })();
</script>
</body>
</html>
```

- [ ] **Step 2: Verify in browser**

With the http.server from Task 2 still running: `open http://localhost:8123/lookups/index.html`
Check: empty states show. Queue an item on lookup.html, revisit library -> item appears under "In the queue". No console errors.

- [ ] **Step 3: Commit**

```bash
git add lookups/index.html
git commit -m "feat: lookup library page with completed + device-pending sections"
```

---

### Task 4: Nav integration + sitewide verification

**Files:**
- Modify: `index.html` (nav links line ~67)
- Modify: `archive.html` (nav links line ~33)

- [ ] **Step 1: Add Lookup to index.html nav**

In `index.html`, change:
```html
<div class="links"><a href="#top10">This Week's 10</a><a href="#categories">Categories</a><a href="#listen">Audio Digest</a><a href="archive.html">Archive</a></div>
```
to:
```html
<div class="links"><a href="#top10">This Week's 10</a><a href="#categories">Categories</a><a href="#listen">Audio Digest</a><a href="lookup.html">Lookup</a><a href="archive.html">Archive</a></div>
```

- [ ] **Step 2: Add Lookup to archive.html nav**

In `archive.html`, change:
```html
<div class="links"><a href="index.html">Current Edition</a></div>
```
to:
```html
<div class="links"><a href="index.html">Current Edition</a><a href="lookup.html">Lookup</a></div>
```

- [ ] **Step 3: Run sitewide verification**

Run from repo root:
```bash
python3 - <<'EOF'
import re, os, glob
files = ["index.html","archive.html","lookup.html","lookups/index.html"] + glob.glob("editions/*/*.html")
bad, em = [], []
for f in files:
    s = open(f).read()
    if "\u2014" in s: em.append(f)
    base = os.path.dirname(f)
    for m in re.findall(r'(?:href|src)="([^"#]+)"', s):
        if m.startswith(("http","mailto")): continue
        t = os.path.normpath(os.path.join(base, m))
        if m.endswith("/"): t = os.path.join(t, "index.html")
        if not os.path.exists(t): bad.append((f, m))
print("em-dashes:", em or "none"); print("broken:", bad or "none")
EOF
```
Expected: `em-dashes: none` and `broken: none`

- [ ] **Step 4: Commit**

```bash
git add index.html archive.html
git commit -m "feat: Lookup link in site nav"
```

---

### Task 5: Queue backend (Apps Script code + setup doc)

**Files:**
- Create: `queue/apps-script.gs`
- Create: `queue/SETUP.md`

- [ ] **Step 1: Write the Apps Script**

```js
// queue/apps-script.gs - Radar Lookup queue. Deploy as Web App (execute as me, access: anyone).
// Bound to a Google Sheet with header row: timestamp | type | query | status
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  try {
    var d = JSON.parse(e.postData.contents);
    if (!d.query || (d.type !== 'url' && d.type !== 'search')) throw new Error('bad payload');
    sheet.appendRow([new Date(), d.type, String(d.query).slice(0, 300), 'pending']);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
function doGet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    out.push({ row: i + 1, ts: rows[i][0], type: rows[i][1], query: rows[i][2], status: rows[i][3] });
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Write SETUP.md**

```markdown
# Radar Lookup queue - one-time setup (2 minutes, JJ's PERSONAL Google account)

1. In jack.jj.gilmore@gmail.com, create a Google Sheet named "Radar Lookup Queue".
   Row 1 headers: timestamp | type | query | status
2. Extensions -> Apps Script. Delete boilerplate, paste queue/apps-script.gs. Save.
3. Deploy -> New deployment -> type: Web app -> Execute as: Me -> Who has access: Anyone. Deploy.
4. Authorize when prompted. Copy the /exec URL.
5. Give the URL to Claude ("here's the queue endpoint: ...") - it goes into
   QUEUE_ENDPOINT in lookup.js, then redeploy.

Until this is done, queueing still works per-device via localStorage.
Never use the ASAAR Google account for this.
```

- [ ] **Step 3: Commit**

```bash
git add queue/apps-script.gs queue/SETUP.md
git commit -m "feat: Apps Script queue backend + setup doc"
```

---

### Task 6: repo-lookup agent skill + trigger registry

**Files:**
- Create: `~/.claude/skills/repo-lookup/SKILL.md`
- Modify: `~/.claude/CLAUDE.md` (skills trigger registry table)

- [ ] **Step 1: Write the skill**

Create `~/.claude/skills/repo-lookup/SKILL.md` with frontmatter `name: repo-lookup` and
`description: Drain the Radar Lookup queue - research queued GitHub repos / Top 3 hunts and publish briefing pages to the Repo Radar site. Triggers on "run repo lookups", "process the lookup queue", "drain the radar queue".`

Body must define, concretely:
1. **Read the queue:** `curl -s "<QUEUE_ENDPOINT>"` -> JSON rows; filter `status == "pending"`. If endpoint not yet configured, ask JJ to paste queue items (or accept inline "look up owner/repo" requests directly).
2. **Per url row - research (all cited, nothing invented):** GitHub API for repo + contributors + releases + security advisories (`/repos/{o}/{r}`, `/contributors?per_page=5`, `/releases?per_page=3`, advisories endpoint); registry downloads if applicable (npm: `api.npmjs.org/downloads/point/last-month/<pkg>`, PyPI: pypistats); dependents count from the repo page "Used by"; community: WebSearch for HN/Reddit/YouTube coverage by name. README inspection for install-script red flags (curl-pipe-bash, postinstall).
3. **Per url row - publish:** page at `lookups/{owner}--{repo}.html` (lowercase slug), six-section scorecard (Safe to install / Adoption / Verified voices / Problem / Why install + watchouts / Built with it), verdict line up top, unique visual theme on the Repo Radar design system, topbar back-link `../lookup.html` and `index.html` (library). Zero em dashes. Missing data = "no data found".
4. **Per search row - publish:** research the space (GitHub search + community verification), pick 3, page at `lookups/search-{slug}.html` (slug = query lowercased, spaces->hyphens, alnum only): hero restating the query, 3 ranked entries each with verdict sentence, key number, safety read, why it won, GitHub link, and a "Full briefing" button linking to `../lookup.html?q={owner}/{repo}` (auto-runs the snapshot with one-click queue).
5. **Rebuild library:** insert rows into `lookups/index.html` `#done` div (newest first, template in the HTML comment) and append the lookup's `type:query` string (lowercased) to `window.RR_COMPLETED`.
6. **Mark done + ship:** set Sheet rows to `done` via... (v1: note in summary for JJ to mark, or Apps Script doGet only - marking rows done requires a doPost update action; v1 keeps it manual/reported). Run the sitewide verify script (Task 4 Step 3), `git add -A && git commit`, `vercel deploy --prod --yes`, curl-check new page URLs return 2xx, `open` each new page in the browser.

- [ ] **Step 2: Register the trigger in ~/.claude/CLAUDE.md**

Add a row to the "My skills (trigger registry)" table:
```markdown
| **repo-lookup** | "run repo lookups", "process the lookup queue" | Drain the Radar Lookup queue: research queued repos/hunts, publish briefing pages to repo-radar-weekly.vercel.app | `~/.claude/skills/repo-lookup/SKILL.md` · Site: `~/Projects/repo-radar` |
```

- [ ] **Step 3: Commit (repo-radar side only)**

Nothing in the repo changes in this task if skill files live in `~/.claude`. Verify skill loads: next session `run repo lookups` should invoke it. Sanity-check the SKILL.md frontmatter parses (name + description present).

---

### Task 7: Deploy + live verification

- [ ] **Step 1: Kill the local server, deploy**

```bash
kill %1 2>/dev/null; cd /Users/jjgilmore/Projects/repo-radar && vercel deploy --prod --yes
```
Expected: "Aliased: https://repo-radar-weekly.vercel.app"

- [ ] **Step 2: Verify live URLs**

```bash
for u in lookup.html lookups/index.html index.html; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' https://repo-radar-weekly.vercel.app/$u)"; done
```
Expected: all 200

- [ ] **Step 3: Live browser test (golden path)**

`open https://repo-radar-weekly.vercel.app/lookup.html`
Test on the LIVE site: paste a real repo URL -> snapshot; queue it; type "website builder" -> raw results; queue hunt; open library -> both pending items show. Check console for errors.

- [ ] **Step 4: Final commit if anything changed, report**

Report to JJ: what shipped, the one manual step remaining (Apps Script setup per queue/SETUP.md), and that "run repo lookups" is armed.
```
