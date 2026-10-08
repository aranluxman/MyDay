// MyDay — read-only guardian dashboard for device-only and signed-in helpers.
//
// A guardian can use a device token or their own MyDay account. This function
// is the ONLY way either route reads another person's data, and it is
// the whole security boundary for Part A. The rules it enforces:
//
//   1. Every dashboard request resolves to exactly ONE senior (`user_id`), from
//      a single-use code, a 256-bit device token, or a verified account link.
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
//   { action:'account_link', code, name }                  -> { link_id, ...dashboard }
//   { action:'account_claim', token }                      -> { ok }
//   { action:'account_list' }                              -> { links }
//   { action:'account_dashboard', link_id }                -> dashboard
//   { action:'account_device', link_id, label?, platform? } -> { link_id, token }
//   { action:'account_unlink', link_id }                   -> { ok }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
// The authorization rules live in a shared plain-JS module so node's test
// runner covers exactly the code that runs here. See test/guardianAccess.test.js.
import {
  authorizeCode, authorizeDevice, authorizeAccountLink, looksLikeToken, normaliseCode, visibleTables,
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

  // Account actions require a real session JWT. The publishable key can reach
  // this function but cannot pass getUser(jwt), and IDs in the body are never
  // used as the account identity.
  let accountUserId: string | null = null;
  if (action.startsWith('account_')) {
    const bearer = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const { data: auth, error: authError } = bearer
      ? await admin.auth.getUser(bearer)
      : { data: { user: null }, error: new Error('No session') };
    if (authError || !auth?.user?.id) return json({ error: 'Please sign in to view people you care for.' }, 401);
    accountUserId = auth.user.id;
  }

  if (action === 'account_list') {
    const { data: links, error: listError } = await admin.from('myday_guardian_accounts')
      .select('device_id').eq('guardian_user_id', accountUserId!);
    if (listError) return json({ error: 'Could not load your guardian connections.' }, 500);
    if (!links?.length) return json({ links: [] });
    const { data: devices, error: devicesError } = await admin.from('myday_guardian_devices')
      .select('id, guardian_id, revoked_at, created_at').in('id', links.map((l) => l.device_id))
      .order('created_at', { ascending: false });
    if (devicesError) return json({ error: 'Could not load your guardian connections.' }, 500);
    const live = (devices || []).filter((d) => !d.revoked_at);
    if (!live.length) return json({ links: [] });
    const guardianIds = [...new Set(live.map((d) => d.guardian_id))];
    const { data: guardians, error: guardiansError } = await admin.from('myday_guardians')
      .select('id, user_id, status').in('id', guardianIds);
    if (guardiansError) return json({ error: 'Could not load your guardian connections.' }, 500);
    const active = (guardians || []).filter((g) => g.status === 'active');
    if (!active.length) return json({ links: [] });
    const { data: profiles, error: profilesError } = await admin.from('myday_profiles')
      .select('user_id, full_name').in('user_id', [...new Set(active.map((g) => g.user_id))]);
    if (profilesError) return json({ error: 'Could not load your guardian connections.' }, 500);
    const names = new Map((profiles || []).map((p) => [p.user_id, p.full_name]));
    const byGuardian = new Map(active.map((g) => [g.id, g]));
    const seen = new Set<string>();
    return json({ links: live.filter((d) => {
      if (!byGuardian.has(d.guardian_id) || seen.has(d.guardian_id)) return false;
      seen.add(d.guardian_id);
      return true;
    }).map((d) => {
      const g = byGuardian.get(d.guardian_id)!;
      return {
        id: d.id,
        device_ids: live.filter((other) => other.guardian_id === d.guardian_id).map((other) => other.id),
        name: names.get(g.user_id) || 'the person you care for',
      };
    }) });
  }

  // ---------------- resolve the caller to one guardian device ----------------
  let guardian: any = null;
  let device: any = null;
  let freshToken: string | null = null;
  let accountLink: any = null;

  if (action === 'link' || action === 'account_link') {
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

    if (accountUserId && g.user_id === accountUserId) {
      return json({ error: 'You cannot use your own guardian code.' }, 400);
    }

    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json({ error: 'Please enter the name you want this person to see.' }, 400);

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

    if (accountUserId) {
      const { error: linkError } = await admin.from('myday_guardian_accounts')
        .insert({ device_id: dev.id, guardian_user_id: accountUserId });
      if (linkError) {
        await admin.from('myday_guardian_devices').update({ revoked_at: new Date().toISOString() }).eq('id', dev.id);
        logSafe('account_link', 'account-insert-failed');
        return json({ error: 'Could not save this connection to your account. Please try again.' }, 500);
      }
    }

    // Burn the code and record the name the guardian gave for themselves.
    const patch: Record<string, unknown> = {
      status: 'active',
      activated_at: new Date().toISOString(),
      code_used_at: new Date().toISOString(),
    };
    patch.name = name;
    await admin.from('myday_guardians').update(patch).eq('id', g.id);

    guardian = { ...g, name: name || g.name };
    device = dev;
    logSafe(action, 'ok');
  } else {
    // Returning helpers use either their verified account link or device token.
    const accountLinkId = String(body.link_id || '').trim();
    const usesAccountLink = ['account_dashboard', 'account_unlink', 'account_device'].includes(action);
    if (usesAccountLink && !/^[0-9a-f-]{36}$/i.test(accountLinkId)) {
      return json({ error: 'Choose a person you care for.' }, 400);
    }
    if (!usesAccountLink && !looksLikeToken(token)) {
      return json({ error: 'This device is not connected. Please enter a 6-digit code.', code: 'unlinked' }, 401);
    }
    if (usesAccountLink) {
      const { data: link } = await admin.from('myday_guardian_accounts')
        .select('device_id, guardian_user_id').eq('device_id', accountLinkId).eq('guardian_user_id', accountUserId!).maybeSingle();
      accountLink = link;
    }
    const { data: dev } = await admin.from('myday_guardian_devices')
      .select('id, guardian_id, push_enabled, daily_summary_at, label, revoked_at')
      .eq(usesAccountLink ? 'id' : 'token_hash', usesAccountLink ? accountLinkId : await sha256(token))
      .maybeSingle();

    const { data: g } = dev?.guardian_id
      ? await admin
          .from('myday_guardians')
          .select('id, user_id, name, status, share_diary')
          .eq('id', dev.guardian_id)
          .maybeSingle()
      : { data: null };

    const verdict = usesAccountLink
      ? authorizeAccountLink({ link: accountLink, accountUserId, device: dev, guardian: g })
      : authorizeDevice({ device: dev, guardian: g });
    if (!verdict.ok) {
      logSafe(action, verdict.code);
      return json({ error: verdict.message, code: verdict.code }, verdict.status);
    }
    guardian = g;
    device = dev;
  }

  // From here on, `userId` is the ONLY senior this request can ever see.
  const userId: string = guardian.user_id;

  if (action === 'account_claim') {
    const { data: existing } = await admin.from('myday_guardian_accounts')
      .select('guardian_user_id').eq('device_id', device.id).maybeSingle();
    if (existing?.guardian_user_id && existing.guardian_user_id !== accountUserId) {
      return json({ error: 'This connection belongs to another account.' }, 403);
    }
    if (!existing) {
      const { error } = await admin.from('myday_guardian_accounts')
        .insert({ device_id: device.id, guardian_user_id: accountUserId });
      if (error) return json({ error: 'Could not add this connection to your account.' }, 500);
    }
    return json({ ok: true, link_id: device.id });
  }

  if (action === 'account_device') {
    const { count, error: countError } = await admin.from('myday_guardian_devices')
      .select('id', { count: 'exact', head: true }).eq('guardian_id', guardian.id).is('revoked_at', null);
    if (countError) return json({ error: 'Could not check connected devices.' }, 500);
    if ((count || 0) >= 10) return json({ error: 'Too many connected devices. Disconnect one before adding another.' }, 400);
    const nextToken = newToken();
    const { data: next, error: deviceError } = await admin.from('myday_guardian_devices')
      .insert({
        guardian_id: guardian.id,
        token_hash: await sha256(nextToken),
        label: String(body.label || '').trim().slice(0, 60) || 'This device',
        platform: String(body.platform || '').trim().slice(0, 40) || null,
        last_seen_at: new Date().toISOString(),
      }).select('id').single();
    if (deviceError) return json({ error: 'Could not connect this device.' }, 500);
    const { error: linkError } = await admin.from('myday_guardian_accounts')
      .insert({ device_id: next.id, guardian_user_id: accountUserId });
    if (linkError) {
      await admin.from('myday_guardian_devices').update({ revoked_at: new Date().toISOString() }).eq('id', next.id);
      return json({ error: 'Could not connect this device.' }, 500);
    }
    return json({ link_id: next.id, token: nextToken });
  }

  if (action === 'account_unlink') {
    const { data: accountRows, error: rowsError } = await admin.from('myday_guardian_accounts')
      .select('device_id').eq('guardian_user_id', accountUserId!);
    if (rowsError) return json({ error: 'Could not disconnect this person.' }, 500);
    const ids = (accountRows || []).map((row) => row.device_id);
    if (ids.length) {
      const { error } = await admin.from('myday_guardian_devices')
        .update({ revoked_at: new Date().toISOString(), push_enabled: false })
        .eq('guardian_id', guardian.id).in('id', ids);
      if (error) return json({ error: 'Could not disconnect this person.' }, 500);
    }
    return json({ ok: true });
  }

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
      .eq('guardian_id', guardian.id)
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

  if (action === 'alert_timing') {
    const mode = body.mode;
    const delay = body.delay_minutes;
    const at = body.at;
    if (!['delay', 'time'].includes(mode) || ![15, 30, 45, 60].includes(delay)
        || typeof at !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
      return json({ error: 'Choose a delay of 15, 30, 45 minutes or 1 hour, or a valid time.' }, 400);
    }
    const { error } = await admin.from('myday_guardian_devices')
      .update({ alert_mode: mode, alert_delay_minutes: delay, alert_at: at }).eq('id', device.id);
    if (error) return json({ error: 'Could not save alert timing. Please try again.' }, 500);
    return json({ ok: true });
  }

  if (action !== 'link' && action !== 'dashboard' && action !== 'account_link' && action !== 'account_dashboard') {
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
    ...(accountUserId && freshToken ? { link_id: device.id } : {}),
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
      alert_mode: device.alert_mode || 'delay',
      alert_delay_minutes: device.alert_delay_minutes ?? 60,
      alert_at: device.alert_at || '19:00',
      last_error: device.last_error || null,
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
