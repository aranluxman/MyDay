// MyDay - guardian join endpoint (unauthenticated, service role).
//
// A guardian is a different person on their own iPad/phone with no MyDay
// account. They connect in one of two ways:
//   - CODE  (the main route): the patient reads out a 6-digit code and the
//           guardian types it into MyDay. Nothing to send, nothing to click.
//   - LINK  (the fallback): the patient shares /guardian?invite=<token>.
// Either identifier is the bearer of authority and expires with the invite.
//
//   { action:'info',      code|token }                  -> who invited me
//   { action:'subscribe', code|token, name?, subscription } -> save my device
//
// A 6-digit code is short enough to guess, so code lookups are rate-limited
// per caller IP (8 failures per 15 minutes) and a correct code clears the
// counter. Token lookups are 128-bit and not throttled.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty or malformed body -> handled below */ }
  const action = body.action || 'info';
  const token = String(body.token || '').trim();
  const code = String(body.code || '').replace(/\D/g, '');

  if (!token && code.length !== 6) {
    return json({ error: 'Please enter the 6-digit code from the other person’s MyDay app.' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Throttle guessing, but only for the short code path.
  const clientKey = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const throttled = !token;
  if (throttled) {
    const { data: over } = await admin.rpc('myday_join_rate_limited', { p_key: clientKey });
    if (over) return json({ error: 'Too many tries. Please wait 15 minutes and try again.' }, 429);
  }

  const query = admin.from('myday_guardians').select('id, user_id, name, status, expires_at');
  const { data: guardian } = token
    ? await query.eq('token', token).maybeSingle()
    : await query.eq('code', code).maybeSingle();

  if (!guardian || guardian.status === 'revoked') {
    return json({ error: 'That code was not recognised. Please check the digits and try again.' }, 404);
  }
  if (new Date(guardian.expires_at).getTime() < Date.now()) {
    return json({ error: 'This code has expired. Ask them to make a new one in MyDay.' }, 410);
  }
  // Correct code: this caller is clearly not guessing.
  if (throttled) await admin.rpc('myday_join_rate_clear', { p_key: clientKey });

  const { data: prof } = await admin.from('myday_profiles').select('full_name').eq('user_id', guardian.user_id).maybeSingle();
  const patientName = prof?.full_name || 'Someone';

  if (action === 'info') {
    return json({ ok: true, patient_name: patientName, guardian_name: guardian.name, status: guardian.status });
  }

  if (action === 'subscribe') {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return json({ error: 'Could not read this device’s alert settings. Please try again.' }, 400);
    }
    const name = String(body.name || '').trim().slice(0, 60);

    const { error: devErr } = await admin.from('myday_guardian_devices')
      .upsert({ guardian_id: guardian.id, endpoint: sub.endpoint, subscription: sub }, { onConflict: 'endpoint' });
    if (devErr) return json({ error: 'Could not turn on alerts. Please try again.' }, 500);

    const patch: Record<string, unknown> = { status: 'active', activated_at: new Date().toISOString() };
    if (name) patch.name = name;
    await admin.from('myday_guardians').update(patch).eq('id', guardian.id);

    return json({ ok: true, patient_name: patientName });
  }

  return json({ error: 'Unknown action.' }, 400);
});
