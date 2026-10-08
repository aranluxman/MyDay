// MyDay - daily 8pm summary (cron every hour).
// For each user whose local time is in the 8pm hour and who hasn't had today's
// summary yet, push a short recap of the day's doses to their family devices and
// active guardians, then stamp myday_profiles.summary_sent_on to dedup.
// Web push crypto + broadcast live in ../_shared/push.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { loadVapid, broadcast } from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function prettyTime(hhmm: string): string { const [h, m] = hhmm.split(':').map(Number); const ap = h < 12 ? 'AM' : 'PM'; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(m).padStart(2, '0')} ${ap}`; }
function doseLabel(d: any): string { const med = d.medication?.name as string | undefined; return `${prettyTime(d.scheduled_time)}${med ? ` ${med}` : ''}`; }

function summaryBody(name: string, doses: any[]): string {
  const total = doses.length;
  const taken = doses.filter((d) => d.status === 'taken').length;
  const missed = doses.filter((d) => d.status === 'missed');
  const pending = doses.filter((d) => d.status === 'pending').length;
  let body = `${name}'s day: ${taken} of ${total} dose${total === 1 ? '' : 's'} taken.`;
  if (missed.length) body += ` Missed: ${missed.map(doseLabel).join(', ')}.`;
  else if (pending) body += ` ${pending} still to take.`;
  else if (total && taken === total) body += ' All done.';
  return body;
}

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

  const vapid = await loadVapid(admin);
  if (!vapid) return json({ ok: false, error: 'push not configured' });

  const { data: due } = await admin.rpc('myday_users_due_for_summary');
  const users = due || [];
  let delivered = 0;
  for (const u of users as any[]) {
    const uid = u.user_id as string;
    const localToday = u.local_today as string;
    const name = (u.full_name as string) || 'Your family member';

    const { data: doses } = await admin.from('myday_doses')
      .select('status, scheduled_time, medication:myday_medications(name)')
      .eq('user_id', uid).eq('dose_date', localToday).order('due_at', { ascending: true });
    const list = doses || [];

    if (list.length) {
      const payload = { title: 'MyDay', body: summaryBody(name, list), url: './', tag: `myday-summary-${uid}` };

      const { data: fam } = await admin.from('myday_family_devices').select('*').eq('user_id', uid);
      delivered += (await broadcast(admin, vapid, 'myday_family_devices', fam || [], payload)).delivered;

      const { data: guardians } = await admin.from('myday_guardians').select('id').eq('user_id', uid).eq('status', 'active');
      const gIds = (guardians || []).map((g: any) => g.id);
      if (gIds.length) {
        const { data: gdevs } = await admin.from('myday_guardian_devices').select('*').in('guardian_id', gIds);
        const byGuardian: Record<string, any[]> = {}; for (const d of (gdevs || [])) (byGuardian[d.guardian_id] ||= []).push(d);
        for (const g of guardians as any[]) {
          const gd = byGuardian[g.id] || [];
          if (!gd.length) continue;
          const res = await broadcast(admin, vapid, 'myday_guardian_devices', gd, payload);
          delivered += res.delivered;
          if (res.dead.length >= gd.length) await admin.from('myday_guardians').update({ status: 'pending' }).eq('id', g.id);
        }
      }
    }

    // Stamp even on empty days so the user isn't re-processed this local day.
    await admin.from('myday_profiles').update({ summary_sent_on: localToday }).eq('user_id', uid);
  }
  return json({ ok: true, users: users.length, delivered });
});
