// Web push (RFC 8291 aes128gcm + RFC 8292 VAPID) on Web Crypto only — no
// external push library, so nothing third-party sits in the path of a
// medication alert.
//
// Extracted verbatim from missed-dose-check so `send-reminders` does not carry
// a second copy of the crypto. missed-dose-check still has its own inlined
// copy: it is the safety-critical path that is known to work in production,
// and swapping its internals out in the same change as everything else is not
// a trade worth making. Once send-reminders has run in production for a while,
// missed-dose-check should import this too and its copy should be deleted.

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export const b64urlToBuf = (s: string) =>
  Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')),
    (c) => c.charCodeAt(0),
  );

export const bufToB64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const concat = (...a: Uint8Array[]) => {
  const t = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) { t.set(x, o); o += x.length; }
  return t;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

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
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

async function vapidAuth(endpoint: string, pub: string, priv: string, contact: string) {
  const aud = new URL(endpoint).origin;
  const header = bufToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bufToB64url(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact,
  })));
  const signingInput = `${header}.${payload}`;
  const p = b64urlToBuf(pub);
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: bufToB64url(p.subarray(1, 33)), y: bufToB64url(p.subarray(33, 65)),
    d: priv, ext: true, key_ops: ['sign'],
  };
  const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  return `vapid t=${signingInput}.${bufToB64url(sig)}, k=${pub}`;
}

export type Vapid = { public: string; private: string; contact: string };

/**
 * Delivers one push. Returns the HTTP status, or 0 when the request itself
 * failed — callers treat 404/410 as a dead subscription and anything else
 * non-2xx as worth retrying later.
 *
 * `urgency` is 'high' for a missed dose and 'normal' for a routine reminder,
 * so a phone in battery-saver mode still wakes for the one that matters.
 */
export async function sendPush(
  subscription: any, payload: object, vapid: Vapid,
  { urgency = 'high', ttl = 86400 }: { urgency?: 'very-low' | 'low' | 'normal' | 'high'; ttl?: number } = {},
): Promise<number> {
  try {
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return 0;
    const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, JSON.stringify(payload));
    const auth = await vapidAuth(subscription.endpoint, vapid.public, vapid.private, vapid.contact);
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
        Authorization: auth,
      },
      body,
    });
    return res.status;
  } catch {
    return 0;
  }
}
