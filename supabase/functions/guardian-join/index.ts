// MyDay - guardian join endpoint (unauthenticated, service role).
// A guardian opens an invite link (/guardian?invite=<token>) on their own phone,
// installs the PWA, grants notifications, and registers their push subscription
// here. The invite token is the bearer of authority and expires after 7 days.
//   { action:'info', token }                        -> who invited me (patient name)
//   { action:'subscribe', token, name?, subscription } -> save my device, go active
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = body.action || 'info';
  const token = (body.token || '').trim();
  if (!token) return json({ error: 'This invite link is missing its code.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: guardian } = await admin.from('myday_guardians')
    .select('id, user_id, name, status, expires_at').eq('token', token).maybeSingle();
  if (!guardian || guardian.status === 'revoked') return json({ error: 'This invite is no longer valid. Ask for a new link.' }, 404);
  if (new Date(guardian.expires_at).getTime() < Date.now()) return json({ error: 'This invite link has expired. Ask for a new one.' }, 410);

  const { data: prof } = await admin.from('myday_profiles').select('full_name').eq('user_id', guardian.user_id).maybeSingle();
  const patientName = prof?.full_name || 'Someone';

  if (action === 'info') {
    return json({ ok: true, patient_name: patientName, guardian_name: guardian.name, status: guardian.status });
  }

  if (action === 'subscribe') {
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json({ error: 'Could not read this phone\'s alert settings.' }, 400);
    const name = (body.name || '').trim();

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
