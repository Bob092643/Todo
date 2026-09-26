// Simuleert een deploy (bestanden veranderen onder dezelfde URL) en verifieert dat het
// ophogen van CACHE_NAME in sw.js een al-gecachede telefoon de nieuwe versie laat zien.

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
  copyDir(V1, LIVE); // schone lei: een vorige run kan "live" op v2 hebben achtergelaten

  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto(`${base}/index.html`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  check("1e bezoek toont VERSIE-1", (await page.textContent("#marker")) === "VERSIE-1");

  copyDir(V2, LIVE); // simuleert een deploy: nieuwe inhoud + opgehoogde CACHE_NAME

  // reg.update() expliciet aanroepen i.p.v. te wachten op Chromium's eigen achtergrondcontrole.
  // De listener moet al klaarstaan vóór reg.update(), in dezelfde evaluate()-aanroep, anders kan
  // "controllerchange" al afgevuurd zijn vóór we luisterden.
  const controllerChanged = await page.evaluate(async () => {
    const changed = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(true), { once: true });
      setTimeout(() => resolve(false), 4000);
    });
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    return changed;
  });

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
