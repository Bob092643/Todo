const CACHE_NAME = "boodschappenlijst-v20";
// Belangrijk: sinds app.js is opgeknipt in losse module-bestanden (die
// app.js zelf met "import" inleest) moeten die HIER OOK stuk voor stuk bij
// staan — anders werkt de app zelf niet meer offline (index.html/app.js
// zouden dan wel uit de cache komen, maar de losse module-bestanden die
// app.js nodig heeft weer niet, dus zou de app alsnog niet opstarten
// zonder internet).
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
  "./categorieen.js",
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

  // Alleen onze eigen app-schil cachen. Alles van buiten dit domein
  // (Firebase/Firestore-verkeer, de Firebase SDK) gaat altijd gewoon
  // rechtstreeks over het netwerk — nooit cachen, want dat is live data.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ============================================================
// Pushmeldingen (optioneel — alleen relevant als je dit hebt ingesteld,
// zie README.md stap 4). Dit stukje zorgt dat er een systeemmelding
// verschijnt zodra er een pushbericht binnenkomt terwijl de app zelf niet
// openstaat; is de app wél open, dan vangt app.js het bericht zelf af
// (zie onMessage daar) en laat het als toastje zien in plaats daarvan.
//
// In try/catch: als dit onderdeel om wat voor reden dan ook niet lukt
// (bijv. geen internet bij de allereerste installatie van de service
// worker, of pushmeldingen zijn nog helemaal niet ingesteld), blijft de
// rest van deze service worker — de offline-cache hierboven, het
// belangrijkste onderdeel — daar helemaal los van gewoon werken.
try {
  importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");
  // Dezelfde instellingen als de rest van de app (config.js) — hoef je dus
  // maar op één plek in te vullen.
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
