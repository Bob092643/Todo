// Tests voor het archief (verwijderde items 30 dagen bewaren, en meteen
// definitief kunnen verwijderen) en het archiveren/terugzetten van een hele
// lijst via het ☰-lijstjespaneel, met hetzelfde 30-dagen-vangnet.

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

async function openListsPanel(page) {
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // ============================================================
  // I. Item archiveren en terugzetten
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=archief-test-1`);
    await page.waitForSelector("#app:not([hidden])");

    await page.fill("#new-item", "Melk halen");
    await page.click("button[type=submit]");
    await page.fill("#new-item", "Brood halen");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);

    await page.click("#list li .item-menu-btn");
    await page.click("#list li .delete-btn");
    await page.waitForTimeout(500);
    check("I1. Verwijderd item verdwijnt uit de lijst", !(await page.textContent("#list")).includes("Melk halen"));

    await page.click("#archive-btn");
    await page.waitForTimeout(150);
    check("I2. Archiefpaneel toont het verwijderde item", (await page.textContent("#archive-list")).includes("Melk halen"));
    check("I3. Archiefpaneel toont hoeveel dagen het nog bewaard blijft", /vervalt over \d+ dag/.test(await page.textContent("#archive-list")));

    // Eerder was deze knop wit-op-wit (onzichtbaar) — dat mag niet terugkomen.
    const restoreBtnColors = await page.locator("#archive-list li .btn-ghost").first().evaluate((btn) => {
      const s = getComputedStyle(btn);
      return { color: s.color, background: s.backgroundColor };
    });
    check("I3b. De 'Terugzetten'-knop heeft zichtbaar contrast (niet wit-op-wit)", restoreBtnColors.color !== restoreBtnColors.background);

    await page.click("#archive-list li .btn-ghost");
    await page.waitForTimeout(200);
    check("I4. Na 'Terugzetten' staat het item weer in de lijst", (await page.textContent("#list")).includes("Melk halen"));
    check("I5. En niet meer in het archief", !(await page.textContent("#archive-list")).includes("Melk halen"));

    await page.click("#archive-close-btn");
    check("I6. Archiefpaneel sluit weer", await page.isHidden("#archive-panel"));

    await ctx.close();
  }

  // ============================================================
  // J. Oude archiefitems (>30 dagen) worden automatisch definitief opgeruimd
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=archief-test-2`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(300); // wacht tot het standaard-lijstje echt is opgeslagen

    // Zet direct een document klaar (in het nieuwe formaat: 1 lijstje met
    // 1 item dat al 31 dagen geleden is "verwijderd" en 1 van gisteren),
    // zoals de mock-Firestore het zou opslaan.
    await page.evaluate(() => {
      const dayMs = 24 * 60 * 60 * 1000;
      const raw = localStorage.getItem("mockdoc:lists/archief-test-2");
      const data = JSON.parse(raw);
      data.lijsten[0].archivedItems = [
        { id: "oud", text: "Heel oud spul", done: false, deletedAt: Date.now() - 31 * dayMs },
        { id: "nieuw", text: "Recent verwijderd", done: false, deletedAt: Date.now() - 1 * dayMs },
      ];
      localStorage.setItem("mockdoc:lists/archief-test-2", JSON.stringify(data));
    });
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(300);

    check("J1. Het item van 31 dagen geleden is automatisch weg", !(await page.textContent("#archive-list")).includes("Heel oud spul"));
    check("J2. Het recente item (1 dag) staat nog wel in het archief", (await page.textContent("#archive-list")).includes("Recent verwijderd"));

    // Ook echt opgeslagen (niet alleen lokaal opgeruimd) — herladen bevestigt dit.
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);
    check("J3. Na herladen blijft het oude item weg (ook echt opgeslagen)", !(await page.textContent("#archive-list")).includes("Heel oud spul"));

    await ctx.close();
  }

  // ============================================================
  // K. Een hele lijst verwijderen en terugzetten (via het ☰-paneel)
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=verwijder-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.fill("#new-item", "Belangrijk itempje");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);

    await page.click("#archive-btn");
    await page.waitForTimeout(100);
    check("K0a. De gevarenzone is standaard ingeklapt (niet meteen een grote rode knop in beeld)", await page.isHidden("#delete-list-btn"));

    // De gevarenzone zit achter een uitklapbare "Dit lijstje verwijderen…"-regel.
    await page.click(".danger-zone-summary");
    await page.waitForTimeout(100);
    check("K0b. De gevarenzone klapt open na een tik op de samenvatting", await page.isVisible("#delete-list-btn"));

    // Op Annuleren klikken: niets gebeurt (geen woord meer dat je hoeft te
    // typen — gewoon een simpele OK/Annuleren-vraag).
    await withDialogQueue(page, [false], async () => {
      await page.click("#delete-list-btn");
      await page.waitForTimeout(200);
    });
    check("K1. Annuleren bij de bevestiging verwijdert de lijst niet", (await page.textContent("#list")).includes("Belangrijk itempje"));

    // Bevestigen: lijst wordt verwijderd (en de app schakelt automatisch
    // naar een nieuw, leeg standaard-lijstje, want dit was de enige lijst
    // van dit gezinnetje).
    await withDialogQueue(page, [true], async () => {
      await page.click("#delete-list-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");
    check("K2. Na bevestigen schakelt de app naar een nieuw, leeg lijstje (het oude item staat er niet meer)", !(await page.textContent("#list")).includes("Belangrijk itempje"));

    await openListsPanel(page);
    check("K3. De verwijderde lijst staat in het archiefgedeelte van het paneel", (await page.textContent("#lists-panel-archived")).includes("Onze lijst"));
    check("K4. Dat archiefgedeelte noemt het aantal resterende dagen", /vervalt over \d+ dag/.test(await page.textContent("#lists-panel-archived")));

    // Herladen: blijft in de archief-staat (echt opgeslagen, niet alleen lokaal).
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await openListsPanel(page);
    check("K5. Na herladen staat de lijst nog steeds in het archief (is opgeslagen)", (await page.textContent("#lists-panel-archived")).includes("Onze lijst"));

    await page.click(`#lists-panel-archived button:has-text("Terugzetten")`);
    await page.waitForTimeout(150);
    check("K6. Na 'Terugzetten' staat de lijst weer tussen de gewone lijstjes", (await page.textContent("#lists-panel-list")).includes("Onze lijst"));

    // De teruggezette lijst heet ook "Onze lijst", net als het lege
    // vervang-lijstje dat na het verwijderen automatisch is aangemaakt — dus
    // niet op naam klikken (dubbelzinnig), maar op de niet-actieve rij.
    await page.click(".lists-panel-row:not(.active) .lists-panel-name");
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector("#app:not([hidden])");
    check("K7. Het item van vóór het verwijderen staat er nog steeds", (await page.textContent("#list")).includes("Belangrijk itempje"));

    await ctx.close();
  }

  // ============================================================
  // L. Een lijst die al langer dan 30 dagen geleden verwijderd is
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=verwijder-test-oud`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const dayMs = 24 * 60 * 60 * 1000;
      const raw = localStorage.getItem("mockdoc:lists/verwijder-test-oud");
      const data = JSON.parse(raw);
      const overleden = { id: "allang-weg", naam: "Allang verwijderd", items: [{ id: "x", text: "iets", done: false }], archivedItems: [], updatedAt: Date.now(), deletedAt: Date.now() - 40 * dayMs };
      data.archivedLijsten = [...(data.archivedLijsten || []), overleden];
      localStorage.setItem("mockdoc:lists/verwijder-test-oud", JSON.stringify(data));
    });
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(300);

    await openListsPanel(page);
    check("L1. Een 40 dagen oude, verwijderde lijst staat niet meer in het archiefgedeelte (automatisch definitief opgeruimd)", !(await page.textContent("#lists-panel-archived")).includes("Allang verwijderd"));

    await ctx.close();
  }

  // ============================================================
  // M. Vanuit het archief terug naar de gewone weergave via het
  // (al-actieve) tabblad of de (al-actieve) rij in het ☰-paneel — niet
  // alleen via het kruisje.
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=nav-test-1`);
    await page.waitForSelector("#app:not([hidden])");

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    await page.click(".list-tab.active");
    await page.waitForTimeout(150);
    check("M1. Klikken op het al-actieve tabblad sluit het archief weer", await page.isHidden("#archive-panel"));
    check("M1b. ...en de gewone lijst is weer zichtbaar", await page.isVisible("#app"));

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    await openListsPanel(page);
    await page.click(".lists-panel-row.active .lists-panel-name");
    await page.waitForTimeout(150);
    check("M2. Klikken op de al-actieve rij in het ☰-paneel sluit het archief ook", await page.isHidden("#archive-panel"));
    check("M2b. ...en de gewone lijst is weer zichtbaar", await page.isVisible("#app"));

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
