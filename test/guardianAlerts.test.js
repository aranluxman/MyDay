import test from 'node:test';
import assert from 'node:assert/strict';
import { guardianAlertDue, guardianDeliveryKey } from '../supabase/functions/_shared/guardianAlerts.js';

const dose = { id: 'am', due_at: '2026-10-07T12:00:00Z', status: 'pending' };
const timezone = 'America/Toronto';
for (const delay of [15, 30, 45, 60]) {
  test(`guardian alerts start ${delay} minutes after the dose, independently of missed status`, () => {
    const device = { alert_mode: 'delay', alert_delay_minutes: delay };
    const at = Date.parse(dose.due_at) + delay * 60_000;
    assert.equal(guardianAlertDue(dose, device, { now: at - 1 }), false);
    assert.equal(guardianAlertDue(dose, device, { now: at }), true);
    for (const status of ['taken', 'skipped']) assert.equal(guardianAlertDue({ ...dose, status }, device, { now: at + 86400000 }), false);
    assert.equal(guardianAlertDue({ ...dose, taken_at: dose.due_at }, device, { now: at }), false);
    assert.equal(guardianAlertDue({ ...dose, medication: { reminders_enabled: false } }, device, { now: at }), false);
  });
}
test('set-time alerts check only due, untaken doses in the patient timezone', () => {
  const device = { alert_mode: 'time', alert_at: '19:00' };
  assert.equal(guardianAlertDue(dose, device, { timezone, now: Date.parse('2026-10-07T22:59:00Z') }), false);
  assert.equal(guardianAlertDue(dose, device, { timezone, now: Date.parse('2026-10-07T23:00:00Z') }), true);
  const evening = { ...dose, due_at: '2026-10-08T00:00:00Z' }; // 8 PM
  assert.equal(guardianAlertDue(evening, device, { timezone, now: Date.parse('2026-10-08T01:00:00Z') }), false);
  assert.equal(guardianAlertDue(evening, device, { timezone, now: Date.parse('2026-10-08T23:00:00Z') }), true);
});
test('set-time checks follow daylight saving changes', () => {
  const beforeFallback = { ...dose, due_at: '2026-11-01T02:00:00Z' }; // Oct 31, 10 PM
  const device = { alert_mode: 'time', alert_at: '09:00' };
  assert.equal(guardianAlertDue(beforeFallback, device, { timezone, now: Date.parse('2026-11-01T13:59:00Z') }), false);
  assert.equal(guardianAlertDue(beforeFallback, device, { timezone, now: Date.parse('2026-11-01T14:00:00Z') }), true);
});
test('each guardian device and each morning/evening dose have independent identities', () => {
  assert.notEqual(guardianDeliveryKey('phone', 'am'), guardianDeliveryKey('phone', 'pm'));
  assert.notEqual(guardianDeliveryKey('phone', 'am'), guardianDeliveryKey('tablet', 'am'));
});
