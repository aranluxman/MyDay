// MyDay - missed-dose checker (runs on a cron every few minutes).
//
// What it does on a normal (cron) run:
//   1. Ensures today's + yesterday's dose rows exist (timezone-aware).
//   2. Flips any dose still "pending" more than 1 hour after it was due to "missed".
//   3. For each newly missed dose, sends a web-push alert to every family device,
//      e.g. "Dad has not taken his 9:00 AM medication."
//
// With { "test": true } in the body it just sends a test alert to all devices.
//
// Web push (RFC 8291 / aes128gcm) is implemented with Web Crypto - no external
// push library. The VAPID keypair is read from the locked-down myday_push_config
// table using the service role (never exposed to the browser).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ---------- small helpers ----------
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
const b64urlToBuf = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
const bufToB64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const concat = (...a: Uint8Array[]) => {
  const t = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of a) { t.set(x, o); o += x.length; } return t;
};

function prettyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// RFC 8291 aes128gcm payload encryption.
async function encryptPayload(p256dh: string, authKey: string, plaintext: string) {
  const uaPublic = b64urlToBuf(p256dh);
  const authSecret = b64urlToBuf(authKey);
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

// VAPID Authorization header (ES256 JWT + public key).
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

// Returns the HTTP status from the push service (or 0 on network error).
async function sendPush(subscription: any, payload: object, vapid: Vapid): Promise<number> {
  try {
    const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, JSON.stringify(payload));
    const auth = await vapidAuth(subscription.endpoint, vapid.public, vapid.private, vapid.contact);
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
        'Urgency': 'high',
        'Authorization': auth,
      },
      body,
    });
    return res.status;
  } catch (_e) {
    return 0;
  }
}

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let test = false;
  try { const b = await req.json(); test = !!b?.test; } catch { /* empty body = cron run */ }

  // VAPID keys (service-role only).
  const { data: cfg } = await admin.from('myday_push_config').select('*').eq('id', 1).maybeSingle();
  if (!cfg) return json({ ok: false, error: 'push not configured' }, 200, cors);
  const vapid: Vapid = { public: cfg.vapid_public, private: cfg.vapid_private, contact: cfg.contact };

  const { data: settings } = await admin.from('myday_settings').select('*').eq('patient_id', '00000000-0000-0000-0000-000000000001').maybeSingle();
  const patientName = settings?.patient_name || 'Dad';
  const tz = settings?.timezone || 'UTC';

  const { data: devices } = await admin.from('myday_family_devices').select('*');
  const deviceList = devices || [];

  // ----- helper: send one message to every device, prune dead subscriptions -----
  async function broadcast(payload: object): Promise<number> {
    let delivered = 0;
    const dead: string[] = [];
    const okIds: string[] = [];
    for (const d of deviceList) {
      const status = await sendPush(d.subscription, payload, vapid);
      if (status >= 200 && status < 300) { delivered++; okIds.push(d.id); }
      else if (status === 404 || status === 410) dead.push(d.id);
    }
    if (dead.length) await admin.from('myday_family_devices').delete().in('id', dead);
    if (okIds.length) await admin.from('myday_family_devices').update({ last_notified_at: new Date().toISOString() }).in('id', okIds);
    return delivered;
  }

  // ----- test mode -----
  if (test) {
    const delivered = await broadcast({
      title: 'MyDay test alert',
      body: `This is a test. ${patientName}'s missed-dose alerts are working.`,
      url: './',
    });
    return json({ ok: true, mode: 'test', devices: deviceList.length, delivered }, 200, cors);
  }

  // ----- cron run: ensure doses + mark missed -----
  await admin.rpc('myday_refresh_doses', { p_timezone: tz });

  // Newly missed doses (within the last day) that haven't been alerted yet.
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: missed } = await admin
    .from('myday_doses')
    .select('id, scheduled_time, due_at, medication:myday_medications(name)')
    .eq('status', 'missed').eq('notified', false).gte('due_at', dayAgo)
    .order('due_at', { ascending: true });

  const missedList = missed || [];
  let totalDelivered = 0;
  for (const dose of missedList) {
    const medName = (dose as any).medication?.name as string | undefined;
    const body = `${patientName} has not taken his ${prettyTime(dose.scheduled_time)} medication${medName ? ` (${medName})` : ''}.`;
    if (deviceList.length) totalDelivered += await broadcast({ title: 'MyDay', body, url: './', tag: `dose-${dose.id}` });
    // Mark as alerted even if no devices are registered yet, so we don't backlog.
    await admin.from('myday_doses').update({ notified: true }).eq('id', dose.id);
  }

  return json({ ok: true, mode: 'cron', missed: missedList.length, devices: deviceList.length, delivered: totalDelivered }, 200, cors);
});

function json(obj: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
