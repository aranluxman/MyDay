// MyDay service worker: app-shell caching for PWA/offline + web-push handling.
const CACHE = 'myday-v2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './main.js', './app.js', './react.js', './ui.js', './config.js', './db.js', './push.js',
  './home.js', './meds.js', './appts.js', './games.js', './gamedata.js', './settings.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // App navigations -> serve the cached shell so the SPA opens offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  // Supabase REST/RPC must always hit the network (fresh data); don't cache.
  if (url.origin.includes('supabase.co')) return;

  // Same-origin assets + esm.sh modules (React/htm/supabase): cache-first.
  if (url.origin === location.origin || url.hostname === 'esm.sh') {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => hit))
    );
  }
});

// ---------- web push ----------
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'MyDay';
  const options = {
    body: data.body || 'A medicine may have been missed.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'myday-missed-dose',
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || './' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
