// Test: simuleert een "git push" naar GitHub Pages (bestanden op de server
// veranderen onder dezelfde URL) en controleert of het ophogen van
// CACHE_NAME in sw.js ervoor zorgt dat een telefoon die de app al had
// geïnstalleerd/gecached, alsnog de nieuwe versie te zien krijgt.

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const BASE_DIR = path.join(__dirname, "sw-cache-test");
const LIVE = path.join(BASE_DIR, "live");
const V1 = path.join(BASE_DIR, "v1");
const V2 = path.join(BASE_DIR, "v2");

function copyDir(src, dst) {
  for (const name of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, name), path.join(dst, name));
  }
}

const server = http.createServer((req, res) => {
  let filePath = path.join(LIVE, decodeURIComponent(req.url.split("?")[0]));
  if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found: " + filePath); return; }
    const ext = path.extname(filePath);
    const type = { ".html": "text/html", ".js": "text/javascript" }[ext] || "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
});

let pass = true;
function check(label, cond) {
  console.log((cond ? "✅" : "❌") + " " + label);
  if (!cond) pass = false;
}

(async () => {
  // "live" moet bij elke run weer met een schone lei starten (gelijk aan
  // v1) — anders laat een vorige testrun, die "live" op v2 achterlaat als
  // "push"-simulatie, deze test bij de volgende keer meteen al mislukken
  // op stap 1 ("1e bezoek toont VERSIE-1"), terwijl daar niks mis mee is.
  copyDir(V1, LIVE);

  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 1) Eerste bezoek: v1 wordt geladen en door de service worker gecached
  //    (zoals een telefoon die de app voor het eerst installeert).
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  check("1e bezoek toont VERSIE-1", (await page.textContent("#marker")) === "VERSIE-1");

  // 2) "git push": de live bestanden op de server worden vervangen door v2
  //    (nieuwe inhoud + opgehoogde CACHE_NAME in sw.js), precies zoals een
  //    GitHub Pages-deploy de bestanden op dezelfde URL vervangt.
  copyDir(V2, LIVE);

  // 3) De browser controleert normaal gesproken vanzelf, bij het opnieuw
  //    openen van de app, of sw.js veranderd is. In deze geautomatiseerde
  //    test triggeren we die controle expliciet (registration.update()) om
  //    niet afhankelijk te zijn van de timing van Chromium's eigen
  //    achtergrondcontrole — het mechanisme zelf (skipWaiting +
  //    clients.claim, hieronder gecontroleerd) is identiek aan wat er in
  //    het echt gebeurt.
  //
  // Belangrijk: de listener moet AL klaarstaan vóórdat reg.update() wordt
  // aangeroepen, en dat moet allebei in dezelfde page.evaluate()-aanroep
  // gebeuren — anders zit er een round-trip tussen "bijwerken starten" en
  // "gaan luisteren", en kan skipWaiting()+clients.claim() de
  // "controllerchange" allang hebben afgevuurd vóórdat we uberhaupt
  // luisterden (een race die niets zegt over of het omschakelen zelf wel
  // goed werkte — dat wordt hieronder sowieso al gecontroleerd via de
  // vernieuwde inhoud en de cachenamen).
  const controllerChanged = await page.evaluate(async () => {
    const changed = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(true), { once: true });
      setTimeout(() => resolve(false), 4000);
    });
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    return changed;
  });

  // 4) Nogmaals openen: nu moet de nieuwe (v2) service worker de boel
  //    bedienen en de vernieuwde inhoud tonen.
  await page.reload();
  await page.waitForTimeout(500);
  check("De actieve service worker is daadwerkelijk gewisseld (controllerchange)", controllerChanged);
  const markerAfterUpdate = await page.textContent("#marker");
  check("Na de 'push' + heropenen verschijnt VERSIE-2 (niet de oude cache)", markerAfterUpdate === "VERSIE-2");

  const cacheNames = await page.evaluate(() => caches.keys());
  check("De oude cache (test-cache-v1) is opgeruimd", !cacheNames.includes("test-cache-v1"));
  check("De nieuwe cache (test-cache-v2) staat klaar", cacheNames.includes("test-cache-v2"));

  await browser.close();
  server.close();

  console.log(pass ? "\n✅ GESLAAGD: het ophogen van CACHE_NAME laat updates goed doorkomen" : "\n❌ MISLUKT");
  process.exit(pass ? 0 : 1);
})();
