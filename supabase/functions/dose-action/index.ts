// MyDay — act on a notification button ("I took it" / "Snooze"), with no app
// session and without opening the app.
//
// The service worker cannot read localStorage and has no Supabase session, so
// it authenticates with a token that came in the push payload. That token:
//   * is single-use and short-lived,
//   * is stored only as a SHA-256 hash, so this table is not a set of keys,
//   * can do exactly ONE thing — mark its own dose taken (or snooze it).
//
// It deliberately cannot read anything, cannot touch another dose, and cannot
// be replayed. A leaked payload is worth one dose marked taken, nothing more.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body: any = {};
  try { body = await req.json(); } catch { /* handled below */ }

  const token = String(body.token || '').trim();
  const action = String(body.action || 'taken');
  if (!token || token.length < 20) return json({ ok: false, error: 'bad token' }, 400);
  if (action !== 'taken' && action !== 'snooze') return json({ ok: false, error: 'bad action' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: row } = await admin
    .from('myday_dose_action_tokens')
    .select('token_hash, dose_id, user_id, expires_at, used_at')
    .eq('token_hash', await sha256(token))
    .maybeSingle();

  // One answer for unknown, expired and spent: there is nothing useful to
  // learn from the difference, and the service worker's behaviour is the same.
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    console.log(JSON.stringify({ fn: 'dose-action', action, outcome: 'rejected' }));
    return json({ ok: false, error: 'This button has expired. Please open MyDay.' }, 401);
  }

  if (action === 'snooze') {
    // Snoozing does not change the dose — it only clears `notified` so the
    // reminder can legitimately come round again. The dose's own status, and
    // therefore missed-dose detection, is untouched.
    await admin.from('myday_doses').update({ notified: false }).eq('id', row.dose_id);
    await admin.from('myday_dose_action_tokens')
      .update({ used_at: new Date().toISOString() }).eq('token_hash', row.token_hash);
    console.log(JSON.stringify({ fn: 'dose-action', action, outcome: 'ok' }));
    return json({ ok: true, action: 'snooze' });
  }

  // Mark taken. Scoped to this token's own dose AND user, so a token can never
  // reach across accounts even if a dose_id were somehow wrong.
  const { error } = await admin.from('myday_doses')
    .update({ status: 'taken', taken_at: new Date().toISOString() })
    .eq('id', row.dose_id)
    .eq('user_id', row.user_id);

  if (error) {
    console.log(JSON.stringify({ fn: 'dose-action', action, outcome: 'write-failed' }));
    return json({ ok: false, error: 'Could not save.' }, 500);
  }

  await admin.from('myday_dose_action_tokens')
    .update({ used_at: new Date().toISOString() }).eq('token_hash', row.token_hash);

  // Any other token still outstanding for this dose is now moot; spending them
  // stops a second device's notification from re-marking it.
  await admin.from('myday_dose_action_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('dose_id', row.dose_id).is('used_at', null);

  console.log(JSON.stringify({ fn: 'dose-action', action, outcome: 'ok' }));
  return json({ ok: true, action: 'taken' });
});
