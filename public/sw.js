/**
 * Service Worker — offline caching for Constrictor PWA.
 *
 * Strategy: Cache-first for the app shell.
 *
 * How it works:
 *   1. On INSTALL: we pre-cache the root HTML page and icons.
 *      Vite-built JS/CSS bundles have hashed filenames, so we don't
 *      pre-cache them — they'll be cached on first fetch instead.
 *
 *   2. On ACTIVATE: we delete any old caches from previous versions.
 *      Bumping CACHE_VERSION forces a full cache refresh.
 *
 *   3. On FETCH: we check the cache first. If we have a cached response,
 *      return it immediately (fast!). If not, fetch from network, cache
 *      the response for next time, and return it. If both cache and
 *      network fail, fall back to the cached root page (SPA — the router
 *      handles all routes from index.html).
 *
 * Why cache-first? Constrictor is a local-first app with no server API.
 * All data lives in IndexedDB. The only thing we fetch from the network
 * is the app shell itself (HTML/JS/CSS). Once cached, the app should
 * load instantly from cache every time.
 */

const CACHE_VERSION = 'constrictor-v1.1';

const PRECACHE_URLS = [
  '/Constrictor/',
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
// Cache-first: serve from cache if available, otherwise fetch from
// network and cache the response. Navigation requests (page loads)
// fall back to the cached root page for SPA routing.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests (not POST, etc.)
  if (request.method !== 'GET') return;

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
          // Network failed and not in cache — for navigation requests,
          // fall back to the cached root page (SPA routing)
          if (request.mode === 'navigate') {
            return caches.match('/Constrictor/');
          }
          // For other requests (images, etc.), just fail
          return new Response('Offline', { status: 503 });
        });
    })
  );
});
