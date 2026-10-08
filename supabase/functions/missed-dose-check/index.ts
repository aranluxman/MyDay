// MyDay - multi-user missed-dose checker (cron every 5 min).
//   - ensures today's/yesterday's doses for ALL users (each in their own tz),
//   - flips overdue pending doses to missed,
//   - web-pushes each user's family devices, e.g. "Mary has not taken their 9:00 AM medication."
// { test:true } with a user bearer token sends a test alert to that user's devices.
// Web push (RFC 8291 / aes128gcm) implemented with Web Crypto; VAPID keys read
// from the locked-down myday_push_config table via the service role.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

import { sendPush, type Vapid } from '../_shared/webpush.ts';
import { guardianAlertDue, guardianDeliveryKey } from '../_shared/guardianAlerts.js';
import { shouldSend } from '../_shared/notificationRules.js';

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

  const { data: cfg } = await admin.from('myday_push_config').select('*').eq('id', 1).maybeSingle();
  if (!cfg) return json({ ok: false, error: 'push not configured' });
  const vapid: Vapid = { public: cfg.vapid_public, private: cfg.vapid_private, contact: cfg.contact };

  // Push `payload` to a set of devices in `table` (family or guardian devices),
  // pruning dead subscriptions (404/410) and stamping last_notified_at on success.
  //
  // How a dead endpoint is pruned depends on what else the row holds:
  //   'delete' — myday_family_devices rows exist only to carry a subscription,
  //              so a gone endpoint means a useless row.
  //   'clear'  — myday_guardian_devices rows also carry the guardian's
  //              DASHBOARD TOKEN. Push endpoints rotate routinely, and deleting
  //              the row over one would silently unlink a working dashboard and
  //              force the guardian to pair again. So only the push fields go.
  async function broadcast(
    table: string, devices: any[], payload: object, prune: 'delete' | 'clear' = 'delete',
  ): Promise<{ delivered: number; dead: string[] }> {
    let delivered = 0; const dead: string[] = []; const ok: string[] = [];
    for (const d of devices) {
      // A row with no subscription cannot be pushed to; skip rather than throw.
      if (!d.subscription) continue;
      const s = await sendPush(d.subscription, payload, vapid);
      if (s >= 200 && s < 300) { delivered++; ok.push(d.id); }
      else if (s === 404 || s === 410) dead.push(d.id);
    }
    if (dead.length) {
      if (prune === 'delete') {
        await admin.from(table).delete().in('id', dead);
      } else {
        await admin.from(table)
          .update({ push_enabled: false, endpoint: null, subscription: null, last_error: 'push endpoint gone' })
          .in('id', dead);
      }
    }
    if (ok.length) await admin.from(table).update({ last_notified_at: new Date().toISOString() }).in('id', ok);
    return { delivered, dead };
  }

  if (test) {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ ok: false, error: 'sign in required' }, 401);
    const { data: devices } = await admin.from('myday_family_devices').select('*').eq('user_id', user.id);
    const { data: prof } = await admin.from('myday_profiles').select('full_name').eq('user_id', user.id).maybeSingle();
    const name = prof?.full_name || 'You';
    const { delivered } = await broadcast('myday_family_devices', devices || [], { title: 'MyDay test alert', body: `Test alert for ${name}. This device can receive MyDay alerts.`, url: './' });
    return json({ ok: true, mode: 'test', devices: (devices || []).length, delivered });
  }

  const { error: sweepError } = await admin.rpc('myday_cron_ensure_and_mark');
  if (sweepError) return json({ ok: false, error: 'Could not refresh doses' }, 500);
  const now = Date.now();
  // Recover claims abandoned by a terminated worker. The lease exceeds the
  // maximum Edge Function run time, so an active sender retains its claims.
  const { error: cleanupError } = await admin.from('myday_notification_log').delete()
    .in('kind', ['guardian_missed', 'dose_missed']).eq('device_count', 0)
    .lt('delivered_at', new Date(now - 15 * 60_000).toISOString());
  if (cleanupError) return json({ ok: false, error: 'Could not recover pending alerts' }, 500);
  const { data: doses, error: doseError } = await admin.from('myday_doses')
    .select('id, user_id, due_at, scheduled_time, status, taken_at, notified, medication:myday_medications(name, active, reminders_enabled)')
    .in('status', ['pending', 'missed']).gte('due_at', new Date(now - 48 * 3600_000).toISOString())
    .lte('due_at', new Date(now).toISOString()).order('due_at');
  if (doseError) return json({ ok: false, error: 'Could not read doses' }, 500);
  const list = doses || [];
  const userIds = [...new Set(list.map((d: any) => d.user_id))];
  if (!userIds.length) return json({ ok: true, mode: 'cron', missed: 0, delivered: 0 });
  const [profiles, prefs, family, guardians] = await Promise.all([
    admin.from('myday_profiles').select('user_id, full_name, timezone').in('user_id', userIds),
    admin.from('myday_notification_prefs').select('*').in('user_id', userIds),
    admin.from('myday_family_devices').select('*').in('user_id', userIds).eq('push_enabled', true).not('subscription', 'is', null),
    admin.from('myday_guardians').select('id, user_id').in('user_id', userIds).eq('status', 'active'),
  ]);
  if ([profiles, prefs, family, guardians].some((r) => r.error)) return json({ ok: false, error: 'Could not read recipients' }, 500);
  const byProfile = Object.fromEntries((profiles.data || []).map((p: any) => [p.user_id, p]));
  const byPrefs = Object.fromEntries((prefs.data || []).map((p: any) => [p.user_id, p]));
  const guardianIds = (guardians.data || []).map((g: any) => g.id);
  const guardianDevices = guardianIds.length
    ? await admin.from('myday_guardian_devices').select('*').in('guardian_id', guardianIds)
      .eq('push_enabled', true).is('revoked_at', null).not('subscription', 'is', null)
    : { data: [], error: null };
  if (guardianDevices.error) return json({ ok: false, error: 'Could not read guardian devices' }, 500);
  let delivered = 0;

  // Claim separately for every recipient and dose. A patient's earlier alert
  // must not swallow a guardian's later one; a failed send releases its claims.
  async function deliver(table: string, device: any, candidates: any[], uid: string, isGuardian: boolean) {
    const claimed: any[] = [];
    for (const dose of candidates) {
      const key = isGuardian ? guardianDeliveryKey(device.id, dose.id) : `family_missed:${device.id}:${dose.id}`;
      const { error } = await admin.from('myday_notification_log').insert({
        key, user_id: uid, kind: isGuardian ? 'guardian_missed' : 'dose_missed', ref_id: dose.id,
        device_count: 0,
      });
      if (error?.code === '23505') continue;
      if (error) throw new Error('Could not claim notification');
      claimed.push({ ...dose, key });
    }
    if (!claimed.length) return;
    const keys = claimed.map((d) => d.key);
    // The patient may have tapped Done while this cron was gathering recipients.
    const current = await admin.from('myday_doses').select('id, status, taken_at')
      .in('id', claimed.map((d) => d.id)).in('status', ['pending', 'missed']).is('taken_at', null);
    if (current.error) {
      await admin.from('myday_notification_log').delete().in('key', keys);
      throw new Error('Could not recheck dose status');
    }
    const remaining = claimed.filter((d) => current.data?.some((row: any) => row.id === d.id));
    const settledKeys = claimed.filter((d) => !remaining.some((row) => row.id === d.id)).map((d) => d.key);
    if (settledKeys.length) await admin.from('myday_notification_log').delete().in('key', settledKeys);
    if (!remaining.length) return;
    const status = await sendPush(device.subscription, {
      title: 'MyDay', body: missedBody(byProfile[uid]?.full_name || 'Your family member', remaining),
      url: isGuardian ? '/guardian' : '/', kind: isGuardian ? 'guardian_alert' : 'dose_missed',
      tag: `myday-missed-${uid}`,
    }, vapid, { urgency: 'high' });
    if (status >= 200 && status < 300) {
      delivered++;
      const at = new Date().toISOString();
      await admin.from(table).update({ last_notified_at: at, last_delivered_at: at, last_error: null }).eq('id', device.id);
      await admin.from('myday_notification_log').update({ device_count: 1, delivered_at: at }).in('key', remaining.map((d) => d.key));
      if (!isGuardian) await admin.from('myday_doses').update({ notified: true }).in('id', remaining.map((d) => d.id));
    } else {
      // Deleting claims permits a retry on the next cron without duplicating
      // successes on other devices. Dead subscriptions retain dashboard access.
      await admin.from('myday_notification_log').delete().in('key', keys);
      await admin.from(table).update({
        last_error: `push failed (${status})`,
        ...([404, 410].includes(status) ? { push_enabled: false, ...(isGuardian ? { endpoint: null, subscription: null } : {}) } : {}),
      }).eq('id', device.id);
    }
  }

  try {
    for (const uid of userIds as string[]) {
      const userDoses = list.filter((d: any) => d.user_id === uid && d.medication?.active !== false && d.medication?.reminders_enabled !== false);
      if (shouldSend({ type: 'dose_missed' }, byPrefs[uid]).send) {
        for (const device of (family.data || []).filter((d: any) => d.user_id === uid)) {
          await deliver('myday_family_devices', device, userDoses.filter((d: any) => d.status === 'missed'), uid, false);
        }
      }
      if (!shouldSend({ type: 'guardian_alert' }, byPrefs[uid]).send) continue;
      for (const guardian of (guardians.data || []).filter((g: any) => g.user_id === uid)) {
        for (const device of (guardianDevices.data || []).filter((d: any) => d.guardian_id === guardian.id)) {
          await deliver('myday_guardian_devices', device,
            userDoses.filter((d: any) => guardianAlertDue(d, device, { now, timezone: byProfile[uid]?.timezone || 'UTC' })), uid, true);
        }
      }
    }
  } catch {
    return json({ ok: false, error: 'Could not process alerts; delivery will retry', delivered }, 500);
  }
  return json({ ok: true, mode: 'cron', missed: list.length, delivered });
});
