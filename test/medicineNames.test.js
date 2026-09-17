import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchMedicineNames, MEDICINE_NAMES } from '../src/lib/medicineNames.js';

test('the list is a decent size and has no duplicates', () => {
  assert.ok(MEDICINE_NAMES.length > 150, `only ${MEDICINE_NAMES.length} names`);
  const lower = MEDICINE_NAMES.map((n) => n.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, 'duplicate entries');
});

test('an empty query offers the person their own medicines first', () => {
  const out = searchMedicineNames('', ['Ramipril', 'Vitamin D']);
  assert.deepEqual(out.map((o) => o.name), ['Ramipril', 'Vitamin D']);
  assert.ok(out.every((o) => o.source === 'recent'));
  assert.deepEqual(searchMedicineNames(''), [], 'nothing to suggest yet');
});

test('a prefix match beats a match in the middle of a word', () => {
  const names = searchMedicineNames('met').map((o) => o.name);
  assert.ok(names.some((n) => n.startsWith('Metformin')), 'Metformin missing');
  const metformin = names.findIndex((n) => n.startsWith('Metformin'));
  const acet = names.findIndex((n) => n.startsWith('Acetaminophen'));
  if (acet !== -1) assert.ok(metformin < acet, 'Metformin should rank above Acetaminophen');
});

test('a brand name in brackets is findable', () => {
  const names = searchMedicineNames('lipitor').map((o) => o.name);
  assert.ok(names.some((n) => n.includes('Lipitor')));
  assert.ok(searchMedicineNames('ventolin').length > 0);
});

test("the person's own medicines outrank the bundled list", () => {
  const out = searchMedicineNames('vitamin d', ['Vitamin D3 custom']);
  assert.equal(out[0].source, 'recent');
});

test('search is case-insensitive and tolerant of stray spaces', () => {
  assert.ok(searchMedicineNames('  RAMIPRIL ').length > 0);
});

test('a name already on the list is not offered twice', () => {
  const out = searchMedicineNames('ramipril', ['Ramipril']);
  assert.equal(out.filter((o) => o.name.toLowerCase() === 'ramipril').length, 1);
});

test('nonsense returns nothing rather than a wrong guess', () => {
  assert.deepEqual(searchMedicineNames('zzzzqqq'), []);
});

test('the limit is respected', () => {
  assert.ok(searchMedicineNames('a', [], 5).length <= 5);
});
