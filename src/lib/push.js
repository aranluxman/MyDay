import { VAPID_PUBLIC_KEY } from './supabase.js';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// True when MyDay is running from the home screen / as an installed app rather
// than inside a browser tab. This is what decides whether an alert is presented
// as "MyDay" or as the browser, so the UI gates on it.
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || window.matchMedia?.('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('This phone does not support alerts.');
  const reg = await navigator.serviceWorker.ready;
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm === 'denied') throw new Error('Alerts are blocked for MyDay. Open your device settings, allow notifications for MyDay, then try again.');
  if (perm !== 'granted') throw new Error('Alerts were not allowed. Please tap Allow when your device asks.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY),
    });
  }
  return sub;
}

function urlB64ToUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
