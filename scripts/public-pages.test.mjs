// Tests for public-pages.mjs parsers, against trimmed copies of real GitHub pages (scripts/fixtures/,
// saved Sep 27 2026). If GitHub changes its markup, these fail first and the gate reports "can't
// check" instead of guessing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRepoPage, parseContributors, parseLatestCommit, parseAdvisoryList, parseAdvisory } from './public-pages.mjs';
import { advisoryStatus } from './gate-lib.mjs';

const fx = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('repo page: the numbers the activity check needs', () => {
  const f = parseRepoPage(fx('repo-page.html'));
  assert.deepEqual(f, { canonical: 'pacifio/atlas', stars: 7928, forks: 331, watchers: 45, openIssues: 31, hasIssues: true, commits: 1208, created: '2026-05-14', archived: false });
});

test('repo page: an archived repo reads as archived', () => {
  assert.equal(parseRepoPage(fx('repo-archived.html')).archived, true);
});

test('repo page: a page without a star count yields nulls, not zeros', () => {
  const f = parseRepoPage('<html>rate limited</html>');
  assert.equal(f.stars, null);
  assert.equal(f.openIssues, null);
});

test('contributors and latest commit', () => {
  assert.equal(parseContributors(fx('contributors.html')), 41);
  assert.equal(parseLatestCommit(fx('commits.atom')), '2026-09-27');
});

test('advisory list: rows, severity, and the next page', () => {
  const l = parseAdvisoryList(fx('advisories-list.html'));
  assert.equal(l.empty, false);
  assert.equal(l.items.length, 2);
  assert.deepEqual(l.items[1], { ghsa: 'GHSA-vqq3-22q7-289w', summary: 'Headless Chromium in the render service runs attacker HTML without connect-src restrictions', published: '2026-09-15', severity: 'moderate' });
  assert.ok(l.pages.includes(2), 'page 2 exists, so the reader must fetch it (the cloud agent missed it by hand)');
});

test('advisory list: "none published" is recognized, and junk is not mistaken for it', () => {
  assert.equal(parseAdvisoryList(fx('advisories-empty.html')).empty, true);
  const junk = parseAdvisoryList('<html>Something went wrong</html>');
  assert.equal(junk.empty, false);
  assert.equal(junk.items.length, 0);
});

test('repo advisory: package, versions, severity, CVE', () => {
  const a = parseAdvisory(fx('advisory-repo.html'));
  assert.deepEqual(a.packages, [{ name: 'openmaic', ecosystem: 'npm', affected: '<= 1.0.0', patched: '1.0.1' }]);
  assert.equal(a.severity, 'critical');
  assert.equal(a.cve, 'CVE-2026-86259');
  assert.match(a.description, /update to v1\.0\.1/);
});

test('global advisory: no package and "Unknown" versions mean no fix', () => {
  const a = parseAdvisory(fx('advisory-global.html'));
  assert.deepEqual(a.packages, [{ name: null, ecosystem: null, affected: null, patched: null }]);
  assert.equal(a.severity, 'low');
  assert.equal(a.cve, 'CVE-2026-84425');
  assert.equal(advisoryStatus(a, [2, 1, 9], 'zhayujie', 'CowAgent').status, 'unpatched');
});

test('advisory status: patched only when a published version reached the fix', () => {
  const adv = { packages: [{ name: 'openmaic', ecosystem: 'npm', affected: '<= 1.0.0', patched: '1.0.1' }] };
  assert.equal(advisoryStatus(adv, [1, 1, 1], 'THU-MAIC', 'OpenMAIC').status, 'patched');
  assert.equal(advisoryStatus(adv, [1, 0, 0], 'THU-MAIC', 'OpenMAIC').status, 'fix-unreleased');
  assert.equal(advisoryStatus(adv, null, 'THU-MAIC', 'OpenMAIC').status, 'patch-unconfirmed');
});

test('advisory status: "< X" is a fix at X, "<= X" is not, a commit fix needs a human', () => {
  assert.equal(advisoryStatus({ packages: [{ affected: '< 0.2.5', patched: null }] }, [0, 8, 2], 'Tencent', 'WeKnora').status, 'patched');
  assert.equal(advisoryStatus({ packages: [{ affected: '<= 0.2.5', patched: null }] }, [0, 8, 2], 'Tencent', 'WeKnora').status, 'unpatched');
  const byCommit = { packages: [{ affected: null, patched: null }], description: 'Fixed in commit 5dbb362.' };
  assert.equal(advisoryStatus(byCommit, [2, 1, 0], 'bytedance', 'deer-flow').status, 'fix-unverified');
});

test('advisory status: one package patched and another not is partly patched', () => {
  const adv = { packages: [{ name: 'a', patched: '1.2.0' }, { name: 'b', patched: null }] };
  assert.equal(advisoryStatus(adv, [9, 9, 9], 'o', 'r').status, 'partly-patched');
});
