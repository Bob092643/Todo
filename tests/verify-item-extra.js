// Verifieert "Wis alles" bij afgeronde items (met gezamenlijke "Ongedaan maken") en het zoek/filter-veldje.

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
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // A. "Wis alles" bij afgeronde items
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=wis-afgevinkte-test`);
    await page.waitForSelector("#app:not([hidden])");

    for (const naam of ["Appels", "Bananen", "Citroenen"]) {
      await page.fill("#new-item", naam);
      await page.click("button[type=submit]");
      await page.waitForTimeout(80);
    }

    check("A1. Geen 'Wis alles'-knop zolang niks is afgevinkt", (await page.locator(".wis-afgevinkte-btn").count()) === 0);

    await page.locator("li:has-text('Appels') .check input").click();
    await page.waitForTimeout(80);
    await page.locator("li:has-text('Bananen') .check input").click();
    await page.waitForTimeout(150);

    check("A2. 'Afgerond (2)' met een 'Wis alles'-knop verschijnt", (await page.textContent("#list")).includes("Afgerond (2)"));
    check("A2b. Citroenen (nog open) staat er nog gewoon bij", (await page.textContent("#list")).includes("Citroenen"));

    await page.click(".wis-afgevinkte-btn");
    await page.waitForTimeout(150);

    check("A3. Beide afgevinkte items zijn in één keer weg uit de lijst", !(await page.textContent("#list")).includes("Appels") && !(await page.textContent("#list")).includes("Bananen"));
    check("A4. Citroenen (nog open) staat er nog steeds", (await page.textContent("#list")).includes("Citroenen"));
    check("A5. Geen 'Afgerond'-kopje meer (niks meer afgevinkt over)", !(await page.textContent("#list")).includes("Afgerond"));

    await page.click("#archive-btn");
    await page.waitForTimeout(100);
    check("A6. Beide gewiste items staan in het archief", (await page.textContent("#archive-list")).includes("Appels") && (await page.textContent("#archive-list")).includes("Bananen"));
    await page.click("#archive-close-btn");

    check("A7. Eén gezamenlijke 'Ongedaan maken'-melding (niet 2 losse)", (await page.textContent("#toast-text")).includes("2 afgeronde items"));

    await page.click("#toast-undo-btn");
    await page.waitForTimeout(150);
    check("A8. Na 'Ongedaan maken' staan beide items weer terug, nog steeds afgevinkt", (await page.textContent("#list")).includes("Appels") && (await page.textContent("#list")).includes("Bananen") && (await page.textContent("#list")).includes("Afgerond (2)"));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);

    await ctx.close();
  }

  // B. Zoek/filter-veldje boven de lijst
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=zoek-test`);
    await page.waitForSelector("#app:not([hidden])");

    check("B1. Zoekveldje verborgen zolang de lijst leeg is", await page.isHidden("#zoek-veld"));

    for (const naam of ["Melk", "Bruinbrood", "Kaas", "Appelmoes"]) {
      await page.fill("#new-item", naam);
      await page.click("button[type=submit]");
      await page.waitForTimeout(80);
    }
    check("B2. Zoekveldje verschijnt zodra er items zijn", await page.isVisible("#zoek-veld"));

    await page.fill("#zoek-veld", "appel");
    await page.waitForTimeout(150);
    const lijstNaFilter = await page.textContent("#list");
    check("B3. Filteren op 'appel' toont alleen Appelmoes", lijstNaFilter.includes("Appelmoes") && !lijstNaFilter.includes("Melk") && !lijstNaFilter.includes("Kaas"));
    check("B4. Geen 'niks gevonden'-melding als er wél een match is", await page.isHidden("#zoek-geen-resultaten"));

    await page.fill("#zoek-veld", "iets-wat-niet-bestaat");
    await page.waitForTimeout(150);
    check("B5. Bij geen enkele match verschijnt de 'niks gevonden'-melding", await page.isVisible("#zoek-geen-resultaten"));
    check("B5b. ...met de gezochte term erin", (await page.textContent("#zoek-geen-resultaten")).includes("iets-wat-niet-bestaat"));

    await page.fill("#zoek-veld", "");
    await page.waitForTimeout(150);
    const lijstLeeggemaakt = await page.textContent("#list");
    check("B6. Zoekveld leegmaken toont alle items weer", ["Melk", "Bruinbrood", "Kaas", "Appelmoes"].every((n) => lijstLeeggemaakt.includes(n)));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
