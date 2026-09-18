// Dose-state logic. Run with `npm test` (node's built-in runner, no deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  doseState, summarise, dayMark, dayMarkFromCounts, headlineFor, adherence, sortForDisplay,
} from '../src/lib/doseState.js';

const NOW = Date.parse('2026-09-17T12:00:00Z');
const at = (mins) => new Date(NOW + mins * 60_000).toISOString();
const dose = (over, status = 'pending') => ({ status, due_at: at(over) });

test('a taken dose is taken regardless of time', () => {
  assert.equal(doseState({ status: 'taken', due_at: at(-500) }, { now: NOW }), 'taken');
  assert.equal(doseState({ status: 'taken', due_at: at(500) }, { now: NOW }), 'taken');
});

test('pending doses grade by how far past due they are', () => {
  assert.equal(doseState(dose(120), { now: NOW }), 'upcoming', 'two hours away');
  assert.equal(doseState(dose(20), { now: NOW }), 'due', 'inside the due-soon window');
  assert.equal(doseState(dose(-20), { now: NOW }), 'overdue', 'past due, inside the grace window');
  assert.equal(doseState(dose(-90), { now: NOW }), 'missed', 'past the 60-minute window');
});

test('the missed threshold follows the user window', () => {
  assert.equal(doseState(dose(-20), { now: NOW, windowMinutes: 15 }), 'missed');
  assert.equal(doseState(dose(-90), { now: NOW, windowMinutes: 120 }), 'overdue');
  // A nonsense window must fall back, never make everything missed.
  assert.equal(doseState(dose(-20), { now: NOW, windowMinutes: 0 }), 'overdue');
  assert.equal(doseState(dose(-20), { now: NOW, windowMinutes: null }), 'overdue');
});

test('a server-set missed status is not demoted inside the window', () => {
  assert.equal(doseState(dose(-20, 'missed'), { now: NOW }), 'missed');
});

test('an unreadable due_at never becomes missed on its own', () => {
  assert.equal(doseState({ status: 'pending', due_at: 'not-a-date' }, { now: NOW }), 'upcoming');
  assert.equal(doseState({ status: 'missed', due_at: 'not-a-date' }, { now: NOW }), 'missed');
  assert.equal(doseState(null, { now: NOW }), 'upcoming');
});

test('summarise counts agree with the states it reports', () => {
  const doses = [
    dose(-500, 'taken'), dose(-400, 'taken'),
    dose(-90),   // missed
    dose(-10),   // overdue
    dose(15),    // due
    dose(300),   // upcoming
  ];
  const s = summarise(doses, { now: NOW });
  assert.equal(s.total, 6);
  assert.equal(s.taken, 2);
  assert.equal(s.missed, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.due, 1);
  assert.equal(s.upcoming, 1);
  // Every dose lands in exactly one bucket — the invariant the Home header broke.
  assert.equal(s.taken + s.missed + s.overdue + s.due + s.upcoming, s.total);
  assert.equal(s.toTake, 3);
  assert.equal(s.actionable.length, 2, 'overdue + due are the ones a button acts on');
  assert.equal(s.pct, 33);
  assert.equal(s.allTaken, false);
});

test('summarise handles an empty and a fully taken day', () => {
  const empty = summarise([], { now: NOW });
  assert.equal(empty.total, 0);
  assert.equal(empty.pct, 0);
  assert.equal(empty.allTaken, false);
  assert.equal(empty.headline, 'No medicines scheduled today');

  const done = summarise([dose(-100, 'taken'), dose(-50, 'taken')], { now: NOW });
  assert.equal(done.allTaken, true);
  assert.equal(done.pct, 100);
  assert.equal(done.headline, 'All doses taken today');
});

test('the headline leads with the state, not a score', () => {
  assert.equal(headlineFor({ total: 3, taken: 0, missed: 0, overdue: 0, due: 0 }), '3 doses to take today');
  assert.equal(headlineFor({ total: 3, taken: 0, missed: 3, overdue: 0, due: 0 }), '3 doses missed today');
  assert.equal(headlineFor({ total: 3, taken: 1, missed: 0, overdue: 1, due: 0 }), '1 dose overdue');
  assert.equal(headlineFor({ total: 2, taken: 0, missed: 0, overdue: 0, due: 1 }), '1 dose due now');
  assert.equal(headlineFor({ total: 3, taken: 1, missed: 0, overdue: 0, due: 0 }), '2 doses still to take');
});

test('a mixed day is partial, not wholly missed', () => {
  // The exact case that made the calendar contradict the Home header.
  assert.equal(dayMark([dose(-500, 'taken'), dose(-400, 'taken'), dose(-90)], { now: NOW }), 'partial');
  assert.equal(dayMark([dose(-90), dose(-95)], { now: NOW }), 'missed');
  assert.equal(dayMark([dose(-500, 'taken')], { now: NOW }), 'taken');
  assert.equal(dayMark([dose(300)], { now: NOW }), 'pending');
  assert.equal(dayMark([], { now: NOW }), 'none');
});

test('dayMarkFromCounts matches dayMark', () => {
  assert.equal(dayMarkFromCounts({ taken: 2, missed: 1, pending: 0 }), 'partial');
  assert.equal(dayMarkFromCounts({ taken: 0, missed: 2, pending: 0 }), 'missed');
  assert.equal(dayMarkFromCounts({ taken: 3, missed: 0, pending: 0 }), 'taken');
  assert.equal(dayMarkFromCounts({ taken: 0, missed: 0, pending: 2 }), 'pending');
  assert.equal(dayMarkFromCounts({}), 'none');
  assert.equal(dayMarkFromCounts(), 'none');
});

test('adherence ignores doses that are still in the future', () => {
  const rows = [dose(-500, 'taken'), dose(-400, 'taken'), dose(-90), dose(600)];
  const a = adherence(rows, { now: NOW });
  assert.equal(a.taken, 2);
  assert.equal(a.total, 3, 'the upcoming dose is not a miss yet');
  assert.equal(a.pct, 67);
});

test('adherence with nothing settled reports no percentage', () => {
  const a = adherence([dose(600), dose(700)], { now: NOW });
  assert.equal(a.total, 0);
  assert.equal(a.pct, null, 'null, not 0% — a fresh morning is not 0% adherent');
});

test('display order puts what needs doing first', () => {
  const overdue = dose(-10);
  const due = dose(15);
  const upcoming = dose(300);
  const taken = dose(-500, 'taken');
  const missed = dose(-90);
  const out = sortForDisplay([taken, upcoming, missed, due, overdue], { now: NOW });
  assert.deepEqual(out.map((d) => doseState(d, { now: NOW })),
    ['overdue', 'due', 'upcoming', 'missed', 'taken']);
});

// ---------- "Not today": a skipped dose is a third outcome (H3) ----------

test('a skipped dose never becomes missed, however long ago it was', () => {
  // The whole point of the status: the sweep marks 'pending' rows missed, and
  // a deliberate decision must not decay into a missed-dose alert.
  assert.equal(doseState(dose(-5, 'skipped')), 'skipped');
  assert.equal(doseState(dose(-600, 'skipped')), 'skipped');
  assert.equal(doseState(dose(-60 * 24 * 30, 'skipped')), 'skipped');
  // Even with a window of zero, which would make any pending dose missed.
  assert.equal(doseState(dose(-1, 'skipped'), { windowMinutes: 0 }), 'skipped');
  // And a future one is still settled, not 'upcoming'.
  assert.equal(doseState(dose(120, 'skipped')), 'skipped');
});

test('a skipped dose does not lower adherence', () => {
  const withSkip = adherence([dose(-600, 'taken'), dose(-600, 'skipped')], { now: NOW });
  assert.deepEqual(withSkip, { taken: 1, total: 1, pct: 100 },
    'it leaves the denominator entirely, rather than counting as a miss');

  const onlySkips = adherence([dose(-600, 'skipped'), dose(-600, 'skipped')], { now: NOW });
  assert.equal(onlySkips.pct, null, 'no doses were actually due, so there is no percentage');

  // A real miss still counts, so skipping cannot be used to hide one.
  assert.equal(adherence([dose(-600, 'taken'), dose(-600, 'skipped'), dose(-600)], { now: NOW }).pct, 50);
});

test('the day summary treats skipped as settled, not outstanding', () => {
  const s = summarise([dose(-600, 'taken'), dose(-600, 'skipped'), dose(120)], { now: NOW });
  assert.equal(s.skipped, 1);
  assert.equal(s.toTake, 1, 'only the upcoming dose still needs doing');
  assert.equal(s.missed, 0);
  assert.equal(s.pct, 50, '1 taken of the 2 doses actually due');

  const done = summarise([dose(-600, 'taken'), dose(-600, 'skipped')], { now: NOW });
  assert.equal(done.allTaken, true, 'nothing is left, so the day is done');
  assert.equal(done.headline, 'All doses taken today');
  assert.equal(done.pct, 100);
});

test('a day of nothing but skipped doses is not a missed day', () => {
  assert.equal(dayMark([dose(-600, 'skipped'), dose(-600, 'skipped')], { now: NOW }), 'none');
  assert.equal(dayMarkFromCounts({ skipped: 2 }), 'none');
  // Mixed with a real taken dose it reads as taken, not partial.
  assert.equal(dayMarkFromCounts({ taken: 1, skipped: 1 }), 'taken');
  // But a genuine miss alongside a skip is still a miss.
  assert.equal(dayMarkFromCounts({ missed: 1, skipped: 1 }), 'missed');
});

test('skipped doses sort last, below taken', () => {
  const list = [dose(-600, 'skipped'), dose(-600, 'taken'), dose(-5)];
  const order = sortForDisplay(list, { now: NOW }).map((d) => doseState(d, { now: NOW }));
  assert.deepEqual(order, ['overdue', 'taken', 'skipped']);
});
