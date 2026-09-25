// Extra tests voor een paar plekken die de bestaande testreeksen nog niet
// dekten, na de tabbladen-op-volgorde-redesign en de tombstone-fix:
// 1. Oude volgorde-data (nog in het { id, pinned } formaat) laadt netjes.
// 2. Een lijstje dat op toestel A definitief verwijderd is, komt niet
//    terug als toestel B (met een eigen, iets verouderde lokale kopie)
//    daarna zelf ook nog eens opslaat.
// 3. Een grafsteen (tombstone) van een definitieve verwijdering wordt na
//    30 dagen automatisch opgeruimd (net als het archief zelf).
// 4. Je allerlaatste lijstje verwijderen terwijl het een PRIVÉ lijstje is
//    (en er ook geen gedeeld lijstje meer over is) geeft geen leeg scherm.

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
  try { await fn(); } finally { page.off("dialog", handler); }
}

async function openDangerZone(page) {
  await page.evaluate(() => { document.querySelector(".danger-zone-toggle").open = true; });
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  async function openListsPanel(page) {
    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
  }

  // ============================================================
  // O. Oude { id, pinned }-volgorde uit localStorage blijft werken
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=migratie-volgorde-test`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    // Handmatig het OUDE volgorde-formaat in localStorage zetten, zoals
    // een bestaand toestel dat al had vóór deze update.
    const eersteId = await page.evaluate(() => {
      const raw = localStorage.getItem("mockdoc:lists/migratie-volgorde-test");
      const data = JSON.parse(raw);
      return data.lijsten[0].id;
    });
    await page.evaluate((id) => {
      localStorage.setItem(
        "boodschappenlijst:lijst-volgorde",
        JSON.stringify([{ id, pinned: true }])
      );
    }, eersteId);
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    check("O1. Na herladen met oud-formaat volgorde-data crasht de app niet en staat het lijstje als tabblad", errors.length === 0 && (await page.locator(".list-tab").count()) >= 1);

    await openListsPanel(page);
    check("O2. Het ☰-paneel werkt ook gewoon (geen crash bij het openen)", errors.length === 0 && (await page.isVisible("#lists-panel-list")));

    await ctx.close();
  }

  // ============================================================
  // P. Definitief verwijderen: komt het lijstje niet terug via een ANDER,
  //    nog niet bijgewerkt toestel dat daarna ook nog eens opslaat?
  // ============================================================
  {
    const ctx = await browser.newContext(); // 1 context = gedeelde mock-cloud
    const codeP = "tombstone-cross-device-test";

    const pageA = await ctx.newPage();
    await pageA.goto(`${base}/index.html?lijst=${codeP}`);
    await pageA.waitForSelector("#app:not([hidden])");
    await pageA.waitForTimeout(200);

    // Toestel B opent dezelfde lijst óók, zodat het zijn eigen lokale kopie
    // van householdLijsten/-ArchivedLijsten heeft (nog van vóór de
    // verwijdering door A).
    const pageB = await ctx.newPage();
    await pageB.goto(`${base}/index.html?lijst=${codeP}`);
    await pageB.waitForSelector("#app:not([hidden])");
    await pageB.waitForTimeout(200);

    // Toestel A: het lijstje archiveren én meteen definitief verwijderen.
    await pageA.click("#archive-btn");
    await openDangerZone(pageA);
    await withDialogQueue(pageA, [true, "Vervangend lijstje op A", true], async () => {
      await pageA.click("#delete-list-btn");
      await pageA.waitForTimeout(300);
    });
    await pageA.click("#lists-btn");
    await pageA.waitForSelector("#lists-panel:not([hidden])");
    await pageA.click('#lists-panel-archived button:has-text("Verwijder definitief")');
    await pageA.waitForTimeout(300);

    // Toestel B heeft dit allemaal niet gezien (geen reload/onSnapshot-tik
    // hoeven te doen in de mock, want elke pagina luistert al live mee via
    // BroadcastChannel) — simuleer nu dat B, met zijn (mogelijk nog even
    // "oude") lokale stand, zelf ook een save doet (bijv. een naam-tikje).
    await pageB.waitForTimeout(300); // even de kans geven de live-update al binnen te krijgen
    await pageB.fill("#new-item", "Iets van toestel B");
    await pageB.click("button[type=submit]");
    await pageB.waitForTimeout(400);

    // Nu bij A herladen: staat het definitief verwijderde lijstje er nog
    // steeds niet, ook na deze extra save-actie van B?
    await pageA.click("#lists-btn");
    await pageA.waitForSelector("#lists-panel:not([hidden])");
    const archivedTextA = await pageA.textContent("#lists-panel-archived-section");
    check("P1. Na een save door een ander (nog niet helemaal bijgewerkt) toestel blijft het definitief verwijderde lijstje weg", !(await pageA.isVisible("#lists-panel-archived-section")) || !archivedTextA.includes("Onze lijst"));

    await pageA.reload();
    await pageA.waitForSelector("#app:not([hidden])");
    await pageA.click("#lists-btn");
    await pageA.waitForSelector("#lists-panel:not([hidden])");
    const archivedVisible = await pageA.isVisible("#lists-panel-archived-section");
    const archivedText2 = archivedVisible ? await pageA.textContent("#lists-panel-archived") : "";
    check("P2. Ook na herladen (dus echt de serverstand) is het lijstje niet teruggekomen", !archivedText2.includes("Onze lijst"));

    await ctx.close();
  }

  // ============================================================
  // Q. Een grafsteen (tombstone) van 30+ dagen geleden wordt automatisch
  //    opgeruimd (net als het archief zelf)
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=tombstone-purge-test`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const dayMs = 24 * 60 * 60 * 1000;
      const raw = localStorage.getItem("mockdoc:lists/tombstone-purge-test");
      const data = JSON.parse(raw);
      data.tombstones = [{ id: "allang-verwijderd-lijstje", deletedForeverAt: Date.now() - 40 * dayMs }];
      localStorage.setItem("mockdoc:lists/tombstone-purge-test", JSON.stringify(data));
    });
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(300);
    // Een kleine wijziging forceren zodat er een save (en dus een
    // schrijfmoment van de opgeschoonde tombstones-lijst) plaatsvindt.
    await page.fill("#new-item", "Iets toevoegen om een save te triggeren");
    await page.click("button[type=submit]");
    await page.waitForTimeout(400);

    const tombstonesNa = await page.evaluate(() => {
      const raw = localStorage.getItem("mockdoc:lists/tombstone-purge-test");
      return JSON.parse(raw).tombstones || [];
    });
    check("Q1. Een 40 dagen oude grafsteen is automatisch opgeruimd (blijft niet eindeloos meegroeien)", !tombstonesNa.some((t) => t.id === "allang-verwijderd-lijstje"));

    await ctx.close();
  }

  // ============================================================
  // R. Je allerlaatste lijstje verwijderen terwijl het een PRIVÉ lijstje
  //    is (en er ook geen gedeeld lijstje meer over is)
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=laatste-prive-test`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    // Eerst een privé lijstje erbij (naast het standaard gedeelde).
    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    await withDialogQueue(page, [true, "Enige privé lijstje", false], async () => {
      await page.click("#lists-add-btn");
      await page.waitForTimeout(300);
    });
    await page.waitForSelector("#app:not([hidden])");

    // Nu het gedeelde lijstje verwijderen — de privé lijst bestaat dan nog
    // (rest.length > 0), dus de app schakelt daar gewoon automatisch naartoe.
    // (Het aanmaken hierboven sloot het ☰-paneel alweer, dus opnieuw openen.)
    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    await page.click(`.lists-panel-name:has-text("Onze lijst")`);
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector("#app:not([hidden])");
    await page.click("#archive-btn");
    await openDangerZone(page);
    await withDialogQueue(page, [true], async () => {
      await page.click("#delete-list-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");
    check("R1. Na het verwijderen van het gedeelde lijstje blijft de privé lijst (nog steeds de enige) actief", await page.isVisible("#list-lock-icon"));

    // En nu DIT privé lijstje (de enige die er nog is, gedeeld én privé) ook
    // verwijderen — dat raakt de server niet, dus zonder een expliciete
    // vervang-actie zou het scherm hier leeg kunnen blijven.
    await page.click("#archive-btn");
    await openDangerZone(page);
    await withDialogQueue(page, [true, "Weer een nieuw lijstje", true], async () => {
      await page.click("#delete-list-btn");
      await page.waitForTimeout(300);
    });
    await page.waitForSelector("#app:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("R2. Ook na het verwijderen van je allerlaatste (privé) lijstje blijft het scherm niet leeg hangen", await page.isVisible("#app"));

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
