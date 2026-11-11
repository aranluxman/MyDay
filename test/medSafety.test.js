import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAFETY_SOURCES, SAFETY_CHECKS, runSafetyCheck, statusWords, sourceFor, medicineLine } from '../src/lib/medSafety.js';

const MEDS = [{ name: 'Synthetic A', active: true }, { name: 'Synthetic B', active: true }];
const ALL_CLEAR = /\b(safe|no interactions|all clear|nothing found|no problems)\b/i;

test('no clinical source is connected, and the app says so for every check', async () => {
  for (const c of SAFETY_CHECKS) {
    assert.equal(SAFETY_SOURCES[c.id], null, `${c.id} must stay unconnected until a verified source is wired in`);
    const r = await runSafetyCheck(c.id, MEDS);
    assert.deepEqual(r, { state: 'not_connected' });
    const words = statusWords(r);
    assert.match(words.label, /Not checked/);
    assert.doesNotMatch(words.label, ALL_CLEAR);
  }
});

test('no status label can be read as an all-clear', () => {
  for (const state of ['not_connected', 'checked', 'nothing_to_check', 'error', undefined]) {
    assert.doesNotMatch(statusWords({ state }).label, ALL_CLEAR);
  }
});

test('a half-configured source counts as not connected', async () => {
  assert.equal(sourceFor('interactions', { interactions: { name: 'X' } }), null);
  assert.equal(sourceFor('interactions', { interactions: { name: 'X', updated: '2026-01-01' } }), null);
  assert.deepEqual(await runSafetyCheck('interactions', MEDS, { interactions: { name: 'X', run: async () => [] } }), { state: 'not_connected' });
});

test('a connected source reports its name and data date; failures are never a clean result', async () => {
  const ok = { interactions: { name: 'Synthetic Source', updated: '2026-10-01', run: async () => [{ pair: ['Synthetic A', 'Synthetic B'], text: 'x' }] } };
  const r = await runSafetyCheck('interactions', MEDS, ok);
  assert.equal(r.state, 'checked');
  assert.equal(r.source, 'Synthetic Source');
  assert.equal(r.updated, '2026-10-01');
  assert.equal(r.findings.length, 1);
  const broken = { interactions: { name: 'S', updated: '2026-10-01', run: async () => { throw new Error('down'); } } };
  assert.equal((await runSafetyCheck('interactions', MEDS, broken)).state, 'error');
  const odd = { interactions: { name: 'S', updated: '2026-10-01', run: async () => 'fine' } };
  assert.equal((await runSafetyCheck('interactions', MEDS, odd)).state, 'error');
  // One medicine cannot interact with itself: nothing to check, not "none found".
  assert.equal((await runSafetyCheck('interactions', [MEDS[0]], ok)).state, 'nothing_to_check');
  assert.equal((await runSafetyCheck('interactions', [{ name: 'Old', active: false }, MEDS[0]], ok)).state, 'nothing_to_check');
});

test('a medicine line for the pharmacist uses only what was entered', () => {
  assert.deepEqual(medicineLine({ name: ' Synthetic A ', strength: '500 mg', dose: '1 tablet', times: ['08:00', '20:00'] }, (t) => `at ${t}`),
    { name: 'Synthetic A', strength: '500 mg', amount: '1 tablet', when: 'at 08:00, at 20:00', instructions: null });
  assert.equal(medicineLine({ name: 'B', frequency: 'as_needed', times: [] }).when, 'Only when needed');
  assert.equal(medicineLine({ name: 'C', times: [] }).when, 'No times set');
});
