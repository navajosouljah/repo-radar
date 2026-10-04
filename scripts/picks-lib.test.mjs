// Run: node --test scripts/*.test.mjs
// The two small rules candidates.mjs and build.mjs share (JJ, Oct 3 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capGain, windowGain, whyThisWeek } from './picks-lib.mjs';

test('a gain can never be bigger than the total star count', () => {
  // Strata, Oct 2 2026: a daily pace x 7 said 11,249 on a repo with 5,341 stars.
  assert.equal(capGain(11249, 5341), 5341);
  assert.equal(capGain(2667, 55593), 2667);
  assert.equal(capGain(null, 5341), null);
  assert.equal(capGain(900, null), 900);
});

test('a repo younger than the window gained every star inside it', () => {
  // AIHOT, Oct 3 2026: 5 days old, 5,470 stars, and an outside estimate of 1,267 "this week".
  assert.equal(windowGain(1267, 5470, 5, 7), 5470);
  assert.equal(windowGain(null, 5341, 8, 30), 5341);
  // Older than the window: the measured number stands, capped at the total.
  assert.equal(windowGain(11249, 5341, 8, 7), 5341);
  assert.equal(windowGain(2667, 55593, 206, 7), 2667);
  assert.equal(windowGain(null, 55593, 206, 7), null);
  assert.equal(windowGain(900, 55593, null, 7), 900);
});

test('a card says why the repo is here this week, not its total stars', () => {
  // A new repo: its age, then the stars it earned in that time.
  assert.equal(whyThisWeek({ stars: 5341 }, { age_days: 8, signals: { stars: 5341, gain7: 5341 } }), '8 days old\u00a0· 5.3K stars');
  assert.equal(whyThisWeek({ stars: 900 }, { age_days: 1, signals: {} }), '1 day old\u00a0· 900 stars');
  // An older repo: the stars GitHub or findarepo measured for the week.
  assert.equal(whyThisWeek({ stars: 55593 }, { age_days: 206, signals: { gain7: 2667 } }), '+2.7K stars this week');
  // An estimate (a daily pace x 7) says so.
  assert.equal(whyThisWeek({ stars: 151149 }, { age_days: 112, signals: { gain7: 5355, gain7_source: 'findarepo (per-day x 7)' } }), 'about +5.4K stars this week');
  // No weekly number: the month, then the day.
  assert.equal(whyThisWeek({ stars: 9000 }, { age_days: 300, signals: { gain30: 4100 } }), '+4.1K stars this month');
  assert.equal(whyThisWeek({ stars: 274332 }, { age_days: 241, signals: { gain1: 883 } }), '+883 stars in a day');
});

test('the still-climbing slot is named, with its 30-day gain', () => {
  assert.equal(whyThisWeek({ stars: 51653, slot: 'climbing' }, { age_days: 176, signals: { gain7: 16114, gain30: 38088 } }), 'Still climbing\u00a0· +38.1K stars this month');
});

test('with no measured growth the card falls back to total stars, never a made-up number', () => {
  assert.equal(whyThisWeek({ stars: 26096 }, undefined), '26.1K stars');
  assert.equal(whyThisWeek({ stars: 26096 }, { age_days: 120, signals: {} }), '26.1K stars');
  assert.equal(whyThisWeek({ stars: 26096 }, { age_days: 120, signals: { gain7: -40 } }), '26.1K stars');
});
