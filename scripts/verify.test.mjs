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
import { jargonProblem, fenceProblems } from './verify.mjs';

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

test('an alternative linked by its GitHub address must be cleared, even without a repo field', () => {
  refuses(withSheet({ verdict: { alternatives: [{ name: 'b', url: 'https://github.com/unchecked/alt', line: 'x' }] } }), /unchecked\/alt was never gated/);
});

test('--sheet checks one answer sheet on its own', () => {
  const root = withSheet({ try: { steps: ['Visit the website to sign up.'] } });
  const r = spawnSync('node', [VERIFY, '--root', root, '--sheet', 'data/editions/2026-09-25/a.json'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /try step 1 sends the reader somewhere but has no link/);
});

// JJ, Oct 3 2026: the Oct 2 Friday run kept a flagged repo on the site by adding an "under review"
// exception to build.mjs and to this checker. These tests close that whole class.
const edition1009 = { number: '2', date: '2026-10-09', theme: 't', picks: [{ rank: 1, slug: 'a', repo: 'good/repo', name: 'a', oneliner: 'x' }] };
const report = '# Repo Radar Edition 2 - 2026-10-09\n\n## Needs JJ\nNothing this week.\n';

test('an "under review" pick still has to be cleared: only PASS appears, and FAIL only as a warning page', () => {
  const g = pass('held/repo'); g.verdict = 'REVIEW';
  refuses(site({
    'data/gate-log.json': JSON.stringify({ 'good/repo': pass('good/repo'), 'held/repo': g }),
    'data/editions/2026-09-25/edition.json': { number: '1', date: '2026-09-25', theme: 't', picks: [{ rank: 1, slug: 'h', repo: 'held/repo', name: 'h', status: 'review', oneliner: 'x' }] },
  }), /held\/repo gate verdict is REVIEW/);
});

test('a page stamped UNDER REVIEW is not excused from the gate', () => {
  const g = pass('held/repo'); g.verdict = 'REVIEW';
  refuses(site({
    'data/gate-log.json': JSON.stringify({ 'good/repo': pass('good/repo'), 'held/repo': g }),
    'editions/2026-09-25/h.html': '<span class="stamp review">UNDER REVIEW</span><a href="https://github.com/held/repo">GitHub</a>',
  }), /held\/repo gate verdict is REVIEW/);
});

test('an edition after Oct 3 2026 ships with its saved report, and the report has a Needs JJ section', () => {
  const base = { 'data/editions/2026-10-09/edition.json': edition1009, 'data/editions/2026-10-09/a.json': sheet({}) };
  refuses(site(base), /docs\/reports\/2026-10-09\.md: missing/);
  refuses(site({ ...base, 'docs/reports/2026-10-09.md': '# Report\n\nAll good.\n' }), /needs a "## Needs JJ" section/);
  const ok = verify(site({ ...base, 'docs/reports/2026-10-09.md': report }));
  assert.equal(ok.status, 0, ok.stderr);
});

test('the fence: a push that adds an edition may not change the checker or the rules', () => {
  const added = { status: 'A', path: 'data/editions/2026-10-09/edition.json' };
  assert.match(fenceProblems([added, { status: 'M', path: 'scripts/verify.mjs' }])[0], /scripts\/verify\.mjs changed in the same push as a new edition/);
  assert.equal(fenceProblems([added, { status: 'A', path: 'scripts/new-helper.mjs' }]).length, 1);
  assert.equal(fenceProblems([added, { status: 'M', path: 'docs/SECURITY_GATE.md' }, { status: 'M', path: 'CLAUDE.md' }]).length, 2);
  // An edition on its own is fine, and so is script work with no new edition in the same push.
  assert.deepEqual(fenceProblems([added, { status: 'A', path: 'editions/2026-10-09/a.html' }, { status: 'M', path: 'data/gate-log.json' }]), []);
  assert.deepEqual(fenceProblems([{ status: 'M', path: 'scripts/verify.mjs' }, { status: 'M', path: 'data/editions/2026-10-02/edition.json' }]), []);
});

test('the fence, end to end: verify refuses a checkout that adds an edition and edits a script', () => {
  const root = site({ 'scripts/build.mjs': '// build', 'docs/reports/2026-10-09.md': report });
  const git = (...a) => { const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'base'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  mkdirSync(join(root, 'data/editions/2026-10-09'), { recursive: true });
  writeFileSync(join(root, 'data/editions/2026-10-09/edition.json'), JSON.stringify(edition1009));
  writeFileSync(join(root, 'data/editions/2026-10-09/a.json'), JSON.stringify(sheet({})));
  const clean = verify(root);
  assert.equal(clean.status, 0, clean.stderr); // the edition alone passes
  writeFileSync(join(root, 'scripts/build.mjs'), '// build, with a new exception');
  refuses(root, /scripts\/build\.mjs changed in the same push as a new edition/);
});

// JJ's rulings on the Oct 3 2026 adversarial pass: (1) the words DO NOT INSTALL excuse nothing on
// their own, (2) no page links a blocklisted repo, in any form of link.
const failed = repo => ({ ...pass(repo), verdict: 'FAIL', reasons: ['1 open advisory(ies)'] });
const stamp = '<span class="stamp fail">DO NOT INSTALL</span>';
const twoBad = {
  'data/gate-log.json': JSON.stringify({ 'good/repo': pass('good/repo'), 'bad/repo': failed('bad/repo'), 'worse/repo': failed('worse/repo') }),
  'data/blocklist.json': JSON.stringify(['bad/repo', 'worse/repo'].map(repo => ({ repo, kind: 'open-advisories', reason: 'x', date: today }))),
};

test('a page is a warning page only when its own repo has a FAIL on record', () => {
  const held = pass('held/repo'); held.verdict = 'REVIEW';
  refuses(site({
    'data/gate-log.json': JSON.stringify({ 'good/repo': pass('good/repo'), 'held/repo': held }),
    'editions/2026-08-01/h.html': `${stamp}<a href="https://github.com/held/repo">GitHub</a>`,
  }), /held\/repo gate verdict is REVIEW/);
  refuses(site({ 'editions/2026-08-01/n.html': `${stamp}<a href="https://github.com/never/gated">GitHub</a>` }), /never\/gated was never gated/);
  // the phrase in bold in a list page's note used to switch the whole page's check off
  refuses(site({ 'editions/2026-08-01/index.html': '<p><b>DO NOT INSTALL</b> is our warning stamp.</p><a href="https://github.com/never/gated">x</a>' }), /never\/gated was never gated/);
});

test('a real warning page passes: stamped, its repo FAIL and blocklisted, linking only its own repo', () => {
  const r = verify(site({ ...twoBad, 'editions/2026-08-01/bad.html': `${stamp}<a href="https://github.com/bad/repo">GitHub</a><a href="https://github.com/bad/repo/security/advisories">advisories</a>` }));
  assert.equal(r.status, 0, r.stderr);
});

test('no page links a blocklisted repo, in any form of link', () => {
  // a deep link on a normal page, a second link on a repo page, a root page, and a warning page that links another one
  refuses(site({ ...twoBad, 'editions/2026-08-01/a.html': '<a href="https://github.com/good/repo">GitHub</a><a href="https://github.com/bad/repo/issues/89">a thread</a>' }), /links bad\/repo, which is on the blocklist/);
  refuses(site({ ...twoBad, 'editions/2026-08-01/a.html': '<a href="https://github.com/good/repo">GitHub</a><a href="https://github.com/Bad/Repo">also</a>' }), /links bad\/repo, which is on the blocklist/);
  // a capitalised host, and GitHub's other hosts for the same repo (a raw file, the API)
  refuses(site({ ...twoBad, 'editions/2026-08-01/a.html': '<a href="https://github.com/good/repo">GitHub</a><a href="https://GitHub.com/bad/repo">also</a>' }), /links bad\/repo, which is on the blocklist/);
  refuses(site({ ...twoBad, 'editions/2026-08-01/a.html': '<a href="https://github.com/good/repo">GitHub</a><a href="https://raw.githubusercontent.com/bad/repo/main/install.sh">script</a>' }), /links bad\/repo, which is on the blocklist/);
  refuses(site({ ...twoBad, 'editions/2026-08-01/a.html': '<a href="https://github.com/good/repo">GitHub</a><a href="https://api.github.com/repos/bad/repo/releases">api</a>' }), /links bad\/repo, which is on the blocklist/);
  refuses(site({ ...twoBad, 'archive.html': '<a href="https://github.com/bad/repo/tree/main">x</a>' }), /archive\.html: links bad\/repo/);
  refuses(site({ ...twoBad, 'editions/2026-08-01/bad.html': `${stamp}<a href="https://github.com/bad/repo">GitHub</a><a href="https://github.com/worse/repo.git">alt</a>` }), /links worse\/repo, which is on the blocklist/);
});

test('a citation to a repo that was never gated and is not blocklisted stays allowed', () => {
  const r = verify(site({ 'editions/2026-08-01/a.html': '<a href="https://github.com/good/repo">GitHub</a><a href="https://github.com/someone/thread/issues/89">source</a>' }));
  assert.equal(r.status, 0, r.stderr);
});

// The adversarial pass on that fix (Oct 3 2026) found the first version tied "its own repo" to the
// first plain link on the page. The page builder's warning pages link their repo only through the
// advisories list, so a real one would have been refused, and a page whose first link was another
// failed repo would have excused the wrong one.
const failSheet = repo => ({ repo, name: 'bad', status: 'fail', tagline: 'Pulled.', sentence: 'It failed.', what_happened: ['x'], why_fail: ['x'], if_used: ['x'], sources: [{ title: 's', url: 'https://example.com', date: '2026-09-27' }] });
const failEdition = { number: '1', date: '2026-09-25', theme: 't', picks: [{ rank: 1, slug: 'bad', repo: 'bad/repo', name: 'bad', status: 'fail', oneliner: 'Pulled.' }] };

test('a warning page as the builder makes it passes: its repo comes from its data file, and its only own link is the advisories list', () => {
  const r = verify(site({ ...twoBad,
    'data/editions/2026-09-25/edition.json': failEdition, 'data/editions/2026-09-25/bad.json': failSheet('bad/repo'),
    'editions/2026-09-25/bad.html': `${stamp}<span class="repo-id">bad/repo</span><a href="https://example.com/report">source</a><a href="https://github.com/bad/repo/security/advisories">GitHub's advisory list</a>`,
  }));
  assert.equal(r.status, 0, r.stderr);
  // an older page with no data file names its repo in the repo-id the stamp sits next to
  const legacy = verify(site({ ...twoBad, 'editions/2026-08-01/bad.html': `${stamp}<span class="repo-id">bad/repo</span><a href="https://github.com/bad/repo/issues/3">the report</a>` }));
  assert.equal(legacy.status, 0, legacy.stderr);
});

test('a warning page excuses its own repo only: another failed repo linked first is still refused', () => {
  refuses(site({ ...twoBad,
    'data/editions/2026-09-25/edition.json': failEdition, 'data/editions/2026-09-25/bad.json': failSheet('bad/repo'),
    'editions/2026-09-25/bad.html': `${stamp}<span class="repo-id">bad/repo</span><a href="https://github.com/worse/repo">see also</a><a href="https://github.com/bad/repo/security/advisories">advisories</a>`,
  }), /links worse\/repo, which is on the blocklist/);
});
