// Verifieert dat de statusbalk onderaan blijft (geen overlap) in ☰-paneel/archief,
// en dat een gearchiveerd lijstje (gedeeld of privé) definitief verwijderd kan worden.

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

// <details> onthoudt open/dicht in de DOM: zet direct, niet via een klik (die zou juist weer dichtklappen).
async function openDangerZone(page) {
  await page.evaluate(() => {
    document.querySelector(".danger-zone-toggle").open = true;
  });
}

// Modal-helpers: vervangen withDialogQueue nu confirm()/prompt() weg zijn en
// zijn vervangen door de eigen modals uit dialoog.js.
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
// Samengestelde helper voor het "nieuw lijstje"-scherm (naam + gedeeld/privé in één modal).
async function modalNieuwLijstje(page, naam, { gedeeld = true } = {}) {
  await modalWacht(page);
  await page.fill(".modal-input", naam);
  if (!gedeeld) await page.click('.modal-keuze-btn:has-text("Privé")');
  await page.click('.modal-knoppen button:has-text("Aanmaken")');
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // M. Statusbalk blijft onderaan (geen overlap) in ☰-paneel en archief
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // telefoonformaat
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=overlap-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    const viewportHeight = 844;

    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    await page.waitForTimeout(150);
    let box = await page.locator(".statusbar").boundingBox();
    check("M1. Statusbalk raakt (nagenoeg) de onderkant van het scherm in het ☰-paneel", Math.abs(box.y + box.height - viewportHeight) < 5);
    let panelBox = await page.locator("#lists-panel").boundingBox();
    check("M2. Statusbalk overlapt het ☰-paneel niet (staat er onder, geen overlap in y)", box.y >= panelBox.y + panelBox.height - 1);

    await page.click("#lists-close-btn");
    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    await page.waitForTimeout(150);
    box = await page.locator(".statusbar").boundingBox();
    check("M3. Statusbalk raakt (nagenoeg) de onderkant van het scherm in het archiefpaneel", Math.abs(box.y + box.height - viewportHeight) < 5);
    panelBox = await page.locator("#archive-panel").boundingBox();
    check("M4. Statusbalk overlapt het archiefpaneel niet", box.y >= panelBox.y + panelBox.height - 1);

    await ctx.close();
  }

  // N. Een gearchiveerd lijstje definitief verwijderen (gedeeld + privé)
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=defverwijder-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    await page.click("#archive-btn");
    await openDangerZone(page);
    await page.click("#delete-list-btn");
    await modalBevestig(page);
    await page.waitForTimeout(500);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    await page.click("#lists-add-btn");
    await modalKiesOptie(page, "Nieuw lijstje aanmaken");
    await modalNieuwLijstje(page, "Privé test", { gedeeld: false });
    await page.waitForTimeout(300);
    await page.waitForTimeout(150);
    await page.fill("#new-item", "Privé testitem");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);
    await page.click("#archive-btn");
    await openDangerZone(page);
    await page.click("#delete-list-btn");
    await modalBevestig(page);
    await page.waitForTimeout(300);
    await page.waitForTimeout(200);

    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    const archivedText = await page.textContent("#lists-panel-archived");
    check("N1. Beide gearchiveerde lijstjes tonen nu een 'Verwijder definitief'-knop", (await page.locator('#lists-panel-archived button:has-text("Verwijder definitief")').count()) === 2);

    const beforeCount = await page.locator("#lists-panel-archived > li").count();
    await page.click('#lists-panel-archived button:has-text("Verwijder definitief")');
    await page.waitForTimeout(200);
    const afterCount = await page.locator("#lists-panel-archived > li").count();
    check("N2. Na 'Verwijder definitief' is er één lijstje minder in het archiefgedeelte", afterCount === beforeCount - 1);

    await page.click('#lists-panel-archived button:has-text("Verwijder definitief")');
    await page.waitForTimeout(200);
    check("N3. Na het definitief verwijderen van de tweede is het archiefgedeelte weer leeg", await page.isHidden("#lists-panel-archived-section"));

    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    check("N4. Na herladen blijven beide lijstjes definitief weg (ook echt opgeslagen)", await page.isHidden("#lists-panel-archived-section"));

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
