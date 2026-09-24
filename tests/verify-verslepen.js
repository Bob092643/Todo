// Verifieert het verslepen van items om ze te herordenen (in plaats van de
// oude ↑/↓-knoppen): met de muis vastpakken bij het handvatje (⠿) en naar
// een andere plek slepen, binnen dezelfde groep (open/vastgepind).

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

async function sleepVan(page, vanSelector, deltaY) {
  const handle = page.locator(vanSelector);
  const box = await handle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // In kleine stapjes bewegen, zodat er onderweg genoeg pointermove-events
  // vuren (net als een echte sleepbeweging).
  const stappen = 8;
  for (let i = 1; i <= stappen; i++) {
    await page.mouse.move(startX, startY + (deltaY * i) / stappen, { steps: 2 });
  }
  await page.mouse.up();
}

async function volgordeVan(page) {
  return page.$$eval("#list li[data-id] .item-text", (els) => els.map((e) => e.textContent));
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

  await page.goto(`http://localhost:${port}/index.html?lijst=sleep-test`);
  await page.waitForSelector("#app:not([hidden])");

  for (const naam of ["Eén", "Twee", "Drie", "Vier"]) {
    await page.fill("#new-item", naam);
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);
  }

  check("V1. Volgorde start zoals toegevoegd", JSON.stringify(await volgordeVan(page)) === JSON.stringify(["Eén", "Twee", "Drie", "Vier"]));
  // Let op: ".move-btn" bestaat ook nog (bewust) voor het herordenen van
  // lijstjes zelf in het ☰-paneel — dat is een ander stuk functionaliteit
  // en blijft gewoon met pijltjes werken. Hier gaat het puur om de
  // items-lijst zelf (#list).
  check("V2. Er zijn geen ↑/↓-knoppen meer in de items-lijst (vervangen door het handvat)", (await page.$$("#list .move-btn")).length === 0);
  check("V3. Elk open item heeft een sleep-handvat", (await page.$$(".drag-handle")).length === 4);

  // Sleep het eerste item ("Eén") ver genoeg naar beneden om voorbij "Twee" én "Drie" te komen.
  const li = page.locator('li[data-id]').first();
  const rowHeight = (await li.boundingBox()).height;
  await sleepVan(page, ".drag-handle >> nth=0", rowHeight * 2.5);
  await page.waitForTimeout(150);
  const naVerslepen = await volgordeVan(page);
  check("V4. 'Eén' staat na het verslepen verderop in de lijst", naVerslepen.indexOf("Eén") > 0);
  check("V5. Alle 4 items staan er nog steeds (niets kwijtgeraakt)", naVerslepen.length === 4 && ["Eén", "Twee", "Drie", "Vier"].every((n) => naVerslepen.includes(n)));

  // Blijft bewaard na herladen
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  const naHerladen = await volgordeVan(page);
  check("V6. Nieuwe volgorde blijft na herladen behouden", JSON.stringify(naHerladen) === JSON.stringify(naVerslepen));

  // --- Vastgepinde items vormen een eigen groep --- (de pin-knop zit
  // achter het "⋯"-actiemenu van het item, dus dat moet eerst open).
  await page.click('li[data-id]:has-text("Vier") .item-menu-btn');
  await page.click('li[data-id]:has-text("Vier") .pin-btn');
  await page.waitForTimeout(100);
  check("V7. Vastgepind item staat los van de normale volgorde (aparte groep)", (await page.textContent("#list")).indexOf("📌 Vastgepind") < (await page.textContent("#list")).indexOf("Vier"));

  check("Geen JS-fouten opgetreden tijdens deze hele test", jsErrors.length === 0);
  if (jsErrors.length) console.log(jsErrors);

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail > 0 ? 1 : 0);
})();
