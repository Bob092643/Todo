// Verifieert dat het archief centraal is: verwijderde items van AL je
// lijstjes (gedeeld en privé) staan bij elkaar, met een tagje erbij uit
// welk lijstje het item kwam, en terugzetten/definitief verwijderen werkt
// ook voor een item dat niet bij het momenteel actieve lijstje hoort. Ook:
// wisselen van lijstje terwijl het archief openstaat knalt je er niet meer
// uit (was eerder een bug/klacht).

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
  const handler = (dialog) => {
    const answer = queue.shift();
    if (answer === true) dialog.accept();
    else if (answer === false) dialog.dismiss();
    else dialog.accept(String(answer));
  };
  page.on("dialog", handler);
  try {
    await fn();
  } finally {
    page.off("dialog", handler);
  }
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
  // A. Verwijderde items van 2 verschillende (gedeelde) lijstjes staan
  //    samen in hetzelfde, centrale archief, elk met een tagje.
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=centraal-archief-test`);
    await page.waitForSelector("#app:not([hidden])");

    // Eerste lijstje: "Boodschappen" (het standaardlijstje) — 1 item erin
    // en meteen weer verwijderen.
    await page.fill("#new-item", "Melk");
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);
    await page.locator("li:has-text('Melk') .delete-btn").click().catch(async () => {
      // Verwijderen zit achter het ⋯-menu.
      await page.locator("li:has-text('Melk') .item-menu-btn").click();
      await page.locator("li:has-text('Melk') .delete-btn").click();
    });
    await page.waitForTimeout(400);

    // Tweede, nieuw lijstje: "Klusjes" — ook 1 item erin, ook verwijderen.
    await openListsPanel(page);
    await withDialogQueue(page, [true, "Klusjes", true], async () => {
      await page.click("#lists-add-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");
    await page.fill("#new-item", "Kraan repareren");
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);
    await page.locator("li:has-text('Kraan repareren') .item-menu-btn").click();
    await page.locator("li:has-text('Kraan repareren') .delete-btn").click();
    await page.waitForTimeout(400);

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    const archiefTekst = await page.textContent("#archive-list");
    check("A1. Het archief toont het verwijderde item van lijstje 1 (Melk)", archiefTekst.includes("Melk"));
    check("A2. ...én van lijstje 2 (Kraan repareren), zonder naar dat lijstje te hoeven wisselen", archiefTekst.includes("Kraan repareren"));

    const melkTag = await page.locator("li:has-text('Melk') .archive-lijst-tag").textContent();
    const kraanTag = await page.locator("li:has-text('Kraan repareren') .archive-lijst-tag").textContent();
    check("A3. Melk is getagd met de naam van lijstje 1 ('Onze lijst')", melkTag.includes("Onze lijst"));
    check("A4. Kraan repareren is getagd met de naam van lijstje 2 ('Klusjes')", kraanTag.includes("Klusjes"));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // ============================================================
  // B. Terugzetten/definitief verwijderen werkt ook voor een item dat NIET
  //    bij het momenteel actieve lijstje hoort.
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=centraal-archief-restore-test`);
    await page.waitForSelector("#app:not([hidden])");

    await page.fill("#new-item", "Kaas");
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);
    await page.locator("li:has-text('Kaas') .item-menu-btn").click();
    await page.locator("li:has-text('Kaas') .delete-btn").click();
    await page.waitForTimeout(400);

    // Nu naar een TWEEDE lijstje wisselen — "Kaas" hoort dus niet meer bij
    // het actieve lijstje op het moment dat we 'm terugzetten/verwijderen.
    await openListsPanel(page);
    await withDialogQueue(page, [true, "Andere lijst", true], async () => {
      await page.click("#lists-add-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    check("B1. Kaas (van het NIET-actieve lijstje) staat toch gewoon in het archief", (await page.textContent("#archive-list")).includes("Kaas"));

    await page.locator("li:has-text('Kaas') button:has-text('Terugzetten')").click();
    await page.waitForTimeout(300);
    check("B2. Na terugzetten staat Kaas niet meer in het archief", !(await page.textContent("#archive-list")).includes("Kaas"));

    await page.click("#archive-close-btn");
    await openListsPanel(page);
    await page.locator(".lists-panel-row", { hasText: "Onze lijst" }).locator(".lists-panel-name").click();
    await page.waitForSelector("#app:not([hidden])");
    check("B3. ...en staat weer gewoon terug in dat (niet-actieve) lijstje zelf", (await page.textContent("#list")).includes("Kaas"));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // ============================================================
  // C. Wisselen van lijstje terwijl het archief openstaat knalt je er niet
  //    meer uit (eerder een klacht: "dan knal je uit het archief").
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=centraal-archief-tabwissel-test`);
    await page.waitForSelector("#app:not([hidden])");

    await withDialogQueue(page, [true, "Tweede lijst", true], async () => {
      await openListsPanel(page);
      await page.click("#lists-add-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");

    // Nu via het TABBLAD (niet het ☰-paneel) naar het andere lijstje
    // wisselen, terwijl het archief nog openstaat.
    await page.locator(".list-tab", { hasText: "Onze lijst" }).click();
    await page.waitForTimeout(150);
    check("C1. Het archief blijft gewoon open na het wisselen van tabblad", await page.isVisible("#archive-panel"));
    check("C2. De 'gewone' lijst-weergave (#app) blijft verborgen", await page.isHidden("#app"));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
