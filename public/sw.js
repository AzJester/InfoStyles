// InfoStyles service worker: makes the app installable and usable offline.
// - Navigations: network-first, falling back to the cached shell when offline.
// - Static assets (JS/CSS/JSON/icons): cache-first with a background refresh.
// - /api/* and /uploads/*: always go to the network (must stay fresh / dynamic).
const CACHE = "infostyles-v4";
const PRECACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/icon.svg",
  "/js/main.js",
  "/js/theme-init.js",
  "/data/styles.json",
  "/data/categories.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Don't fail the whole install if one optional file is missing.
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // leave cross-origin alone
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) return;

  // Navigations: fresh HTML when online, cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))));
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
