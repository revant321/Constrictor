/**
 * Service Worker — offline caching for Constrictor PWA.
 *
 * Strategy: Two-tier caching.
 *
 *   - Navigation requests (HTML): NETWORK-FIRST.
 *     Always try the network so the browser gets the latest index.html
 *     (which references the correct hashed JS/CSS bundles). Fall back
 *     to the cached copy only when offline.
 *
 *   - Static assets (JS/CSS/images): CACHE-FIRST.
 *     Vite adds content hashes to filenames (index-a1b2c3.js), so a
 *     cached copy is always valid — the filename changes when the
 *     content changes. This makes loads instant from cache.
 *
 * How it works:
 *   1. On INSTALL: we pre-cache the root HTML page and icons.
 *      Vite-built JS/CSS bundles have hashed filenames, so we don't
 *      pre-cache them — they'll be cached on first fetch instead.
 *
 *   2. On ACTIVATE: we delete any old caches from previous versions.
 *      Bumping CACHE_VERSION forces a full cache refresh.
 *
 *   3. On FETCH: navigation requests use network-first (fall back to
 *      cached /Constrictor/index.html for SPA routing). Asset requests
 *      use cache-first (fall back to network, then cache the response).
 */

const CACHE_VERSION = 'constrictor-v3.0';

const INDEX_HTML = '/Constrictor/index.html';

const PRECACHE_URLS = [
  '/Constrictor/',
  INDEX_HTML,
  '/Constrictor/icons/icon-192.svg',
  '/Constrictor/icons/icon-512.svg',
];

// ─── Install ─────────────────────────────────────────────────────
// Pre-cache essential assets. We do NOT call skipWaiting() here —
// the new SW waits in the "waiting" state until the user explicitly
// approves the update from the UI. This prevents the app from
// reloading out from under the user mid-session.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

// ─── Message ─────────────────────────────────────────────────────
// When the UI sends a SKIP_WAITING message (user accepted the update),
// call skipWaiting() to promote this waiting SW to active. The browser
// then fires a 'controllerchange' event on all controlled pages,
// which our main.tsx listener uses to reload.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── Activate ────────────────────────────────────────────────────
// Clean up old caches when a new SW version takes over.
// claim() makes this SW control all open tabs immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────
// Two strategies:
//   Navigation (HTML): network-first → cache fallback (SPA index.html)
//   Assets (JS/CSS/img): cache-first → network fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests (not POST, etc.)
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    // ── Navigation: network-first ──
    // Always try the network so we get the latest index.html (which
    // references the correct hashed JS/CSS bundles). If the network
    // returns a non-200 (e.g., 404 for an SPA route like /passwords),
    // fall back to the cached index.html — React Router handles routing.
    // If the network is down entirely, same fallback.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(request, responseToCache);
            });
            return response;
          }
          // Server returned 404/500/etc — serve cached index.html
          // (SPA routing: React Router will handle the path)
          return caches.match(INDEX_HTML) || caches.match('/Constrictor/');
        })
        .catch(() => {
          // Network is down — serve cached index.html for offline use
          return caches.match(INDEX_HTML) || caches.match('/Constrictor/');
        })
    );
    return;
  }

  // ── Assets: cache-first ──
  // Vite hashes filenames (index-a1b2c3.js), so a cached copy is
  // always correct — the hash changes when the content changes.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Don't cache non-ok responses or opaque responses
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }

          // Clone the response — one copy for the cache, one for the browser
          const responseToCache = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          // Asset not in cache and network failed
          return new Response('Offline', { status: 503 });
        });
    })
  );
});
