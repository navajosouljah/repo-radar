// Run: node --test scripts/
// Each case is a real record the gate met on Sep 27 2026. A rule change that breaks one of these
// reopens a hole that already let something through, or wrongly failed a safe repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiedToRepo, fixFromText, fixFromRanges, commitsFromText, prsFromRefs, ver, cmp } from './gate-lib.mjs';

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
