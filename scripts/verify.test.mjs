// Run: node --test scripts/*.test.mjs
// Each test builds a tiny fake site with one deliberate problem and proves verify.mjs refuses it.
// These are the adversarial pass's findings (Sep 27 2026) turned into tests: anything the site
// shows must be cleared by the security gate, through any path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jargonProblem } from './verify.mjs';

const VERIFY = new URL('./verify.mjs', import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);
const pass = repo => ({ repo, checked: today, verdict: 'PASS', checks: { advisories: { source: 'github-api', url: `https://github.com/${repo}/security/advisories`, count: 0, items: [] }, activity: { created: '2026-01-01' } } });

function site(files) {
  const root = mkdtempSync(join(tmpdir(), 'rr-verify-'));
  const base = {
    'index.html': '<a href="archive.html">Archive</a>',
    'archive.html': '<p>archive</p>',
    'data/gate-log.json': JSON.stringify({ 'good/repo': pass('good/repo') }),
    'data/blocklist.json': '[]',
  };
  for (const [p, c] of Object.entries({ ...base, ...files })) {
    mkdirSync(join(root, dirname(p)), { recursive: true });
    writeFileSync(join(root, p), typeof c === 'string' ? c : JSON.stringify(c));
  }
  return root;
}
const verify = root => spawnSync('node', [VERIFY, '--root', root], { encoding: 'utf8' });
const refuses = (root, needle) => {
  const r = verify(root);
  assert.equal(r.status, 1, `expected a refusal, got: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, needle);
};

test('a clean site passes', () => {
  const r = verify(site({}));
  assert.equal(r.status, 0, r.stderr);
});

test('an ungated repo on the Claude Board is refused', () => {
  refuses(site({ 'data/hub.json': { categories: [], claude_board: [{ repo: 'never/gated', name: 'x', oneliner: 'x' }] } }), /never\/gated was never gated/);
});

test('a blocklisted repo on an old page is refused', () => {
  refuses(site({
    'data/blocklist.json': JSON.stringify([{ repo: 'bad/repo', kind: 'open-advisories', reason: 'x', date: today }]),
    'editions/2026-08-01/x.html': '<a href="https://github.com/bad/repo">GitHub</a>',
  }), /bad\/repo is on the blocklist/);
});

test('a PASS without advisory evidence is refused', () => {
  const g = pass('thin/repo'); delete g.checks.advisories.source;
  refuses(site({
    'data/gate-log.json': JSON.stringify({ 'thin/repo': g }),
    'data/hub.json': { categories: [{ name: 'Lane', picks: [{ repo: 'thin/repo', name: 'x', oneliner: 'x' }] }] },
  }), /no advisory evidence/);
});

test('a repo named as an alternative must be cleared too', () => {
  refuses(site({
    'data/editions/2026-09-25/edition.json': { number: '1', date: '2026-09-25', theme: 't', picks: [{ rank: 1, slug: 'a', repo: 'good/repo', name: 'a', oneliner: 'x' }] },
    'data/editions/2026-09-25/a.json': { repo: 'good/repo', name: 'a', tagline: 'A tool', sentence: 'It helps.', fit: 'you', board: [{}, {}, {}, {}], before: ['x'], after: ['y'], uses: [], pulse: {}, coverage: [], try: {}, verdict: { alternatives: [{ name: 'b', repo: 'unchecked/alt', line: 'x' }] }, watch: [], sources: [] },
  }), /unchecked\/alt was never gated/);
});

test('jargon in a plain-English field is refused unless explained right next to it', () => {
  assert.equal(jargonProblem('A fast inference engine for your app'), 'inference');
  assert.equal(jargonProblem('It speeds up inference (running the AI model) on your laptop'), null);
  assert.equal(jargonProblem('Pays per token: small chunks of text the AI reads'), null);
  assert.equal(jargonProblem('A tiny AI sorting clerk for your messages'), null);
});

test('a source dated before the repo existed is refused', () => {
  refuses(site({
    'data/editions/2026-09-25/edition.json': { number: '1', date: '2026-09-25', theme: 't', picks: [{ rank: 1, slug: 'a', repo: 'good/repo', name: 'a', oneliner: 'x' }] },
    'data/editions/2026-09-25/a.json': { repo: 'good/repo', name: 'a', tagline: 'A tool', sentence: 'It helps.', fit: 'you', board: [{}, {}, {}, {}], before: ['x'], after: ['y'], uses: [], pulse: {}, coverage: [], try: {}, verdict: {}, watch: [], sources: [{ title: 'Old thread', url: 'https://example.com', date: '2025-10-06' }] },
  }), /before the repo existed/);
});

test('a broken internal link and an em dash are refused', () => {
  refuses(site({ 'index.html': '<a href="missing.html">x</a>' }), /broken link missing\.html/);
  refuses(site({ 'archive.html': '<p>one — two</p>' }), /em or en dash/);
});

// JJ's Gate A round (Sep 27 2026): the board shows the trigger, the steps and the outputs; every
// page says what installing takes; every try-it step that sends you somewhere links there.
const sheet = over => ({ repo: 'good/repo', name: 'a', tagline: 'A tool', sentence: 'It helps.', fit: 'you',
  board: [{ role: 'problem', say: 'p' }, { role: 'trigger', say: 't' }, { role: 'input', say: 'i' }, { role: 'does', say: 'd', steps: ['one', 'two'] }, { role: 'result', say: 'r', outputs: [{ what: 'o' }] }],
  before: ['x'], after: ['y'], uses: [], pulse: {}, coverage: [], try: { steps: ['Nothing to install.'] },
  footprint: { disk: '10 MB', memory: 'no data found', runs_on: 'Mac', source: { title: 's', url: 'https://example.com' } },
  verdict: {}, watch: ['**Early.** It is new.'], sources: [{ title: 's', url: 'https://example.com', date: '2026-09-20' }], ...over });
const edition = { number: '1', date: '2026-09-25', theme: 't', picks: [{ rank: 1, slug: 'a', repo: 'good/repo', name: 'a', oneliner: 'x' }] };
const withSheet = over => site({ 'data/editions/2026-09-25/edition.json': edition, 'data/editions/2026-09-25/a.json': sheet(over) });

test('a complete answer sheet passes', () => {
  const r = verify(withSheet({}));
  assert.equal(r.status, 0, r.stderr);
});

test('a board without its trigger, steps or outputs is refused', () => {
  refuses(withSheet({ board: [{ role: 'problem', say: 'p' }, { role: 'input', say: 'i' }, { role: 'does', say: 'd' }, { role: 'result', say: 'r' }] }), /board needs 5 notes/);
  refuses(withSheet({ board: sheet({}).board.map(n => (n.role === 'does' ? { ...n, steps: ['only one'] } : n)) }), /needs 2 to 4 steps/);
  refuses(withSheet({ board: sheet({}).board.map(n => (n.role === 'result' ? { ...n, outputs: [] } : n)) }), /needs 1 to 3 outputs/);
});

test('a page must say what installing takes, with a source', () => {
  refuses(withSheet({ footprint: undefined }), /missing footprint/);
  refuses(withSheet({ footprint: { disk: '2 GB', memory: '1 GB', runs_on: 'Mac' } }), /footprint needs a source/);
});

test('a try-it step that sends you somewhere must link there', () => {
  refuses(withSheet({ try: { steps: ['Open the live demo and press Ask.'] } }), /try step 1 sends the reader somewhere but has no link/);
  const ok = verify(withSheet({ try: { steps: ['Open the [live demo](https://example.com/demo) and press Ask.'] } }));
  assert.equal(ok.status, 0, ok.stderr);
});
