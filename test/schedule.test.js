// Scheduling rules. These decide which dose rows exist at all, so a mistake
// here shows up as a phantom "missed dose" alert for a medicine the person was
// never supposed to take that day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDueOn, dueDatesBetween, normaliseTimes, toTimeString, courseLength,
  describeSchedule, validateMedicine, dowOf, daysBetween,
} from '../src/lib/schedule.js';

// 2026-09-13 is a Sunday, so 14 = Monday … 19 = Saturday.
test('weekday maths is timezone-proof', () => {
  assert.equal(dowOf('2026-09-13'), 0, 'Sunday');
  assert.equal(dowOf('2026-09-14'), 1, 'Monday');
  assert.equal(dowOf('2026-09-19'), 6, 'Saturday');
  assert.equal(daysBetween('2026-09-13', '2026-09-20'), 7);
  assert.equal(daysBetween('2026-09-20', '2026-09-13'), -7);
  // Across a daylight-saving boundary the count must still be whole days.
  assert.equal(daysBetween('2026-10-30', '2026-11-05'), 6);
  assert.equal(daysBetween('2026-03-05', '2026-03-12'), 7);
});

test('a daily medicine is due every day', () => {
  const med = { frequency: 'daily' };
  for (const d of ['2026-09-13', '2026-09-14', '2026-09-15']) {
    assert.equal(isDueOn(med, d), true);
  }
});

test('an as-needed medicine is never scheduled', () => {
  // This is the point of the option: no dose row, so no missed-dose alert.
  const med = { frequency: 'as_needed' };
  assert.equal(isDueOn(med, '2026-09-14'), false);
  assert.deepEqual(dueDatesBetween(med, '2026-09-01', '2026-09-30'), []);
});

test('certain days of the week', () => {
  const med = { frequency: 'days_of_week', days_of_week: [1, 4] }; // Mon, Thu
  assert.equal(isDueOn(med, '2026-09-14'), true, 'Monday');
  assert.equal(isDueOn(med, '2026-09-17'), true, 'Thursday');
  assert.equal(isDueOn(med, '2026-09-15'), false, 'Tuesday');
  assert.equal(isDueOn(med, '2026-09-13'), false, 'Sunday');
});

test('no chosen day means nothing is due, not everything', () => {
  const med = { frequency: 'days_of_week', days_of_week: [] };
  assert.equal(isDueOn(med, '2026-09-14'), false,
    'an incomplete schedule must not silently become daily');
});

test('every other day is anchored to the start date', () => {
  const med = { frequency: 'alternate', start_date: '2026-09-14' };
  assert.equal(isDueOn(med, '2026-09-14'), true, 'day 0');
  assert.equal(isDueOn(med, '2026-09-15'), false, 'day 1');
  assert.equal(isDueOn(med, '2026-09-16'), true, 'day 2');
  assert.equal(isDueOn(med, '2026-09-13'), false, 'before it starts');
  // The phase must not drift: a month later it is still on even offsets.
  assert.equal(isDueOn(med, '2026-10-14'), true, '30 days on');
  assert.equal(isDueOn(med, '2026-10-15'), false);
});

test('a course has a start and a hard end', () => {
  const med = { frequency: 'daily', start_date: '2026-09-14', end_date: '2026-09-23' };
  assert.equal(isDueOn(med, '2026-09-13'), false, 'the day before');
  assert.equal(isDueOn(med, '2026-09-14'), true, 'first day');
  assert.equal(isDueOn(med, '2026-09-23'), true, 'last day is inclusive');
  assert.equal(isDueOn(med, '2026-09-24'), false, 'the day after');
  // "for 10 days" must be exactly ten.
  assert.equal(dueDatesBetween(med, '2026-09-01', '2026-10-31').length, 10);
});

test('course length counts doses, not just days', () => {
  const med = {
    frequency: 'daily', times: ['08:00', '20:00'],
    start_date: '2026-09-14', end_date: '2026-09-23',
  };
  assert.deepEqual(courseLength(med), { days: 10, doses: 20 });
  assert.equal(courseLength({ frequency: 'daily' }), null, 'no end date, no length');
});

test('times are de-duplicated, sorted and validated', () => {
  assert.deepEqual(normaliseTimes(['20:00', '08:00', '08:00']), ['08:00', '20:00']);
  assert.deepEqual(normaliseTimes(['9:00']), [], 'H:MM is not valid, HH:MM is');
  assert.deepEqual(normaliseTimes(['24:00', '12:60', 'abc', '', null]), []);
  assert.deepEqual(normaliseTimes(null), []);
  assert.deepEqual(normaliseTimes(['00:00', '23:59']), ['00:00', '23:59']);
});

test('toTimeString pads and clamps', () => {
  assert.equal(toTimeString(8, 0), '08:00');
  assert.equal(toTimeString(21, 5), '21:05');
  assert.equal(toTimeString(30, 90), '23:59');
  assert.equal(toTimeString(-1, -1), '00:00');
});

test('the review sentence reads like a person wrote it', () => {
  assert.equal(
    describeSchedule({ frequency: 'daily', times: ['08:00'], with_food: true }),
    'every day at 08:00, with food');
  assert.equal(
    describeSchedule({ frequency: 'alternate', times: ['09:00'] }),
    'every other day at 09:00');
  assert.equal(
    describeSchedule({ frequency: 'days_of_week', days_of_week: [1, 2, 3, 4, 5], times: ['08:00'] }),
    'every weekday at 08:00');
  assert.equal(
    describeSchedule({ frequency: 'days_of_week', days_of_week: [0, 6], times: ['10:00'] }),
    'at weekends at 10:00');
  assert.equal(
    describeSchedule({ frequency: 'days_of_week', days_of_week: [1, 4], times: ['08:00'] }),
    'every Monday, Thursday at 08:00');
  assert.equal(
    describeSchedule({ frequency: 'as_needed' }),
    'only when you need it — no reminders');
  assert.match(
    describeSchedule({ frequency: 'daily', times: ['08:00'], start_date: '2026-09-14', end_date: '2026-09-23' }),
    /for 10 days/);
});

test('validation is specific and never blocks on nothing', () => {
  assert.deepEqual(validateMedicine({ name: 'Vitamin D', frequency: 'daily', times: ['08:00'] }), []);

  const noName = validateMedicine({ frequency: 'daily', times: ['08:00'] });
  assert.equal(noName.length, 1);
  assert.equal(noName[0].field, 'name');

  const noTimes = validateMedicine({ name: 'X', frequency: 'daily', times: [] });
  assert.ok(noTimes.some((p) => p.field === 'times'));

  // As-needed legitimately has no times, so that must not be an error.
  assert.deepEqual(validateMedicine({ name: 'Paracetamol', frequency: 'as_needed', times: [] }), []);

  const noDays = validateMedicine({ name: 'X', frequency: 'days_of_week', days_of_week: [], times: ['08:00'] });
  assert.ok(noDays.some((p) => p.field === 'days'));

  const backwards = validateMedicine({
    name: 'X', frequency: 'daily', times: ['08:00'],
    start_date: '2026-09-23', end_date: '2026-09-14',
  });
  assert.ok(backwards.some((p) => p.field === 'end_date'));
});
