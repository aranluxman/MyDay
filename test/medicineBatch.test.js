import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMedicines } from '../src/lib/medicineList.js';
import { saveMedicationsBulk } from '../src/lib/db.js';
import { readMedicineBatch, writeMedicineBatch, clearMedicineBatch } from '../src/lib/medicineBatch.js';

const form = (name) => ({
  name, dose_amount: 1, dose_unit: 'tablet', dose_other: '',
  times: ['08:00'], frequency: 'daily', days_of_week: [],
  start_date: '', end_date: '', with_food: false, note: '', color: '#2563a8', photo_path: null,
});

test('search and sorting keep a long list easy to scan without changing the source', () => {
  const meds = Array.from({ length: 60 }, (_, i) => ({
    id: i, name: `Medicine ${String(59 - i).padStart(2, '0')}`,
    times: [i % 2 ? '20:00' : '08:00'], created_at: `2026-09-${String(i % 28 + 1).padStart(2, '0')}`,
  }));
  assert.equal(selectMedicines([], '').length, 0);
  assert.equal(selectMedicines(meds, '').length, 60);
  assert.equal(selectMedicines(meds, ' MEDICINE 05 ').length, 1);
  assert.equal(selectMedicines(meds, '', 'name')[0].name, 'Medicine 00');
  assert.equal(selectMedicines(meds, '', 'time')[0].times[0], '08:00');
  assert.equal(selectMedicines(meds, '', 'newest')[0].created_at, '2026-09-28');
  assert.equal(meds[0].name, 'Medicine 59');
});

test('a mixed reviewed batch is sent once with stable IDs and matching fields', async () => {
  let calls = 0;
  const client = { from(table) {
    assert.equal(table, 'myday_medications');
    return { async upsert(rows, options) {
      calls++;
      assert.deepEqual(options, { onConflict: 'id', ignoreDuplicates: true });
      assert.deepEqual(rows.map((row) => row.id), ['hand-1', 'photo-2']);
      assert.deepEqual(rows.map((row) => row.name), ['Vitamin D', 'Aspirin']);
      assert.equal(rows[1].photo_path, 'private/photo.webp');
      return { error: null };
    } };
  } };
  const result = await saveMedicationsBulk([
    { id: 'hand-1', form: form(' Vitamin D ') },
    { id: 'photo-2', form: { ...form('Aspirin'), photo_path: 'private/photo.webp' } },
  ], client);
  assert.equal(result, 2);
  assert.equal(calls, 1);
});

test('an invalid reviewed medicine stops the batch before any database request', async () => {
  let calls = 0;
  const client = { from() { calls++; throw new Error('should not reach database'); } };
  await assert.rejects(saveMedicationsBulk([
    { id: 'a', form: form('Valid') }, { id: 'b', form: form('  ') },
  ], client), /called|medicine/i);
  assert.equal(calls, 0);
});

test('a server error leaves the batch to retry with the same IDs', async () => {
  const items = [{ id: 'same-id', form: form('Vitamin D') }];
  const client = { from() { return { async upsert() { return { error: new Error('Connection lost') }; } }; } };
  await assert.rejects(saveMedicationsBulk(items, client), /Connection lost/);
  assert.equal(items[0].id, 'same-id');
});

test('unfinished review is stored separately for each signed-in user', () => {
  const data = new Map();
  const before = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  try {
    const batch = { items: [{ id: 'a', form: form('Vitamin D') }], working: { form: form('Calcium'), step: 2 } };
    writeMedicineBatch('user-a', batch);
    assert.deepEqual(readMedicineBatch('user-a'), batch);
    assert.deepEqual(readMedicineBatch('user-b'), { items: [], working: null });
    clearMedicineBatch('user-a');
    assert.deepEqual(readMedicineBatch('user-a'), { items: [], working: null });
  } finally {
    globalThis.localStorage = before;
  }
});
