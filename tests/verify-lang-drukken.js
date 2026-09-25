// Verifieert dat je een item niet meer per se bij het handvatje (⠿) hoeft
// vast te pakken om te verslepen: ergens anders op de rij lang vasthouden
// (zoals in de meeste apps) begint nu ook verslepen. Met als randvoorwaarden:
// - een kort tikje (vinkje afvinken, ⋯-menu openen) mag niet per ongeluk als
//   sleepactie worden opgevat;
// - snel wegbewegen vóórdat de "lang drukken"-tijd vol is (zoals een gewone
//   scrollbeweging) moet het slepen weer afblazen, niet doorzetten.

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

async function volgordeVan(page) {
  return page.$$eval("#list li[data-id] .item-text", (els) => els.map((e) => e.textContent));
}

// Lang drukken op een willekeurige plek in de rij (default: de tekst zelf,
// dus NIET het handvatje) en dan pas bewegen — net als de echte gebruiker.
async function langDrukEnSleep(page, vanSelector, deltaY, { wachtMs = 450 } = {}) {
  const el = page.locator(vanSelector);
  const box = await el.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(wachtMs); // stilhouden tot de "lang drukken"-tijd vol is
  const stappen = 8;
  for (let i = 1; i <= stappen; i++) {
    await page.mouse.move(startX, startY + (deltaY * i) / stappen, { steps: 2 });
  }
  await page.mouse.up();
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // ============================================================
  // A. Lang drukken op de TEKST van een item (niet het handvatje) en dan
  //    bewegen, verplaatst het item echt.
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=lang-drukken-test`);
    await page.waitForSelector("#app:not([hidden])");
    for (const naam of ["Eén", "Twee", "Drie"]) {
      await page.fill("#new-item", naam);
      await page.click("button[type=submit]");
      await page.waitForTimeout(80);
    }
    check("A1. Volgorde start zoals toegevoegd", JSON.stringify(await volgordeVan(page)) === JSON.stringify(["Eén", "Twee", "Drie"]));

    const rowHoogte = (await page.locator("li:has-text('Eén')").boundingBox()).height;
    await langDrukEnSleep(page, "li:has-text('Eén') .item-text", rowHoogte * 2);
    await page.waitForTimeout(150);
    check("A2. Na lang drukken + slepen op de TEKST staat 'Eén' verderop in de lijst", (await volgordeVan(page))[0] !== "Eén");

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // ============================================================
  // B. Snel wegbewegen vóórdat de tijd vol is (zoals scrollen) blaast het
  //    slepen af — de volgorde verandert dan NIET.
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=lang-drukken-scroll-test`);
    await page.waitForSelector("#app:not([hidden])");
    for (const naam of ["Eén", "Twee", "Drie"]) {
      await page.fill("#new-item", naam);
      await page.click("button[type=submit]");
      await page.waitForTimeout(80);
    }

    const rowHoogte = (await page.locator("li:has-text('Eén')").boundingBox()).height;
    // GEEN wachttijd hier: meteen bewegen, zoals een scrollbeweging, vóórdat
    // de "lang drukken"-tijd (400ms) vol is.
    await langDrukEnSleep(page, "li:has-text('Eén') .item-text", rowHoogte * 2, { wachtMs: 0 });
    await page.waitForTimeout(150);
    check("B1. Snel bewegen (geen echte 'lang drukken') verandert de volgorde niet", JSON.stringify(await volgordeVan(page)) === JSON.stringify(["Eén", "Twee", "Drie"]));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // ============================================================
  // C. Een kort tikje op het vinkje of het ⋯-knopje wordt niet als
  //    sleepactie opgevat — die blijven gewoon normaal werken.
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=lang-drukken-vinkje-test`);
    await page.waitForSelector("#app:not([hidden])");
    await page.fill("#new-item", "Melk");
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);

    await page.locator("li:has-text('Melk') .check input").click();
    await page.waitForTimeout(150);
    check("C1. Een tik op het vinkje vinkt het item nog gewoon af", await page.locator("li:has-text('Melk')").evaluate((li) => li.classList.contains("done")));

    await page.locator("li:has-text('Melk') .item-menu-btn").click();
    await page.waitForTimeout(80);
    check("C2. Een tik op het ⋯-knopje opent nog gewoon het menu", await page.locator("li:has-text('Melk') .item-menu").isVisible());

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
