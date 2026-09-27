// verify.mjs - the check that must pass before anything ships (scripts/ship.sh runs it).
// Fails closed: exits 1 on any problem and prints what to fix.
//
//   1. every internal link on the site resolves
//   2. no em or en dashes anywhere in the published pages or the data
//   3. every repo the site recommends has a current gate PASS with advisory evidence and is not on
//      the blocklist (pages, lists, the Claude Board, alternatives, legacy pages, classic/)
//   4. every repo data file has the required fields
//   5. the plain-English fields contain no unexplained jargon
//   6. no source is dated before the repo it describes existed
//
// Usage: node scripts/verify.mjs [--root DIR]   (DIR defaults to the repo root; tests use fixtures)
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';

const argv = process.argv.slice(2);
const IMPORTED = !process.argv[1]?.endsWith('verify.mjs');
const ROOT = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : new URL('..', import.meta.url).pathname;
const problems = [];
const bad = (where, what) => problems.push(`${where}: ${what}`);
const readJSON = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const key = r => String(r || '').toLowerCase();

function walk(dir, out = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    if (['.git', 'node_modules', '.vercel', 'backup', 'scripts'].includes(f)) continue; // scripts/ holds test fixtures, never published
    const p = dir ? `${dir}/${f}` : f;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = IMPORTED ? [] : walk('');
const html = files.filter(f => f.endsWith('.html'));

// ---- 1 + 2: links and dashes -------------------------------------------------------------
for (const f of html) {
  const s = readFileSync(join(ROOT, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  if (/[—–]/.test(s)) bad(f, 'contains an em or en dash');
  for (const [, href] of s.matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#|javascript:|data:)/.test(href) || href.includes('${')) continue;
    const path = href.split('#')[0].split('?')[0];
    if (!path) continue;
    let t = normalize(join(dirname(f), path));
    if (path.endsWith('/') || (existsSync(join(ROOT, t)) && statSync(join(ROOT, t)).isDirectory())) t = join(t, 'index.html');
    if (!existsSync(join(ROOT, t))) bad(f, `broken link ${href}`);
  }
}
for (const f of files.filter(f => f.startsWith('data/') && f.endsWith('.json'))) {
  if (/[—–]/.test(readFileSync(join(ROOT, f), 'utf8')) && !f.includes('candidates/') && !f.endsWith('gate-log.json')) bad(f, 'contains an em or en dash');
}

// ---- 3: every recommended repo is cleared --------------------------------------------------
const GATE = existsSync(join(ROOT, 'data/gate-log.json')) ? readJSON('data/gate-log.json') : {};
const BLOCK = new Set((existsSync(join(ROOT, 'data/blocklist.json')) ? readJSON('data/blocklist.json') : []).map(b => key(b.repo)));
const gateOf = r => Object.values(GATE).find(e => key(e.repo) === key(r));
function cleared(repo, where, maxAgeDays = 45) {
  if (BLOCK.has(key(repo))) return bad(where, `${repo} is on the blocklist`);
  const g = gateOf(repo);
  if (!g) return bad(where, `${repo} was never gated`);
  if (g.verdict !== 'PASS') return bad(where, `${repo} gate verdict is ${g.verdict}`);
  const a = g.checks?.advisories || {};
  if (!a.source || a.count == null || !a.url) return bad(where, `${repo} PASS has no advisory evidence`);
  if ((Date.now() - Date.parse(g.checked)) / 864e5 > maxAgeDays) bad(where, `${repo} gate is older than ${maxAgeDays} days`);
}
// a) repos rendered from data (new pages, lists, board, alternatives)
const edDirs = existsSync(join(ROOT, 'data/editions')) ? readdirSync(join(ROOT, 'data/editions')).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
for (const d of edDirs) {
  const ed = readJSON(`data/editions/${d}/edition.json`);
  for (const p of ed.picks) if (p.status !== 'fail') cleared(p.repo, `data/editions/${d}/edition.json`);
  for (const f of readdirSync(join(ROOT, `data/editions/${d}`)).filter(f => f.endsWith('.json') && f !== 'edition.json')) {
    const r = readJSON(`data/editions/${d}/${f}`);
    for (const a of r.verdict?.alternatives || []) if (a.repo) cleared(a.repo, `data/editions/${d}/${f} (alternative)`);
  }
}
if (existsSync(join(ROOT, 'data/hub.json'))) {
  const hub = readJSON('data/hub.json');
  for (const c of hub.categories || []) for (const p of c.picks || []) cleared(p.repo, `data/hub.json (${c.name})`);
  for (const p of hub.claude_board || []) cleared(p.repo, 'data/hub.json (Claude Board)');
}
// b) every published page: the repo a page is about, and every GitHub repo a list links to
for (const f of html.filter(f => /^(editions|lookups|classic)\//.test(f) || f === 'index.html')) {
  const s = readFileSync(join(ROOT, f), 'utf8');
  if (/DO NOT INSTALL/.test(s) && /class="stamp[^"]*"|>DO NOT INSTALL</.test(s)) continue; // a warning page is allowed to name its repo
  const isList = /index\.html$/.test(f);
  const links = [...s.matchAll(/href="https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?"/g)].map(m => `${m[1]}/${m[2]}`);
  const subjects = isList ? links : links.slice(0, 1);
  for (const r of new Set(subjects)) if (!/^(sponsors|topics|orgs|features)\//.test(r)) cleared(r, f, 90);
}

// ---- 4 + 5 + 6: repo data files --------------------------------------------------------------
const REQUIRED = ['repo', 'name', 'tagline', 'sentence', 'fit', 'board', 'before', 'after', 'uses', 'pulse', 'coverage', 'try', 'footprint', 'verdict', 'watch', 'sources'];
const BOARD = ['problem', 'trigger', 'input', 'does', 'result'];
// A try-it step that sends the reader somewhere must link there (JJ, Sep 27 2026: "always provide links").
const GOES_SOMEWHERE = /\b(open|visit|download|go to|sign up|log in|install(s)? (it )?from|releases? page|(live )?demo|website|notebook|app store|quickstart|docs|guide)\b/i;
// Words a non-coder can't be expected to know. Allowed only when the same field explains them.
const JARGON = /\b(autoregressive|non-autoregressive|inference|embeddings?|vector(s| database)?|RAG|LLMs?|orchestration|harness|SDK|CLI|latency|tokens?|fine-?tun(e|ing)|MCP|agentic|runtime|backbone|parameters?|checkpoint|forward pass|calibrat\w*|repo(sitory)?|dependenc(y|ies)|deploy\w*|endpoint|webhook|Docker|Kubernetes|monorepo|self-hosted)\b/i;
// The explanation has to sit right next to the word: "inference (running the model)", "tokens: small chunks of text".
const explainedAt = (text, idx, len) => /^[\w-]*\s*(\([^)]{6,}\)|[:,-]\s*(which|meaning|that is|a way|small|the|how)|:\s)/i.test(text.slice(idx + len));
export function jargonProblem(text) {
  const re = new RegExp(JARGON.source, 'gi');
  for (const m of String(text || '').matchAll(re)) if (!explainedAt(text, m.index, m[0].length)) return m[0];
  return null;
}
const dataFiles = [
  ...edDirs.flatMap(d => readdirSync(join(ROOT, `data/editions/${d}`)).filter(f => f.endsWith('.json') && f !== 'edition.json').map(f => `data/editions/${d}/${f}`)),
  ...(existsSync(join(ROOT, 'data/lookups')) ? readdirSync(join(ROOT, 'data/lookups')).filter(f => f.endsWith('.json')).map(f => `data/lookups/${f}`) : []),
];
for (const where of dataFiles) {
  const r = readJSON(where);
  if (where.startsWith('data/lookups/')) { cleared(r.repo, where); for (const a of r.verdict?.alternatives || []) if (a.repo) cleared(a.repo, `${where} (alternative)`); }
  for (const k of REQUIRED) if (r[k] == null || (Array.isArray(r[k]) && !r[k].length && k !== 'uses' && k !== 'coverage')) bad(where, `missing ${k}`);
  const board = r.board || [];
  if (board.map(n => n.role).join() !== BOARD.join()) bad(where, `board needs 5 notes in this order: ${BOARD.join(', ')}`);
  const does = board.find(n => n.role === 'does'), result = board.find(n => n.role === 'result');
  if (does && !((does.steps || []).length >= 2 && does.steps.length <= 4)) bad(where, 'the "It does" note needs 2 to 4 steps');
  if (result && !((result.outputs || []).length >= 1 && result.outputs.length <= 3)) bad(where, 'the "You get" note needs 1 to 3 outputs');
  const fp = r.footprint || {};
  for (const k of ['disk', 'memory', 'runs_on']) if (!fp[k]) bad(where, `footprint.${k} missing (write "no data found" if there is none)`);
  if (['disk', 'memory', 'runs_on'].some(k => fp[k] && !/^no data found/i.test(fp[k])) && !fp.source?.url) bad(where, 'footprint needs a source');
  (r.try?.steps || []).forEach((st, i) => { if (GOES_SOMEWHERE.test(st) && !/\]\(https?:\/\//.test(st)) bad(where, `try step ${i + 1} sends the reader somewhere but has no link`); });
  const plain = [['tagline', r.tagline], ['sentence', r.sentence], ...board.flatMap((n, i) => [[`board[${i}]`, n.say], ...(n.steps || []).map((x, j) => [`board[${i}].steps[${j}]`, x]), ...(n.outputs || []).map((o, j) => [`board[${i}].outputs[${j}]`, o.what])]), ...(r.before || []).map((x, i) => [`before[${i}]`, x]), ...(r.after || []).map((x, i) => [`after[${i}]`, x])];
  for (const [field, text] of plain) {
    const word = jargonProblem(text);
    if (word) bad(where, `jargon "${word}" in ${field} without a plain explanation next to it`);
  }
  const created = gateOf(r.repo)?.checks?.activity?.created;
  if (created) for (const s of [...(r.sources || []), ...(r.uses || []).map(u => u.source).filter(Boolean)]) {
    if (s.date && s.date < created) bad(where, `source "${s.title}" is dated ${s.date}, before the repo existed (${created})`);
  }
}

if (IMPORTED) { /* imported by a test: expose helpers only */ }
else if (problems.length) {
  console.error(`VERIFY FAILED - ${problems.length} problem(s):\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
} else console.log(`verify ok: ${html.length} pages, ${edDirs.length} edition data folder(s), every recommended repo cleared`);
