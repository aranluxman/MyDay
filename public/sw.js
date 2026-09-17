// MyDay service worker: offline app-shell + web-push handling.
// Vite emits hashed asset filenames, so we cache at runtime rather than precache.
const CACHE = 'myday-v6';
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
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'MyDay';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'A medicine may have been missed.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || 'myday-missed-dose',
    renotify: true,
    requireInteraction: true,
    // A long-short-long buzz is distinct from a message tone, so a missed dose
    // is recognisable from a pocket without looking.
    vibrate: [220, 90, 220, 90, 320],
    lang: 'en',
    dir: 'ltr',
    actions: [{ action: 'open', title: 'Open MyDay' }],
    data: { url: data.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
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
