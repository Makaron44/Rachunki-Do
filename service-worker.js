/* Simple cache-first service worker (Safari-friendly) */
var CACHE = 'billreminder-v21'; // ← PODBIJ wersję przy każdym deployu!
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

// Install: wgraj do cache i od razu aktywuj nową wersję SW
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); }) // ← kluczowe dla Safari/iOS
  );
});

// Activate: wyczyść stare cache i przejmij kontrolę nad klientami
self.addEventListener('activate', function (e) {
  e.waitUntil(
    Promise.all([
      caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                              .map(function (k) { return caches.delete(k); }));
      }),
      self.clients.claim() // ← kluczowe dla Safari/iOS
    ])
  );
});

// Fetch: cache-first tylko dla GET; reszta leci do sieci
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // nie cache’uj POST/PUT itd.

  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        // Tylko same-origin i status 200 do cache
        try {
          var copy = resp.clone();
          if (resp.ok && new URL(req.url).origin === self.location.origin) {
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
        } catch (e) { /* ignore */ }
        return resp;
      }).catch(function () {
        return cached; // offline fallback jeśli coś było
      });
    })
  );
});
