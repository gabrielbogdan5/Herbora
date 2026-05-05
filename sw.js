const CACHE_NAME = 'herbora-v5';
const OFFLINE_URL = './offline.html';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './offline.html'
];

// ── INSTALL ────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── BACKGROUND SYNC ────────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'sync-favorites') {
    e.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(c => c.postMessage({ type: 'SYNC_FAVORITES' }));
      })
    );
  }
});

// ── PERIODIC BACKGROUND SYNC ───────────────────────────────────
// Fetches "remedy of the day" data in the background daily
self.addEventListener('periodicsync', e => {
  if (e.tag === 'remedy-of-day') {
    e.waitUntil(
      self.clients.matchAll().then(clients => {
        // Pick a new daily remedy and notify all open clients
        const dayIndex = Math.floor(Date.now() / 86400000) % 46;
        clients.forEach(c => c.postMessage({
          type: 'PERIODIC_REMEDY_UPDATE',
          dayIndex
        }));
      })
    );
  }
});

// ── PUSH NOTIFICATIONS ─────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Herbora 🌿', body: 'Your daily remedy is ready!', icon: './icon-192.png' };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch (_) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:  data.body,
      icon:  data.icon || './icon-192.png',
      badge: './icon-192.png',
      tag:   'herbora-daily',
      renotify: true,
      data:  { url: data.url || './' }
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes('Herbora') && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // Google Fonts → cache-first
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => { cache.put(e.request, res.clone()); return res; });
        })
      )
    );
    return;
  }

  // Same-origin → stale-while-revalidate
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const fetchPromise = fetch(e.request)
            .then(res => {
              if (res && res.status === 200) cache.put(e.request, res.clone());
              return res;
            })
            .catch(() => cached || caches.match(OFFLINE_URL) ||
              new Response('Offline', { status: 503 }));
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Everything else → network + cache fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request) || caches.match(OFFLINE_URL))
  );
});
