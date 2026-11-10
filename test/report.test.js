import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, medicineHeadline, rangeDates, daysBetween } from '../src/lib/report.js';

const NOW = Date.parse('2026-11-10T15:00:00Z');
const dayOf = (iso) => iso.slice(0, 10);
const dose = (id, date, time, status, extra = {}) => ({
  id, dose_date: date, scheduled_time: time, due_at: `${date}T${time}:00Z`, status,
  taken_at: status === 'taken' ? `${date}T${time}:00Z` : null, medication: { name: 'Synthetic A' }, ...extra,
});

test('range dates are inclusive', () => {
  assert.deepEqual(rangeDates(7, '2026-11-10'), { from: '2026-11-04', to: '2026-11-10' });
  assert.equal(daysBetween('2026-11-04', '2026-11-10').length, 7);
  assert.deepEqual(daysBetween('2026-11-10', '2026-11-10'), ['2026-11-10']);
});

test('medicine totals: only settled scheduled doses are in the denominator', () => {
  const doses = [
    dose('1', '2026-11-08', '08:00', 'taken'),
    dose('2', '2026-11-08', '20:00', 'missed'),
    dose('3', '2026-11-09', '08:00', 'skipped'),
    dose('4', '2026-11-09', '20:00', 'pending'), // long past its window: not recorded
    dose('5', '2026-11-10', '08:00', 'taken'),
    dose('6', '2026-11-10', '20:00', 'pending'), // still to come today: open
    dose('7', '2026-11-10', '09:30', 'taken', { as_needed: true }),
    dose('8', '2026-11-01', '08:00', 'taken'), // outside the range
  ];
  const r = buildReport({ doses, from: '2026-11-08', to: '2026-11-10', dayOf, opts: { now: NOW, windowMinutes: 60 } });
  const m = r.medicines;
  assert.deepEqual([m.scheduled, m.taken, m.skipped, m.notRecorded, m.open, m.asNeeded], [5, 2, 1, 2, 1, 1]);
  assert.equal(m.taken + m.skipped + m.notRecorded, m.scheduled);
  assert.equal(medicineHeadline(m), '2 of 5 scheduled doses recorded as taken');
  assert.deepEqual(m.perDay.map((d) => [d.day, d.taken, d.skipped, d.notRecorded, d.open]),
    [['2026-11-08', 1, 0, 1, 0], ['2026-11-09', 0, 1, 1, 0], ['2026-11-10', 1, 0, 0, 1]]);
  assert.deepEqual(m.perMedicine, [{ name: 'Synthetic A', scheduled: 5, taken: 2, skipped: 1, notRecorded: 2, asNeeded: 1 }]);
});

test('no doses: says so instead of showing 0 of 0 as a score', () => {
  const r = buildReport({ from: '2026-11-08', to: '2026-11-10', dayOf, opts: { now: NOW } });
  assert.equal(medicineHeadline(r.medicines), 'No scheduled doses in this period.');
  const open = buildReport({ doses: [dose('1', '2026-11-10', '20:00', 'pending')], from: '2026-11-10', to: '2026-11-10', dayOf, opts: { now: NOW } });
  assert.equal(medicineHeadline(open.medicines), 'No scheduled doses have finished in this period yet.');
});

test('health logs: missing stays missing; averages name the days they cover', () => {
  const logs = [
    { kind: 'sleep', value: 420, unit: 'min', logged_at: '2026-11-08T07:00:00Z' },
    { kind: 'sleep', value: 480, unit: 'min', logged_at: '2026-11-10T07:00:00Z' },
    { kind: 'blood_pressure', value: 130, value2: 85, unit: 'mmHg', logged_at: '2026-11-09T07:00:00Z' },
    { kind: 'blood_pressure', value: 124, value2: 80, unit: 'mmHg', logged_at: '2026-11-10T07:00:00Z' },
    { kind: 'water', value: 2, unit: 'glass', logged_at: '2026-11-10T08:00:00Z' },
    { kind: 'water', value: 250, unit: 'ml', logged_at: '2026-11-10T09:00:00Z' },
    { kind: 'heart_rate', value: 70, unit: 'bpm', logged_at: '2026-10-01T09:00:00Z' }, // outside the range
  ];
  const r = buildReport({ logs, from: '2026-11-08', to: '2026-11-10', dayOf, opts: { now: NOW } });
  const by = Object.fromEntries(r.health.map((h) => [h.kind, h]));
  assert.equal(by.sleep.summary, 'Average 7 h 30 min on the 2 days logged');
  assert.equal(by.sleep.daysLogged, 2);
  assert.equal(by.sleep.totalDays, 3);
  assert.equal(by.blood_pressure.summary, 'Readings from 124/80 to 130/85 mmHg');
  assert.equal(by.water.summary, '2 glasses + 250 ml logged in total');
  assert.equal(by.heart_rate.count, 0);
  assert.equal(by.heart_rate.summary, null);
  assert.equal(by.weight.latest, null);
});

test('diary notes are limited to the range, newest first', () => {
  const diary = [
    { id: 'a', entry_at: '2026-11-08T09:00:00Z', title: 'Older' },
    { id: 'b', entry_at: '2026-11-10T09:00:00Z', title: 'Newer' },
    { id: 'c', entry_at: '2026-10-10T09:00:00Z', title: 'Outside' },
  ];
  const r = buildReport({ diary, from: '2026-11-08', to: '2026-11-10', dayOf, opts: { now: NOW } });
  assert.deepEqual(r.notes.map((n) => n.id), ['b', 'a']);
});
