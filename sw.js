const CACHE_NAME = "my-app-cache-v1";

const urlsToCache = [
  "./",
  "./index.html",
  "./dashboard.html",
  "./students.html",
  "./classes.html",
  "./fees.html",
  "./reports.html",

  "./css/style.css",

  "./js/auth.js",
  "./js/classes.js",
  "./js/config.js",
  "./js/dashboard.js",
  "./js/fees.js",
  "./js/layout.js",
  "./js/reports.js",
  "./js/students.js",
  "./js/supabaseClient.js",
  "./js/utils.js",

  "./manifest.json",

  "./img/fee-pulse-192.png",
  "./img/fee-pulse-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});