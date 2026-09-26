// Minimal hand-rolled service worker — no next-pwa, no Workbox, no new deps.
//
// This app is almost entirely dynamic, auth-scoped dashboards (employer /
// employee / candidate portals rendered server-side per signed-in user), so
// "cache the app shell" here deliberately means the STATIC framework shell —
// the hashed /_next/static/* bundles, the manifest, and the install icons —
// never full-page HTML. Caching a signed-in page's HTML risks serving one
// user's dashboard to another user's browser tab after a session change, or
// stale data in a place a user expects fresh; the risk isn't worth the
// offline-page win. Navigations are simply passed through to the network.
const CACHE_NAME = "rt-shell-v1";
const APP_SHELL = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* best-effort — an offline/blocked initial fetch shouldn't fail install */
      })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Hashed, immutable build assets + the install icons: cache-first, falling
  // back to network and quietly caching what comes back.
  const isStaticAsset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-") || url.pathname === "/manifest.webmanifest";
  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
  }
  // Everything else (pages, API calls) goes straight to the network — no
  // interception, no offline fallback. Simple and safe beats clever here.
});
