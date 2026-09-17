// Dose building and parsing. The parser is what migrates the free-text doses
// already in the database, so its refusals matter as much as its successes:
// guessing someone's dose is worse than admitting we cannot read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDoseString, parseDose, migrateDose, clampAmount, formatAmount, UNIT_IDS,
} from '../src/lib/doseUnits.js';

test('the unit chips include everything the flow promises', () => {
  for (const u of ['tablet', 'capsule', 'ml', 'drop', 'puff', 'mg', 'IU', 'unit', 'patch', 'sachet', 'injection', 'other']) {
    assert.ok(UNIT_IDS.includes(u), `${u} missing`);
  }
});

test('amounts clamp and snap to halves', () => {
  assert.equal(clampAmount(1), 1);
  assert.equal(clampAmount(0.5), 0.5);
  assert.equal(clampAmount(0.7), 0.5, 'snaps to the nearest half');
  assert.equal(clampAmount(0), 0.5, 'never zero');
  assert.equal(clampAmount(-3), 0.5);
  assert.equal(clampAmount(99999), 9999);
  assert.equal(clampAmount('abc'), 1, 'falls back to one');
});

test('amounts read as fractions where that is natural', () => {
  assert.equal(formatAmount(0.5), '1/2');
  assert.equal(formatAmount(1), '1');
  assert.equal(formatAmount(1.5), '1 1/2');
  assert.equal(formatAmount(2), '2');
  assert.equal(formatAmount(1000), '1000');
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
  assert.equal(buildDoseString(5, 'ml'), '5 ml');
  assert.equal(buildDoseString(1000, 'IU'), '1000 IU');
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

test('units understood but not offered as chips round-trip as themselves', () => {
  const p = parseDose('50 mcg');
  assert.equal(p.amount, 50);
  assert.equal(p.unit, 'other');
  assert.equal(p.otherText, 'mcg');
  assert.equal(buildDoseString(p.amount, p.unit, p.otherText), '50 mcg');
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
