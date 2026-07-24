// MyDay - multi-user missed-dose checker (cron every 5 min).
//   - ensures today's/yesterday's doses for ALL users (each in their own tz),
//   - flips overdue pending doses to missed,
//   - web-pushes each user's family devices, e.g. "Mary has not taken their 9:00 AM medication."
// { test:true } with a user bearer token sends a test alert to that user's devices.
// Web push (RFC 8291 / aes128gcm) implemented with Web Crypto; VAPID keys read
// from the locked-down myday_push_config table via the service role.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
const b64urlToBuf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
const bufToB64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const concat = (...a: Uint8Array[]) => { const t = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { t.set(x, o); o += x.length; } return t; };

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

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function encryptPayload(p256dh: string, authKey: string, plaintext: string) {
  const uaPublic = b64urlToBuf(p256dh); const authSecret = b64urlToBuf(authKey);
  const asPair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', asPair.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPair.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const record = concat(enc.encode(plaintext), new Uint8Array([0x02]));
  const aesKey = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}
async function vapidAuth(endpoint: string, pub: string, priv: string, contact: string) {
  const aud = new URL(endpoint).origin;
  const header = bufToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bufToB64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact })));
  const signingInput = `${header}.${payload}`;
  const p = b64urlToBuf(pub);
  const jwk = { kty: 'EC', crv: 'P-256', x: bufToB64url(p.subarray(1, 33)), y: bufToB64url(p.subarray(33, 65)), d: priv, ext: true, key_ops: ['sign'] };
  const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  return `vapid t=${signingInput}.${bufToB64url(sig)}, k=${pub}`;
}
type Vapid = { public: string; private: string; contact: string };
async function sendPush(subscription: any, payload: object, vapid: Vapid): Promise<number> {
  try {
    const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, JSON.stringify(payload));
    const auth = await vapidAuth(subscription.endpoint, vapid.public, vapid.private, vapid.contact);
    const res = await fetch(subscription.endpoint, { method: 'POST', headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: auth }, body });
    return res.status;
  } catch { return 0; }
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
  async function broadcast(table: string, devices: any[], payload: object): Promise<{ delivered: number; dead: string[] }> {
    let delivered = 0; const dead: string[] = []; const ok: string[] = [];
    for (const d of devices) { const s = await sendPush(d.subscription, payload, vapid); if (s >= 200 && s < 300) { delivered++; ok.push(d.id); } else if (s === 404 || s === 410) dead.push(d.id); }
    if (dead.length) await admin.from(table).delete().in('id', dead);
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
    const { delivered } = await broadcast('myday_family_devices', devices || [], { title: 'MyDay test alert', body: `Test alert for ${name}. Missed-dose alerts are working.`, url: './' });
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

      delivered += (await broadcast('myday_family_devices', famByUser[uid] || [], payload)).delivered;

      for (const g of (guardiansByUser[uid] || [])) {
        const gd = devByGuardian[g.id] || [];
        if (!gd.length) continue;
        const res = await broadcast('myday_guardian_devices', gd, payload);
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
