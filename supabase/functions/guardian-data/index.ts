// MyDay — guardian dashboard data (unauthenticated caller, service role).
//
// A guardian is a different person, on their own device, with no MyDay account.
// This function is the ONLY way their device reads a senior's data, and it is
// the whole security boundary for Part A. The rules it enforces:
//
//   1. Every request resolves to exactly ONE senior (`user_id`), from either a
//      single-use 6-digit code (linking) or a 256-bit device token (returning).
//      Every query below is filtered on that one id. A device token can never
//      widen to another senior, because user_id is never taken from the request.
//   2. READ-ONLY. There is no code path here that writes to myday_medications,
//      myday_doses, myday_appointments, myday_diary or myday_profiles. The only
//      writes are to the guardian's own rows (last_seen_at, push subscription,
//      revoked_at).
//   3. Tokens are stored hashed (SHA-256). The plaintext lives only on the
//      guardian's device, so these tables leaking does not grant access.
//   4. Codes are single-use, expire in 15 minutes, and are rate-limited by
//      myday_join_rate_limited (8 per caller / 15 min + a global breaker).
//   5. Nothing sensitive is logged — no codes, no tokens, no names, no health
//      data. See `logSafe`.
//   6. `user_id` is never returned to the client.
//
// Actions:
//   { action:'link',       code, name?, label?, platform? } -> { token, ...dashboard }
//   { action:'dashboard',  token }                          -> dashboard
//   { action:'subscribe',  token, subscription }            -> { ok }
//   { action:'unsubscribe',token }                          -> { ok }
//   { action:'disconnect', token }                          -> { ok }   ("not my device")
//   { action:'summary',    token, at:'HH:MM'|null }         -> { ok }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
// The authorization rules live in a shared plain-JS module so node's test
// runner covers exactly the code that runs here. See test/guardianAccess.test.js.
import {
  authorizeCode, authorizeDevice, looksLikeToken, normaliseCode, visibleTables,
} from '../_shared/guardianAccess.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const HISTORY_DAYS = 60;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Deliberately coarse: an action name and an outcome, never an identifier.
function logSafe(action: string, outcome: string) {
  console.log(JSON.stringify({ fn: 'guardian-data', action, outcome }));
}

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(s: string) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

function newToken() {
  // 32 bytes = 256 bits of entropy; base64url so it survives localStorage and
  // a JSON body untouched.
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 'YYYY-MM-DD' for a date in the senior's timezone. The guardian may be in a
// different one, and "today" must always mean the senior's today.
function localDate(tz: string, d = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); }
  catch { return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d); }
}
function shiftDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body: any = {};
  try { body = await req.json(); } catch { /* handled below */ }

  const action = String(body.action || 'dashboard');
  const token = String(body.token || '').trim();
  const code = String(body.code || '').replace(/\D/g, '');

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const clientKey = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();

  // ---------------- resolve the caller to one guardian device ----------------
  let guardian: any = null;
  let device: any = null;
  let freshToken: string | null = null;

  if (action === 'link') {
    if (!normaliseCode(code)) {
      return json({ error: 'Please enter the 6-digit code from the other person’s MyDay app.' }, 400);
    }
    // Throttle before the lookup, so a sweep is stopped whether or not it hits.
    const { data: over } = await admin.rpc('myday_join_rate_limited', { p_key: clientKey });
    if (over) {
      logSafe('link', 'rate-limited');
      return json({ error: 'Too many tries. Please wait 15 minutes and try again.' }, 429);
    }

    const { data: g } = await admin
      .from('myday_guardians')
      .select('id, user_id, name, status, code_expires_at, code_used_at, share_diary')
      .eq('code', code)
      .maybeSingle();

    const verdict = authorizeCode({ guardian: g });
    if (!verdict.ok) {
      logSafe('link', verdict.code);
      return json({ error: verdict.message }, verdict.status);
    }

    // A correct code: this caller is not guessing.
    await admin.rpc('myday_join_rate_clear', { p_key: clientKey });

    freshToken = newToken();
    const label = String(body.label || '').trim().slice(0, 60) || 'This device';
    const platform = String(body.platform || '').trim().slice(0, 40) || null;

    const { data: dev, error: devErr } = await admin
      .from('myday_guardian_devices')
      .insert({
        guardian_id: g.id,
        token_hash: await sha256(freshToken),
        label, platform,
        last_seen_at: new Date().toISOString(),
        created_ip_key: clientKey.slice(0, 80),
      })
      .select('id, guardian_id, push_enabled, daily_summary_at, label')
      .single();
    if (devErr) {
      logSafe('link', 'device-insert-failed');
      return json({ error: 'Could not connect this device. Please try again.' }, 500);
    }

    // Burn the code and record the name the guardian gave for themselves.
    const patch: Record<string, unknown> = {
      status: 'active',
      activated_at: new Date().toISOString(),
      code_used_at: new Date().toISOString(),
    };
    const name = String(body.name || '').trim().slice(0, 60);
    if (name) patch.name = name;
    await admin.from('myday_guardians').update(patch).eq('id', g.id);

    guardian = { ...g, name: name || g.name };
    device = dev;
    logSafe('link', 'ok');
  } else {
    // Every other action needs a device token.
    if (!looksLikeToken(token)) {
      return json({ error: 'This device is not connected. Please enter a 6-digit code.', code: 'unlinked' }, 401);
    }
    const { data: dev } = await admin
      .from('myday_guardian_devices')
      .select('id, guardian_id, push_enabled, daily_summary_at, label, revoked_at')
      .eq('token_hash', await sha256(token))
      .maybeSingle();

    const { data: g } = dev?.guardian_id
      ? await admin
          .from('myday_guardians')
          .select('id, user_id, name, status, share_diary')
          .eq('id', dev.guardian_id)
          .maybeSingle()
      : { data: null };

    const verdict = authorizeDevice({ device: dev, guardian: g });
    if (!verdict.ok) {
      logSafe(action, verdict.code);
      return json({ error: verdict.message, code: verdict.code }, verdict.status);
    }
    guardian = g;
    device = dev;
  }

  // From here on, `userId` is the ONLY senior this request can ever see.
  const userId: string = guardian.user_id;

  // ---------------- write-only-to-own-rows actions ----------------
  if (action === 'disconnect') {
    await admin.from('myday_guardian_devices')
      .update({ revoked_at: new Date().toISOString(), push_enabled: false })
      .eq('id', device.id);
    logSafe('disconnect', 'ok');
    return json({ ok: true });
  }

  if (action === 'subscribe') {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return json({ error: 'Could not read this device’s alert settings. Please try again.' }, 400);
    }
    // An endpoint can already exist from the old push-only join flow; adopt it
    // onto this device row rather than failing the unique index.
    await admin.from('myday_guardian_devices')
      .update({ endpoint: null, subscription: null, push_enabled: false })
      .eq('endpoint', sub.endpoint)
      .neq('id', device.id);

    const { error } = await admin.from('myday_guardian_devices')
      .update({ endpoint: sub.endpoint, subscription: sub, push_enabled: true, last_error: null })
      .eq('id', device.id);
    if (error) {
      logSafe('subscribe', 'failed');
      return json({ error: 'Could not turn on alerts. Please try again.' }, 500);
    }
    logSafe('subscribe', 'ok');
    return json({ ok: true });
  }

  if (action === 'unsubscribe') {
    await admin.from('myday_guardian_devices')
      .update({ push_enabled: false }).eq('id', device.id);
    return json({ ok: true });
  }

  if (action === 'summary') {
    const at = body.at == null ? null : String(body.at).trim();
    if (at !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
      return json({ error: 'Please choose a valid time.' }, 400);
    }
    await admin.from('myday_guardian_devices')
      .update({ daily_summary_at: at }).eq('id', device.id);
    return json({ ok: true });
  }

  if (action !== 'link' && action !== 'dashboard') {
    return json({ error: 'Unknown action.' }, 400);
  }

  // ---------------- the dashboard read ----------------
  const nowIso = new Date().toISOString();
  await admin.from('myday_guardian_devices')
    .update({ last_seen_at: nowIso }).eq('id', device.id);
  await admin.from('myday_guardians')
    .update({ last_dashboard_at: nowIso }).eq('id', guardian.id);

  const { data: prof } = await admin
    .from('myday_profiles')
    .select('full_name, timezone, alert_window_minutes')
    .eq('user_id', userId)
    .maybeSingle();

  const tz = prof?.timezone || 'UTC';
  const today = localDate(tz);
  const historyFrom = shiftDays(today, -HISTORY_DAYS);

  // Every one of these is filtered on `userId`.
  const [todayDoses, history, appts, contacts, diary] = await Promise.all([
    admin.from('myday_doses')
      .select('id, dose_date, scheduled_time, due_at, status, taken_at, medication:myday_medications(name, dose, note, color)')
      .eq('user_id', userId).eq('dose_date', today)
      .order('due_at', { ascending: true }),

    admin.from('myday_doses')
      .select('id, dose_date, scheduled_time, due_at, status, taken_at, medication:myday_medications(name, dose)')
      .eq('user_id', userId).gte('dose_date', historyFrom).lte('dose_date', today)
      .order('dose_date', { ascending: false }).order('due_at', { ascending: true }),

    admin.from('myday_appointments')
      .select('id, appt_date, appt_time, doctor_name, location, reason')
      .eq('user_id', userId).gte('appt_date', today)
      .order('appt_date', { ascending: true }).order('appt_time', { ascending: true, nullsFirst: true })
      .limit(20),

    // Name, phone and type only — enough for a "Call the pharmacy" button, and
    // none of the address / notes / email a guardian has no reason to see.
    admin.from('myday_contacts')
      .select('id, type, name, phone')
      .eq('user_id', userId).not('phone', 'is', null)
      .order('type'),

    guardian.share_diary
      ? admin.from('myday_diary')
          .select('id, entry_at, category, title, body')
          .eq('user_id', userId).order('entry_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  logSafe('dashboard', 'ok');

  return json({
    ok: true,
    ...(freshToken ? { token: freshToken } : {}),
    guardian: { name: guardian.name, device_label: device.label },
    patient: {
      name: prof?.full_name || 'the person you care for',
      timezone: tz,
      alert_window_minutes: prof?.alert_window_minutes ?? 60,
    },
    today: { date: today, doses: todayDoses.data || [] },
    history: history.data || [],
    appointments: appts.data || [],
    contacts: contacts.data || [],
    diary: diary.data || [],
    notifications: {
      push_enabled: !!device.push_enabled,
      daily_summary_at: device.daily_summary_at || null,
    },
    // Stated by the server so the page cannot promise a guardian more than the
    // boundary actually allows.
    permissions: {
      can_read: visibleTables(guardian),
      can_write: [],
      read_only: true,
    },
    server_time: nowIso,
  });
});
