import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayForKey, addDays } from '../src/lib/calendarKeys.js';

test('arrows move a day or a week, across month and year ends', () => {
  assert.equal(dayForKey('ArrowRight', '2026-10-31'), '2026-11-01');
  assert.equal(dayForKey('ArrowLeft', '2026-01-01'), '2025-12-31');
  assert.equal(dayForKey('ArrowDown', '2026-10-28'), '2026-11-04');
  assert.equal(dayForKey('ArrowUp', '2026-10-03'), '2026-09-26');
});

test('Home and End go to Sunday and Saturday of the same week', () => {
  // Wed Oct 7, 2026
  assert.equal(dayForKey('Home', '2026-10-07'), '2026-10-04');
  assert.equal(dayForKey('End', '2026-10-07'), '2026-10-10');
});

test('Page Up / Page Down keep the day where the month allows', () => {
  assert.equal(dayForKey('PageDown', '2026-01-31'), '2026-02-28');
  assert.equal(dayForKey('PageUp', '2026-03-31'), '2026-02-28');
  assert.equal(dayForKey('PageDown', '2026-12-15'), '2027-01-15');
});

test('other keys are ignored, and addDays crosses daylight-saving changes', () => {
  assert.equal(dayForKey('Enter', '2026-10-07'), null);
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
});
