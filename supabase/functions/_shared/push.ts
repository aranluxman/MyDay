// Shared web-push (RFC 8291 / aes128gcm) implemented with Web Crypto, plus the
// VAPID config loader and a device broadcaster. Used by both the missed-dose
// checker and the daily-summary function so the crypto lives in one place.
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
const b64urlToBuf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
const bufToB64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const concat = (...a: Uint8Array[]) => { const t = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { t.set(x, o); o += x.length; } return t; };

export type Vapid = { public: string; private: string; contact: string };

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

// Send one push. Returns the HTTP status (0 on a thrown error).
export async function sendPush(subscription: any, payload: object, vapid: Vapid): Promise<number> {
  try {
    const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, JSON.stringify(payload));
    const auth = await vapidAuth(subscription.endpoint, vapid.public, vapid.private, vapid.contact);
    const res = await fetch(subscription.endpoint, { method: 'POST', headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: auth }, body });
    return res.status;
  } catch { return 0; }
}

// Read the singleton VAPID config (service role only).
export async function loadVapid(admin: any): Promise<Vapid | null> {
  const { data: cfg } = await admin.from('myday_push_config').select('*').eq('id', 1).maybeSingle();
  if (!cfg) return null;
  return { public: cfg.vapid_public, private: cfg.vapid_private, contact: cfg.contact };
}

// Push `payload` to a set of devices in `table` (family or guardian devices),
// pruning dead subscriptions (404/410) and stamping last_notified_at on success.
export async function broadcast(admin: any, vapid: Vapid, table: string, devices: any[], payload: object): Promise<{ delivered: number; dead: string[] }> {
  let delivered = 0; const dead: string[] = []; const ok: string[] = [];
  for (const d of devices) { const s = await sendPush(d.subscription, payload, vapid); if (s >= 200 && s < 300) { delivered++; ok.push(d.id); } else if (s === 404 || s === 410) dead.push(d.id); }
  if (dead.length) await admin.from(table).delete().in('id', dead);
  if (ok.length) await admin.from(table).update({ last_notified_at: new Date().toISOString() }).in('id', ok);
  return { delivered, dead };
}
