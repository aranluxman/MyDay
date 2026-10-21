import test from 'node:test';
import assert from 'node:assert/strict';
import { aiFailure, CHAT_UNAVAILABLE } from '../src/lib/aiErrors.js';
import { clinicalRequest, safeChatResult, CHAT_BOUNDARY } from '../supabase/functions/_shared/chatSafety.js';
import { blankMedicineForm, meaningfulMedicineDraft } from '../src/lib/medicineDraft.js';
import { readMedicineBatch, writeMedicineBatch } from '../src/lib/medicineBatch.js';
import { describeDevice } from '../src/lib/readiness.js';

test('configuration and permanent failures hide provider strings and have no retry', () => {
  for (const failure of [
    { status: 503, code: 'ai_unavailable', retryable: false },
    { status: 503, error: 'missing OPENAI_API_KEY' },
    { status: 401, error: 'JWT expired' },
    { status: 502, retryable: false, code: 'ai_refusal' },
  ]) assert.deepEqual(aiFailure(failure), { message: CHAT_UNAVAILABLE, retryable: false });
});

test('temporary network, rate-limit and service failures permit retry', () => {
  for (const status of [0, 408, 429, 500, 502, 503, 504]) {
    assert.deepEqual(aiFailure({ status }), { message: CHAT_UNAVAILABLE, retryable: true });
  }
});

test('clinical requests and unsafe generated replies/suggestions use the boundary', () => {
  for (const text of ['Diagnose me', 'Prescribe something', 'Should I double my dose?', 'What dosage should I take?', 'Can I stop my medicine?', 'How many pills should I take?']) {
    assert.equal(clinicalRequest(text), true, text);
  }
  assert.equal(clinicalRequest('Help me describe my day'), false);
  for (const reply of ['You probably have diabetes.', 'My diagnosis is diabetes.', 'I prescribe metformin.', 'Take 2 tablets tonight.', 'Increase your dose to 5 mg.', 'These medicines are safe together.']) {
    assert.equal(safeChatResult({ reply, suggestions: [], urgent: false }).reply, CHAT_BOUNDARY, reply);
  }
  assert.equal(safeChatResult({ reply: 'Thanks for recording that.', suggestions: ['Should I take more?'] }).reply, CHAT_BOUNDARY);
  assert.equal(safeChatResult({ reply: 'Take another dose.', urgent: true }).urgent, true);
  assert.equal(safeChatResult({ reply: 'What would you like to add to your note?', suggestions: [] }).reply, 'What would you like to add to your note?');
});

test('defaults, whitespace and navigation alone are not meaningful drafts', () => {
  assert.equal(meaningfulMedicineDraft(null), false);
  assert.equal(meaningfulMedicineDraft(blankMedicineForm()), false);
  assert.equal(meaningfulMedicineDraft({ ...blankMedicineForm(), name: '  ', dose_amount: 1 }), false);
  for (const change of [{ name: 'Vitamin D' }, { dose_amount: '0.5' }, { times: ['09:00'] }, { note: 'Ask pharmacy' }, { photo_path: 'photo.webp' }]) {
    assert.equal(meaningfulMedicineDraft({ ...blankMedicineForm(), ...change }), true);
  }
});

test('opening/closing an empty batch cannot leave an unfinished draft or block review', () => {
  const before = globalThis.localStorage;
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  try {
    writeMedicineBatch('user', { items: [], working: { form: blankMedicineForm(), step: 0, index: null } });
    assert.equal(data.size, 0);
    // Also clean up an empty draft persisted by an older app version.
    data.set('myday_med_batch:user', JSON.stringify({ items: [], working: { form: blankMedicineForm(), step: 4 } }));
    assert.deepEqual(readMedicineBatch('user'), { items: [], working: null });
    writeMedicineBatch('user', { items: [], working: { form: { ...blankMedicineForm(), name: 'Medicine' }, step: 1 } });
    assert.equal(readMedicineBatch('user').working.form.name, 'Medicine');
  } finally { globalThis.localStorage = before; }
});

test('relative device nicknames never claim this browser without an endpoint match', () => {
  for (const label of ['This phone', ' This phone ', 'THIS DEVICE', 'This browser']) {
    const device = describeDevice({ label, platform: 'android', endpoint: 'other' }, { myEndpoint: 'mine' });
    assert.equal(device.current, false);
    assert.equal(device.name, 'Android device');
  }
});

import { dosingRequest, safeMedicineResult, MEDICINE_BOUNDARY, MEDICINE_DISCLAIMER } from '../supabase/functions/_shared/chatSafety.js';
import { normaliseMedicineReply } from '../src/lib/aiParse.js';

test('medicine questions: understanding is allowed, dosing decisions are redirected', () => {
  for (const q of ['Should I take my metformin twice?', 'How many tablets should I take?', 'I forgot my dose, what now?', 'Can I stop the vitamin D?']) {
    assert.equal(dosingRequest(q), true, q);
  }
  for (const q of ['What is each one for?', 'Do any of these work together?', 'Why take some with food?', 'What should I ask my pharmacist?']) {
    assert.equal(dosingRequest(q), false, q);
  }
});

test('a medicine reply never says a combination is safe or gives a dose instruction', () => {
  const ok = safeMedicineResult({ reply: 'Metformin helps lower blood sugar. Many people take it with meals.', suggestions: ['Why with food?', 'Should I double it?'] });
  assert.match(ok.reply, /blood sugar/);
  assert.deepEqual(ok.suggestions, ['Why with food?']);
  assert.equal(ok.disclaimer, MEDICINE_DISCLAIMER);
  for (const bad of ['It is safe to take these together.', 'There are no interactions between them.', 'You should stop the vitamin D.']) {
    assert.equal(safeMedicineResult({ reply: bad }).reply, MEDICINE_BOUNDARY, bad);
  }
  const shown = normaliseMedicineReply({ reply: 'You should take an extra dose.', suggestions: [] });
  assert.equal(shown.reply, MEDICINE_BOUNDARY);
  assert.equal(normaliseMedicineReply(null).disclaimer, MEDICINE_DISCLAIMER);
});
