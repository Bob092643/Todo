// Verifieert het rechtstreeks verwijderen van een lijstje vanuit het
// ☰ Lijstjes-paneel (nieuwe "Verwijderen"-knop per rij), zonder eerst naar
// dat lijstje te hoeven wisselen en via archief de danger-zone te openen.
// Dekt: gedeeld + privé, niet-actief + actief lijstje, annuleren, en de
// regressie waarbij een nog niet opgeslagen wijziging (binnen de 400ms-
// debounce) verloren zou kunnen gaan bij het verwijderen van het actieve
// lijstje via deze nieuwe knop.

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

async function modalWacht(page) {
  await page.waitForSelector(".modal-overlay.zichtbaar");
}
async function modalBevestig(page) {
  await modalWacht(page);
  await page.click(".modal-knoppen .btn-primary, .modal-knoppen .btn-danger");
}
async function modalAnnuleer(page) {
  await modalWacht(page);
  await page.click(".modal-knoppen .modal-btn-line");
}
async function modalKiesOptie(page, tekst) {
  await modalWacht(page);
  await page.click(`.modal-keuze-btn:has-text("${tekst}")`);
}
async function modalNieuwLijstje(page, naam, { gedeeld = true } = {}) {
  await modalWacht(page);
  await page.fill(".modal-input", naam);
  if (!gedeeld) await page.click('.modal-keuze-btn:has-text("Privé")');
  await page.click('.modal-knoppen button:has-text("Aanmaken")');
}
async function nieuwLijstjeViaKnop(page, naam, opts) {
  await page.click("#lists-add-btn");
  await modalKiesOptie(page, "Nieuw lijstje aanmaken");
  await modalNieuwLijstje(page, naam, opts);
  await page.waitForTimeout(300);
  await page.waitForSelector("#app:not([hidden])");
}
async function openListsPanel(page) {
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await page.waitForTimeout(100);
}
function rijVoor(page, naam) {
  return page.locator(`#lists-panel-list .lists-panel-row:has-text("${naam}")`);
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // A. Niet-actief gedeeld lijstje rechtstreeks verwijderen vanuit het paneel
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=paneel-verwijder-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    await openListsPanel(page);
    await nieuwLijstjeViaKnop(page, "Kamperen", { gedeeld: true });

    // Terug naar het oorspronkelijke lijstje, zodat "Kamperen" niet actief is.
    await openListsPanel(page);
    await rijVoor(page, "Onze lijst").locator(".lists-panel-name").click();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(150);

    await openListsPanel(page);
    check("A1. 'Kamperen' staat niet actief (het huidige lijstje is 'Onze lijst')", await page.locator(".lists-panel-row.active .lists-panel-name").textContent().then((t) => !t.includes("Kamperen")));
    check("A2. Elke rij heeft nu een 'Verwijderen'-knop (ook zonder eerst te wisselen)", (await rijVoor(page, "Kamperen").locator("button.lists-panel-delete").count()) === 1);

    await rijVoor(page, "Kamperen").locator("button.lists-panel-delete").click();
    await modalWacht(page);
    const modalTekst = await page.textContent(".modal-kaart");
    check("A3. De bevestigingsvraag noemt de naam van HET GEKOZEN lijstje, niet het actieve", modalTekst.includes("Kamperen"));
    await modalBevestig(page);
    await page.waitForTimeout(300);

    check("A4. 'Kamperen' staat meteen niet meer in de gewone lijst (geen wissel nodig geweest)", (await rijVoor(page, "Kamperen").count()) === 0);
    check("A5. We zijn niet weggenavigeerd van 'Onze lijst' (nog steeds actief lijstje)", (await page.locator(".lists-panel-row.active .lists-panel-name").textContent()).includes("Onze lijst"));

    const archivedText = await page.textContent("#lists-panel-archived-section");
    check("A6. 'Kamperen' staat nu in het archief", archivedText.includes("Kamperen"));

    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await openListsPanel(page);
    check("A7. Ook na herladen blijft 'Kamperen' weg uit de gewone lijst (dus echt opgeslagen)", (await rijVoor(page, "Kamperen").count()) === 0);
    const archivedTextNa = await page.textContent("#lists-panel-archived-section");
    check("A8. ...en staat na herladen nog steeds in het archief", archivedTextNa.includes("Kamperen"));

    check("Geen JS-fouten opgetreden tijdens deze sectie", errors.length === 0);

    await ctx.close();
  }

  // B. Niet-actief PRIVÉ lijstje rechtstreeks verwijderen vanuit het paneel
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=paneel-verwijder-test-2`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    await openListsPanel(page);
    await nieuwLijstjeViaKnop(page, "Ons privé lijstje", { gedeeld: false });

    await openListsPanel(page);
    await rijVoor(page, "Onze lijst").locator(".lists-panel-name").click();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(150);

    await openListsPanel(page);
    await rijVoor(page, "🔒 Ons privé lijstje").locator("button.lists-panel-delete").click();
    await modalBevestig(page);
    await page.waitForTimeout(300);

    check("B1. Het niet-actieve privé lijstje is meteen weg uit de gewone lijst", (await rijVoor(page, "🔒 Ons privé lijstje").count()) === 0);
    const archivedText = await page.textContent("#lists-panel-archived-section");
    check("B2. En staat nu in het archief", archivedText.includes("Ons privé lijstje"));

    await ctx.close();
  }

  // C. Annuleren bij het rechtstreeks verwijderen laat het lijstje met rust
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=paneel-verwijder-test-3`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    await openListsPanel(page);
    await nieuwLijstjeViaKnop(page, "Feestje", { gedeeld: true });
    await openListsPanel(page);
    await rijVoor(page, "Onze lijst").locator(".lists-panel-name").click();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(150);

    await openListsPanel(page);
    await rijVoor(page, "Feestje").locator("button.lists-panel-delete").click();
    await modalAnnuleer(page);
    await page.waitForTimeout(200);

    check("C1. Na annuleren staat 'Feestje' nog gewoon in de lijst", (await rijVoor(page, "Feestje").count()) === 1);
    check("C2. En het archief is nog leeg", await page.isHidden("#lists-panel-archived-section"));

    await ctx.close();
  }

  // D. Het ACTIEVE lijstje verwijderen via de nieuwe paneelknop: zelfde
  // wissel-logica als de bestaande "Verwijderen"-knop in het archief, én
  // (de kritieke regressie) een nog niet opgeslagen wijziging gaat niet verloren.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=paneel-verwijder-test-4`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    await openListsPanel(page);
    await nieuwLijstjeViaKnop(page, "Tweede lijstje", { gedeeld: true });
    // "Onze lijst" (het eerste, oorspronkelijke lijstje) is nu niet actief.

    // Direct een item toevoegen op het NU ACTIEVE lijstje ("Tweede lijstje")
    // en METEEN (binnen de 400ms-debounce) verwijderen via het paneel —
    // zonder de oude blokkerende prompt() zou dit een race kunnen zijn.
    await page.fill("#new-item", "Nog niet opgeslagen testitem");
    await page.click("button[type=submit]");

    await openListsPanel(page);
    check("D1. 'Tweede lijstje' staat als actief gemarkeerd", (await page.locator(".lists-panel-row.active .lists-panel-name").textContent()).includes("Tweede lijstje"));
    await rijVoor(page, "Tweede lijstje").locator("button.lists-panel-delete").click();
    await modalWacht(page);
    const modalTekst = await page.textContent(".modal-kaart");
    check("D2. De bevestigingsvraag noemt het actieve lijstje zelf", modalTekst.includes("Tweede lijstje"));
    await modalBevestig(page);
    await page.waitForTimeout(400);
    await page.waitForSelector("#app:not([hidden])");

    check("D3. Na verwijderen van het actieve lijstje wordt automatisch naar een ander lijstje gewisseld", (await page.locator("#list-name").textContent()).trim() === "Onze lijst");

    await openListsPanel(page);
    const archivedText = await page.textContent("#lists-panel-archived-section");
    check("D4. 'Tweede lijstje' staat nu in het archief", archivedText.includes("Tweede lijstje"));

    await page.click(`#lists-panel-archived button:has-text("Terugzetten")`);
    await page.waitForTimeout(300);

    await openListsPanel(page);
    await rijVoor(page, "Tweede lijstje").locator(".lists-panel-name").click();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    check(
      "D5. Regressie: het item dat nog niet opgeslagen was vóór het verwijderen, is niet verloren gegaan",
      await page.locator("#list li", { hasText: "Nog niet opgeslagen testitem" }).count() === 1
    );

    check("Geen JS-fouten opgetreden tijdens deze sectie", errors.length === 0);

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
