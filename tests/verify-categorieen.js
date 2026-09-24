// Verifieert de nieuwe categorieën-functie: ingebouwd woordenboek
// (herkent + maakt categorie aan), per-lijstje leren van een eigen keuze,
// zelf categorieën beheren (toevoegen/hernoemen/verwijderen), en
// groeperen op categorie in de lijstweergave.

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

async function withDialogQueue(page, answers, fn) {
  const queue = [...answers];
  const handler = async (dialog) => {
    const answer = queue.shift();
    if (answer === false || answer === undefined) await dialog.dismiss();
    else if (answer === true) await dialog.accept();
    else await dialog.accept(answer);
  };
  page.on("dialog", handler);
  try {
    await fn();
  } finally {
    page.off("dialog", handler);
  }
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

  await page.goto(`http://localhost:${port}/index.html?lijst=cat-test`);
  await page.waitForSelector("#app:not([hidden])");

  // --- Woordenboek: herkent + maakt categorie aan ---
  await page.fill("#new-item", "Melk");
  await page.click("button[type=submit]");
  await page.waitForTimeout(120);
  check("Y1. 'Melk' krijgt automatisch de categorie 'Zuivel'", (await page.textContent(".cat-pill")).includes("Zuivel"));

  await page.fill("#new-item", "Schroeven 4mm");
  await page.click("button[type=submit]");
  await page.waitForTimeout(120);
  const pillen = await page.$$eval(".cat-pill", (els) => els.map((e) => e.textContent.trim()));
  check("Y2. Een onbekend item krijgt 'Overig'", pillen.some((t) => t.includes("Overig")));

  // --- Zelf een categorie kiezen + leren voor volgende keer ---
  const laatstePill = page.locator(".cat-pill").last();
  await laatstePill.click();
  await page.waitForSelector("#cat-kies-menu:not([hidden])");
  await withDialogQueue(page, ["Onderhoud"], async () => {
    await page.click(".kies-optie-nieuw");
    await page.waitForTimeout(150);
  });
  check("Y3. Zelfgekozen categorie 'Onderhoud' verschijnt op het item", (await laatstePill.textContent()).includes("Onderhoud"));
  check("Y4. Het keuzemenu is weer dicht", await page.isHidden("#cat-kies-menu"));

  await page.fill("#new-item", "Schroeven 4mm");
  await page.click("button[type=submit]");
  await page.waitForTimeout(120);
  const laatstePill2 = await page.locator(".cat-pill").last().textContent();
  check("Y5. Dezelfde naam opnieuw toevoegen leert de eerder gekozen categorie", laatstePill2.includes("Onderhoud"));

  // --- Categorieën beheren: hernoemen en verwijderen ---
  await page.click("#cat-beheer-btn");
  await page.waitForSelector("#cat-beheer-menu:not([hidden])");
  const aantalRijenVoor = await page.$$eval(".cat-beheer-row", (els) => els.length);
  check("Y6. Beheervenster toont de bestaande categorieën", aantalRijenVoor >= 2);

  await withDialogQueue(page, ["Melkproducten"], async () => {
    await page.click(".cat-beheer-row:has-text('Zuivel') button[title='Hernoemen']");
    await page.waitForTimeout(120);
  });
  check("Y7. Hernoemen werkt en is meteen op het item te zien", (await page.textContent(".cat-pill")).includes("Melkproducten"));

  await withDialogQueue(page, [true], async () => {
    await page.click(".cat-beheer-row:has-text('Melkproducten') button[title='Verwijderen']");
    await page.waitForTimeout(120);
  });
  check("Y8. Na verwijderen valt het item terug op 'Overig'", (await page.textContent(".cat-pill")).includes("Overig"));

  await page.click("#cat-beheer-close-btn");
  check("Y9. Beheervenster sluit weer", await page.isHidden("#cat-beheer-menu"));

  // --- Groeperen op categorie ---
  await page.click("#groep-btn");
  await page.waitForTimeout(120);
  check("Y10. Groepskopjes verschijnen in de lijst", (await page.textContent("#list")).includes("Onderhoud"));
  check("Y11. De knop laat 'aan' zien", (await page.textContent("#groep-btn")).includes("aan"));

  // Blijft staan na herladen (device-only voorkeur, net als compacte weergave)
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  check("Y12. Groeperen blijft aan staan na herladen", (await page.textContent("#groep-btn")).includes("aan"));

  // --- Blijft na herladen ook echt bewaard (categorieën zijn opgeslagen bij het lijstje) ---
  // Let op: "Zuivel" is eerder in deze test al hernoemd (Y7, naar
  // "Melkproducten") en daarna verwijderd (Y8), dus die naam hoort na
  // deze reload nergens meer te staan. Wat wél moet blijven staan is de
  // categorie "Onderhoud" (nog steeds in gebruik) — dát bevestigt dat
  // categorieën echt bij het lijstje worden opgeslagen, niet alleen in het
  // geheugen van de pagina.
  const pillenNaHerladen = await page.$$eval(".cat-pill", (els) => els.map((e) => e.textContent.trim()));
  check("Y13. Categorieën blijven na herladen behouden (Onderhoud)", pillenNaHerladen.some((t) => t.includes("Onderhoud")));

  check("Geen JS-fouten opgetreden tijdens deze hele test", jsErrors.length === 0);
  if (jsErrors.length) console.log(jsErrors);

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail > 0 ? 1 : 0);
})();
