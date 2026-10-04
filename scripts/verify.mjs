// verify.mjs - the check that must pass before anything ships (scripts/ship.sh runs it).
// Fails closed: exits 1 on any problem and prints what to fix.
//
//   1. every internal link on the site resolves
//   2. no em or en dashes anywhere in the published pages or the data
//   3. every repo the site recommends has a current gate PASS with advisory evidence and is not on
//      the blocklist (pages, lists, the Claude Board, alternatives, legacy pages, classic/)
//      and no page links a blocklisted repo in any form of link; only a stamped page whose own
//      repo has a FAIL on record may name that repo
//   4. every repo data file has the required fields
//   5. the plain-English fields contain no unexplained jargon
//   6. no source is dated before the repo it describes existed
//   7. every edition after Oct 3 2026 ships with its saved report (docs/reports/<date>.md)
//   8. the fence: a push that adds an edition changes no script and no rule file
//
// Usage: node scripts/verify.mjs [--root DIR]   (DIR defaults to the repo root; tests use fixtures)
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const IMPORTED = !process.argv[1]?.endsWith('verify.mjs');
const ROOT = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : new URL('..', import.meta.url).pathname;
// --sheet data/editions/<date>/<slug>.json checks that one answer sheet alone (fields, board,
// footprint, links, jargon, dates, dashes, gated alternatives), so several pages can be written at once.
const SHEET = argv.includes('--sheet') ? argv[argv.indexOf('--sheet') + 1] : null;
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
const files = IMPORTED || SHEET ? [] : walk('');
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
// An alternative that links a GitHub project recommends it, whether or not it has a repo field.
export const altRepo = a => a?.repo || (String(a?.url || '').match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?(?:[#?].*)?$/) || [])[1] || null;
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
for (const d of SHEET ? [] : edDirs) {
  const ed = readJSON(`data/editions/${d}/edition.json`);
  for (const p of ed.picks) if (p.status !== 'fail') cleared(p.repo, `data/editions/${d}/edition.json`);
  for (const f of readdirSync(join(ROOT, `data/editions/${d}`)).filter(f => f.endsWith('.json') && f !== 'edition.json')) {
    const r = readJSON(`data/editions/${d}/${f}`);
    for (const a of r.verdict?.alternatives || []) if (altRepo(a)) cleared(altRepo(a), `data/editions/${d}/${f} (alternative)`);
  }
}
if (!SHEET && existsSync(join(ROOT, 'data/hub.json'))) {
  const hub = readJSON('data/hub.json');
  for (const c of hub.categories || []) for (const p of c.picks || []) cleared(p.repo, `data/hub.json (${c.name})`);
  for (const p of hub.claude_board || []) cleared(p.repo, 'data/hub.json (Claude Board)');
}
// b) every published page: the repo a page is about, and every GitHub repo a list links to.
// A warning page may name its own repo and nothing else: it carries the DO NOT INSTALL stamp AND
// that repo has a FAIL on record. The words alone excuse nothing (JJ, Oct 3 2026: any page with the
// phrase in bold used to skip this whole check, whether or not its repo had failed).
// c) no page anywhere links a blocklisted repo, in any form of link: a deep link (/issues, /tree),
// a second link on a repo page, a source, a raw file, a capitalised host. Citations to other repos
// stay ungated (JJ, Oct 3 2026).
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCK_LINK = [...BLOCK].map(k => [k, new RegExp(`^https?://[^/]*github[^/]*/(?:repos/)?${reEsc(k)}(?=$|[/?#]|\\.git(?=$|[/?#]))`, 'i')]);
// The repo a page is about: its data file when it has one, else the repo-id the template prints
// next to the stamp, else (old hand-made pages only) the first GitHub link on it.
function ownRepo(f, s) {
  const d = `data/${f.replace(/\.html$/, '.json')}`;
  if (existsSync(join(ROOT, d))) return readJSON(d).repo || null;
  return (s.match(/class="repo-id">\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\s*</) || s.match(/href="https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?[/?#"]/i) || [])[1] || null;
}
for (const f of html) {
  const s = readFileSync(join(ROOT, f), 'utf8');
  const isList = /index\.html$/.test(f);
  const own = !isList && /class="stamp[^"]*"[^>]*>\s*DO NOT INSTALL/.test(s) ? ownRepo(f, s) : null;
  const warned = own && gateOf(own)?.verdict === 'FAIL' ? key(own) : null;
  const hrefs = [...s.matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
  for (const [k, re] of BLOCK_LINK) if (k !== warned && hrefs.some(h => re.test(h))) bad(f, `links ${k}, which is on the blocklist`);
  if (warned || !(/^(editions|lookups|classic)\//.test(f) || f === 'index.html')) continue; // a warning page recommends nothing
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
const dataFiles = SHEET ? [SHEET] : [
  ...edDirs.flatMap(d => readdirSync(join(ROOT, `data/editions/${d}`)).filter(f => f.endsWith('.json') && f !== 'edition.json').map(f => `data/editions/${d}/${f}`)),
  ...(existsSync(join(ROOT, 'data/lookups')) ? readdirSync(join(ROOT, 'data/lookups')).filter(f => f.endsWith('.json')).map(f => `data/lookups/${f}`) : []),
];
for (const where of dataFiles) {
  const r = readJSON(where);
  if (r.status === 'fail') { // a DO NOT INSTALL page: the evidence, not a recommendation
    for (const k of ['repo', 'name', 'tagline', 'sentence', 'what_happened', 'why_fail', 'if_used', 'sources']) if (r[k] == null || (Array.isArray(r[k]) && !r[k].length)) bad(where, `missing ${k}`);
    if (gateOf(r.repo)?.verdict !== 'FAIL') bad(where, `a DO NOT INSTALL page needs a FAIL in the gate log (${r.repo} is ${gateOf(r.repo)?.verdict || 'not gated'})`);
    continue;
  }
  if (where.startsWith('data/lookups/') || SHEET) { cleared(r.repo, where); for (const a of r.verdict?.alternatives || []) if (altRepo(a)) cleared(altRepo(a), `${where} (alternative)`); }
  if (SHEET && /[—–]/.test(readFileSync(join(ROOT, where), 'utf8'))) bad(where, 'contains an em or en dash');
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

// ---- 7: the Friday report is saved with the edition ---------------------------------------------
// The Oct 2 2026 report lived only in the cloud session, so "flagged for JJ" never reached him.
const REPORTS_FROM = '2026-10-03';
for (const d of SHEET ? [] : edDirs.filter(d => d > REPORTS_FROM)) {
  const p = `docs/reports/${d}.md`;
  if (!existsSync(join(ROOT, p))) bad(p, 'missing: write this edition\'s report before shipping (playbook step 8)');
  else if (!/^## Needs JJ\s*$/m.test(readFileSync(join(ROOT, p), 'utf8'))) bad(p, 'needs a "## Needs JJ" section (write "Nothing this week." under it if there is nothing)');
}

// ---- 8: the fence -------------------------------------------------------------------------------
// The Oct 2 2026 Friday run kept a flagged repo on the site by adding an "under review" exception to
// build.mjs and to this file. An edition run never edits the checker or the rules: script and rule
// changes ship on their own, from a session JJ is in. Known ceiling, accepted by JJ on Oct 3 2026:
// a run that rewrites this check on purpose, or that ships a script change in one push and the
// edition in the next, still gets through. Only a rule on the GitHub side would stop that; revisit
// if a run ever trips the fence.
const PROTECTED = [/^scripts\//, /^CLAUDE\.md$/, /^docs\/(SECURITY_GATE|EDITION_PLAYBOOK|DATA_FORMAT)\.md$/];
export function fenceProblems(changes) {
  const added = changes.find(c => c.status === 'A' && /^data\/editions\/\d{4}-\d{2}-\d{2}\/edition\.json$/.test(c.path));
  if (!added) return [];
  return changes.filter(c => PROTECTED.some(re => re.test(c.path)))
    .map(c => `${c.path} changed in the same push as a new edition (${added.path}). An edition run never edits the scripts or the rule files: put the file back, and if a check is blocking you, stop and report it instead`);
}
// Everything that differs from GitHub's main: commits not pushed yet, uncommitted edits, new files.
function changesVsGitHub() {
  const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(ROOT)) return null; // not a checkout (a test fixture)
  if (git('rev-parse', '--verify', '-q', 'origin/main').status !== 0) return { error: 'no origin/main to compare with' };
  const diff = git('diff', '--name-status', '--no-renames', 'origin/main');
  const fresh = git('ls-files', '--others', '--exclude-standard');
  if (diff.status !== 0 || fresh.status !== 0) return { error: (diff.stderr || fresh.stderr).trim().slice(0, 140) };
  return { changes: [
    ...diff.stdout.split('\n').filter(Boolean).map(l => { const [status, ...path] = l.split('\t'); return { status: status[0], path: path.join('\t') }; }),
    ...fresh.stdout.split('\n').filter(Boolean).map(path => ({ status: 'A', path })),
  ] };
}
if (!IMPORTED && !SHEET) {
  const vs = changesVsGitHub();
  if (vs?.error) bad('the fence', `can't compare this checkout with GitHub (${vs.error})`);
  else if (vs) for (const p of fenceProblems(vs.changes)) problems.push(p);
}

if (IMPORTED) { /* imported by a test: expose helpers only */ }
else if (problems.length) {
  console.error(`VERIFY FAILED - ${problems.length} problem(s):\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
} else console.log(SHEET ? `sheet ok: ${SHEET}` : `verify ok: ${html.length} pages, ${edDirs.length} edition data folder(s), every recommended repo cleared`);
