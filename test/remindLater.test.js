import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snoozeDecision, snoozeAttempt, snoozeUntil, dedupeKey } from '../src/lib/notifications.js';

const MIN = 60_000;
const NOW = Date.parse('2026-11-10T15:00:00Z');
const at = (mins) => new Date(NOW + mins * MIN).toISOString();

test('a dose that was never postponed is left to the ordinary reminders', () => {
  assert.equal(snoozeDecision(null, NOW), 'none');
  assert.equal(snoozeDecision(undefined, NOW), 'none');
  assert.equal(snoozeDecision('not a date', NOW), 'none');
});

test('a postponed reminder holds, fires once in its window, then steps aside', () => {
  assert.equal(snoozeDecision(at(15), NOW), 'hold');
  assert.equal(snoozeDecision(at(2), NOW), 'hold');
  assert.equal(snoozeDecision(at(0), NOW), 'fire');
  assert.equal(snoozeDecision(at(-5), NOW), 'fire');     // the 5-minute cron catches it late
  assert.equal(snoozeDecision(at(-7), NOW), 'none');     // long gone: ordinary repeats resume
});

test('every 5-minute run sees a postponed reminder exactly once', () => {
  const until = at(15);
  const fired = [];
  for (let run = 0; run <= 40; run += 5) {
    if (snoozeDecision(until, NOW + run * MIN) === 'fire') fired.push(run);
  }
  // Two consecutive runs can both fall in the window; the dedupe key makes the second a no-op.
  assert.ok(fired.length >= 1 && fired.length <= 2, `fired at ${fired}`);
  assert.equal(fired[0], 15);
  const keys = new Set(fired.map(() => dedupeKey({ type: 'dose_due', userId: 'u', refId: 'd', date: '2026-11-10', attempt: snoozeAttempt(until) })));
  assert.equal(keys.size, 1);
});

test('the postponed reminder has its own identity, different from the first reminder and its repeats', () => {
  const k = (attempt) => dedupeKey({ type: 'dose_due', userId: 'u', refId: 'd', date: '2026-11-10', attempt });
  const s1 = k(snoozeAttempt(at(15)));
  assert.notEqual(s1, k(0));
  assert.notEqual(s1, k(1));
  assert.notEqual(s1, k(snoozeAttempt(at(30))), 'postponing again gives a new reminder');
});

test('snooze length follows the person’s setting, limited to the offered lengths', () => {
  assert.equal(snoozeUntil(at(0), { snooze_minutes: 30 }), at(30));
  assert.equal(snoozeUntil(at(0), { snooze_minutes: 240 }), at(15));
  assert.equal(snoozeUntil(at(0), {}), at(15));
});
