// Regressietest voor de opmaak van rijen in het ☰ Lijstjes-paneel op een smal
// (telefoon-breed) scherm. Bob's feedback: de ↑/↓-knoppen om lijstjes te
// herschikken zijn lastig precies te raken. Onderzoek wees uit dat #lists-panel
// dezelfde "archive-panel"-class deelt met het Archief-paneel (voor gedeelde
// paneel-chroom-stijl), en dat paneel zet elders `flex-flow: wrap` op zijn
// item-rijen — die regel lekte ongewild mee naar de lijstjes-rijen en zorgde
// voor een rommelige opmaak (naam afgekapt tot een paar tekens, een knop die
// buiten de kaart uitstak). Dekt: geen horizontale overloop, de naam wordt
// niet zinloos afgekapt, en de ↑/↓-knoppen hebben een fatsoenlijk raakvlak.

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
async function openDangerZone(page) {
  await page.evaluate(() => { document.querySelector(".danger-zone-toggle").open = true; });
}

// Geen enkel direct kind van deze rij mag buiten de rij zelf uitsteken
// (met een kleine marge voor sub-pixel afronding).
async function rijHeeftGeenOverloop(page, rowLocator) {
  return rowLocator.evaluate((row) => {
    const rowBox = row.getBoundingClientRect();
    const marge = 1;
    for (const kind of row.children) {
      if (kind.hidden) continue;
      const box = kind.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right > rowBox.right + marge || box.left < rowBox.left - marge) return false;
    }
    return true;
  });
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // telefoonformaat, zoals Bob gebruikt
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${base}/index.html?lijst=paneel-layout-test-1`);
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForTimeout(200);

  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await nieuwLijstjeViaKnop(page, "Tweede lijst hier met een wat langere naam", { gedeeld: true });
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await nieuwLijstjeViaKnop(page, "Onze privé boodschappen", { gedeeld: false });

  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await page.waitForTimeout(150);

  const rijen = page.locator("#lists-panel-list .lists-panel-row");
  const aantalRijen = await rijen.count();
  check("1. Er staan de verwachte 3 lijstjes in het paneel (setup klopt)", aantalRijen === 3);

  for (let i = 0; i < aantalRijen; i++) {
    const row = rijen.nth(i);
    const naam = await row.locator(".lists-panel-name").textContent();
    check(`2.${i}. Rij "${naam.trim()}" heeft geen enkel kind dat buiten de kaart uitsteekt`, await rijHeeftGeenOverloop(page, row));
  }

  // Kern van Bob's feedback: elke rij hoort op ÉÉN regel te passen, ook met
  // een langere naam (die dan netjes met "…" afkapt i.p.v. naar een 2e/3e
  // regel te wikkelen). Zelfde rijhoogte als een rij met een korte naam
  // bewijst dat er niet gewikkeld is.
  const rowHeights = await page.locator("#lists-panel-list .lists-panel-row").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  const enkeleRegelHoogte = rowHeights[0];
  check("3. Elke rij blijft op één regel, óók met een langere naam (zelfde hoogte als een korte naam, geen wikkel)", rowHeights.every((h) => Math.abs(h - enkeleRegelHoogte) < 2));

  const naamAfgekapt = await page.locator("#lists-panel-list .lists-panel-row").nth(1).locator(".lists-panel-name").evaluate(
    (el) => el.scrollWidth > el.clientWidth // dit IS de bedoeling: liever "…" dan wikkelen
  );
  check("3b. ...een te lange naam kapt daarvoor netjes af met '…' (i.p.v. de rij te breken)", naamAfgekapt);

  const moveBtnBoxes = await page.locator("#lists-panel-list .move-btn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((b) => ({ width: b.width, height: b.height })));
  check("4. Er zijn ↑/↓-knoppen voor elk lijstje (2 per lijstje × 3 lijstjes)", moveBtnBoxes.length === 6);
  check("5. Elke ↑/↓-knop heeft een fatsoenlijk raakvlak (hoogte ≥ 28px, i.p.v. de ~21px van voorheen)", moveBtnBoxes.every((b) => b.height >= 28));

  // Ook de knoppen zelf (Verbergen/Verwijderen) mogen niet half buiten beeld hangen.
  const knopBoxes = await page.locator("#lists-panel-list .lists-panel-hide, #lists-panel-list .lists-panel-delete").evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().right)
  );
  const viewportBreedte = 390;
  check("6. Geen enkele 'Verbergen'/'Verwijderen'-knop steekt over de rand van het scherm heen", knopBoxes.every((r) => r <= viewportBreedte + 1));

  // Archief- en verborgen-rijen delen dezelfde .lists-panel-row-opmaak: ook daar geen overloop.
  await page.click("#archive-btn");
  await openDangerZone(page);
  await page.click("#delete-list-btn");
  await modalBevestig(page);
  await page.waitForTimeout(400);
  await page.waitForSelector("#app:not([hidden])");

  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await page.waitForTimeout(150);
  const archiefRijen = page.locator("#lists-panel-archived .lists-panel-row");
  const aantalArchiefRijen = await archiefRijen.count();
  check("7. Er staat nu 1 lijstje in het archiefgedeelte (setup klopt)", aantalArchiefRijen === 1);
  check("8. Ook de archief-rij heeft geen overloop", await rijHeeftGeenOverloop(page, archiefRijen.first()));

  check("Geen JS-fouten opgetreden tijdens deze hele test", errors.length === 0);

  await ctx.close();
  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
