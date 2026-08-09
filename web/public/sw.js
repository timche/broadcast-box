/**
 * Minimal service worker: it exists so the app is installable, and to keep it
 * opening when the network is down.
 *
 * Deliberately caches nothing but the app shell. Streams, chat and the API are
 * live by nature, and a cached build would serve stale JS against a freshly
 * released backend — so every request except a page navigation goes straight
 * to the network, and navigations only fall back to the cache when offline.
 */

const SHELL_CACHE = "shell-v1";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(SHELL_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Everything that isn't a page load — assets, /api, SSE, WHIP/WHEP — is left
  // entirely alone.
  if (request.method !== "GET" || request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
        return response;
      })
      .catch(() => caches.match(SHELL_URL).then((cached) => cached ?? Response.error())),
  );
});
