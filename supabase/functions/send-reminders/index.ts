// MyDay — reminder sender (cron, every 5 minutes).
//
// This is the "arrives when the app is closed" half of Part E. Deliberately
// SEPARATE from missed-dose-check: missed-dose detection and its alerts are
// safety-critical and already proven, so nothing here can delay or break them.
// This function only sends the non-critical, additive reminders:
//
//   * dose_due       — it is time to take a medicine
//   * appointment    — a visit is coming up, at the chosen lead time
//   * daily_summary  — one message about the whole day, at a chosen time
//   * guardian daily summary — the same, for a guardian who asked for one
//
// Every send passes through the same rules the client uses (shouldSend), so
// quiet hours, per-type switches and "already taken" behave identically
// wherever the decision is made.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sendPush, type Vapid } from '../_shared/webpush.ts';
// The rules live in plain JS shared with the browser and covered by
// test/notifications.test.js, so the sender cannot drift from the settings
// screen's promises.
import {
  shouldSend, dedupeKey, localHHMM, appointmentReminderAt, PREF_DEFAULTS,
} from '../_shared/notificationRules.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// The cron runs every 5 minutes, so a reminder is "due now" if its time falls
// inside this window. Slightly wider than the interval so a late cron run does
// not skip a dose entirely.
const WINDOW_MINUTES = 6;
const TOKEN_TTL_HOURS = 12;

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

function newToken() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const localDate = (tz: string, d = new Date()) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); }
  catch { return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d); }
};

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: cfg } = await admin.from('myday_push_config').select('*').eq('id', 1).maybeSingle();
  if (!cfg) return json({ ok: false, error: 'push not configured' });
  const vapid: Vapid = { public: cfg.vapid_public, private: cfg.vapid_private, contact: cfg.contact };

  const now = Date.now();
  let sent = 0;
  let skipped = 0;

  // Only people who have at least one live device are worth considering.
  const { data: devices } = await admin
    .from('myday_family_devices')
    .select('id, user_id, label, subscription, push_enabled')
    .eq('push_enabled', true)
    .not('subscription', 'is', null);

  const devicesByUser: Record<string, any[]> = {};
  for (const d of devices || []) (devicesByUser[d.user_id] ||= []).push(d);
  const userIds = Object.keys(devicesByUser);
  if (!userIds.length) return json({ ok: true, sent: 0, skipped: 0, note: 'no subscribed devices' });

  const [{ data: profiles }, { data: prefsRows }] = await Promise.all([
    admin.from('myday_profiles').select('user_id, full_name, timezone').in('user_id', userIds),
    admin.from('myday_notification_prefs').select('*').in('user_id', userIds),
  ]);
  const profileBy: Record<string, any> = {};
  for (const p of profiles || []) profileBy[p.user_id] = p;
  const prefsBy: Record<string, any> = {};
  for (const p of prefsRows || []) prefsBy[p.user_id] = p;

  /**
   * Sends one notification to all of a user's devices, once. The de-duplication
   * key is checked and claimed BEFORE sending, so two overlapping cron runs
   * cannot both deliver the same reminder.
   */
  async function deliver(userId: string, key: string, kind: string, refId: string | null, payload: any, urgency: 'normal' | 'high') {
    const claim = await admin.from('myday_notification_log')
      .insert({ key, user_id: userId, kind, ref_id: refId, device_count: 0 });
    // A duplicate key means another run already owns this notification.
    if (claim.error) { skipped++; return; }

    let delivered = 0;
    const dead: string[] = [];
    for (const d of devicesByUser[userId] || []) {
      const status = await sendPush(d.subscription, payload, vapid, { urgency });
      if (status >= 200 && status < 300) {
        delivered++;
        await admin.from('myday_family_devices')
          .update({ last_delivered_at: new Date().toISOString(), last_error: null }).eq('id', d.id);
      } else if (status === 404 || status === 410) {
        dead.push(d.id);
      } else {
        await admin.from('myday_family_devices')
          .update({ last_error: `push failed (${status})` }).eq('id', d.id);
      }
    }
    if (dead.length) await admin.from('myday_family_devices').delete().in('id', dead);
    await admin.from('myday_notification_log').update({ device_count: delivered }).eq('key', key);
    sent += delivered;
  }

  for (const userId of userIds) {
    const profile = profileBy[userId];
    const tz = profile?.timezone || 'UTC';
    const prefs = { ...PREF_DEFAULTS, ...(prefsBy[userId] || {}) };
    const ctx = { now, timezone: tz };
    const today = localDate(tz);
    const nowHHMM = localHHMM(new Date(now), tz);

    // ---------- dose reminders ----------
    if (shouldSend({ type: 'dose_due', at: new Date(now).toISOString() }, prefs, ctx).send) {
      const { data: due } = await admin.from('myday_doses')
        .select('id, due_at, scheduled_time, status, medication:myday_medications(name, dose, note, reminders_enabled)')
        .eq('user_id', userId).eq('dose_date', today).eq('status', 'pending')
        .gte('due_at', new Date(now - WINDOW_MINUTES * 60_000).toISOString())
        .lte('due_at', new Date(now + 60_000).toISOString());

      for (const dose of due || []) {
        // A medicine with its own reminders switched off still tracks doses.
        if (dose.medication?.reminders_enabled === false) { skipped++; continue; }
        // Re-check per dose: status may have changed since the query.
        if (!shouldSend({ type: 'dose_due', doseStatus: dose.status, at: dose.due_at }, prefs, ctx).send) {
          skipped++; continue;
        }

        // A single-use token so "I took it" works straight from the
        // notification, with no session and without opening the app.
        const token = newToken();
        await admin.from('myday_dose_action_tokens').insert({
          token_hash: await sha256(token),
          dose_id: dose.id,
          user_id: userId,
          expires_at: new Date(now + TOKEN_TTL_HOURS * 3600_000).toISOString(),
        });

        const name = dose.medication?.name || 'your medicine';
        await deliver(
          userId,
          dedupeKey({ type: 'dose_due', userId, refId: dose.id, date: today }),
          'dose_due', dose.id,
          {
            title: `Time for ${name}${dose.medication?.dose ? ` — ${dose.medication.dose}` : ''}`,
            body: dose.medication?.note || 'Tap "I took it" once you have taken it.',
            url: '/medication',
            kind: 'dose_due',
            tag: `myday-dose-${dose.id}`,
            doseId: dose.id,
            actionToken: token,
            actions: [{ action: 'taken', title: 'I took it' }, { action: 'snooze', title: 'Snooze 15 min' }],
            vibrate: prefs.vibrate,
            silent: !prefs.sound,
          },
          'normal',
        );
      }
    }

    // ---------- appointment reminders ----------
    if (shouldSend({ type: 'appointment', at: new Date(now).toISOString() }, prefs, ctx).send) {
      const { data: appts } = await admin.from('myday_appointments')
        .select('id, appt_date, appt_time, doctor_name, location, reason')
        .eq('user_id', userId).gte('appt_date', today).limit(20);

      for (const appt of appts || []) {
        const at = appointmentReminderAt(appt, prefs);
        if (!at) continue;
        const atMs = new Date(at).getTime();
        if (atMs < now - WINDOW_MINUTES * 60_000 || atMs > now + 60_000) continue;
        if (!shouldSend({ type: 'appointment', at }, prefs, ctx).send) { skipped++; continue; }

        const who = appt.doctor_name || appt.reason || 'an appointment';
        await deliver(
          userId,
          dedupeKey({ type: 'appointment', userId, refId: appt.id, date: appt.appt_date }),
          'appointment', appt.id,
          {
            title: `Coming up: ${who}`,
            body: [appt.appt_time ? `At ${appt.appt_time}` : 'Today', appt.location].filter(Boolean).join(' · '),
            url: '/appointments',
            kind: 'appointment',
            tag: `myday-appt-${appt.id}`,
            vibrate: prefs.vibrate,
            silent: !prefs.sound,
          },
          'normal',
        );
      }
    }

    // ---------- daily summary ----------
    if (prefs.daily_summary && nowHHMM >= prefs.daily_summary_at
        && minutesApart(nowHHMM, prefs.daily_summary_at) <= WINDOW_MINUTES
        && shouldSend({ type: 'daily_summary', at: new Date(now).toISOString() }, prefs, ctx).send) {
      const { data: doses } = await admin.from('myday_doses')
        .select('status').eq('user_id', userId).eq('dose_date', today);
      const list = doses || [];
      const taken = list.filter((d: any) => d.status === 'taken').length;
      const missed = list.filter((d: any) => d.status === 'missed').length;

      await deliver(
        userId,
        dedupeKey({ type: 'daily_summary', userId, refId: null, date: today }),
        'daily_summary', null,
        {
          title: 'Your day so far',
          body: list.length
            ? `${taken} of ${list.length} doses taken${missed ? `, ${missed} missed` : ''}.`
            : 'No medicines scheduled today.',
          url: '/',
          kind: 'daily_summary',
          tag: 'myday-summary',
          vibrate: prefs.vibrate,
          silent: !prefs.sound,
        },
        'normal',
      );
    }
  }

  // ---------- guardian daily summaries ----------
  // A guardian chooses their own time, on their own device, independently of
  // the senior's settings — it is their notification, not the senior's.
  const { data: gdevs } = await admin
    .from('myday_guardian_devices')
    .select('id, guardian_id, subscription, daily_summary_at, push_enabled, revoked_at, guardian:myday_guardians(user_id, status)')
    .eq('push_enabled', true).is('revoked_at', null)
    .not('daily_summary_at', 'is', null).not('subscription', 'is', null);

  for (const dev of gdevs || []) {
    const g: any = dev.guardian;
    if (!g || g.status === 'revoked') continue;
    const prof = await admin.from('myday_profiles')
      .select('full_name, timezone').eq('user_id', g.user_id).maybeSingle();
    const tz = prof.data?.timezone || 'UTC';
    const today = localDate(tz);
    const nowHHMM = localHHMM(new Date(now), tz);
    if (minutesApart(nowHHMM, dev.daily_summary_at) > WINDOW_MINUTES || nowHHMM < dev.daily_summary_at) continue;

    const key = dedupeKey({ type: 'guardian_alert', userId: g.user_id, refId: dev.id, date: today });
    const claim = await admin.from('myday_notification_log')
      .insert({ key, user_id: g.user_id, kind: 'guardian_summary', ref_id: dev.id });
    if (claim.error) { skipped++; continue; }

    const { data: doses } = await admin.from('myday_doses')
      .select('status').eq('user_id', g.user_id).eq('dose_date', today);
    const list = doses || [];
    const taken = list.filter((d: any) => d.status === 'taken').length;
    const missed = list.filter((d: any) => d.status === 'missed').length;
    const name = prof.data?.full_name || 'They';

    const status = await sendPush(dev.subscription, {
      title: `${name}'s day`,
      body: list.length
        ? `${taken} of ${list.length} doses taken${missed ? `, ${missed} missed` : ''}.`
        : 'No medicines were scheduled today.',
      url: '/guardian',
      kind: 'guardian_alert',
      tag: 'myday-guardian-summary',
    }, vapid, { urgency: 'normal' });

    if (status >= 200 && status < 300) {
      sent++;
      await admin.from('myday_guardian_devices')
        .update({ last_delivered_at: new Date().toISOString(), last_error: null }).eq('id', dev.id);
    } else if (status === 404 || status === 410) {
      // Clear the push fields, never delete: the row carries the dashboard token.
      await admin.from('myday_guardian_devices')
        .update({ push_enabled: false, endpoint: null, subscription: null, last_error: 'push endpoint gone' })
        .eq('id', dev.id);
    }
  }

  console.log(JSON.stringify({ fn: 'send-reminders', sent, skipped }));
  return json({ ok: true, sent, skipped });
});

/** Distance in minutes between two 'HH:MM' wall-clock times. */
function minutesApart(a: string, b: string) {
  const toMin = (s: string) => {
    const m = /^(\d{2}):(\d{2})$/.exec(s || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const x = toMin(a); const y = toMin(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  return Math.abs(x - y);
}
