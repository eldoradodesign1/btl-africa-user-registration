const CACHE_NAME = "btl-africa-user-registration-v2";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // HTML et assets versionnés (hash dans le nom) : réseau d'abord,
  // cache en repli pour le mode hors-ligne.
  const isNavigation = event.request.mode === "navigate";
  const isHashedAsset = url.pathname.includes("/assets/");

  if (isNavigation || isHashedAsset) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const response = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, response);
            });
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (isNavigation) return caches.match("./index.html");
            throw new Error("Offline");
          }),
        ),
    );
    return;
  }

  // Autres ressources (icônes, manifest) : cache d'abord.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        const response = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, response);
        });
        return networkResponse;
      });
    }),
  );
});
