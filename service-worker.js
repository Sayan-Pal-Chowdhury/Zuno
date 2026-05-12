const CACHE_NAME = "zuno-pwa-v4";

const APP_SHELL = [
  "/",
  "/login.html",
  "/home.html",
  "/index.html",
  "/sales.html",
  "/customer.html",
  "/credit.html",
  "/finance.html",
  "/settings.html",
  "/shop-setup.html",
  "/shops.html",
  "/shop.html",
  "/cart.html",
  "/orders.html",
  "/inventory.htm",
  "/style.css",
  "/inventory.css",
  "/voice.css",
  "/auth.js",
  "/shop-init.js",
  "/shop-store.js",
  "/shop-topbar.js",
  "/shop-navbar.js",
  "/shop-cart.js",
  "/shops.js",
  "/shop.js",
  "/cart.js",
  "/orders.js",
  "/shop.css",
  "/credit.js",
  "/editSaleModal.js",
  "/finance.js",
  "/firebase.js",
  "/inventory.js",
  "/navbar.js",
  "/sales.js",
  "/script.js",
  "/settings.js",
  "/topbar.js",
  "/voice.js",
  "/pwa.js",
  "/manifest.json",
  "/zuno-icon-192.png",
  "/zuno-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/login.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
