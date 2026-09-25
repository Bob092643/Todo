// Verifieert twee nieuwe fixes:
// 1. De onderste statusbalk (Gesynchroniseerd... + code) blijft nu echt
//    onderaan het scherm staan in het ☰-lijstjespaneel en het archiefpaneel,
//    ook als er maar weinig lijstjes/items in staan (overlap-bug).
// 2. Een verwijderd (gearchiveerd) lijstje kan nu ook definitief verwijderd
//    worden, zowel een gedeeld als een privé lijstje.

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

async function openDangerZone(page) {
  // <details> onthoudt zijn open/dicht-status in de DOM (het paneel wordt
  // alleen verborgen via [hidden], niet opnieuw opgebouwd) — dus niet
  // blindelings nog een keer klikken (dat klapt 'm juist weer dicht als
  // hij al open stond van een vorige keer in deze test).
  await page.evaluate(() => {
    document.querySelector(".danger-zone-toggle").open = true;
  });
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
  try { await fn(); } finally { page.off("dialog", handler); }
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // ============================================================
  // M. Statusbalk blijft onderaan (geen overlap) in ☰-paneel en archief
  // ============================================================
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

  // ============================================================
  // N. Een gearchiveerd lijstje definitief verwijderen (gedeeld + privé)
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=defverwijder-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    // --- Gedeeld lijstje archiveren (dit is het enige lijstje; de app
    // schakelt daarna automatisch naar een nieuw leeg vervang-lijstje, via
    // de eigen onSnapshot-echo van het opslaan — geen extra dialoogvragen) ---
    await page.click("#archive-btn");
    await openDangerZone(page);
    await withDialogQueue(page, [true], async () => {
      await page.click("#delete-list-btn");
      await page.waitForTimeout(500);
    });
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    // --- Privé lijstje toevoegen en meteen archiveren ---
    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    // "+ Nieuw lijstje" vraagt via dialogen: nieuw/bestaand → naam → delen/privé.
    await withDialogQueue(page, [true, "Privé test", false], async () => {
      await page.click("#lists-add-btn");
      await page.waitForTimeout(300);
    });
    await page.waitForTimeout(150);
    await page.fill("#new-item", "Privé testitem");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);
    await page.click("#archive-btn");
    await openDangerZone(page);
    // "Vervangend lijstje" (gedeeld) bestaat nog, dus geen extra
    // vervang-lijstje-dialogen nodig — de app schakelt er gewoon naartoe.
    await withDialogQueue(page, [true], async () => {
      await page.click("#delete-list-btn");
      await page.waitForTimeout(300);
    });
    await page.waitForTimeout(200);

    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    const archivedText = await page.textContent("#lists-panel-archived");
    check("N1. Beide gearchiveerde lijstjes tonen nu een 'Verwijder definitief'-knop", (await page.locator('#lists-panel-archived button:has-text("Verwijder definitief")').count()) === 2);

    // Definitief verwijderen van de eerste (gedeelde) gearchiveerde lijst.
    const beforeCount = await page.locator("#lists-panel-archived > li").count();
    await page.click('#lists-panel-archived button:has-text("Verwijder definitief")');
    await page.waitForTimeout(200);
    const afterCount = await page.locator("#lists-panel-archived > li").count();
    check("N2. Na 'Verwijder definitief' is er één lijstje minder in het archiefgedeelte", afterCount === beforeCount - 1);

    // Definitief verwijderen van de resterende (privé) gearchiveerde lijst.
    await page.click('#lists-panel-archived button:has-text("Verwijder definitief")');
    await page.waitForTimeout(200);
    check("N3. Na het definitief verwijderen van de tweede is het archiefgedeelte weer leeg", await page.isHidden("#lists-panel-archived-section"));

    // Herladen: blijft echt weg (niet alleen lokaal uit beeld).
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
