// MyDay service worker: offline app-shell + web-push handling.
// Vite emits hashed asset filenames, so we cache at runtime rather than precache.
const CACHE = 'myday-v20';
// '/guardian' and its manifest are precached too: a guardian's installed app
// starts there, and it has to open with no signal (they may be in a clinic
// basement). The navigate handler below falls back to the cached index.html,
// which boots the SPA and renders the dashboard from its local cache.
const SHELL = [
  '/', '/index.html', '/guardian',
  '/manifest.webmanifest', '/manifest-guardian.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-72.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    // Anything not the current shell goes, including the old offline
    // health-card images now that My cards has been removed.
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  if (url.origin.includes('supabase.co')) return; // always fresh
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
  }
});

// ---------- web push ----------
// The operating system draws the notification's sender from the app the service
// worker belongs to. Installed to the home screen that reads "MyDay" with the
// MyDay icon; left in a browser tab it reads "Chrome" no matter what we set
// here, which is why the app insists on being installed before enabling alerts.
// Everything below controls the parts we DO own: title, icon, badge, buttons.
const API = 'https://cthpunnnkdgukuogyvxm.supabase.co/functions/v1';

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }

  const title = data.title || 'MyDay';
  const kind = data.kind || 'dose_missed';
  // A missed dose stays on screen until it is dealt with; a due reminder and a
  // summary do not need to be that insistent.
  // Only the second notification — the missed dose — is insistent. The first
  // ("Time for your medicine") and the guardian's daily summary are ordinary
  // notifications with the phone's normal sound.
  const summary = kind === 'guardian_summary' || data.tag === 'myday-guardian-summary';
  const critical = !summary && (kind === 'dose_missed' || kind === 'guardian_alert');

  const actions = Array.isArray(data.actions) && data.actions.length
    ? data.actions.slice(0, 2)
    : (data.actionToken ? [{ action: 'taken', title: 'I took it' }, { action: 'snooze', title: 'Snooze 15 min' }] : []);

  // A web app cannot turn up the phone's notification volume, so when MyDay is
  // open it plays its own loud alarm for a missed dose (src/lib/alarm.js).
  // A due dose arriving while MyDay is open takes over the screen with the
  // full-page "Time for your medicine" alarm (src/components/DueAlarm.jsx).
  const due = kind === 'dose_due';
  const tellOpenApp = (critical || due) && data.silent !== true
    ? self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => list.forEach((c) => c.postMessage({ type: due ? 'myday-due' : 'myday-missed', doseId: data.doseId || null })))
      .catch(() => {})
    : Promise.resolve();

  e.waitUntil(Promise.all([tellOpenApp, self.registration.showNotification(title, {
    body: data.body || 'A medicine may have been missed.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    // Collapses repeats of the same alert instead of stacking them up.
    tag: data.tag || `myday-${kind}`,
    renotify: true,
    // A due dose stays on screen until it is dealt with too: a reminder that
    // slides away unseen is a missed dose.
    requireInteraction: critical || due,
    silent: data.silent === true,
    // A long-short-long buzz is distinct from a message tone, so a missed dose
    // is recognisable from a pocket without looking. A missed dose buzzes much
    // harder and longer: an ordinary message buzz is too easy to sleep through.
    vibrate: data.vibrate === false ? undefined
      : critical ? [800, 200, 800, 200, 800, 200, 1200] : [220, 90, 220, 90, 320],
    lang: 'en',
    dir: 'ltr',
    actions,
    data: {
      url: data.url || '/',
      doseId: data.doseId || null,
      // Single-use, short-lived, and able to do exactly one thing: mark this
      // dose taken. A service worker has no Supabase session, so this is how
      // "I took it" works without opening the app.
      actionToken: data.actionToken || null,
      kind,
    },
  })]));
});

self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();

  // "I took it" — mark the dose and confirm, without ever opening the app.
  if (e.action === 'taken' && d.actionToken) {
    e.waitUntil(doseAction(d.actionToken, 'taken').then((ok) => {
      if (ok) return self.registration.showNotification('Marked as taken', {
        body: 'Well done. Nothing more to do.',
        icon: '/icons/icon-192.png', badge: '/icons/badge-72.png',
        tag: 'myday-ack', silent: true,
      });
      // Never fail silently: if the tap could not be saved, say so and let
      // them open the app, rather than leaving them thinking it was recorded.
      return self.registration.showNotification('Could not save that', {
        body: 'Tap to open MyDay and mark it there.',
        icon: '/icons/icon-192.png', badge: '/icons/badge-72.png',
        tag: 'myday-ack', data: { url: '/medication' },
      });
    }));
    return;
  }

  if (e.action === 'snooze' && d.actionToken) {
    e.waitUntil(doseAction(d.actionToken, 'snooze').then(() =>
      self.registration.showNotification('Reminder snoozed', {
        body: 'We will remind you again shortly.',
        icon: '/icons/icon-192.png', badge: '/icons/badge-72.png',
        tag: 'myday-ack', silent: true,
      })));
    return;
  }

  // Tapping the body opens the right screen. A guardian alert is marked so
  // the app knows this was a tap on the alert, not someone simply reopening
  // MyDay — which, for a person with their own account, starts at Home.
  let target = d.url || '/';
  // A due dose opens straight onto the full-screen alarm for that dose.
  if (d.kind === 'dose_due' && d.doseId) target = `/?due=${encodeURIComponent(d.doseId)}`;
  if (/^\/guardian\/?$/.test(target)) target = '/guardian?from=alert';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        // Bring the existing window forward AND move it to the right screen,
        // rather than focusing whatever page it happened to be left on.
        if ('navigate' in c && target) { try { c.navigate(target); } catch { /* cross-origin or unloaded */ } }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});

// Posts a notification action to the dose-action endpoint. Returns true only
// on a definite success, so the caller can tell the person the truth.
async function doseAction(token, action) {
  try {
    const res = await fetch(`${API}/dose-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return body && body.ok === true;
  } catch {
    return false;
  }
}

// A tap that arrives while offline would otherwise be lost. Where the browser
// supports Background Sync, retry it when the connection returns.
self.addEventListener('sync', (e) => {
  if (e.tag === 'myday-dose-retry') {
    // Nothing queued in this build; the hook exists so a failed tap can be
    // retried rather than silently dropped once queueing is added.
  }
});
