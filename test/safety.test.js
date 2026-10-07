// Unit tests for the status, inventory, readiness and contact rules added
// after the phone/safety audit. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doseState, countsByDay, dayMarkFromCounts, summarise, adherence } from '../src/lib/doseState.js';
import { supplyEstimate, supplyWords, dosesPerDay } from '../src/lib/inventory.js';
import { readinessChecklist, describeDevice } from '../src/lib/readiness.js';
import { validPhone, telHref } from '../src/lib/contacts.js';
import { courseEndDate, courseDays, isIsoDate, isDueOn, validateMedicine } from '../src/lib/schedule.js';
import { medicineProblems, toMedicationPayload } from '../src/lib/medicationPayload.js';

const NOW = Date.parse('2026-10-07T13:30:00Z'); // 9:30 AM Toronto
const dose = (date, due, status = 'pending', extra = {}) => ({ dose_date: date, due_at: due, status, ...extra });

test('calendar counts use the same rule as Today: a stale pending dose is missed', () => {
  const doses = [
    dose('2026-10-07', '2026-10-07T12:00:00Z'), // 8:00, past the 60 min window
    dose('2026-10-07', '2026-10-07T13:00:00Z'), // 9:00, inside the window
    dose('2026-10-03', '2026-10-03T12:00:00Z'), // days ago, never swept
  ];
  const c = countsByDay(doses, { now: NOW, windowMinutes: 60 });
  assert.deepEqual([c['2026-10-07'].missed, c['2026-10-07'].toTake], [1, 1]);
  assert.equal(c['2026-10-03'].missed, 1);
  assert.equal(dayMarkFromCounts(c['2026-10-03']), 'missed', 'not "to take"');
  // And summarise() — what Today and Home show — agrees.
  assert.equal(summarise(doses.slice(0, 2), { now: NOW, windowMinutes: 60 }).missed, 1);
});

test('a per-medicine missed window overrides the profile window, like the server', () => {
  const d = dose('2026-10-07', '2026-10-07T12:00:00Z', 'pending', { medication: { alert_window_override: 120 } });
  assert.equal(doseState(d, { now: NOW, windowMinutes: 60 }), 'overdue');
  assert.equal(doseState({ ...d, medication: null }, { now: NOW, windowMinutes: 60 }), 'missed');
});

test('skipped and as-needed doses are outside the adherence denominator', () => {
  const list = [
    dose('2026-10-06', '2026-10-06T12:00:00Z', 'taken'),
    dose('2026-10-06', '2026-10-06T13:00:00Z', 'missed'),
    dose('2026-10-06', '2026-10-06T14:00:00Z', 'skipped'),
    dose('2026-10-06', '2026-10-06T15:00:00Z', 'taken', { as_needed: true }),
    dose('2026-10-08', '2026-10-08T12:00:00Z', 'pending'),
  ];
  assert.deepEqual(adherence(list, { now: NOW }), { taken: 1, total: 2, pct: 50 });
  assert.equal(countsByDay(list, { now: NOW })['2026-10-06'].total, 3, 'PRN not counted on the calendar');
});

test('midnight and DST: dates are strings, so a course never shifts a day', () => {
  // Nov 1 2026 is the end of DST in North America.
  assert.equal(courseEndDate('2026-10-28', 7), '2026-11-03');
  assert.equal(courseDays('2026-10-31', '2026-11-02'), 3);
  assert.equal(courseEndDate('2026-12-31', 2), '2027-01-01');
  assert.equal(isIsoDate('2026-02-30'), false);
  const alt = { frequency: 'alternate', start_date: '2026-10-31' };
  assert.deepEqual(['2026-10-31', '2026-11-01', '2026-11-02'].map((d) => isDueOn(alt, d)), [true, false, true]);
});

test('end before start and malformed dates are refused by the shared validation', () => {
  const base = { name: 'X', dose_amount: 1, dose_unit: 'tablet', times: ['08:00'], frequency: 'daily' };
  assert.equal(validateMedicine({ ...base, start_date: '2026-10-10', end_date: '2026-10-09' })[0].field, 'end_date');
  assert.equal(validateMedicine({ ...base, start_date: '2026-13-01' })[0].field, 'start_date');
  assert.equal(validateMedicine({ ...base, start_date: '2026-10-10', end_date: '2026-10-10' }).length, 0, 'one-day course is fine');
});

test('the payload refuses what review would refuse, and keeps PRN as the exception', () => {
  const base = { name: 'X', dose_amount: '2.75', dose_unit: 'mg', times: ['08:00'], frequency: 'daily', days_of_week: [], with_food: false, note: '', color: '#000' };
  assert.equal(toMedicationPayload(base).dose_amount, 2.75);
  assert.equal(toMedicationPayload(base).dose, '2.75 mg');
  assert.throws(() => toMedicationPayload({ ...base, dose_amount: '-1' }), /more than zero/);
  assert.throws(() => toMedicationPayload({ ...base, times: [] }), /at least one time/);
  assert.throws(() => toMedicationPayload({ ...base, frequency: 'days_of_week' }), /day of the week/);
  assert.equal(medicineProblems({ ...base, frequency: 'as_needed', times: [] }).length, 0);
  assert.throws(() => toMedicationPayload({ ...base, dose_unit: 'other', dose_other: '' }), /call the amount/);
});

test('supply is an estimate, unknown stock never blocks anything', () => {
  const med = { stock_quantity: 30, refill_threshold: 10, dose_amount: 1, times: ['08:00', '20:00'], frequency: 'daily' };
  assert.deepEqual([supplyEstimate(med).daysLeft, supplyEstimate(med).low], [15, false]);
  assert.equal(supplyEstimate({ ...med, stock_quantity: 9 }).low, true);
  assert.equal(supplyEstimate({ ...med, stock_quantity: null }).unknown, true);
  assert.equal(supplyWords({ ...med, stock_quantity: null }), null);
  assert.match(supplyWords(med, 'tablets left'), /about 15 days \(estimate\)/);
  assert.equal(dosesPerDay({ times: ['08:00'], frequency: 'alternate' }), 0.5);
  assert.equal(dosesPerDay({ times: [], frequency: 'as_needed' }), null);
  assert.equal(supplyEstimate({ ...med, frequency: 'as_needed' }).daysLeft, null);
});

test('readiness keeps each link of the chain separate and never claims delivery', () => {
  const devices = [{ endpoint: 'e1', push_enabled: true, last_notified_at: '2026-10-06T13:00:00Z' }];
  const r = readinessChecklist({
    prefs: { master: true, dose_due: true }, permission: 'granted', supported: true, installed: true,
    meds: [{ frequency: 'daily', reminders_enabled: false }, { frequency: 'daily' }], devices, myEndpoint: 'e1',
  });
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(by.pref.state, 'ok');
  assert.equal(by.meds.state, 'warn');
  assert.match(by.meds.detail, /1 of 2/);
  assert.equal(by.subscribed.state, 'ok');
  assert.match(by.delivery.detail, /Send a test/);
  const off = readinessChecklist({ prefs: { master: false }, permission: 'denied', supported: true, devices: [], meds: [] });
  assert.equal(off.find((x) => x.id === 'pref').state, 'warn');
  assert.equal(off.find((x) => x.id === 'permission').state, 'warn');
});

test('two "This phone" rows become two distinguishable devices', () => {
  const all = [
    { id: 1, label: 'This phone', platform: 'ios', created_at: '2026-09-02T00:00:00Z', installed: true, endpoint: 'a' },
    { id: 2, label: 'This phone', platform: 'ios', created_at: '2026-09-20T00:00:00Z', installed: false, endpoint: 'b' },
  ];
  const a = describeDevice(all[0], { all, myEndpoint: 'b' });
  const b = describeDevice(all[1], { all, myEndpoint: 'b' });
  assert.notEqual(`${a.name} ${a.meta}`, `${b.name} ${b.meta}`);
  assert.equal(a.name, 'iPhone 1');
  assert.equal(b.current, true);
});

test('phone numbers are validated before a Call button appears', () => {
  for (const ok of ['(555) 123-4567', '+1 555 123 4567', '555.123.4567', '911 1234']) assert.ok(validPhone(ok), ok);
  for (const bad of ['12', 'call me', '555-CALL-NOW', '+1234567890123456']) assert.equal(validPhone(bad), false, bad);
  assert.equal(telHref('+1 (555) 123-4567'), 'tel:+15551234567');
  assert.equal(telHref('12'), null);
});
