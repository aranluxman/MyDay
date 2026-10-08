import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { guardianAlertDue, guardianDeliveryKey } from '../supabase/functions/_shared/guardianAlerts.js';
import * as rules from '../supabase/functions/_shared/notificationRules.js';
import { shouldSend } from '../supabase/functions/_shared/notificationRules.js';

// Run the actual Edge Function handler against an in-memory database and push
// transport. No real subscriptions or patient data are used.
const source = (await readFile(new URL('../supabase/functions/missed-dose-check/index.ts', import.meta.url), 'utf8'))
  .replace(/^import .*?;\n/gm, '');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
function setup(handlerCode = code) {
  const now = Date.now();
  const db = {
    myday_push_config: [{ id: 1, vapid_public: 'test', vapid_private: 'test', contact: 'mailto:test@example.test' }],
    myday_doses: [{ id: 'morning', user_id: 'patient', status: 'pending', due_at: new Date(now - 30 * 60_000).toISOString(), scheduled_time: '08:00', taken_at: null, medication: { name: 'Test medicine', active: true, reminders_enabled: true } }],
    myday_profiles: [{ user_id: 'patient', full_name: 'Synthetic person', timezone: 'UTC' }],
    myday_notification_prefs: [], myday_family_devices: [],
    myday_guardians: [{ id: 'connection', user_id: 'patient', status: 'active' }],
    myday_guardian_devices: [{ id: 'guardian-phone', guardian_id: 'connection', push_enabled: true, revoked_at: null, subscription: { endpoint: 'https://push.example.test' }, alert_mode: 'delay', alert_delay_minutes: 15 }],
    myday_notification_log: [],
  };
  let responseStatus = 201;
  const sent = [];
  let beforeRecheck = null;
  function from(table) {
    const predicates = [];
    let operation = 'select', values, single = false;
    const query = {
      select() { return query; }, order() { return query; }, maybeSingle() { single = true; return query; },
      eq(key, value) { predicates.push(row => row[key] === value); return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
      is(key, value) { predicates.push(row => (row[key] ?? null) === value); return query; },
      not(key, op, value) { predicates.push(row => (row[key] ?? null) !== value); return query; },
      gte(key, value) { predicates.push(row => row[key] >= value); return query; },
      lte(key, value) { predicates.push(row => row[key] <= value); return query; },
      lt(key, value) { predicates.push(row => row[key] < value); return query; },
      insert(value) { operation = 'insert'; values = value; return query; },
      update(value) { operation = 'update'; values = value; return query; },
      delete() { operation = 'delete'; return query; },
      then(resolve, reject) {
        if (table === 'myday_doses' && predicates.length === 3 && beforeRecheck) beforeRecheck();
        const list = db[table] || [];
        const matching = list.filter(row => predicates.every(p => p(row)));
        let error = null;
        if (operation === 'insert') {
          if (values.key && list.some(row => row.key === values.key)) error = { code: '23505' };
          else list.push({ delivered_at: new Date().toISOString(), ...values });
        } else if (operation === 'update') matching.forEach(row => Object.assign(row, values));
        else if (operation === 'delete') db[table] = list.filter(row => !matching.includes(row));
        return Promise.resolve({ data: single ? matching[0] : matching, error }).then(resolve, reject);
      },
    };
    return query;
  }
  const admin = { from, rpc: async () => ({ error: null }) };
  let handler;
  const Deno = { env: { get: () => 'test' }, serve: fn => { handler = fn; } };
  new Function('createClient', 'sendPush', 'guardianAlertDue', 'guardianDeliveryKey', 'shouldSend', 'Deno', 'dedupeKey', 'localHHMM', 'appointmentReminderAt', 'PREF_DEFAULTS', handlerCode)(
    () => admin,
    async (subscription, payload) => { sent.push({ subscription, payload }); return responseStatus; },
    guardianAlertDue, guardianDeliveryKey, shouldSend, Deno, rules.dedupeKey, rules.localHHMM, rules.appointmentReminderAt, rules.PREF_DEFAULTS,
  );
  return {
    db, sent,
    status: value => { responseStatus = value; },
    beforeRecheck: fn => { beforeRecheck = fn; },
    run: async () => (await handler(new Request('https://example.test', { method: 'POST', body: '{}' }))).json(),
  };
}

test('guardian receives a pending dose after their delay with no patient device, once', async () => {
  const s = setup();
  assert.equal((await s.run()).delivered, 1);
  assert.equal(s.sent[0].payload.url, '/guardian');
  assert.equal((await s.run()).delivered, 0);
  assert.equal(s.sent.length, 1);
});
test('failed guardian deliveries retry and successful retries are not repeated', async () => {
  const s = setup(); s.status(503);
  assert.equal((await s.run()).delivered, 0);
  assert.equal(s.db.myday_notification_log.length, 0);
  assert.match(s.db.myday_guardian_devices[0].last_error, /503/);
  s.status(201);
  assert.equal((await s.run()).delivered, 1);
  assert.equal(s.db.myday_guardian_devices[0].last_error, null);
  assert.equal((await s.run()).delivered, 0);
});
test('patient notification does not swallow a later guardian alert', async () => {
  const s = setup();
  s.db.myday_doses[0].status = 'missed';
  s.db.myday_doses[0].due_at = new Date(Date.now() - 70 * 60_000).toISOString();
  s.db.myday_guardian_devices[0].alert_mode = 'time';
  s.db.myday_guardian_devices[0].alert_at = '23:59';
  s.db.myday_family_devices.push({ id: 'patient-phone', user_id: 'patient', push_enabled: true, subscription: {} });
  assert.equal((await s.run()).delivered, 1);
  assert.equal(s.db.myday_doses[0].notified, true);
  s.db.myday_guardian_devices[0].alert_mode = 'delay';
  assert.equal((await s.run()).delivered, 1);
  assert.equal(s.sent[1].payload.url, '/guardian');
});
test('a dose completed while gathering recipients produces no push', async () => {
  const s = setup();
  s.beforeRecheck(() => { s.db.myday_doses[0].status = 'taken'; });
  assert.equal((await s.run()).delivered, 0);
  assert.equal(s.sent.length, 0);
  s.beforeRecheck(null);
  s.db.myday_doses[0].status = 'pending'; // A correction undid the completion.
  assert.equal((await s.run()).delivered, 1);
});

test('concurrent checks deliver once, and abandoned claims recover after their lease', async () => {
  const s = setup();
  const results = await Promise.all([s.run(), s.run()]);
  assert.equal(results.reduce((n, r) => n + r.delivered, 0), 1);
  assert.equal(s.sent.length, 1);
  const fresh = setup();
  fresh.db.myday_notification_log.push({
    key: guardianDeliveryKey('guardian-phone', 'morning'), user_id: 'patient', kind: 'guardian_missed',
    device_count: 0, delivered_at: new Date(Date.now() - 16 * 60_000).toISOString(),
  });
  assert.equal((await fresh.run()).delivered, 1);
});
test('disabled and revoked devices receive no push, and dead endpoints preserve access', async () => {
  for (const patch of [{ push_enabled: false }, { revoked_at: new Date().toISOString() }]) {
    const s = setup(); Object.assign(s.db.myday_guardian_devices[0], patch);
    assert.equal((await s.run()).delivered, 0);
    assert.equal(s.sent.length, 0);
  }
  const s = setup(); s.status(410); await s.run();
  assert.equal(s.db.myday_guardian_devices.length, 1);
  assert.equal(s.db.myday_guardian_devices[0].push_enabled, false);
  assert.equal(s.db.myday_guardian_devices[0].subscription, null);
});
test('each failed patient device can retry independently of successful devices', async () => {
  const s = setup();
  s.db.myday_guardian_devices = [];
  s.db.myday_doses[0].status = 'missed';
  s.db.myday_doses[0].due_at = new Date(Date.now() - 70 * 60_000).toISOString();
  s.db.myday_family_devices.push({ id: 'patient-phone', user_id: 'patient', push_enabled: true, subscription: {} });
  s.status(503); await s.run();
  s.db.myday_doses[0].notified = true; // Another recipient already succeeded.
  s.status(201);
  assert.equal((await s.run()).delivered, 1);
});


test('guardian daily summaries run without any subscribed patient device', async () => {
  const source = (await readFile(new URL('../supabase/functions/send-reminders/index.ts', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\n/gm, '');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  const s = setup(code);
  const device = s.db.myday_guardian_devices[0];
  device.guardian = { user_id: 'patient', status: 'active' };
  device.daily_summary_at = rules.localHHMM(new Date(), 'UTC');
  const result = await s.run();
  assert.equal(result.sent, 1);
  assert.equal(s.sent[0].payload.kind, 'guardian_alert');
});
