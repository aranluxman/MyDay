// Dose building and parsing. The parser is what migrates the free-text doses
// already in the database, so its refusals matter as much as its successes:
// guessing someone's dose is worse than admitting we cannot read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDoseString, parseDose, migrateDose, formatAmount, UNIT_IDS, parseAmountInput, amountProblem,
  stepAmount, describeDoseWithStrength, cleanStrength,
} from '../src/lib/doseUnits.js';

test('the unit chips include everything the flow promises', () => {
  for (const u of ['tablet', 'capsule', 'ml', 'drop', 'puff', 'mg', 'mcg', 'IU', 'unit', 'patch', 'sachet', 'injection', 'other']) {
    assert.ok(UNIT_IDS.includes(u), `${u} missing`);
  }
});

// P0 regression: the audit entered 2.75 mg and saw 3 mg on review, 0.1 mL and
// saw 1/2 mL, and -1 mL and saw 1/2 mL. Amounts are now exact or refused.
test('typed amounts are preserved exactly', () => {
  for (const [typed, value] of [['2.75', 2.75], ['0.1', 0.1], ['0.125', 0.125], ['0,5', 0.5], ['.5', 0.5],
    ['1/2', 0.5], ['1 1/2', 1.5], ['1/4', 0.25], ['1000', 1000], ['9999', 9999], [' 3 ', 3]]) {
    const r = parseAmountInput(typed);
    assert.equal(r.ok, true, `${typed} should be accepted`);
    assert.equal(r.value, value, `${typed} must stay ${value}`);
  }
});

test('invalid amounts are rejected with a message, never replaced', () => {
  const cases = {
    '': /enter how much/i, '   ': /enter how much/i, '-1': /more than zero/i, '-0.5': /more than zero/i,
    '0': /more than zero/i, '0.0': /more than zero/i, 'abc': /number/i, '1e3': /number/i, '1.2.3': /number/i,
    'Infinity': /number/i, 'NaN': /number/i, '1/0': /number/i, '10000': /more than 9999/i,
    '0.00001': /decimal places/i, '1/3': /cannot be stored exactly/i, '2 tablets': /number/i,
  };
  for (const [typed, msg] of Object.entries(cases)) {
    const r = parseAmountInput(typed);
    assert.equal(r.ok, false, `${JSON.stringify(typed)} must be refused`);
    assert.match(r.error, msg, `${JSON.stringify(typed)} message`);
  }
});

test('amountProblem guards numbers that reach the payload by any route', () => {
  assert.equal(amountProblem(2.75), null);
  assert.equal(amountProblem('2.75'), null);
  for (const bad of [0, -1, NaN, Infinity, -Infinity, null, undefined, '', 1e6, 0.00001, '1e3']) {
    assert.notEqual(amountProblem(bad), null, `${String(bad)} must be a problem`);
  }
});

test('the +/- buttons move by a half without snapping what was typed', () => {
  assert.equal(stepAmount(2.75, 0.5), 3.25);
  assert.equal(stepAmount(2.75, -0.5), 2.25);
  assert.equal(stepAmount(0.25, -0.5), 0.25, 'never steps to zero or below');
  assert.equal(stepAmount('', 0.5), 0.5);
  assert.equal(stepAmount(1, 0.5), 1.5);
});

test('amounts read as fractions only for countable things', () => {
  assert.equal(formatAmount(0.5), '1/2');
  assert.equal(formatAmount(1), '1');
  assert.equal(formatAmount(1.5), '1 1/2');
  assert.equal(formatAmount(0.25, 'tablet'), '1/4');
  assert.equal(formatAmount(1000), '1000');
  // Measured amounts are decimals with a leading zero and no trailing zero.
  assert.equal(formatAmount(0.5, 'ml'), '0.5');
  assert.equal(formatAmount(0.1, 'ml'), '0.1');
  assert.equal(formatAmount(2.75, 'mg'), '2.75');
  assert.equal(formatAmount(2.5, 'tablet'), '2 1/2');
  assert.equal(formatAmount(2.3, 'tablet'), '2.3', 'no invented fraction');
});

test('dose strings carry the exact amount', () => {
  assert.equal(buildDoseString(2.75, 'mg'), '2.75 mg');
  assert.equal(buildDoseString(0.1, 'ml'), '0.1 mL');
  assert.equal(buildDoseString('0.125', 'mg'), '0.125 mg');
  assert.equal(buildDoseString(50, 'mcg'), '50 mcg');
  // Invalid input builds nothing, so nothing invalid can be displayed as a dose.
  assert.equal(buildDoseString(-1, 'ml'), '');
  assert.equal(buildDoseString(0, 'ml'), '');
  assert.equal(buildDoseString('', 'ml'), '');
});

test('dose strings pluralise countable units only', () => {
  assert.equal(buildDoseString(1, 'tablet'), '1 tablet');
  assert.equal(buildDoseString(2, 'tablet'), '2 tablets');
  assert.equal(buildDoseString(0.5, 'tablet'), '1/2 tablet');
  assert.equal(buildDoseString(1.5, 'tablet'), '1 1/2 tablets');
  assert.equal(buildDoseString(1, 'patch'), '1 patch');
  assert.equal(buildDoseString(3, 'patch'), '3 patches');
  // Measures never pluralise: "2 mgs" and "5 mls" are wrong.
  assert.equal(buildDoseString(2, 'mg'), '2 mg');
  assert.equal(buildDoseString(5, 'ml'), '5 mL');
  assert.equal(buildDoseString(1000, 'IU'), '1000 IU');
});

test('strength is shown beside the amount, never merged into it', () => {
  assert.equal(describeDoseWithStrength({ dose: '1 tablet', dose_unit: 'tablet', strength: '5 mg' }), '1 tablet (5 mg tablet strength)');
  assert.equal(describeDoseWithStrength({ dose: '5 mg', dose_unit: 'mg', strength: '' }), '5 mg');
  assert.equal(cleanStrength('  250 mg /  5 mL '), '250 mg / 5 mL', 'kept as written, only tidied');
});

test('"other" carries the words the person typed', () => {
  assert.equal(buildDoseString(1, 'other', 'scoop'), '1 scoop');
  assert.equal(buildDoseString(2, 'other', ''), '2', 'no invented unit');
});

test('parses the shapes people actually write', () => {
  assert.deepEqual(pick(parseDose('1 tablet')), { amount: 1, unit: 'tablet' });
  assert.deepEqual(pick(parseDose('2 tablets')), { amount: 2, unit: 'tablet' });
  assert.deepEqual(pick(parseDose('1000 IU')), { amount: 1000, unit: 'IU' });
  assert.deepEqual(pick(parseDose('5ml')), { amount: 5, unit: 'ml' });
  assert.deepEqual(pick(parseDose('500 mg')), { amount: 500, unit: 'mg' });
  assert.deepEqual(pick(parseDose('1 cap')), { amount: 1, unit: 'capsule' });
  assert.deepEqual(pick(parseDose('2 puffs')), { amount: 2, unit: 'puff' });
  assert.deepEqual(pick(parseDose('1 PILL')), { amount: 1, unit: 'tablet' }, 'case-insensitive');
  assert.deepEqual(pick(parseDose('  3   drops  ')), { amount: 3, unit: 'drop' });
});

test('parses halves however they are written', () => {
  assert.deepEqual(pick(parseDose('1/2 tablet')), { amount: 0.5, unit: 'tablet' });
  assert.deepEqual(pick(parseDose('0.5 tablet')), { amount: 0.5, unit: 'tablet' });
  assert.deepEqual(pick(parseDose('.5 tablet')), { amount: 0.5, unit: 'tablet' });
  assert.deepEqual(pick(parseDose('1 1/2 tablets')), { amount: 1.5, unit: 'tablet' });
  assert.deepEqual(pick(parseDose('0,5 ml')), { amount: 0.5, unit: 'ml' }, 'comma decimal');
});

test('a trailing note is kept separate from the dose', () => {
  const p = parseDose('1 tablet at night');
  assert.equal(p.amount, 1);
  assert.equal(p.unit, 'tablet');
  assert.equal(p.trailing, 'at night');
});

test('unreadable free text is refused, not guessed', () => {
  // The medicine actually saved as "dafs" in production data.
  for (const junk of ['dafs', '', '   ', 'as directed', 'take one', '???']) {
    const p = parseDose(junk);
    assert.equal(p.parsed, false, `${JSON.stringify(junk)} must not parse`);
    assert.equal(p.amount, null);
    assert.equal(p.unit, null);
  }
});

test('migrateDose leaves unreadable text alone', () => {
  assert.equal(migrateDose('dafs'), null, 'null means "do not touch this row"');
  assert.equal(migrateDose(''), null);
  const ok = migrateDose('1 tablet');
  assert.equal(ok.dose_amount, 1);
  assert.equal(ok.dose_unit, 'tablet');
  assert.equal(ok.rebuilt, '1 tablet');
});

test('a bare number keeps the number and admits it has no unit', () => {
  const p = parseDose('2');
  assert.equal(p.parsed, true);
  assert.equal(p.amount, 2);
  assert.equal(p.unit, null, 'no unit invented');
  // And migrating it does not fabricate one either.
  assert.equal(migrateDose('2').dose_unit, null);
  assert.equal(migrateDose('2').rebuilt, '2');
});

test('a number with an unknown word becomes "other", keeping the word', () => {
  const p = parseDose('1 scoop');
  assert.equal(p.unit, 'other');
  assert.equal(p.otherText, 'scoop');
});

test('mcg is a real unit now; grams still round-trip as their own word', () => {
  const p = parseDose('50 mcg');
  assert.equal(p.amount, 50);
  assert.equal(p.unit, 'mcg');
  assert.equal(buildDoseString(p.amount, p.unit, p.otherText), '50 mcg');
  const g = parseDose('2 g');
  assert.equal(g.unit, 'other');
  assert.equal(buildDoseString(g.amount, g.unit, g.otherText), '2 g');
});

test('stored doses are parsed exactly — the old parser floored and snapped them', () => {
  assert.equal(parseDose('2.75 mg').amount, 2.75);
  assert.equal(parseDose('0.1 ml').amount, 0.1);
  assert.equal(parseDose('0.125 mg').amount, 0.125);
  assert.equal(parseDose('-1 ml').parsed, false, 'a negative stored dose is unreadable, not 1/2');
  assert.equal(parseDose('0 ml').parsed, false);
});

test('a teaspoon is not silently turned into mL', () => {
  const p = parseDose('1 tsp');
  assert.equal(p.unit, 'other');
  assert.equal(p.otherText, 'tsp');
});

test('every stored dose round-trips through the wizard unchanged', () => {
  for (const s of ['2.75 mg', '0.1 mL', '0.125 mg', '1/2 tablet', '1 1/2 tablets', '50 mcg', '1000 IU', '2 puffs']) {
    const p = parseDose(s);
    assert.equal(buildDoseString(p.amount, p.unit, p.otherText), s, s);
  }
});

test('build and parse round-trip for every offered unit', () => {
  for (const unit of UNIT_IDS) {
    if (unit === 'other') continue;
    const s = buildDoseString(2, unit);
    const back = parseDose(s);
    assert.equal(back.parsed, true, `${s} should parse`);
    assert.equal(back.amount, 2, `${s} amount`);
    assert.equal(back.unit, unit, `${s} unit`);
  }
});

function pick(p) { return { amount: p.amount, unit: p.unit }; }
