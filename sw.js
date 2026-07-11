const CACHE_NAME = 'nawa-pos-v1';
const OFFLINE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const ASSETS = [
  './',
  './index.html',
  './css/variables.css',
  './css/login.css',
  './css/pos.css',
  './css/admin.css',
  './css/super-admin.css',
  './css/components.css',
  './js/config.js',
  './js/db.js',
  './js/auth.js',
  './js/audit.js',
  './js/i18n.js',
  './js/pos.js',
  './js/admin.js',
  './js/super-admin.js',
  './js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => {
      const fetchPromise = fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => r);
      return r || fetchPromise;
    })
  );
});

self.addEventListener('sync', e => {
  if (e.tag === 'sync-orders') {
    e.waitUntil(self.clients.matchAll().then(clients => {
      clients.forEach(c => c.postMessage({ type: 'SYNC_REQUEST' }));
    }));
  }
});
