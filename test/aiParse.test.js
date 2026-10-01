// The gate between what the AI proposes and what the app does. The refusals
// matter as much as the successes: a bad value must never reach a setting or
// the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseScan, validateActions, validBirthday, medsSignature, normaliseChatReply } from '../src/lib/aiParse.js';

const TODAY = new Date(2026, 8, 27); // 27 Sep 2026

test('a clean pharmacy-label scan maps straight onto the wizard form', () => {
  const s = normaliseScan({
    is_medicine: true, name: 'Metformin', strength: '500 mg', dose_amount: 1, dose_unit: 'tablet',
    dose_other: 'ignored', times: ['20:00', '08:00'], frequency: 'daily', days_of_week: [3],
    with_food: true, note: '500 mg. Take with meals.', confidence: 'high', warnings: [],
  });
  assert.equal(s.isMedicine, true);
  assert.equal(s.confidence, 'high');
  assert.deepEqual(s.form.times, ['08:00', '20:00'], 'times sorted');
  assert.equal(s.form.dose_other, '', 'dose_other only kept for unit "other"');
  assert.deepEqual(s.form.days_of_week, [], 'days only kept for certain-days schedules');
  assert.equal(s.form.with_food, true);
});

test('scan values outside what the app allows fall back to safe defaults', () => {
  const s = normaliseScan({
    name: '  Vitamin D3  ', dose_amount: 0, dose_unit: 'softgel', times: ['8am', '25:00'],
    frequency: 'hourly', with_food: 'yes', confidence: 'certain',
  });
  assert.equal(s.form.name, 'Vitamin D3');
  assert.equal(s.form.dose_amount, 0.5, 'never zero');
  assert.equal(s.form.dose_unit, 'tablet', 'unknown unit');
  assert.deepEqual(s.form.times, ['08:00'], 'unreadable times');
  assert.equal(s.form.frequency, 'daily');
  assert.equal(s.form.with_food, false, 'only a real true counts');
  assert.equal(s.confidence, 'low');
});

test('"certain days" with no valid days becomes every day, so it can be saved', () => {
  const s = normaliseScan({ name: 'X', frequency: 'days_of_week', days_of_week: [9, -1] });
  assert.equal(s.form.frequency, 'daily');
  const t = normaliseScan({ name: 'X', frequency: 'days_of_week', days_of_week: [4, 1, 1] });
  assert.equal(t.form.frequency, 'days_of_week');
  assert.deepEqual(t.form.days_of_week, [1, 4]);
});

test('a non-medicine photo is flagged, and garbage input does not throw', () => {
  assert.equal(normaliseScan({ is_medicine: false, name: '' }).isMedicine, false);
  assert.doesNotThrow(() => normaliseScan(null));
  assert.equal(normaliseScan(undefined).form.name, '');
});

test('the three examples from the brief become the right actions', () => {
  const big = validateActions([{ type: 'set_text_size', key: '', value: 'xlarge' }], TODAY);
  assert.equal(big.actions[0].value, 'xlarge');

  const bday = validateActions([{ type: 'update_profile', key: 'birthday', value: '2026-05-05' }], TODAY);
  assert.equal(bday.actions[0].value, '2026-05-05');
  assert.match(bday.actions[0].label, /May 5, 2026/);

  const contrast = validateActions([
    { type: 'set_setting', key: 'highContrast', value: 'true' },
    { type: 'set_setting', key: 'calmMotion', value: 'true' },
  ], TODAY);
  assert.deepEqual(contrast.actions.map((a) => [a.key, a.value]), [['highContrast', true], ['calmMotion', true]]);
});

test('unknown actions, keys and values are rejected, never applied', () => {
  const { actions, rejected } = validateActions([
    { type: 'delete_account', key: '', value: '' },
    { type: 'set_setting', key: 'isAdmin', value: 'true' },
    { type: 'set_setting', key: 'bold', value: 'maybe' },
    { type: 'set_text_size', key: '', value: 'gigantic' },
    { type: 'set_theme', key: '', value: 'neon' },
    { type: 'update_profile', key: 'user_id', value: 'x' },
    { type: 'navigate', key: '', value: 'https://evil.example' },
  ], TODAY);
  assert.equal(actions.length, 0);
  assert.equal(rejected.length, 7);
});

test('birthdays must be real, past dates', () => {
  assert.equal(validBirthday('1950-05-05', TODAY), '1950-05-05');
  assert.equal(validBirthday('2026-09-27', TODAY), '2026-09-27', 'today is allowed');
  assert.equal(validBirthday('2026-09-28', TODAY), null, 'future');
  assert.equal(validBirthday('2023-02-29', TODAY), null, 'not a real day');
  assert.equal(validBirthday('May 5, 1950', TODAY), null, 'must be ISO');
  assert.equal(validBirthday('1850-01-01', TODAY), null, 'too old');
});

test('duplicate actions keep the last word, and navigation runs last', () => {
  const { actions } = validateActions([
    { type: 'navigate', key: '', value: '/medication' },
    { type: 'set_text_size', key: '', value: 'large' },
    { type: 'set_text_size', key: '', value: 'huge' },
  ], TODAY);
  assert.deepEqual(actions.map((a) => a.type), ['set_text_size', 'navigate']);
  assert.equal(actions[0].value, 'huge');
});

test('empty profile text is refused and long text is trimmed', () => {
  assert.equal(validateActions([{ type: 'update_profile', key: 'goal', value: '   ' }], TODAY).actions.length, 0);
  const long = validateActions([{ type: 'update_profile', key: 'full_name', value: 'a'.repeat(200) }], TODAY);
  assert.equal(long.actions[0].value.length, 60);
});

test('the medicine-list signature ignores order but notices changes', () => {
  const a = [{ name: 'Aspirin', dose: '1 tablet', frequency: 'daily' }, { name: 'Vitamin D', dose: '1 capsule', frequency: 'daily' }];
  assert.equal(medsSignature(a), medsSignature([...a].reverse()));
  assert.notEqual(medsSignature(a), medsSignature([a[0]]));
  assert.notEqual(medsSignature(a), medsSignature([{ ...a[0], dose: '2 tablets' }, a[1]]));
});

test('a note-chat reply is trimmed, capped and never urgent by accident', () => {
  const r = normaliseChatReply({
    reply: '  Well done for writing this down! Did you drink much water today?  ',
    suggestions: ['Not much', 'Not much', '', 'A lot', 'Not sure', 'Way too many words in this one to fit on a tap button ok'],
    urgent: 'true',
  });
  assert.equal(r.reply, 'Well done for writing this down! Did you drink much water today?');
  assert.deepEqual(r.suggestions, ['Not much', 'A lot', 'Not sure'], 'deduped, blanks and long ones dropped, max 3');
  assert.equal(r.urgent, false, 'only a real boolean true counts');
  assert.equal(normaliseChatReply({ reply: 'Call 911 now.', suggestions: [], urgent: true }).urgent, true);
});

test('an empty or broken note-chat reply still gives the person something to read', () => {
  const r = normaliseChatReply(null);
  assert.ok(r.reply.length > 0);
  assert.deepEqual(r.suggestions, []);
  assert.equal(r.urgent, false);
});
