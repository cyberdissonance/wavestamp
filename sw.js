// ── WaveStamp Service Worker ──
// Increment CACHE_VERSION on every deploy to force all clients to update
const CACHE_VERSION = 'wavestamp-v3';

// Only cache external CDN assets — never cache index.html
const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Syne+Mono&display=swap',
  'https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.js',
];

// On install — cache CDN assets and skip waiting immediately
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(CDN_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// On activate — delete ALL old caches and claim all clients immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
      .then(() => {
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
        });
      })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // NEVER cache index.html — always fetch fresh from network
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/'))
    );
    return;
  }

  // Cache CDN assets only
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE_VERSION).then(c => c.put(e.request, res.clone()));
          return res;
        });
      })
    );
    return;
  }
  // All other requests — pass through, no caching
});
