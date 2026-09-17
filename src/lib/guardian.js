// Guardian-side client. A guardian has no MyDay account and no Supabase
// session, so nothing here uses the authenticated client: every call goes to
// the `guardian-data` edge function, which is the read-only boundary.
//
// The device token is the credential. It lives in localStorage so returning to
// /guardian goes straight to the dashboard instead of asking for a code again,
// and the last payload is cached beside it so a dashboard opened with no signal
// shows yesterday's answer plus "Last updated at…" rather than an empty screen.
import { SUPABASE_URL, SUPABASE_KEY } from './supabase.js';

const TOKEN_KEY = 'myday_guardian_token';
const CACHE_KEY = 'myday_guardian_cache';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/guardian-data`;

export function getGuardianToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}
function setGuardianToken(t) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ }
}
export function clearGuardianDevice() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(CACHE_KEY); } catch {}
}

// ---------- offline cache ----------
export function readCachedDashboard() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.data ? v : null;
  } catch { return null; }
}
function writeCachedDashboard(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
}

// A label the senior will recognise in their Guardians list, without asking
// the guardian to name their own tablet.
export function deviceLabel() {
  const ua = navigator.userAgent || '';
  const iPad = /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iPad) return 'iPad';
  if (/iphone|ipod/i.test(ua)) return 'iPhone';
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/mac os x/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows PC';
  return 'This device';
}

export function platformTag() {
  const ua = navigator.userAgent || '';
  const iPad = /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iPad) return 'ipados';
  if (/iphone|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

/** Thrown when the token is gone or revoked, so the UI can fall back to code entry. */
export class GuardianUnlinked extends Error {
  constructor(message) { super(message || 'This device is no longer connected.'); this.name = 'GuardianUnlinked'; }
}

async function call(body) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The publishable key is required to reach any function on the project;
        // it grants nothing on its own (all guardian authority is the token).
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Distinguishable from a rejection, so the caller can fall back to cache.
    const err = new Error('No internet connection.');
    err.offline = true;
    throw err;
  }

  let payload = {};
  try { payload = await res.json(); } catch { /* non-JSON error page */ }

  if (!res.ok || payload?.error) {
    if (res.status === 401 || payload?.code === 'unlinked') {
      clearGuardianDevice();
      throw new GuardianUnlinked(payload?.error);
    }
    throw new Error(payload?.error || 'Something went wrong. Please try again.');
  }
  return payload;
}

/** Links this device with a 6-digit code. Stores the returned token. */
export async function linkWithCode(code, name) {
  const data = await call({
    action: 'link',
    code: String(code || '').replace(/\D/g, ''),
    name: name || '',
    label: deviceLabel(),
    platform: platformTag(),
  });
  if (data.token) setGuardianToken(data.token);
  writeCachedDashboard(stripToken(data));
  return stripToken(data);
}

/** Fetches the dashboard. Falls back to the cached copy when offline. */
export async function fetchDashboard({ allowCache = true } = {}) {
  const token = getGuardianToken();
  if (!token) throw new GuardianUnlinked('This device is not connected.');
  try {
    const data = await call({ action: 'dashboard', token });
    const clean = stripToken(data);
    writeCachedDashboard(clean);
    return { data: clean, cached: false, at: Date.now() };
  } catch (e) {
    if (e.offline && allowCache) {
      const hit = readCachedDashboard();
      if (hit) return { data: hit.data, cached: true, at: hit.at };
    }
    throw e;
  }
}

// The token is never kept inside the cached payload — it belongs in exactly
// one place, and a cache is the easiest thing to accidentally log or export.
function stripToken(data) {
  const { token, ...rest } = data || {};
  return rest;
}

export async function enableGuardianPush(subscription) {
  const token = getGuardianToken();
  if (!token) throw new GuardianUnlinked();
  const sub = subscription?.toJSON ? subscription.toJSON() : subscription;
  return call({ action: 'subscribe', token, subscription: sub });
}

export async function disableGuardianPush() {
  const token = getGuardianToken();
  if (!token) throw new GuardianUnlinked();
  return call({ action: 'unsubscribe', token });
}

export async function setDailySummary(at) {
  const token = getGuardianToken();
  if (!token) throw new GuardianUnlinked();
  return call({ action: 'summary', token, at: at || null });
}

/** "This is not my device" — revokes the token server-side, then forgets it. */
export async function disconnectThisDevice() {
  const token = getGuardianToken();
  if (!token) { clearGuardianDevice(); return; }
  try { await call({ action: 'disconnect', token }); }
  finally { clearGuardianDevice(); }
}
