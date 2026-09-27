// Run: node --test scripts/*.test.mjs
// Each case is a real record the gate met on Sep 27 2026. A rule change that breaks one of these
// reopens a hole that already let something through, or wrongly failed a safe repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiedToRepo, fixFromText, fixFromRanges, commitsFromText, prsFromRefs, ver, cmp, newConcerns, activityFlags } from './gate-lib.mjs';

test('a record that names the repo counts against it, even with no package or source', () => {
  // CVE-2026-7595, VulDB-sourced, unreviewed on GitHub: no package, no source, but it names the project.
  const adv = { description: 'A flaw has been found in nextlevelbuilder ui-ux-pro-max-skill up to 2.5.0.', references: ['https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/pull/275'] };
  assert.equal(tiedToRepo(adv, 'nextlevelbuilder', 'ui-ux-pro-max-skill'), true);
});

test('a record about something else is not held against the repo', () => {
  // CVE-2026-42505: a Go standard-library TLS issue that surfaced in a search for dagger.
  const adv = { description: 'Handshakes which used Encrypted Client Hello could be de-anonymized by a passive network observer.', references: ['https://go.dev/cl/775960', 'https://go.dev/issue/79282'] };
  assert.equal(tiedToRepo(adv, 'dagger', 'dagger'), false);
});

test('a structured source repo decides it outright', () => {
  assert.equal(tiedToRepo({ source_code_location: 'https://github.com/openai/codex' }, 'openai', 'codex'), true);
  assert.equal(tiedToRepo({ source_code_location: 'https://github.com/openai/codex' }, 'openai', 'codex-security'), false);
});

test('a record that links only a sibling repo of the same owner is not held against this one', () => {
  // CVE-2026-85606 is about firecrawl/firecrawl-mcp-server; a prefix match once pinned it on firecrawl/firecrawl.
  const sibling = { description: 'firecrawl-mcp-server 3.20.2 contains an arbitrary local file read vulnerability', references: ['https://github.com/firecrawl/firecrawl-mcp-server/issues/306', 'https://github.com/firecrawl/firecrawl-mcp-server'] };
  assert.equal(tiedToRepo(sibling, 'firecrawl', 'firecrawl'), false);
  assert.equal(tiedToRepo(sibling, 'firecrawl', 'firecrawl-mcp-server'), true);
  // CVE-2026-32857 links firecrawl's own advisory: it is firecrawl's.
  const own = { description: 'Firecrawl version 2.8.0 and prior contain a server-side request forgery (SSRF) protection bypass', references: ['https://github.com/firecrawl/firecrawl/security/advisories/GHSA-vjp8-2wgg-p734', 'https://www.firecrawl.dev'] };
  assert.equal(tiedToRepo(own, 'firecrawl', 'firecrawl'), true);
});

test('fix versions stated in words are found', () => {
  assert.deepEqual(fixFromText('OpenAI issued a fix on August 20, 2025, in Codex CLI version 0.23.0. fixed in 0.23.0'), ver('0.23.0'));
  assert.deepEqual(fixFromText('DeepSeek Harness before 0.1.2-alpha.1 contains an authentication bypass'), ver('0.1.2'));
  assert.deepEqual(fixFromText("if you're pinning to version, `:2.11.31` is the first patched version."), ver('2.11.31'));
});

test('an affected range written in words is never read as a fix', () => {
  assert.equal(fixFromText('A vulnerability was identified in NousResearch hermes-agent up to 0.12.0.'), null);
  assert.equal(fixFromText('krayin laravel-crm up to 2.2 ... cross site scripting'), null);
});

test('"< X" is a fix at X; "<= X" is not', () => {
  assert.deepEqual(fixFromRanges([{ vulnerable_version_range: '<2.9.0' }]), ver('2.9.0'));
  assert.equal(fixFromRanges([{ vulnerable_version_range: '<= 0.29.8' }]), null);
  assert.equal(fixFromRanges([{ vulnerable_version_range: '>= 0.28.7, <= 0.29.8' }]), null);
  assert.deepEqual(fixFromRanges([{ vulnerable_version_range: '>= 1.10.0, < 1.26.0' }]), ver('1.26.0'));
});

test('fix commits and fix pull requests are found for the right repo only', () => {
  assert.deepEqual(commitsFromText('Deer-Flow versions prior to commit 5dbb362 contain a stored XSS'), ['5dbb362']);
  assert.deepEqual(prsFromRefs(['https://github.com/krayin/laravel-crm/pull/2466', 'https://github.com/other/repo/pull/9'], 'krayin', 'laravel-crm'), [2466]);
});

test('version compare', () => {
  assert.ok(cmp(ver('v0.157.1'), ver('0.23.0')) > 0);
  assert.ok(cmp(ver('2.11.0'), ver('2.11.31')) < 0);
});

// A human ruling carries over a re-gate only when nothing new turned up (see newConcerns).
const ruled = {
  repo: 'firecrawl/firecrawl', verdict: 'PASS', settled: { by: 'human review', date: '2026-09-27', note: 'fixed in Docker images' },
  checks: {
    advisories: { items: [{ ghsa: 'GHSA-3p54-jg6f-68r8', status: 'fix-unreleased' }, { ghsa: 'GHSA-7843-ffpq-5f9p', status: 'fix-unreleased' }] },
    searches: { queries: ['a', 'b', 'c', 'd'], errors: 0, hits: [{ kind: 'report', url: 'https://news.ycombinator.com/item?id=1' }], cves: [] },
    activity: { flags: ['7924 stars on 2 contributor(s)'] },
  },
};
const again = (patch = {}) => ({ checks: {
  advisories: { items: [{ ghsa: 'GHSA-3p54-jg6f-68r8', status: 'fix-unreleased' }, { ghsa: 'GHSA-7843-ffpq-5f9p', status: 'unpatched' }], ...patch.advisories },
  searches: { queries: ['a', 'b', 'c', 'd'], errors: 0, hits: [{ kind: 'report', url: 'https://news.ycombinator.com/item?id=1' }], cves: [], ...patch.searches },
  activity: { flags: ['8102 stars on 2 contributor(s)'], ...patch.activity },
} });

test('a ruling carries over when the same advisories, reports and flags come back', () => {
  // firecrawl: the fixes shipped as Docker images, which the automatic check can't see. The same two
  // advisories return on every re-gate; the ruling must hold, or the repo drops off the site monthly.
  assert.deepEqual(newConcerns(ruled, again()), []);
});

test('a new advisory, report or flag sends the decision back to a human', () => {
  const newAdv = again({ advisories: { items: [{ ghsa: 'GHSA-3p54-jg6f-68r8', status: 'fix-unreleased' }, { ghsa: 'GHSA-zzzz-zzzz-zzzz', status: 'unpatched' }] } });
  assert.deepEqual(newConcerns(ruled, newAdv), ['advisory GHSA-zzzz-zzzz-zzzz (unpatched)']);
  const newReport = again({ searches: { hits: [{ kind: 'report', url: 'https://example.com/firecrawl-malware' }] } });
  assert.deepEqual(newConcerns(ruled, newReport), ['report https://example.com/firecrawl-malware']);
  const newFlag = again({ activity: { flags: ['archived'] } });
  assert.deepEqual(newConcerns(ruled, newFlag), ['activity: archived']);
});

test('a check that did not run never carries a ruling over', () => {
  assert.deepEqual(newConcerns(ruled, again({ advisories: { error: 'HTTP 429', items: [] } })), ['advisories not checked: HTTP 429']);
  assert.deepEqual(newConcerns(ruled, again({ searches: { errors: 4 } })), ['searches not run: all failed']);
});

test('a CVE the human already ruled on (found by search, not on the repo page) carries over', () => {
  // deer-flow: its advisories live in GitHub's global database; the ruling lists them under recheck.
  const old = { settled: {}, checks: { advisories: { items: [] }, searches: { queries: [], hits: [], cves: [] } }, recheck: { items: [{ ghsa: 'GHSA-36m7-49vh-x3qh', recheck: 'patched' }] } };
  const fresh = { checks: { advisories: { items: [] }, searches: { queries: ['a'], errors: 0, hits: [], cves: [{ id: 'CVE-2026-1', ghsa: 'GHSA-36m7-49vh-x3qh', status: 'fix-unverified' }] }, activity: { flags: [] } } };
  assert.deepEqual(newConcerns(old, fresh), []);
});

test('activity flags: star farms, code drops, archived repos', () => {
  assert.deepEqual(activityFlags({ canonical: 'o/r', stars: 22000, contributors: 1, commits: 14, watchers: 90, hasIssues: true, openIssues: 5, ageDays: 40 }, 'o', 'r'),
    ['22000 stars on 1 contributor(s)', '22000 stars on only 14 commit(s)']);
  assert.deepEqual(activityFlags({ canonical: 'new/name', stars: 12000, contributors: null, commits: null, watchers: 5, hasIssues: true, openIssues: 0, ageDays: null, archived: true }, 'o', 'r'),
    ['renamed/moved to new/name', 'very few watchers for the stars (5)', 'archived']);
});
