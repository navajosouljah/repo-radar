// build.mjs - Repo Radar v3: data in, pages out. Zero dependencies.
//
//   data/editions/<date>/edition.json   the edition: number, theme, the 10 picks in order
//   data/editions/<date>/<slug>.json    one repo's answer sheet (see docs/DATA_FORMAT.md)
//   data/gate-log.json, blocklist.json  the security gate's evidence (docs/SECURITY_GATE.md)
//   data/hub.json                       Category Radar + Claude Board for the hub
//
// Writes editions/<date>/<slug>.html, editions/<date>/index.html and (with --hub) index.html.
// Refuses to render a repo that lacks a current gate PASS with advisory evidence, or that is
// on the blocklist, anywhere it would appear: page, list row, alternative.
//
// Usage: node scripts/build.mjs [--edition YYYY-MM-DD] [--hub] [--all]
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { human, whyThisWeek } from './picks-lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = 'https://repo-radar-weekly.vercel.app/';
// A picture path is either a full URL or relative to the site root ("assets/shots/x.webp").
const srcAt = (src, depth) => (!src || /^https?:/.test(src) ? src : '../'.repeat(depth) + src);
const absSrc = src => (!src ? undefined : /^https?:/.test(src) ? src : SITE + src);
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const GATE = existsSync(join(ROOT, 'data/gate-log.json')) ? read('data/gate-log.json') : {};
const BLOCK = existsSync(join(ROOT, 'data/blocklist.json')) ? read('data/blocklist.json') : [];
const MAX_GATE_AGE_DAYS = 30;
const errors = [];

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Markup allowed inside data strings: **bold**, [a link](https://...), and `a tool name`.
const rich = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dShort = iso => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };
const dLong = iso => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${FULL[m - 1]} ${d}, ${y}`; };
const key = r => String(r || '').toLowerCase();
const initials = s => String(s).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

function gateFor(repo, where) {
  const blocked = BLOCK.find(b => key(b.repo) === key(repo));
  const g = Object.values(GATE).find(e => key(e.repo) === key(repo));
  if (blocked) return { ok: false, why: `on the blocklist (${blocked.reason})`, g, blocked };
  if (!g) return { ok: false, why: 'never gated' };
  if (g.verdict !== 'PASS') return { ok: false, why: `gate verdict is ${g.verdict}`, g };
  const adv = g.checks?.advisories || {};
  if (!adv.source || adv.count == null || !adv.url) return { ok: false, why: 'PASS without advisory evidence', g };
  const age = (Date.now() - Date.parse(g.checked)) / 864e5;
  if (age > MAX_GATE_AGE_DAYS) return { ok: false, why: `gate is ${Math.round(age)} days old`, g };
  return { ok: true, g };
}
function requireGate(repo, where) {
  const r = gateFor(repo, where);
  if (!r.ok) errors.push(`${where}: ${repo} cannot render - ${r.why}`);
  return r;
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Shantell+Sans:wght@500;600;700&display=swap';
function head({ title, description, depth, image }) {
  const up = '../'.repeat(depth);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='6' y='10' width='40' height='40' rx='3' fill='%23f7e38a' transform='rotate(-6 26 30)'/%3E%3Crect x='20' y='16' width='38' height='38' rx='3' fill='%23bfe8c9' transform='rotate(5 39 35)'/%3E%3Cpath d='M18 36c8-2 16-2 26 0' stroke='%232f3350' stroke-width='4' fill='none' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${up}assets/radar.css">
<script src="${up}assets/radar.js" defer></script>
</head>
<body>`;
}
const topbar = (depth, crumb) => {
  const up = '../'.repeat(depth);
  return `<div class="wrap"><header class="topbar">
  <a class="brand" href="${up}index.html">Repo <span>Radar</span></a>
  <nav aria-label="Site"><a href="${up}index.html">This week's 10</a><a href="${up}index.html#categories">Categories</a><a href="${up}archive.html">Archive</a><a href="${up}lookup.html">Look up a repo</a></nav>
</header>${crumb ? `<p class="crumb">${crumb}</p>` : ''}</div>`;
};

// ---------- sparkline (the Popularity vital) ----------
const miniChart = history => {
  const pts = (history || []).filter(p => p && p[1] != null);
  if (pts.length < 2) return '';
  const ys = pts.map(p => Number(p[1])), max = Math.max(...ys);
  const step = 100 / (pts.length - 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(30 - (Number(p[1]) / max) * 26).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--green-ink)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg>`;
};

// ---------- the repo page ----------
const FIT = {
  you: ['fit-you', 'Use it yourself'],
  developers: ['fit-dev', 'For developers'],
  news: ['fit-news', 'Just news'],
};
const EFFORT = { minutes: 0, hour: 1, developer: 2 };
const EFFORT_LABEL = ['5 minutes', 'About an hour', 'Needs a developer'];
const PLAT_COLORS = ['oklch(0.55 0.13 255)', 'oklch(0.55 0.14 30)', 'oklch(0.52 0.12 152)', 'oklch(0.55 0.12 300)', 'oklch(0.50 0.10 90)'];

function repoPage(ed, r, ctx = {}) {
  const where = ctx.where || `editions/${ed.date}/${r.slug}.html`;
  const depth = ctx.depth ?? 2;
  const gate = requireGate(r.repo, where);
  const g = gate.g || {};
  const act = g.checks?.activity || {};
  const adv = g.checks?.advisories || {};
  const srch = g.checks?.searches || {};
  const fit = FIT[r.fit] || FIT.news;
  const effort = EFFORT[r.try?.effort] ?? 2;
  const q = (n, id, title, lede, body) => `<section class="q" id="${id}" aria-labelledby="${id}-h"><header><span class="q-num">${n}</span><h2 id="${id}-h">${title}</h2></header>${lede ? `<p class="lede">${lede}</p>` : ''}${body}</section>`;

  // An alternative that links a GitHub project recommends it, whether or not it has a repo field.
  const altRepo = a => a?.repo || (String(a?.url || '').match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?(?:[#?].*)?$/) || [])[1] || null;
  for (const a of r.verdict?.alternatives || []) if (altRepo(a)) requireGate(altRepo(a), `${where} (alternative)`);

  const links = r.links || {};
  const actions = [
    links.website ? `<a class="btn primary" href="${esc(links.website)}" rel="noopener">Visit the website <span class="arrow" aria-hidden="true">&#8599;</span></a>` : '',
    links.demo ? `<a class="btn" href="${esc(links.demo)}" rel="noopener">See it work <span class="arrow" aria-hidden="true">&#8599;</span></a>` : '',
    `<a class="btn quiet" href="https://github.com/${esc(r.repo)}" rel="noopener">GitHub</a>`,
    links.website ? '' : `<span class="no-site">No website yet: the GitHub page is its home.</span>`,
  ].join('');

  const history = r.pulse?.history || [];
  const stars = act.stars ?? r.pulse?.stars;
  const coverageCount = (r.coverage || []).length;
  const pts = (r.coverage || []).map(c => ({ c, n: Number((String(c.meta || '').match(/([\d,]+)\s*points/) || [])[1]?.replace(/,/g, '') || 0) })).sort((a, b) => b.n - a.n)[0];
  const biggest = pts && pts.n ? `${human(pts.n)} points on ${pts.c.plat}` : '';

  const vitals = `<div class="vitals" aria-label="At a glance">
  <div class="vital"><span class="v-label">Popularity</span><span class="v-big">${human(stars)}</span><span class="v-note">GitHub stars${r.pulse?.gain ? `, <b>${esc(r.pulse.gain)}</b>` : ''}</span>${miniChart(history)}</div>
  <div class="vital"><span class="v-label">Buzz</span><span class="v-big">${coverageCount}</span><span class="v-note">independent write-ups and threads we found${biggest ? `. Biggest: <b>${esc(biggest)}</b>` : ''}. <a href="#who">See them</a></span></div>
  <div class="vital"><span class="v-label">Effort to try</span><span class="v-big" style="font-size:1.25rem">${EFFORT_LABEL[effort]}</span><div class="meter" aria-hidden="true">${[0, 1, 2].map(i => `<i class="${i <= effort ? 'on' : ''}"></i>`).join('')}</div></div>
  <div class="vital ${gate.ok ? 'safe' : 'unsafe'}"><span class="v-label">Safety check</span><span class="v-big">${gate.ok ? 'Passed' : 'Not cleared'}</span><span class="v-note">${gate.ok ? `Checked ${dShort(g.checked)}: no open security issues` : esc(gate.why)}</span></div>
</div>`;

  const hero = `<section class="answer" aria-labelledby="name">
  <div>
    <div class="kicker"><span class="rank-tag">${ctx.tag || `#${r.rank} this week`}</span><span class="repo-id">${esc(r.repo)}</span></div>
    <h1 id="name">${esc(r.name)}</h1>
    <p class="tagline">${rich(r.tagline)}</p>
    <p class="sentence">${rich(r.sentence)}</p>
    <div class="chips">
      <span class="chip ${fit[0]}"><span class="dot" aria-hidden="true"></span>${fit[1]}</span>
      ${r.replaces ? `<span class="chip replaces">Replaces: ${esc(r.replaces)}</span>` : ''}
      ${r.category ? `<span class="chip">${esc(r.category)}</span>` : ''}
    </div>
    <div class="actions">${actions}</div>
  </div>
  <figure class="pinned">
    <img src="${esc(srcAt(r.visual?.src, depth) || `https://opengraph.githubassets.com/1/${r.repo}`)}" alt="${esc(r.visual?.alt || `${r.name} on GitHub`)}" width="${r.visual?.width || 1200}" height="${r.visual?.height || 600}" loading="eager">
    <figcaption>${esc(r.visual?.caption || 'No demo published yet: this is its GitHub card.')}</figcaption>
  </figure>
</section>
${vitals}`;

  const note = n => {
    const role = { problem: 'Your problem', trigger: 'When it kicks in', input: 'You give it', does: 'It does', result: 'You get' }[n.role] || esc(n.role);
    const steps = n.role === 'does' && (n.steps || []).length ? `<ol class="steps-in">${n.steps.map(x => `<li>${rich(x)}</li>`).join('')}</ol>` : '';
    const outs = n.role === 'result' && (n.outputs || []).length ? `<ul class="outputs">${n.outputs.map(o => `<li><b>${rich(o.what)}</b>${o.eg ? `<span>${rich(o.eg)}</span>` : ''}</li>`).join('')}</ul>` : '';
    return `<div class="note ${esc(n.role)}"><span class="role">${role}</span><p class="say">${rich(n.say)}</p>${steps}${outs}${n.eg ? `<p class="eg">${rich(n.eg)}</p>` : ''}</div>`;
  };
  const notes = r.board || [];
  const headline = notes.find(n => n.role === 'problem');
  const board = q(1, 'how', 'How does it work?', null, `<div class="board">${headline ? `<div class="headline">${note(headline)}</div>` : ''}
<div class="flow">${notes.filter(n => n !== headline).map(note).join('')}</div>
</div>
<p class="legend" aria-hidden="true"><span class="l-problem">the problem</span><span class="l-how">how it works</span><span class="l-result">what you get</span><span class="l-watch">watch out</span></p>`);

  const ba = q(2, 'changes', 'What changes for me?', null, `<div class="ba">
  <div class="before"><h3>Without it</h3><ul>${(r.before || []).map(x => `<li>${rich(x)}</li>`).join('')}</ul></div>
  <div class="after"><h3>With it</h3><ul>${(r.after || []).map(x => `<li>${rich(x)}</li>`).join('')}</ul></div>
</div>`);

  const fp = r.footprint || {};
  const footprint = `<div class="footprint"><h3>What it takes on your computer</h3><dl>
    <div><dt>Space on disk</dt><dd>${rich(fp.disk || 'no data found')}</dd></div>
    <div><dt>Memory while it runs</dt><dd>${rich(fp.memory || 'no data found')}</dd></div>
    <div><dt>Runs on</dt><dd>${rich(fp.runs_on || 'no data found')}</dd></div>
  </dl>${fp.source ? `<a class="src" href="${esc(fp.source.url)}" rel="noopener">Source: ${esc(fp.source.title)}</a>` : ''}</div>`;

  const tryIt = q(3, 'try', 'How hard is it to try?', null, `<div class="try">
  <div class="effort">
    <h3 style="font-size:1.125rem">Effort</h3>
    <div class="levels" role="img" aria-label="Effort: ${EFFORT_LABEL[effort]}">${EFFORT_LABEL.map((l, i) => `<span class="${i === effort ? 'on' : ''}">${l}</span>`).join('')}</div>
    <ol class="steps">${(r.try?.steps || []).map(s => `<li>${rich(s)}</li>`).join('')}</ol>
  </div>
  <div class="try-side">
    ${footprint}
    ${gate.ok && r.try?.paste ? `<div class="paste">
      <p>Paste this into Claude Code. It runs your safety scan first, then a 10-minute test.</p>
      <pre id="paste-${esc(r.slug)}">${esc(r.try.paste)}</pre>
      <button class="copy" type="button" data-copy="paste-${esc(r.slug)}">Copy the prompt</button>
    </div>` : ''}
  </div>
</div>`);

  const v = r.verdict || {};
  const should = q(4, 'should', 'Should I?', null, `<div class="should">
  <div class="yes"><h3>Great if you...</h3><ul>${(v.best_for || []).map(x => `<li>${rich(x)}</li>`).join('')}</ul></div>
  <div class="no"><h3>Skip it if...</h3><ul>${(v.skip_if || []).map(x => `<li>${rich(x)}</li>`).join('')}</ul></div>
</div>
${(v.alternatives || []).length ? `<div class="alts"><h3>Instead, you could look at</h3><ul>${v.alternatives.map(a => `<li><a href="${esc(a.url || `https://github.com/${a.repo}`)}" rel="noopener"><b>${esc(a.name)}</b></a><span>${rich(a.line)}</span></li>`).join('')}</ul></div>` : ''}`);

  const flags = act.flags || [];
  const safe = q(5, 'safe', 'Is it safe?', null, `<div class="safety">
  <div>
    <span class="stamp ${gate.ok ? 'pass' : 'fail'}">${gate.ok ? 'PASSED' : 'NOT CLEARED'}</span>
    <ul class="checks">
      <li><div><b>Security advisories: ${adv.count ?? 'not checked'}</b><span>${adv.url ? `<a href="${esc(adv.url)}" rel="noopener">GitHub's advisory list</a>, checked ${dShort(g.checked)}` : ''}${adv.count ? ', all fixed in a published release' : ''}</span></div></li>
      <li><div><b>Searches for CVEs, vulnerabilities, malware and scams</b><span>${srch.results ?? 0} results read, including the national CVE database${(srch.hits || []).filter(h => h.kind === 'report' || h.kind === 'cve-record').length ? ': nothing unresolved' : ': nothing found'}</span></div></li>
      <li class="${flags.length ? 'flag' : ''}"><div><b>Are the stars earned?</b><span>${human(act.stars)} stars, ${human(act.contributors)} contributors, ${human(act.commits)} commits${flags.length ? `. Flag: ${esc(flags.join('; '))}` : `${r.star_check ? `. ${esc(r.star_check)}` : ''}`}</span></div></li>
    </ul>
    ${g.settled ? `<p class="lede" style="margin:var(--s-4) 0 0">${esc(g.settled.note)}</p>` : ''}
  </div>
  <div><h3 style="font-size:1.125rem;margin-bottom:var(--s-3)">Watch out for</h3><ul class="watch">${(r.watch || []).map(x => `<li>${rich(x)}</li>`).join('')}</ul></div>
</div>`);

  // Real uses and the coverage come last: the conclusion, with every link to go back to.
  const who = q(6, 'who', "Who's using it, and for what?", r.uses_note ? rich(r.uses_note) : null,
    `${(r.uses || []).length ? `<ol class="uses">${r.uses.map(u => `
  <li class="use"><span class="who-mark${u.stat && u.stat.length > 4 ? ' long' : ''}" aria-hidden="true">${esc(u.stat || String(r.uses.indexOf(u) + 1))}</span><div><h3>${rich(u.who)}</h3><p>${rich(u.what)}</p>${u.result ? `<p class="result">${rich(u.result)}</p>` : ''}${u.source ? `<a class="src" href="${esc(u.source.url)}" rel="noopener">${esc(u.source.title)}${u.source.date ? `, ${dShort(u.source.date)}` : ''}</a>` : ''}</div></li>`).join('')}</ol>`
      : `<p class="thin">We couldn't find anyone describing real use of it yet. That's normal for a brand-new repo, and it's worth knowing.</p>`}
<div class="talk"><h3>Who's talking about it</h3>
  ${(r.coverage || []).length ? `<ul class="wall">${r.coverage.map(c => `<li class="${c.tone === 'critical' ? 'tone-critical' : ''}"><span class="plat">${esc(c.plat)}</span><a href="${esc(c.url)}" rel="noopener">${esc(c.title)}</a><span class="meta">${esc(c.meta || '')}</span></li>`).join('')}</ul>` : `<p class="thin">No independent coverage found yet.</p>`}
  ${(r.trending || []).length ? `<div class="trending">${r.trending.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
</div>`);

  const sources = `<section class="sources" aria-labelledby="src-h"><h2 id="src-h">Sources</h2><ol>${(r.sources || []).map(s => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>${s.date ? `, ${dShort(s.date)}` : ''}</li>`).join('')}</ol></section>`;

  const html = `${head({ title: `${r.name}: ${stripB(r.tagline)} | Repo Radar`, description: stripB(r.sentence), depth, image: absSrc(r.visual?.src) || `https://opengraph.githubassets.com/1/${r.repo}` })}
${topbar(depth, ctx.crumb || `Edition ${ed.number} &middot; Week of ${dLong(ed.date)}`)}
<main class="wrap">
${hero}
${board}
${ba}
${tryIt}
${should}
${safe}
${who}
${sources}
<footer class="site-foot"><span>${ctx.footLeft || `Repo Radar &middot; Edition ${ed.number} &middot; ${dLong(ed.date)}`}</span><a href="${ctx.backHref || './'}">&larr; ${ctx.backLabel || "Back to this week's 10"}</a></footer>
</main>
</body>
</html>
`;
  return html;
}
const stripB = s => String(s || '').replace(/\*\*/g, '');

// ---------- the DO NOT INSTALL page: a pick that failed the gate after it was published ----------
// Red, with the evidence and what to do if you already used it. No picture, no board, no try box.
function failPage(ed, r) {
  const where = `editions/${ed.date}/${r.slug}.html`;
  const g = Object.values(GATE).find(e => key(e.repo) === key(r.repo));
  if (!g || g.verdict !== 'FAIL') errors.push(`${where}: a DO NOT INSTALL page needs a FAIL in the gate log (${r.repo} is ${g ? g.verdict : 'not gated'})`);
  const act = g?.checks?.activity || {}, adv = g?.checks?.advisories || {};
  const q = (n, id, title, body) => `<section class="q" id="${id}" aria-labelledby="${id}-h"><header><span class="q-num">${n}</span><h2 id="${id}-h">${title}</h2></header>${body}</section>`;
  return `${head({ title: `DO NOT INSTALL: ${r.name} | Repo Radar`, description: stripB(r.sentence), depth: 2 })}
${topbar(2, `Edition ${ed.number} &middot; Week of ${dLong(ed.date)}`)}
<main class="wrap">
<section class="answer danger" aria-labelledby="name">
  <div>
    <div class="kicker"><span class="stamp fail">DO NOT INSTALL</span><span class="repo-id">${esc(r.repo)}</span></div>
    <h1 id="name">${esc(r.name)}</h1>
    <p class="tagline">${rich(r.tagline)}</p>
    <p class="sentence">${rich(r.sentence)}</p>
  </div>
</section>
${q(1, 'what', 'What happened?', `<ul class="watch">${(r.what_happened || []).map(x => `<li>${rich(x)}</li>`).join('')}</ul>`)}
${q(2, 'why', 'Why it still fails our check', `<div class="should one"><div class="no"><ul>${(r.why_fail || []).map(x => `<li>${rich(x)}</li>`).join('')}</ul></div></div>`)}
${q(3, 'used', 'If you already used it', `<ol class="steps">${(r.if_used || []).map(x => `<li>${rich(x)}</li>`).join('')}</ol>`)}
${q(4, 'record', 'Safety check record', `<ul class="checks">
  <li class="flag"><div><b>Checked ${g ? dLong(g.checked) : ''}: ${g ? g.verdict : 'not gated'}</b><span>${esc(g?.settled?.note || (g?.reasons || []).join('; '))}</span></div></li>
  <li><div><b>Security advisories: ${adv.count ?? 'not checked'}</b><span>${adv.url ? `<a href="${esc(adv.url)}" rel="noopener">GitHub's advisory list</a>` : ''}</span></div></li>
  <li class="${(act.flags || []).length ? 'flag' : ''}"><div><b>Activity</b><span>${human(act.stars)} stars, ${human(act.contributors)} contributors, ${human(act.commits)} commits${act.created ? `, created ${dLong(act.created)}` : ''}</span></div></li>
</ul>`)}
<section class="sources" aria-labelledby="src-h"><h2 id="src-h">Sources</h2><ol>${(r.sources || []).map(x => `<li><a href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a>${x.date ? `, ${dShort(x.date)}` : ''}</li>`).join('')}</ol></section>
<footer class="site-foot"><span>Repo Radar &middot; Edition ${ed.number} &middot; ${dLong(ed.date)}. Pulled after our security review.</span><a href="./">&larr; Back to this week's 10</a></footer>
</main>
</body>
</html>
`;
}

// ---------- edition index + hub ----------
// What a Top 10 card shows in place of total stars: why the repo is here this week, from the numbers
// the candidates run measured for that edition. An edition without a candidates file shows total stars.
const poolCache = new Map();
function why(ed, p) {
  if (!poolCache.has(ed.date)) {
    const f = `data/candidates/${ed.date}.json`;
    poolCache.set(ed.date, new Map((existsSync(join(ROOT, f)) ? read(f).candidates : []).map(c => [key(c.repo), c])));
  }
  return esc(whyThisWeek(p, poolCache.get(ed.date).get(key(p.repo))));
}
function pickCard(ed, p, i, depth) {
  const up = '../'.repeat(depth);
  const href = depth === 0 ? `editions/${ed.date}/${p.slug}.html` : `${p.slug}.html`;
  if (p.status === 'fail') {
    return `<a class="pick small bad" href="${href}"><span class="n">!</span><h3><small>${esc(p.repo)}</small>${esc(p.name)}: do not install</h3><p>${esc(p.oneliner)}</p><div class="row"><span class="chip" style="border-color:var(--coral-edge);color:var(--coral-ink)">Failed our safety check</span></div></a>`;
  }
  requireGate(p.repo, `${depth === 0 ? 'index.html' : `editions/${ed.date}/index.html`} (Top 10)`);
  const fit = FIT[p.fit] || FIT.news;
  const cls = i === 0 ? 'p1' : i <= 2 ? `p${i + 1}` : 'small';
  const img = i <= 2 && p.thumb ? `<img src="${esc(srcAt(p.thumb, depth))}" alt="" loading="lazy">` : '';
  const text = `<div>${i === 0 ? '' : `<span class="n">#${p.rank}</span>`}${i === 0 ? `<span class="rank-tag">#1 this week</span>` : ''}<h3><small>${esc(p.repo)}</small>${esc(p.name)}</h3><p>${rich(p.oneliner)}</p><div class="row" style="margin-top:var(--s-3)"><span class="chip ${fit[0]}"><span class="dot" aria-hidden="true"></span>${fit[1]}</span><span class="num">${why(ed, p)}</span></div></div>`;
  return i === 0 ? `<a class="pick p1" href="${href}">${text}${img}</a>` : `<a class="pick ${cls}" href="${href}">${img}${text}</a>`;
}

function restList(ed, depth) {
  const rows = ed.picks.slice(3).map(p => {
    const href = depth === 0 ? `editions/${ed.date}/${p.slug}.html` : `${p.slug}.html`;
    if (p.status === 'fail') return `<li><a class="row bad" href="${href}"><span class="n">!</span><span class="nm"><b>${esc(p.name)}</b><small>${esc(p.repo)}</small></span><span class="ol">${esc(p.oneliner)}</span><span class="chip" style="border-color:var(--coral-edge);color:var(--coral-ink)">Do not install</span></a></li>`;
    requireGate(p.repo, `${depth === 0 ? 'index.html' : `editions/${ed.date}/index.html`} (Top 10)`);
    const fit = FIT[p.fit] || FIT.news;
    return `<li><a class="row" href="${href}"><span class="n">#${p.rank}</span><span class="nm"><b>${esc(p.name)}</b><small>${esc(p.repo)}</small></span><span class="ol">${rich(p.oneliner)}</span><span class="chip ${fit[0]}"><span class="dot" aria-hidden="true"></span>${fit[1]}</span><span class="num">${why(ed, p)}</span></a></li>`;
  }).join('');
  return `<ol class="rest">${rows}</ol>`;
}

function editionIndex(ed) {
  const html = `${head({ title: `Edition ${ed.number}: ${ed.theme_short || 'This week'} | Repo Radar`, description: stripB(ed.theme), depth: 2 })}
${topbar(2, `Edition ${ed.number} &middot; Week of ${dLong(ed.date)}`)}
<main class="wrap">
<section class="masthead"><div><p class="edition">Edition ${ed.number} &middot; Week of ${dLong(ed.date)}</p><h1>This week's <span class="scribble">10</span></h1></div>
<div class="theme-note"><span class="role">The story this week</span><p>${rich(ed.theme)}</p></div></section>
<div class="ten">${ed.picks.slice(0, 3).map((p, i) => pickCard(ed, p, i, 2)).join('')}</div>
${restList(ed, 2)}
${ed.method ? `<p class="method">${rich(ed.method)}</p>` : ''}
<footer class="site-foot"><span>Repo Radar &middot; Edition ${ed.number}</span><a href="../../archive.html">Every edition</a></footer>
</main>
</body>
</html>
`;
  return html;
}

function hub(ed, hubData) {
  const cats = (hubData.categories || []).map(c => {
    const rows = (c.picks || []).filter(p => requireGate(p.repo, `index.html (Category Radar: ${c.name})`).ok || true);
    const max = Math.max(1, ...rows.map(p => p.perday || 0));
    return `<section class="cat" aria-labelledby="cat-${esc(c.id)}"><h3 id="cat-${esc(c.id)}">${esc(c.name)}<small>${rows.length < 3 ? `${rows.length} of 3 cleared` : `checked ${dShort(c.checked)}`}</small></h3>
<ol>${rows.map((p, i) => `<li><a href="${esc(p.url || `https://github.com/${p.repo}`)}" rel="noopener"><span class="pos">${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="st">${human(p.stars)} stars${p.perday ? ` &middot; +${human(p.perday)} a day` : ''}</span><span class="ds">${rich(p.oneliner)}</span>${p.perday ? `<span class="bar" aria-hidden="true"><i style="width:${Math.round((p.perday / max) * 100)}%"></i></span>` : ''}</a></li>`).join('')}
${rows.length < 3 ? `<li class="gap">${3 - rows.length} slot${rows.length === 2 ? '' : 's'} open: the old picks failed the safety check, and replacements are being checked.</li>` : ''}</ol></section>`;
  }).join('');
  const board = (hubData.claude_board || []).length ? `<section class="q" id="claude-board" aria-labelledby="cb-h"><header><h2 id="cb-h">The Claude Board</h2></header><p class="lede">${rich(hubData.claude_board_note || '')}</p><div class="cats"><section class="cat"><ol>${hubData.claude_board.map((p, i) => { requireGate(p.repo, 'index.html (Claude Board)'); return `<li><a href="${esc(p.url || `https://github.com/${p.repo}`)}" rel="noopener"><span class="pos">${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="st">${esc(p.installs_label || '')}</span><span class="ds">${rich(p.oneliner)}</span></a></li>`; }).join('')}</ol></section></div></section>` : '';

  return `${head({ title: 'Repo Radar: the open-source tools worth your week', description: 'Every Friday: the 10 open-source tools worth knowing, explained in plain English with pictures, plus the leaders in every category. Every pick passes a security check.', depth: 0 })}
${topbar(0, '')}
<main class="wrap">
<section class="masthead"><div><p class="edition">Edition ${ed.number} &middot; Week of ${dLong(ed.date)}</p><h1>The tools worth <span class="scribble">your week</span></h1></div>
<div class="theme-note"><span class="role">The story this week</span><p>${rich(ed.theme)}</p></div></section>
<div class="ten">${ed.picks.slice(0, 3).map((p, i) => pickCard(ed, p, i, 0)).join('')}</div>
${restList(ed, 0)}
${ed.method ? `<p class="method">${rich(ed.method)}</p>` : ''}
<section class="q" id="categories" aria-labelledby="cat-h"><header><h2 id="cat-h">Leaders in every category</h2></header><p class="lede">${rich(hubData.categories_note || '')}</p><div class="cats">${cats}</div></section>
${board}
<footer class="site-foot"><span>Repo Radar &middot; New edition every Friday</span><a href="archive.html">Every edition</a></footer>
</main>
</body>
</html>
`;
}

// ---------- main ----------
const argv = process.argv.slice(2);
const edArg = argv[argv.indexOf('--edition') + 1];
const editions = argv.includes('--all') || !argv.includes('--edition')
  ? readdirSync(join(ROOT, 'data/editions')).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  : [edArg];
const written = [];
const outputs = []; // [path, html] - written only if the whole build is clean
let latest = null;
for (const date of editions) {
  const edPath = `data/editions/${date}/edition.json`;
  if (!existsSync(join(ROOT, edPath))) continue;
  const ed = read(edPath);
  latest = ed;
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  for (const p of ed.picks) {
    if (only && p.slug !== only) continue;
    const f = `data/editions/${date}/${p.slug}.json`;
    if (!existsSync(join(ROOT, f))) continue;
    const r = { ...read(f), rank: p.rank, slug: p.slug };
    const out = `editions/${date}/${p.slug}.html`;
    outputs.push([out, p.status === 'fail' || r.status === 'fail' ? failPage(ed, r) : repoPage(ed, r)]);
  }
  if (!only && ed.picks.every(p => p.status === 'fail' || p.oneliner)) {
    outputs.push([`editions/${date}/index.html`, editionIndex(ed)]);
  }
}
// Lookups: data/lookups/<owner>--<repo>.json -> lookups/<owner>--<repo>.html, same template.
if (existsSync(join(ROOT, 'data/lookups')) && !argv.includes('--only')) {
  for (const f of readdirSync(join(ROOT, 'data/lookups')).filter(f => f.endsWith('.json'))) {
    const r = { ...read(`data/lookups/${f}`), slug: f.replace(/\.json$/, '') };
    const date = r.looked_up || new Date().toISOString().slice(0, 10);
    outputs.push([`lookups/${r.slug}.html`, repoPage({ number: '', date }, r, {
      where: `lookups/${r.slug}.html`, depth: 1, tag: `Looked up ${dShort(date)}`,
      crumb: `Lookup &middot; ${dLong(date)}`, footLeft: `Repo Radar &middot; Lookup &middot; ${dLong(date)}`,
      backHref: 'index.html', backLabel: 'Lookup library',
    })]);
  }
}
if (argv.includes('--hub') && latest) {
  const hubData = existsSync(join(ROOT, 'data/hub.json')) ? read('data/hub.json') : {};
  outputs.push(['index.html', hub(latest, hubData)]);
}
if (errors.length) {
  console.error(`BUILD REFUSED - ${errors.length} safety problem(s), nothing written:\n  ${[...new Set(errors)].join('\n  ')}`);
  process.exit(1);
}
for (const [out, html] of outputs) {
  mkdirSync(join(ROOT, dirname(out)), { recursive: true });
  writeFileSync(join(ROOT, out), html);
  written.push(out);
}
console.log(`built ${written.length} page(s):\n  ${written.join('\n  ')}`);
