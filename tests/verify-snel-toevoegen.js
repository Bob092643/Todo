// Verifieert "Snel toevoegen": handmatige favorieten (★) en automatisch
// leren van vaak toegevoegde items, allebei als klikbare chips boven de
// lijst, en dat een chip verdwijnt zodra dat item al openstaat.

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.join(__dirname, "test-run");

function makeServer(root) {
  return http.createServer((req, res) => {
    let filePath = path.join(root, decodeURIComponent(req.url.split("?")[0]));
    if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found: " + filePath); return; }
      const ext = path.extname(filePath);
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    });
  });
}

let pass = 0, fail = 0;
function check(label, cond) {
  console.log((cond ? "✅" : "❌") + " " + label);
  if (cond) pass++; else fail++;
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));

  await page.goto(`http://localhost:${port}/index.html?lijst=snel-test`);
  await page.waitForSelector("#app:not([hidden])");

  check("W1. Zonder favorieten/geschiedenis is de snel-toevoegen-rij verborgen", await page.isHidden("#snel-toevoegen-rij"));

  // --- Favoriet maken via ster-knopje ---
  await page.fill("#new-item", "Afwasmiddel");
  await page.click("button[type=submit]");
  await page.waitForTimeout(100);
  await page.click(".fav-btn");
  await page.waitForTimeout(100);
  check("W2. Ster-knopje staat op actief na klikken", await page.locator(".fav-btn").first().evaluate((b) => b.classList.contains("active")));

  // Item afvinken + verwijderen: favoriet moet blijven bestaan (zit op de tekst, niet op dit item)
  await page.click(".check input");
  await page.waitForTimeout(100);
  await page.click(".delete-btn");
  await page.waitForTimeout(400);
  check("W3. Favoriet verschijnt als chip zodra het item niet meer openstaat", (await page.textContent("#snel-toevoegen-rij")).includes("Afwasmiddel"));
  check("W4. De rij is niet meer verborgen", await page.isVisible("#snel-toevoegen-rij"));

  // --- Chip klikken voegt het item weer toe ---
  await page.click(".snel-chip");
  await page.waitForTimeout(100);
  check("W5. Klikken op de chip voegt het item toe aan de lijst", (await page.textContent("#list")).includes("Afwasmiddel"));
  check("W6. De chip verdwijnt zodra het item alweer openstaat", !(await page.textContent("#snel-toevoegen-rij")).includes("Afwasmiddel"));

  // --- Automatisch leren: 2x hetzelfde toevoegen (en weer verwijderen) laat het vanzelf verschijnen ---
  await page.click(".delete-btn"); // "Afwasmiddel" weer weg, telt niet mee voor deze nieuwe naam
  await page.waitForTimeout(400);
  await page.fill("#new-item", "Vuilniszakken");
  await page.click("button[type=submit]");
  await page.waitForTimeout(100);
  await page.click(".delete-btn");
  await page.waitForTimeout(400);
  check("W7. Na 1x toevoegen nog geen automatische suggestie", !(await page.textContent("#snel-toevoegen-rij")).includes("Vuilniszakken"));

  await page.fill("#new-item", "Vuilniszakken");
  await page.click("button[type=submit]");
  await page.waitForTimeout(100);
  await page.click(".delete-btn");
  await page.waitForTimeout(400);
  check("W8. Na 2x toevoegen verschijnt het vanzelf als suggestie", (await page.textContent("#snel-toevoegen-rij")).includes("Vuilniszakken"));

  // --- Favoriet weer uitzetten ---
  await page.fill("#new-item", "Afwasmiddel");
  await page.click("button[type=submit]");
  await page.waitForTimeout(100);
  await page.click(".fav-btn");
  await page.waitForTimeout(100);
  check("W9. Ster-knopje weer uit na nogmaals klikken", !(await page.locator(".fav-btn").first().evaluate((b) => b.classList.contains("active"))));

  // --- Blijft na herladen bewaard (bij het lijstje zelf) ---
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  check("W10. Vuilniszakken-suggestie blijft na herladen bestaan", (await page.textContent("#snel-toevoegen-rij")).includes("Vuilniszakken"));

  check("Geen JS-fouten opgetreden tijdens deze hele test", jsErrors.length === 0);
  if (jsErrors.length) console.log(jsErrors);

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail > 0 ? 1 : 0);
})();
