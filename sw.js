const CACHE_NAME = "boodschappenlijst-v30";
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
  "./compact.js",
  "./tekst.js",
  "./config.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
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

// Pushmeldingen (optioneel, zie README.md stap 4): toont een systeemmelding
// als de app dicht is; open app.js vangt het bericht zelf af als toastje.
// try/catch zodat de offline-cache hierboven blijft werken als dit faalt.
try {
  importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");
  importScripts("./config.js");

  firebase.initializeApp(CONFIG.firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const titel = (payload.notification && payload.notification.title) || "Boodschappenlijst";
    const tekst = (payload.notification && payload.notification.body) || "Er is iets nieuws toegevoegd";
    self.registration.showNotification(titel, { body: tekst, icon: "./icon-192.png" });
  });
} catch (e) {
  console.warn("Pushmeldingen-onderdeel van de service worker kon niet laden (de rest van de app werkt gewoon door):", e);
}
