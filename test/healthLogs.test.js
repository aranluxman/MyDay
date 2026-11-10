import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLog, formatLog, latestByKind, waterForDay, dailySeries, averageOf, sleepWords,
  kgToLb, lbToKg, cmToFtIn, ftInToCm, allergyState, validateBody, heightWords, weightWords, parseNumber,
} from '../src/lib/healthLogs.js';

const NOW = Date.parse('2026-11-10T15:00:00Z');
const dayOf = (iso) => iso.slice(0, 10);

test('numbers: only plain numbers are accepted', () => {
  assert.equal(parseNumber('7'), 7);
  assert.equal(parseNumber('7,5'), 7.5);
  assert.equal(parseNumber(' 68.4 '), 68.4);
  for (const bad of ['', 'abc', '-3', '1e3', '7..5', '12 kg', null, undefined]) assert.equal(parseNumber(bad), null, String(bad));
});

test('blood pressure needs both numbers, in range, top above bottom', () => {
  assert.deepEqual(validateLog('blood_pressure', { systolic: '128', diastolic: '82', now: NOW }).row,
    { kind: 'blood_pressure', value: 128, value2: 82, unit: 'mmHg', note: null, logged_at: new Date(NOW).toISOString() });
  assert.ok(validateLog('blood_pressure', { systolic: '128', now: NOW }).errors.diastolic);
  assert.ok(validateLog('blood_pressure', { diastolic: '80', now: NOW }).errors.systolic);
  assert.match(validateLog('blood_pressure', { systolic: '80', diastolic: '120', now: NOW }).errors.diastolic, /lower than the top/);
  assert.ok(validateLog('blood_pressure', { systolic: '400', diastolic: '80', now: NOW }).errors.systolic);
  assert.ok(validateLog('blood_pressure', { systolic: '120.5', diastolic: '80', now: NOW }).errors.systolic);
});

test('sleep takes hours and minutes and stores minutes', () => {
  assert.equal(validateLog('sleep', { hours: '7', minutes: '20', now: NOW }).row.value, 440);
  assert.equal(validateLog('sleep', { hours: '', minutes: '45', now: NOW }).row.value, 45);
  assert.equal(validateLog('sleep', { hours: '8', minutes: '', now: NOW }).row.value, 480);
  assert.ok(validateLog('sleep', { hours: '', minutes: '', now: NOW }).errors.hours);
  assert.ok(validateLog('sleep', { hours: '0', minutes: '0', now: NOW }).errors.hours);
  assert.ok(validateLog('sleep', { hours: '7', minutes: '75', now: NOW }).errors.minutes);
  assert.ok(validateLog('sleep', { hours: '24', minutes: '30', now: NOW }).errors.hours);
  assert.ok(validateLog('sleep', { hours: '7.5', minutes: '0', now: NOW }).errors.hours);
});

test('weight is stored in kilograms and remembers the unit typed', () => {
  const lb = validateLog('weight', { amount: '150', unit: 'lb', now: NOW }).row;
  assert.equal(lb.unit, 'lb');
  assert.equal(lb.value, 68.04);
  assert.equal(formatLog(lb), '150 lb');
  assert.equal(formatLog(lb, { weightUnit: 'kg' }), '68 kg');
  assert.equal(validateLog('weight', { amount: '68.4', unit: 'kg', now: NOW }).row.value, 68.4);
  assert.ok(validateLog('weight', { amount: '5', unit: 'kg', now: NOW }).errors.amount);
  assert.ok(validateLog('weight', { amount: '900', unit: 'lb', now: NOW }).errors.amount);
  assert.ok(validateLog('weight', { amount: '', unit: 'kg', now: NOW }).errors.amount);
});

test('water and heart rate: units and limits', () => {
  assert.equal(formatLog(validateLog('water', { amount: '1', unit: 'glass', now: NOW }).row), '1 glass');
  assert.equal(formatLog(validateLog('water', { amount: '3', unit: 'glass', now: NOW }).row), '3 glasses');
  assert.equal(formatLog(validateLog('water', { amount: '250', unit: 'ml', now: NOW }).row), '250 ml');
  assert.ok(validateLog('water', { amount: '0', unit: 'glass', now: NOW }).errors.amount);
  assert.ok(validateLog('water', { amount: '41', unit: 'glass', now: NOW }).errors.amount);
  assert.equal(formatLog(validateLog('heart_rate', { bpm: '72', now: NOW }).row), '72 bpm');
  assert.ok(validateLog('heart_rate', { bpm: '900', now: NOW }).errors.bpm);
  assert.ok(validateLog('heart_rate', { bpm: '72.5', now: NOW }).errors.bpm);
  assert.ok(validateLog('steps', { now: NOW }).errors.kind);
});

test('a reading cannot be dated in the future, and a long note is refused', () => {
  assert.ok(validateLog('heart_rate', { bpm: '72', loggedAt: '2026-11-11T15:00:00Z', now: NOW }).errors.loggedAt);
  assert.equal(validateLog('heart_rate', { bpm: '72', loggedAt: '2026-11-09T08:00:00Z', now: NOW }).row.logged_at, '2026-11-09T08:00:00.000Z');
  assert.ok(validateLog('heart_rate', { bpm: '72', loggedAt: 'yesterday-ish', now: NOW }).errors.loggedAt);
  assert.ok(validateLog('heart_rate', { bpm: '72', note: 'x'.repeat(501), now: NOW }).errors.note);
  assert.equal(validateLog('heart_rate', { bpm: '72', note: '  after a walk ', now: NOW }).row.note, 'after a walk');
});

test('latest reading per kind, and words for sleep', () => {
  const rows = [
    { kind: 'heart_rate', value: 70, logged_at: '2026-11-08T08:00:00Z' },
    { kind: 'heart_rate', value: 76, logged_at: '2026-11-10T08:00:00Z' },
    { kind: 'sleep', value: 440, logged_at: '2026-11-09T07:00:00Z' },
    { kind: 'nonsense', value: 1, logged_at: '2026-11-10T09:00:00Z' },
  ];
  const latest = latestByKind(rows);
  assert.equal(latest.heart_rate.value, 76);
  assert.equal(latest.sleep.value, 440);
  assert.equal(latest.weight, undefined);
  assert.equal(latest.nonsense, undefined);
  assert.equal(sleepWords(440), '7 h 20 min');
  assert.equal(sleepWords(480), '8 h');
  assert.equal(sleepWords(45), '45 min');
});

test('water for a day never mixes or converts glasses and millilitres', () => {
  const rows = [
    { kind: 'water', value: 2, unit: 'glass', logged_at: '2026-11-10T08:00:00Z' },
    { kind: 'water', value: 1, unit: 'glass', logged_at: '2026-11-10T12:00:00Z' },
    { kind: 'water', value: 250, unit: 'ml', logged_at: '2026-11-10T13:00:00Z' },
    { kind: 'water', value: 5, unit: 'glass', logged_at: '2026-11-09T13:00:00Z' },
  ];
  assert.deepEqual(waterForDay(rows, '2026-11-10', dayOf), { text: '3 glasses + 250 ml', glasses: 3, ml: 250, count: 3 });
  assert.equal(waterForDay(rows, '2026-11-08', dayOf), null);
});

test('daily series leaves days without a reading empty, never zero', () => {
  const rows = [
    { kind: 'sleep', value: 420, unit: 'min', logged_at: '2026-11-08T07:00:00Z' },
    { kind: 'sleep', value: 60, unit: 'min', logged_at: '2026-11-08T14:00:00Z' },
    { kind: 'sleep', value: 440, unit: 'min', logged_at: '2026-11-10T07:00:00Z' },
    { kind: 'blood_pressure', value: 130, value2: 85, logged_at: '2026-11-10T07:00:00Z' },
    { kind: 'blood_pressure', value: 124, value2: 80, logged_at: '2026-11-10T19:00:00Z' },
    { kind: 'water', value: 2, unit: 'glass', logged_at: '2026-11-10T08:00:00Z' },
    { kind: 'water', value: 300, unit: 'ml', logged_at: '2026-11-10T09:00:00Z' },
  ];
  const sleep = dailySeries(rows, 'sleep', { endIso: '2026-11-10', days: 4, dayOf });
  assert.deepEqual(sleep.points.map((p) => [p.day, p.value]), [['2026-11-07', null], ['2026-11-08', 480], ['2026-11-09', null], ['2026-11-10', 440]]);
  assert.equal(sleep.daysWithData, 2);
  assert.equal(averageOf(sleep.points), 460);
  const bp = dailySeries(rows, 'blood_pressure', { endIso: '2026-11-10', days: 2, dayOf });
  assert.deepEqual([bp.points[1].value, bp.points[1].value2], [124, 80]);
  assert.equal(bp.points[0].value, null);
  const water = dailySeries(rows, 'water', { endIso: '2026-11-10', days: 1, dayOf });
  assert.equal(water.points[0].value, 2);
  assert.equal(water.otherUnit, 1);
  assert.equal(averageOf(dailySeries([], 'sleep', { endIso: '2026-11-10', days: 3, dayOf }).points), null);
});

test('unit conversions round-trip sensibly', () => {
  assert.equal(kgToLb(68), 149.9);
  assert.equal(lbToKg(150), 68.04);
  assert.equal(kgToLb(lbToKg(150)), 150);
  assert.equal(kgToLb(lbToKg(182.4)), 182.4);
  assert.deepEqual(cmToFtIn(165), { ft: 5, inches: 5 });
  assert.equal(ftInToCm(5, 5), 165.1);
  assert.equal(heightWords(165, 'cm'), '165 cm');
  assert.equal(heightWords(165, 'ft_in'), '5 ft 5 in');
  assert.equal(heightWords(null), null);
  assert.equal(weightWords(61.5, 'kg'), '61.5 kg');
  assert.equal(weightWords('', 'kg'), null);
});

test('allergies: a list, "No known allergies" and "Not entered" are three different answers', () => {
  assert.deepEqual(allergyState({ allergies: ' Penicillin ' }), { state: 'listed', text: 'Penicillin' });
  assert.deepEqual(allergyState({ allergies_none: true }), { state: 'none', text: 'No known allergies' });
  assert.deepEqual(allergyState({ allergies: '', allergies_none: false }), { state: 'missing', text: 'Not entered' });
  assert.deepEqual(allergyState(null), { state: 'missing', text: 'Not entered' });
});

test('profile height and weight are optional but checked when typed', () => {
  assert.deepEqual(validateBody({ heightUnit: 'cm', heightCm: '', weightUnit: 'kg', weight: '' }), { ok: true, errors: {}, values: { height_cm: null, weight_kg: null } });
  assert.deepEqual(validateBody({ heightUnit: 'cm', heightCm: '165', weightUnit: 'lb', weight: '150' }).values, { height_cm: 165, weight_kg: 68.04 });
  assert.equal(validateBody({ heightUnit: 'ft_in', heightFt: '5', heightIn: '6', weightUnit: 'kg', weight: '' }).values.height_cm, 167.6);
  assert.ok(validateBody({ heightUnit: 'ft_in', heightFt: '5', heightIn: '14', weightUnit: 'kg', weight: '' }).errors.height);
  assert.ok(validateBody({ heightUnit: 'cm', heightCm: '16', weightUnit: 'kg', weight: '' }).errors.height);
  assert.ok(validateBody({ heightUnit: 'cm', heightCm: '', weightUnit: 'kg', weight: 'heavy' }).errors.weight);
});
