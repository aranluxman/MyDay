import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medIcon, medKind, MED_KINDS } from '../src/lib/medIcon.js';
import { MEDICINE_NAMES } from '../src/lib/medicineNames.js';

const icon = (name, extra = {}) => medIcon({ name, dose: '1 tablet', ...extra });

test('categories come from the name', () => {
  assert.equal(icon('Vitamin D'), 'leaf');
  assert.equal(icon('Omega-3'), 'leaf');
  assert.equal(icon('Candesartan'), 'heart');
  assert.equal(icon('Ezetimibe'), 'heart');
  assert.equal(icon('Atorvastatin (Lipitor)'), 'heart');
  assert.equal(icon('Lipitor'), 'heart', 'the brand name works too');
  assert.equal(icon('Aspirin (ASA)'), 'droplet');
  assert.equal(icon('Metformin'), 'cube');
  assert.equal(icon('Acetaminophen (Tylenol)'), 'bolt');
  assert.equal(icon('Amoxicillin'), 'shield');
  assert.equal(icon('Sertraline (Zoloft)'), 'moon');
  assert.equal(icon('Levothyroxine (Synthroid)'), 'flask');
});

test('matching is case-insensitive and tolerates extra words', () => {
  assert.equal(icon('candesartan 8mg'), 'heart');
  assert.equal(icon('VITAMIN B12 1000mcg'), 'leaf');
});

test('the longest, word-start match wins', () => {
  assert.equal(icon('Spironolactone'), 'heart', "'iron' inside the word must not make it a vitamin");
  assert.equal(icon('Calcium carbonate (Tums)'), 'stomach', 'beats plain calcium');
  assert.equal(icon('Calcium'), 'leaf');
});

test('unknown names fall back on drug-name endings', () => {
  assert.equal(icon('Fosinopril'), 'heart');
  assert.equal(icon('Olmesartan'), 'heart');
  assert.equal(icon('Erythromycin'), 'shield');
});

test('the form wins over the category', () => {
  assert.equal(medIcon({ name: 'Insulin glargine (Lantus)', dose_unit: 'injection' }), 'syringe');
  assert.equal(medIcon({ name: 'Insulin glargine (Lantus)', dose: '10 units' }), 'syringe', 'insulin is always injected');
  assert.equal(medIcon({ name: 'Salbutamol (Ventolin)', dose_unit: 'puff' }), 'inhaler');
  assert.equal(medIcon({ name: 'Something new', dose: '2 puffs' }), 'inhaler', 'read from the dose string');
  assert.equal(medIcon({ name: 'Timolol eye drops', dose: '1 drop' }), 'dropper');
  assert.equal(medIcon({ name: 'Fentanyl patch', dose: '1 patch' }), 'bandage');
  assert.equal(medIcon({ name: 'Hydrocortisone cream' }), 'tube');
  assert.equal(medIcon({ name: 'Lactulose', dose_unit: 'ml', dose: '15 ml' }), 'bottle');
});

test('anything unknown is a tablet or capsule', () => {
  assert.equal(medIcon({ name: 'Mystery', dose: '1 tablet' }), 'pill');
  assert.equal(medIcon({ name: 'Mystery', dose_unit: 'capsule' }), 'capsule');
  assert.equal(medIcon({ name: 'Mystery', dose: '2 capsules' }), 'capsule');
  assert.equal(medIcon({}), 'pill');
  assert.equal(medIcon(null), 'pill');
});

test('every name in the autocomplete list gets a known kind', () => {
  for (const name of MEDICINE_NAMES) {
    assert.ok(MED_KINDS[medKind({ name })], name);
    assert.notEqual(medKind({ name }), 'tablet', `${name} should have a category`);
  }
});
