// Notification rules.
//
// The in-app reminders were fine; what was missing was OS-level notifications
// that arrive when the app is closed, and any way for the person to control
// them. This module owns the decisions — should this notification be sent at
// all, when, and has it already gone out — as pure functions, because the same
// rules run in three places: the browser (local fallback notifications), the
// service worker, and the Edge Function that sends web push.
//
// Everything here is deliberately conservative in one direction: a missed-dose
// alert is safety-critical, so it overrides quiet hours and is never
// suppressed by de-duplication across devices unless the exact same alert has
// already been delivered.

export const NOTIFICATION_TYPES = [
  { id: 'dose_due', label: 'Dose reminders', desc: 'When it is time to take a medicine.', critical: false },
  { id: 'dose_missed', label: 'Missed-dose alerts', desc: 'If a dose has not been marked as taken.', critical: true },
  { id: 'appointment', label: 'Appointment reminders', desc: 'Before a doctor or clinic visit.', critical: false },
  { id: 'daily_summary', label: 'Daily summary', desc: 'One message about your whole day.', critical: false },
  { id: 'game_nudge', label: 'Brain game nudge', desc: 'A gentle reminder to play once a day.', critical: false },
  { id: 'guardian_alert', label: 'Guardian alerts', desc: 'Alerts sent to the family you have connected.', critical: true },
];

export const CRITICAL_TYPES = NOTIFICATION_TYPES.filter((t) => t.critical).map((t) => t.id);

export const APPOINTMENT_LEADS = [
  { id: '1d', minutes: 1440, label: '1 day before' },
  { id: '2h', minutes: 120, label: '2 hours before' },
  { id: '30m', minutes: 30, label: '30 minutes before' },
];

export const SNOOZE_CHOICES = [5, 10, 15, 30];
export const REPEAT_EVERY_CHOICES = [0, 5, 10, 15, 30];
export const REPEAT_TIMES_CHOICES = [1, 2, 3, 5];

export const PREF_DEFAULTS = {
  master: true,
  dose_due: true,
  dose_missed: true,
  appointment: true,
  daily_summary: false,
  game_nudge: false,
  guardian_alert: true,

  appointment_lead_minutes: 120,
  daily_summary_at: '09:00',

  // Repeat a dose reminder every N minutes, up to M times, until it is marked
  // taken. 0 means do not repeat.
  repeat_every_minutes: 0,
  repeat_max_times: 2,
  snooze_minutes: 15,

  quiet_hours_enabled: false,
  quiet_from: '21:00',
  quiet_to: '07:00',

  sound: true,
  vibrate: true,
};

const MINUTE = 60_000;

/** 'HH:MM' -> minutes since midnight, or null. */
export function minutesOfDay(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Is `hhmm` inside the quiet window?
 *
 * Quiet hours normally wrap past midnight (21:00 to 07:00), which a naive
 * from <= t <= to comparison gets exactly backwards.
 */
export function inQuietHours(hhmm, from, to) {
  const t = minutesOfDay(hhmm);
  const a = minutesOfDay(from);
  const b = minutesOfDay(to);
  if (t == null || a == null || b == null) return false;
  if (a === b) return false;          // a zero-length window is not "always"
  if (a < b) return t >= a && t < b;  // same-day window
  return t >= a || t < b;             // wraps midnight
}

/** 'HH:MM' for a Date in a timezone — the person's local wall clock. */
export function localHHMM(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
}

/**
 * The single decision: may this notification be delivered?
 *
 * @param n      { type, doseStatus?, at? }  at = when it would be delivered
 * @param prefs  merged preferences
 * @param ctx    { now, timezone }
 * @returns { send: boolean, reason: string }
 */
export function shouldSend(n, prefs = {}, ctx = {}) {
  const p = { ...PREF_DEFAULTS, ...prefs };
  const type = n?.type;

  if (!type) return no('no type');
  if (!NOTIFICATION_TYPES.some((t) => t.id === type)) return no('unknown type');

  // Master off means off, including the critical ones. Turning off all
  // notifications has to actually do that, or the switch is a lie — the Home
  // screen says so in plain words instead.
  if (!p.master) return no('all notifications are off');
  if (p[type] === false) return no(`${type} is off`);

  // A dose already marked taken must never produce a reminder, on any device.
  if ((type === 'dose_due' || type === 'dose_missed') && n.doseStatus === 'taken') {
    return no('dose already taken');
  }

  if (p.quiet_hours_enabled) {
    const at = n.at ? new Date(n.at) : new Date(ctx.now ?? Date.now());
    const hhmm = localHHMM(at, ctx.timezone);
    if (inQuietHours(hhmm, p.quiet_from, p.quiet_to)) {
      // A missed dose is the one thing worth waking someone for.
      if (!CRITICAL_TYPES.includes(type)) return no('quiet hours');
    }
  }

  return { send: true, reason: 'ok' };
}
const no = (reason) => ({ send: false, reason });

/**
 * When to re-fire a dose reminder that has not been marked taken.
 * Returns the delivery times after the first one, in order.
 */
export function repeatTimes(firstAt, prefs = {}) {
  const p = { ...PREF_DEFAULTS, ...prefs };
  const every = Number(p.repeat_every_minutes) || 0;
  const max = Math.max(0, Number(p.repeat_max_times) || 0);
  if (every <= 0 || max <= 0) return [];
  const base = new Date(firstAt).getTime();
  if (!Number.isFinite(base)) return [];
  return Array.from({ length: max }, (_, i) => new Date(base + (i + 1) * every * MINUTE).toISOString());
}

/** When a snoozed reminder comes back. */
export function snoozeUntil(from, prefs = {}) {
  const p = { ...PREF_DEFAULTS, ...prefs };
  const mins = SNOOZE_CHOICES.includes(Number(p.snooze_minutes)) ? Number(p.snooze_minutes) : 15;
  return new Date(new Date(from).getTime() + mins * MINUTE).toISOString();
}

/**
 * A stable identity for one notification, so the same alert is not delivered
 * twice across a phone, a tablet and an installed PWA. The attempt number is
 * part of it, otherwise a repeat would be swallowed as a duplicate.
 */
export function dedupeKey({ type, userId, refId, date, attempt = 0 }) {
  return [type, userId || '-', refId || '-', date || '-', attempt].join(':');
}

/** Has this exact notification already gone out? */
export function alreadySent(key, log = []) {
  return log.some((row) => (typeof row === 'string' ? row : row?.key) === key);
}

/**
 * Collapse a backlog built up while the device was offline.
 *
 * Coming back online after six hours must not fire eight separate reminders.
 * Anything older than `staleMinutes` is folded into one summary; anything
 * still current is delivered normally.
 */
export function collapseBacklog(pending, { now = Date.now(), staleMinutes = 60 } = {}) {
  const fresh = [];
  const stale = [];
  for (const n of pending || []) {
    const at = new Date(n.at).getTime();
    if (!Number.isFinite(at)) continue;
    (now - at > staleMinutes * MINUTE ? stale : fresh).push(n);
  }
  if (!stale.length) return { deliver: fresh, summary: null };

  // One honest line rather than a pile of reminders for times that have passed.
  const names = [...new Set(stale.map((n) => n.title || n.medicationName).filter(Boolean))];
  const summary = {
    type: 'dose_missed',
    title: 'While you were offline',
    body: stale.length === 1
      ? `You have 1 reminder you did not see${names[0] ? `: ${names[0]}` : ''}.`
      : `You have ${stale.length} reminders you did not see${names.length ? `: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : ''}.`,
    collapsed: stale.length,
  };
  return { deliver: fresh, summary };
}

/** When an appointment reminder should fire. */
export function appointmentReminderAt(appt, prefs = {}) {
  const p = { ...PREF_DEFAULTS, ...prefs };
  if (!appt?.appt_date) return null;
  // No time set means the whole day; 09:00 is a reasonable hour to be told.
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(appt.appt_time || '') ? appt.appt_time : '09:00';
  const at = new Date(`${appt.appt_date}T${time}:00`).getTime();
  if (!Number.isFinite(at)) return null;
  const lead = Number(p.appointment_lead_minutes) || 0;
  return new Date(at - lead * MINUTE).toISOString();
}

/** The notification the platform actually shows for a due dose. */
export function doseNotification(dose, { kind = 'dose_due' } = {}) {
  const med = dose?.medication || {};
  const name = med.name || 'your medicine';
  const dosage = med.dose ? ` — ${med.dose}` : '';
  return {
    type: kind,
    title: kind === 'dose_missed' ? `Missed: ${name}` : `Time for ${name}${dosage}`,
    body: kind === 'dose_missed'
      ? `Your ${dose?.scheduled_time || ''} dose has not been marked as taken.`.trim()
      : (med.note ? med.note : 'Tap "I took it" once you have taken it.'),
    // Handled by the service worker without opening the app.
    actions: [
      { action: 'taken', title: 'I took it' },
      { action: 'snooze', title: 'Snooze 15 min' },
    ],
    data: { doseId: dose?.id, url: '/medication', kind },
  };
}

/**
 * Can this device actually deliver a notification, and if not, what should the
 * person be told? Never "it failed" with no explanation.
 *
 * @param env { supported, permission, installed, platform }
 */
export function deliveryStatus(env = {}) {
  const { supported, permission, installed, platform } = env;

  if (!supported) {
    return {
      ok: false, code: 'unsupported',
      message: 'This browser cannot show alerts.',
      fix: platform === 'ios' || platform === 'ipados'
        ? 'Open MyDay in Safari, add it to your home screen, then open it from there.'
        : 'Try Chrome, Edge or Safari, or ask a family member to receive the alerts for you.',
    };
  }
  // iOS and iPadOS refuse web push entirely until the app is on the home
  // screen. This is a platform rule, not something the page can work around.
  if ((platform === 'ios' || platform === 'ipados') && !installed) {
    return {
      ok: false, code: 'needs_install',
      message: 'Alerts need MyDay on your home screen first.',
      fix: 'Tap the Share button in Safari, choose "Add to Home Screen", then open MyDay from the new icon.',
    };
  }
  if (permission === 'denied') {
    return {
      ok: false, code: 'blocked',
      message: 'Alerts are blocked for MyDay.',
      fix: platform === 'ios' || platform === 'ipados'
        ? 'Open Settings, scroll to MyDay, tap Notifications and switch them on.'
        : platform === 'android'
          ? 'Open Settings, then Apps, then MyDay, then Notifications, and switch them on.'
          : 'Click the padlock in the address bar, then allow notifications for this site.',
    };
  }
  if (permission !== 'granted') {
    return { ok: false, code: 'not_asked', message: 'Alerts are not switched on yet.', fix: 'Tap "Turn on alerts".' };
  }
  return { ok: true, code: 'ready', message: 'Alerts are on for this device.', fix: null };
}
