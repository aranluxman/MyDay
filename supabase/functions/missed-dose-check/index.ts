// MyDay - multi-user missed-dose checker (cron every 5 min).
//   - ensures today's/yesterday's doses for ALL users (each in their own tz),
//   - flips overdue pending doses to missed,
//   - web-pushes each user's family devices AND active guardians, batching all of
//     a user's newly-missed doses into a single notification per recipient.
// { test:true } with a user bearer token sends a test alert to that user's devices.
// Web push crypto + broadcast live in ../_shared/push.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { loadVapid, broadcast } from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function prettyTime(hhmm: string): string { const [h, m] = hhmm.split(':').map(Number); const ap = h < 12 ? 'AM' : 'PM'; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(m).padStart(2, '0')} ${ap}`; }
function doseLabel(d: any): string { const med = d.medication?.name as string | undefined; return `${prettyTime(d.scheduled_time)}${med ? ` ${med}` : ''}`; }
// One batched message per person: a single miss keeps the familiar phrasing,
// several are collapsed into one line so guardians get one push, not a flurry.
function missedBody(name: string, doses: any[]): string {
  if (doses.length === 1) {
    const med = doses[0].medication?.name as string | undefined;
    return `${name} has not taken their ${prettyTime(doses[0].scheduled_time)} medication${med ? ` (${med})` : ''}.`;
  }
  return `${name} missed ${doses.length} medications: ${doses.map(doseLabel).join(', ')}.`;
}

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  let test = false;
  try { const b = await req.json(); test = !!b?.test; } catch {}

  const vapid = await loadVapid(admin);
  if (!vapid) return json({ ok: false, error: 'push not configured' });

  if (test) {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ ok: false, error: 'sign in required' }, 401);
    const { data: devices } = await admin.from('myday_family_devices').select('*').eq('user_id', user.id);
    const { data: prof } = await admin.from('myday_profiles').select('full_name').eq('user_id', user.id).maybeSingle();
    const name = prof?.full_name || 'You';
    const { delivered } = await broadcast(admin, vapid, 'myday_family_devices', devices || [], { title: 'MyDay test alert', body: `Test alert for ${name}. Missed-dose alerts are working.`, url: './' });
    return json({ ok: true, mode: 'test', devices: (devices || []).length, delivered });
  }

  await admin.rpc('myday_cron_ensure_and_mark');
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: missed } = await admin.from('myday_doses')
    .select('id, user_id, scheduled_time, medication:myday_medications(name)')
    .eq('status', 'missed').eq('notified', false).gte('due_at', dayAgo).order('due_at', { ascending: true });
  const list = missed || [];
  let delivered = 0;
  if (list.length) {
    // Group the newly-missed doses by user so each person gets ONE batched push.
    const byUser: Record<string, any[]> = {}; for (const d of list as any[]) (byUser[d.user_id] ||= []).push(d);
    const userIds = Object.keys(byUser);

    const { data: profs } = await admin.from('myday_profiles').select('user_id, full_name').in('user_id', userIds);
    const nameByUser: Record<string, string> = {}; for (const p of (profs || [])) nameByUser[p.user_id] = p.full_name || 'Your family member';

    // Recipients: the patient's own devices, plus every active guardian's devices.
    const { data: fam } = await admin.from('myday_family_devices').select('*').in('user_id', userIds);
    const famByUser: Record<string, any[]> = {}; for (const d of (fam || [])) (famByUser[d.user_id] ||= []).push(d);

    const { data: guardians } = await admin.from('myday_guardians').select('id, user_id').eq('status', 'active').in('user_id', userIds);
    const guardianList = guardians || [];
    const gIds = guardianList.map((g: any) => g.id);
    const { data: gdevs } = gIds.length ? await admin.from('myday_guardian_devices').select('*').in('guardian_id', gIds) : { data: [] as any[] };
    const devByGuardian: Record<string, any[]> = {}; for (const d of (gdevs || [])) (devByGuardian[d.guardian_id] ||= []).push(d);
    const guardiansByUser: Record<string, any[]> = {}; for (const g of guardianList) (guardiansByUser[g.user_id] ||= []).push(g);

    for (const uid of userIds) {
      const doses = byUser[uid];
      const name = nameByUser[uid] || 'Your family member';
      const payload = { title: 'MyDay', body: missedBody(name, doses), url: './', tag: `myday-missed-${uid}` };

      delivered += (await broadcast(admin, vapid, 'myday_family_devices', famByUser[uid] || [], payload)).delivered;

      for (const g of (guardiansByUser[uid] || [])) {
        const gd = devByGuardian[g.id] || [];
        if (!gd.length) continue;
        const res = await broadcast(admin, vapid, 'myday_guardian_devices', gd, payload);
        delivered += res.delivered;
        // If this guardian's last device just died, mark the link inactive so the
        // patient sees "Waiting to connect" instead of a silently-broken guardian.
        if (res.dead.length >= gd.length) await admin.from('myday_guardians').update({ status: 'pending' }).eq('id', g.id);
      }

      await admin.from('myday_doses').update({ notified: true }).in('id', doses.map((d: any) => d.id));
    }
  }
  return json({ ok: true, mode: 'cron', missed: list.length, delivered });
});
