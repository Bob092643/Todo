// Verifieert de 3 grote UX-vervangingen voor native browser-dialogen:
//  A. Het eigen modal-systeem (dialoog.js) dat confirm()/prompt() vervangt.
//  B. De losse foutmelding-toast (toast.js, #error-toast) die alert() vervangt.
//  C. Het update-beschikbaar-balkje (update.js/sw.js), inclusief de regressie
//     die deze test specifiek bewaakt: een gewone eerste paginabezoek mag
//     zichzelf NIET vanzelf herladen zodra de service worker de pagina claimt
//     (self.clients.claim() in sw.js) — dat gebeurde een tijd lang wél, omdat
//     "controllerchange" ook bij die allereerste keer afgaat.

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.join(__dirname, "test-run");
const SW_PATH = path.join(ROOT, "sw.js");

function makeServer(root) {
  return http.createServer((req, res) => {
    let filePath = path.join(root, decodeURIComponent(req.url.split("?")[0]));
    if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("not found: " + filePath); return; }
      const ext = path.extname(filePath);
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[ext] || "application/octet-stream";
      // Belangrijk voor sectie C: de browser mag deze niet browser-cachen, anders
      // ziet 'ie de aangepaste sw.js hieronder niet als "nieuwe versie".
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
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
async function modalWegSelector(page) {
  await page.waitForSelector(".modal-overlay", { state: "detached", timeout: 3000 }).catch(() => {});
}
// #update-balk staat altijd op display:flex (nodig voor de inschuif-animatie) en
// schuift alleen via een CSS-transform in/uit beeld, dus Playwright's isVisible()/
// isHidden() (die naar display/opacity kijken) zien 'm altijd als "zichtbaar". De
// echte staat is de "hidden"-DOM-property samen met de .zichtbaar-class.
async function balkEchtZichtbaar(page) {
  return page.evaluate(() => {
    const el = document.getElementById("update-balk");
    return !!el && !el.hidden && el.classList.contains("zichtbaar");
  });
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();
  const swOrigineel = fs.readFileSync(SW_PATH, "utf8");

  // A. Het modal-systeem zelf (dialoog.js)
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=modal-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    // A1. Escape sluit een vraagInvoer-modal zonder wijziging (vervangt prompt()-annuleren).
    await page.click("#rename-btn");
    await modalWacht(page);
    await page.keyboard.press("Escape");
    await modalWegSelector(page);
    check("A1. Escape sluit de naam-modal zonder de naam te wijzigen", (await page.textContent("#list-name")) === "Onze lijst");

    // A2. Klikken naast de kaart (op de overlay-achtergrond) sluit 'm ook, zonder wijziging.
    await page.click("#rename-btn");
    await modalWacht(page);
    await page.click(".modal-overlay", { position: { x: 5, y: 5 } });
    await modalWegSelector(page);
    check("A2. Klikken naast de kaart sluit de modal ook zonder wijziging", (await page.textContent("#list-name")) === "Onze lijst");

    // A3. Enter in het invoerveld dient de modal in (niet alleen de knop).
    await page.click("#rename-btn");
    await modalWacht(page);
    await page.fill(".modal-input", "Naam via Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    check("A3. Enter in het invoerveld bevestigt de modal, net als de knop", (await page.textContent("#list-name")) === "Naam via Enter");

    // A4. vraagKeuze ("Lijstje toevoegen"): 2 keuzeknoppen, Annuleren maakt niets aan.
    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    const lijstjesVoor = await page.locator(".lists-panel-row").count();
    await page.click("#lists-add-btn");
    await modalWacht(page);
    const keuzeKnoppen = await page.locator(".modal-keuze-btn").allInnerTexts();
    check("A4a. 'Lijstje toevoegen' toont de 2 verwachte keuzes", keuzeKnoppen.some((t) => t.includes("Nieuw lijstje aanmaken")) && keuzeKnoppen.some((t) => t.includes("Aansluiten via code")));
    await page.click(".modal-knoppen .modal-btn-line"); // Annuleren
    await modalWegSelector(page);
    await page.waitForTimeout(150);
    check("A4b. Annuleren bij die keuze maakt geen nieuw lijstje aan", (await page.locator(".lists-panel-row").count()) === lijstjesVoor);

    // A5. vraagBevestiging met gevaarlijk:true toont de rode ("btn-danger") knop, niet de blauwe.
    await page.click("#lists-close-btn").catch(() => {});
    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    await page.click(".danger-zone-summary");
    await page.waitForSelector("#delete-list-btn:visible");
    await page.click("#delete-list-btn");
    await modalWacht(page);
    check("A5. De verwijder-bevestiging gebruikt de rode ('gevaarlijke') knopstijl", (await page.locator(".modal-knoppen .btn-danger").count()) === 1);
    await page.click(".modal-knoppen .modal-btn-line"); // niet echt verwijderen, gewoon annuleren
    await modalWegSelector(page);
    await page.click("#archive-close-btn");

    // A6. toonTekst: het "tekst delen"-scherm toont de tekst alleen-lezen, met een "Sluiten"-knop.
    await page.fill("#new-item", "Kaas");
    await page.click("button[type=submit]");
    await page.waitForTimeout(120);
    // Clipboard-API is in deze headless testcontext niet beschikbaar, dus de fallback (toonTekst) treedt vanzelf in werking.
    await page.click("#settings-btn");
    await page.waitForSelector("#settings-panel:not([hidden])");
    await page.selectOption("#tekst-delen-select", { index: 0 }).catch(() => {});
    await page.click("#tekst-delen-btn");
    await modalWacht(page);
    const gedeeldeTekst = await page.inputValue(".modal-textarea").catch(() => null);
    check("A6a. Het 'tekst delen'-scherm toont de items van de lijst, alleen-lezen", !!gedeeldeTekst && gedeeldeTekst.includes("Kaas"));
    check("A6b. Het invoerveld is echt niet te bewerken (readonly)", await page.getAttribute(".modal-textarea", "readonly") !== null);
    await page.click(".modal-knoppen .btn-primary"); // "Sluiten"
    await modalWegSelector(page);

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // B. De foutmelding-toast (vervangt alert())
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=toast-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    // B1. Duidelijke foutmelding bij een ongeldige lijst-code.
    await page.click("#list-code-btn");
    await modalWacht(page);
    await page.fill(".modal-input", "foute/code/met/slash");
    await page.click(".modal-knoppen .btn-primary");
    await page.waitForSelector("#error-toast:not([hidden])", { timeout: 3000 }).catch(() => {});
    const foutTekst = await page.textContent("#error-toast-text").catch(() => "");
    check("B1. De foutmelding-toast toont een duidelijke tekst over de '/'", foutTekst.includes("/"));

    // B2. De foutmelding verdwijnt vanzelf (na ~7s), niet blijvend zichtbaar.
    await page.waitForSelector("#error-toast[hidden]", { timeout: 9000 }).catch(() => {});
    check("B2. De foutmelding-toast verdwijnt vanzelf weer na een tijdje", await page.isHidden("#error-toast"));

    // B3. De foutmelding-toast en de gewone (undo-)toast kunnen tegelijk zichtbaar zijn.
    await page.fill("#new-item", "Tijdelijk item");
    await page.click("button[type=submit]");
    await page.waitForTimeout(120);
    await page.click("#list li .item-menu-btn");
    await page.click("#list li .delete-btn"); // toont de gewone undo-toast
    await page.waitForTimeout(100);
    await page.click("#list-code-btn"); // en meteen ook een foutmelding erbovenop
    await modalWacht(page);
    await page.fill(".modal-input", "nog/een/foute/code");
    await page.click(".modal-knoppen .btn-primary");
    await page.waitForSelector("#error-toast:not([hidden])", { timeout: 3000 }).catch(() => {});
    check(
      "B3. De undo-toast en de foutmelding-toast staan tegelijk zichtbaar, zonder elkaar te verdringen",
      (await page.isVisible("#toast")) && (await page.isVisible("#error-toast"))
    );

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // C. Het update-beschikbaar-balkje (update.js + sw.js)
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=update-test-1`);
    await page.waitForSelector("#app:not([hidden])");

    check("C1. Het update-balkje is bij een gewoon bezoek verborgen", !(await balkEchtZichtbaar(page)));

    // C2. DE regressietest: de allereerste keer dat de service worker de pagina
    // claimt (self.clients.claim() in de activate-handler) mag de pagina niet
    // vanzelf herladen. Vroeger gebeurde dat wél, omdat "controllerchange" ook
    // bij die allereerste keer afgaat (zie update.js: verversGevraagd-vlag).
    await page.evaluate(() => { window.__geenAutoHerlaad = true; });
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000); // ruim de tijd voor een eventuele onterechte herlaad
    check(
      "C2. Eerste keer 'geclaimd' worden door de service worker herlaadt de pagina niet vanzelf",
      await page.evaluate(() => window.__geenAutoHerlaad === true)
    );
    check("...en het balkje verschijnt daarbij ook niet", !(await balkEchtZichtbaar(page)));

    // C3. Een ECHTE nieuwe versie (ander sw.js) laat na een herlaad het balkje verschijnen.
    const nieuweSw = swOrigineel.replace(/boodschappenlijst-v(\d+)/, (m, n) => `boodschappenlijst-v${Number(n) + 1}-test`);
    fs.writeFileSync(SW_PATH, nieuweSw);
    try {
      await page.reload();
      await page.waitForSelector("#app:not([hidden])");
      await page.waitForFunction(() => {
        const el = document.getElementById("update-balk");
        return el && !el.hidden && el.classList.contains("zichtbaar");
      }, { timeout: 10000 }).catch(() => {});
      check("C3. Een echt nieuwe sw.js laat na herladen het update-balkje verschijnen", await balkEchtZichtbaar(page));

      // C4. Op ✕ tikken verbergt de balk weer, zonder te herladen.
      await page.evaluate(() => { window.__nietHerladenBijSluiten = true; });
      await page.click("#update-sluit-btn");
      await page.waitForTimeout(400);
      check("C4. Op ✕ tikken verbergt de balk weer", !(await balkEchtZichtbaar(page)));
      check("...zonder de pagina te herladen", await page.evaluate(() => window.__nietHerladenBijSluiten === true));

      // C5. Op "Ververs" tikken herlaadt de pagina daadwerkelijk (en maar één keer).
      // (De balk is door C4 net weggeklikt terwijl de wachtende worker nog steeds
      // klaarstaat; een fris reload laat 'm daarom via reg.waiting opnieuw zien.)
      await page.reload();
      await page.waitForSelector("#app:not([hidden])");
      await page.waitForFunction(() => {
        const el = document.getElementById("update-balk");
        return el && !el.hidden && el.classList.contains("zichtbaar");
      }, { timeout: 10000 }).catch(() => {});
      await page.evaluate(() => { window.__marker = "voor-ververs"; });
      await page.click("#update-ververs-btn");
      await page.waitForFunction(() => window.__marker !== "voor-ververs", { timeout: 10000 }).catch(() => {});
      check("C5. Op 'Ververs' tikken herlaadt de pagina daadwerkelijk", (await page.evaluate(() => window.__marker)) !== "voor-ververs");
      await page.waitForSelector("#app:not([hidden])");
      check("...en de app werkt daarna gewoon door (geen kapotte staat)", await page.isVisible("#app"));
    } finally {
      fs.writeFileSync(SW_PATH, swOrigineel); // altijd herstellen, ook als een check hierboven faalde
    }

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
