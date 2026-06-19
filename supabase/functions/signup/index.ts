// MyDay - frictionless sign-up. Creates a pre-confirmed account via the service
// role so new users can sign in immediately (no email-confirmation step, which
// would be a barrier for older users). The client then signs in normally.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const full_name = (body.full_name || '').trim();
  if (!email || !email.includes('@')) return json({ error: 'Please enter a valid email address.' }, 400);
  if (password.length < 6) return json({ error: 'Password must be at least 6 characters.' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
  if (error) {
    const msg = /already registered|already exists|duplicate/i.test(error.message)
      ? 'An account with this email already exists. Try signing in.' : error.message;
    return json({ error: msg }, 400);
  }
  return json({ ok: true, user_id: data.user?.id });
});
