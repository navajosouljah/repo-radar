import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, formatCount, addToQueue, readQueue } from '../lookup.js';

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

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}
test('addToQueue dedupes case-insensitively', () => {
  const st = fakeStorage();
  addToQueue(st, { type: 'url', query: 'usestrix/strix', ts: 1 });
  addToQueue(st, { type: 'url', query: 'USEstrix/Strix', ts: 2 });
  assert.equal(readQueue(st).length, 1);
});
