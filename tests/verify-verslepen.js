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
  check("V3. Elk open item heeft een sleep-handvat", (await page.$$(".drag-handle")).length === 4);

  // Naast slepen kan het ook met ↑/↓-knopjes achter het ⋯-menu (fijner op
  // een telefoon dan precies moeten mikken) — bij het eerste item in de
  // groep hoort "omhoog" uitgeschakeld te zijn, bij het laatste "omlaag".
  const eersteLi = page.locator("#list li[data-id]").first();
  await eersteLi.locator(".item-menu-btn").click();
  await page.waitForTimeout(80);
  check("V2a. Bij het eerste item is 'omhoog' uitgeschakeld", await eersteLi.locator(".move-item-btn").first().isDisabled());
  check("V2b. Bij het eerste item is 'omlaag' gewoon te gebruiken", !(await eersteLi.locator(".move-item-btn").nth(1).isDisabled()));
  await page.click("body");
  await page.waitForTimeout(80);

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

  // Ook los van slepen: het 2e item met de "omhoog"-knop (achter ⋯) een
  // plekje naar voren zetten moet 'm laten wisselen met het 1e item.
  const verwachtNaKnop = [...naHerladen];
  [verwachtNaKnop[0], verwachtNaKnop[1]] = [verwachtNaKnop[1], verwachtNaKnop[0]];
  const tweedeLi = page.locator("#list li[data-id]").nth(1);
  await tweedeLi.locator(".item-menu-btn").click();
  await page.waitForTimeout(80);
  await tweedeLi.locator(".move-item-btn").first().click(); // "↑ Naar boven"
  await page.waitForTimeout(150);
  check("V6b. Ook via ↑/↓ achter het ⋯-knopje verplaatsen werkt", JSON.stringify(await volgordeVan(page)) === JSON.stringify(verwachtNaKnop));

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
