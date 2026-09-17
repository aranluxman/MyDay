// Notification scheduling. Two failure modes matter here and pull in opposite
// directions: a missed-dose alert that does not arrive, and a pile of stale
// reminders dumped on someone at once. Both are covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldSend, inQuietHours, minutesOfDay, repeatTimes, snoozeUntil, dedupeKey,
  alreadySent, collapseBacklog, appointmentReminderAt, doseNotification,
  deliveryStatus, PREF_DEFAULTS, CRITICAL_TYPES,
} from '../supabase/functions/_shared/notificationRules.js';

const TZ = 'America/Toronto';

test('HH:MM parsing rejects nonsense', () => {
  assert.equal(minutesOfDay('09:30'), 570);
  assert.equal(minutesOfDay('00:00'), 0);
  assert.equal(minutesOfDay('23:59'), 1439);
  for (const bad of ['24:00', '9:30', '12:60', '', null, undefined, 'abc']) {
    assert.equal(minutesOfDay(bad), null, `${JSON.stringify(bad)} should not parse`);
  }
});

test('quiet hours wrap past midnight', () => {
  // The case a naive from <= t <= to comparison gets exactly backwards.
  assert.equal(inQuietHours('22:00', '21:00', '07:00'), true);
  assert.equal(inQuietHours('03:00', '21:00', '07:00'), true);
  assert.equal(inQuietHours('06:59', '21:00', '07:00'), true);
  assert.equal(inQuietHours('07:00', '21:00', '07:00'), false, 'end is exclusive');
  assert.equal(inQuietHours('12:00', '21:00', '07:00'), false);
  assert.equal(inQuietHours('21:00', '21:00', '07:00'), true, 'start is inclusive');
});

test('quiet hours also work without wrapping', () => {
  assert.equal(inQuietHours('14:00', '13:00', '17:00'), true);
  assert.equal(inQuietHours('12:59', '13:00', '17:00'), false);
  assert.equal(inQuietHours('17:00', '13:00', '17:00'), false);
});

test('a zero-length quiet window silences nothing', () => {
  assert.equal(inQuietHours('12:00', '09:00', '09:00'), false);
});

test('master off means everything off, including critical', () => {
  for (const t of ['dose_due', 'dose_missed', 'guardian_alert']) {
    assert.equal(shouldSend({ type: t }, { master: false }).send, false, `${t} should be off`);
  }
});

test('a per-type switch turns off just that type', () => {
  assert.equal(shouldSend({ type: 'dose_due' }, { dose_due: false }).send, false);
  assert.equal(shouldSend({ type: 'dose_missed' }, { dose_due: false }).send, true);
});

test('an unknown type is never sent', () => {
  assert.equal(shouldSend({ type: 'marketing' }).send, false);
  assert.equal(shouldSend({}).send, false);
  assert.equal(shouldSend(null).send, false);
});

test('a dose already taken never produces a reminder', () => {
  // The cross-device case: another phone marked it taken a second ago.
  assert.equal(shouldSend({ type: 'dose_due', doseStatus: 'taken' }).send, false);
  assert.equal(shouldSend({ type: 'dose_missed', doseStatus: 'taken' }).send, false);
  assert.equal(shouldSend({ type: 'dose_due', doseStatus: 'pending' }).send, true);
});

test('quiet hours suppress ordinary notifications but not a missed dose', () => {
  const prefs = { quiet_hours_enabled: true, quiet_from: '21:00', quiet_to: '07:00' };
  const at = '2026-09-17T02:30:00-04:00'; // 02:30 in Toronto, inside quiet hours
  const ctx = { timezone: TZ };

  assert.equal(shouldSend({ type: 'dose_due', at }, prefs, ctx).send, false);
  assert.equal(shouldSend({ type: 'daily_summary', at }, prefs, ctx).send, false);
  assert.equal(shouldSend({ type: 'game_nudge', at }, prefs, ctx).send, false);
  // Safety-critical: these must still arrive.
  assert.equal(shouldSend({ type: 'dose_missed', at }, prefs, ctx).send, true);
  assert.equal(shouldSend({ type: 'guardian_alert', at }, prefs, ctx).send, true);
});

test('the critical list is exactly the two safety alerts', () => {
  assert.deepEqual([...CRITICAL_TYPES].sort(), ['dose_missed', 'guardian_alert']);
});

test('outside quiet hours everything enabled goes out', () => {
  const prefs = { quiet_hours_enabled: true, quiet_from: '21:00', quiet_to: '07:00', game_nudge: true };
  const at = '2026-09-17T14:00:00-04:00';
  assert.equal(shouldSend({ type: 'dose_due', at }, prefs, { timezone: TZ }).send, true);
  assert.equal(shouldSend({ type: 'game_nudge', at }, prefs, { timezone: TZ }).send, true);
});

test('quiet hours are evaluated in the person’s timezone, not UTC', () => {
  const prefs = { quiet_hours_enabled: true, quiet_from: '21:00', quiet_to: '07:00' };
  // 01:00 UTC is 21:00 the previous evening in Toronto — inside quiet hours
  // locally, outside them if you wrongly read the UTC clock.
  const at = '2026-09-18T01:00:00Z';
  assert.equal(shouldSend({ type: 'dose_due', at }, prefs, { timezone: TZ }).send, false);
});

test('repeats are off by default and bounded when on', () => {
  assert.deepEqual(repeatTimes('2026-09-17T08:00:00Z', PREF_DEFAULTS), [], 'off by default');

  const out = repeatTimes('2026-09-17T08:00:00Z', { repeat_every_minutes: 15, repeat_max_times: 3 });
  assert.deepEqual(out, [
    '2026-09-17T08:15:00.000Z',
    '2026-09-17T08:30:00.000Z',
    '2026-09-17T08:45:00.000Z',
  ]);
  assert.deepEqual(repeatTimes('2026-09-17T08:00:00Z', { repeat_every_minutes: 15, repeat_max_times: 0 }), []);
  assert.deepEqual(repeatTimes('bad-date', { repeat_every_minutes: 15, repeat_max_times: 2 }), []);
});

test('snooze uses the chosen length and falls back safely', () => {
  assert.equal(snoozeUntil('2026-09-17T08:00:00Z', { snooze_minutes: 30 }), '2026-09-17T08:30:00.000Z');
  assert.equal(snoozeUntil('2026-09-17T08:00:00Z', PREF_DEFAULTS), '2026-09-17T08:15:00.000Z');
  // A value not on the list must not become a 999-minute snooze.
  assert.equal(snoozeUntil('2026-09-17T08:00:00Z', { snooze_minutes: 999 }), '2026-09-17T08:15:00.000Z');
});

test('de-duplication is per notification and per attempt', () => {
  const a = dedupeKey({ type: 'dose_due', userId: 'u1', refId: 'd1', date: '2026-09-17' });
  const same = dedupeKey({ type: 'dose_due', userId: 'u1', refId: 'd1', date: '2026-09-17' });
  const otherDose = dedupeKey({ type: 'dose_due', userId: 'u1', refId: 'd2', date: '2026-09-17' });
  const otherUser = dedupeKey({ type: 'dose_due', userId: 'u2', refId: 'd1', date: '2026-09-17' });
  const retry = dedupeKey({ type: 'dose_due', userId: 'u1', refId: 'd1', date: '2026-09-17', attempt: 1 });

  assert.equal(a, same, 'the same alert from two devices is one key');
  assert.notEqual(a, otherDose);
  assert.notEqual(a, otherUser);
  assert.notEqual(a, retry, 'a repeat is not swallowed as a duplicate');

  assert.equal(alreadySent(a, [a]), true);
  assert.equal(alreadySent(a, [{ key: a }]), true);
  assert.equal(alreadySent(a, [otherDose]), false);
  assert.equal(alreadySent(a, []), false);
});

test('an offline backlog is collapsed into one message', () => {
  const now = Date.parse('2026-09-17T14:00:00Z');
  const ago = (h) => new Date(now - h * 3600_000).toISOString();
  const { deliver, summary } = collapseBacklog([
    { at: ago(6), title: 'Vitamin D' },
    { at: ago(4), title: 'Metformin' },
    { at: ago(2), title: 'Ramipril' },
    { at: ago(0.2), title: 'Atorvastatin' }, // still current
  ], { now });

  assert.equal(deliver.length, 1, 'only the current one is delivered on its own');
  assert.equal(deliver[0].title, 'Atorvastatin');
  assert.ok(summary, 'the stale ones become a summary');
  assert.equal(summary.collapsed, 3);
  assert.match(summary.body, /3 reminders/);
});

test('no backlog means no summary', () => {
  const now = Date.parse('2026-09-17T14:00:00Z');
  const { deliver, summary } = collapseBacklog([{ at: new Date(now - 60_000).toISOString(), title: 'X' }], { now });
  assert.equal(summary, null);
  assert.equal(deliver.length, 1);
  assert.deepEqual(collapseBacklog([], { now }), { deliver: [], summary: null });
  assert.deepEqual(collapseBacklog(null, { now }), { deliver: [], summary: null });
});

test('a single stale reminder reads in the singular', () => {
  const now = Date.parse('2026-09-17T14:00:00Z');
  const { summary } = collapseBacklog([{ at: new Date(now - 5 * 3600_000).toISOString(), title: 'Vitamin D' }], { now });
  assert.match(summary.body, /1 reminder you did not see/);
  assert.ok(!/1 reminders/.test(summary.body));
});

test('appointment reminders respect the lead time', () => {
  const appt = { appt_date: '2026-09-20', appt_time: '10:30' };
  const two = appointmentReminderAt(appt, { appointment_lead_minutes: 120 });
  assert.equal(new Date(two).getTime(), new Date('2026-09-20T10:30:00').getTime() - 120 * 60_000);

  const day = appointmentReminderAt(appt, { appointment_lead_minutes: 1440 });
  assert.equal(new Date(day).getTime(), new Date('2026-09-20T10:30:00').getTime() - 1440 * 60_000);

  // An all-day appointment still gets told about at a civilised hour.
  const allDay = appointmentReminderAt({ appt_date: '2026-09-20' }, { appointment_lead_minutes: 0 });
  assert.equal(new Date(allDay).getTime(), new Date('2026-09-20T09:00:00').getTime());

  assert.equal(appointmentReminderAt(null), null);
  assert.equal(appointmentReminderAt({}), null);
});

test('a dose notification is actionable and names the medicine', () => {
  const n = doseNotification({
    id: 'd1', scheduled_time: '08:00',
    medication: { name: 'Vitamin D', dose: '1 tablet' },
  });
  assert.match(n.title, /Vitamin D/);
  assert.match(n.title, /1 tablet/);
  assert.deepEqual(n.actions.map((a) => a.action), ['taken', 'snooze']);
  assert.equal(n.data.doseId, 'd1');

  const missed = doseNotification({ id: 'd1', scheduled_time: '08:00', medication: { name: 'Vitamin D' } },
    { kind: 'dose_missed' });
  assert.match(missed.title, /^Missed: Vitamin D/);
  assert.equal(missed.type, 'dose_missed');
});

test('delivery status explains every failure with a fix', () => {
  const unsupported = deliveryStatus({ supported: false, platform: 'desktop' });
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.fix, 'never a dead end');

  // iPadOS refuses web push until the app is installed — the case the old copy
  // described as "an iPad won't send them at all".
  const ipad = deliveryStatus({ supported: true, permission: 'default', installed: false, platform: 'ipados' });
  assert.equal(ipad.code, 'needs_install');
  assert.match(ipad.fix, /Add to Home Screen/i);

  // Installed, and it can now actually work.
  const ipadInstalled = deliveryStatus({ supported: true, permission: 'granted', installed: true, platform: 'ipados' });
  assert.equal(ipadInstalled.ok, true);

  const blocked = deliveryStatus({ supported: true, permission: 'denied', installed: true, platform: 'android' });
  assert.equal(blocked.code, 'blocked');
  assert.match(blocked.fix, /Settings/);

  const notAsked = deliveryStatus({ supported: true, permission: 'default', installed: true, platform: 'desktop' });
  assert.equal(notAsked.code, 'not_asked');

  const ready = deliveryStatus({ supported: true, permission: 'granted', installed: true, platform: 'desktop' });
  assert.equal(ready.ok, true);
});
