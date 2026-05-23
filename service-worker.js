const CACHE_NAME = "zuno-pwa-v20";

const APP_SHELL = [
  "/",
  "/login.html",
  "/customer-login.html",
  "/account-type.html",
  "/home.html",
  "/index.html",
  "/sales.html",
  "/customer.html",
  "/credit.html",
  "/finance.html",
  "/settings.html",
  "/admin.html",
  "/shop-setup.html",
  "/shops.html",
  "/shop.html",
  "/cart.html",
  "/orders.html",
  "/inventory.htm",
  "/menu.html",
  "/style.css",
  "/inventory.css",
  "/menu.css",
  "/voice.css",
  "/auth.js",
  "/customer-login.js",
  "/account-type.js",
  "/shop-init.js",
  "/shop-store.js",
  "/shop-topbar.js",
  "/shop-navbar.js",
  "/shop-cart.js",
  "/marketplace-categories.js",
  "/marketplace-visuals.js",
  "/product-images.js",
  "/item-suggestions.js",
  "/unit-pricing.js",
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
  "/menu.js",
  "/navbar.js",
  "/sales.js",
  "/script.js",
  "/settings.js",
  "/admin.js",
  "/topbar.js",
  "/voice.js",
  "/pwa.js",
  "/manifest.json",
  "/zuno-icon-192.png",
  "/zuno-icon-512.png",
  "/zuno-logo.png"
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

  if (["script", "style"].includes(request.destination)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
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
