const CACHE_NAME = "boodschappenlijst-v40";
// Elke module die app.js importeert moet hier ook staan, anders start de app offline niet op.
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./dom.js",
  "./kleur.js",
  "./naam.js",
  "./toast.js",
  "./dialoog.js",
  "./update.js",
  "./compact.js",
  "./tekst.js",
  "./config.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Bewust GEEN self.skipWaiting() hier: deze nieuwe worker blijft "waiting"
  // tot de pagina er zelf om vraagt (via het update-balkje, zie update.js) —
  // zo kan de gebruiker eerst zien dat er een update is in plaats van dat de
  // app zomaar onder 'm verandert.
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return; // extern verkeer (Firestore e.d.) nooit cachen, is live data

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
