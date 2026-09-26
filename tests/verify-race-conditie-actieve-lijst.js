// Regressietest: een onSnapshot van een ANDER toestel die binnenkomt tijdens
// de eigen 400ms-opslagvertraging (scheduleSave) mocht een nog niet
// opgeslagen lokale wijziging (bijv. een afvinkje) niet stilletjes
// overschrijven met de oudere serverstand (fix: resolveActiveList() slaat
// overschrijven over zolang saveTimer nog loopt voor hetzelfde lijstje).
//
// Let op: de mock-Firestore deelt localStorage tussen "toestel A/B" in
// dezelfde browsercontext, dus toestel B mag tijdens de kritieke stap niet
// zelf van actief lijstje wisselen — vandaar dat het test-lijstje hieronder
// vóór het kritieke moment wordt aangemaakt en weer verwijderd.

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

  // S. Afvinken op A overleeft een ongerelateerde opslag op B die binnenkomt vóór A's 400ms-debounce afloopt.
  {
    const ctx = await browser.newContext(); // 1 context = gedeelde mock-cloud
    const code = "race-conditie-test";

    const pageA = await ctx.newPage();
    const errors = [];
    pageA.on("pageerror", (e) => errors.push(e.message));

    await pageA.goto(`${base}/index.html?lijst=${code}`);
    await pageA.waitForSelector("#app:not([hidden])");
    await pageA.waitForTimeout(200);

    await pageA.fill("#new-item", "Melk halen");
    await pageA.click("button[type=submit]");
    await pageA.waitForTimeout(500); // rustig laten opslaan, niet het geteste deel

    const pageB = await ctx.newPage();
    await pageB.goto(`${base}/index.html?lijst=${code}`);
    await pageB.waitForSelector("#app:not([hidden])");
    await pageB.waitForTimeout(300);

    // Derde lijstje aanmaken + verwijderen zodat er iets in het archief staat; B schakelt daarna terug naar A's lijstje.
    await pageB.click("#lists-btn");
    await pageB.waitForSelector("#lists-panel:not([hidden])");
    await withDialogQueue(pageB, [true, "Derde lijstje", true], async () => {
      await pageB.click("#lists-add-btn");
      await pageB.waitForTimeout(400);
    });
    await pageB.click("#archive-btn");
    await openDangerZone(pageB);
    await withDialogQueue(pageB, [true], async () => {
      await pageB.click("#delete-list-btn");
      await pageB.waitForTimeout(400);
    });
    await pageB.waitForTimeout(300);

    // Kritiek moment: A vinkt af (start 400ms-debounce), dan verwijdert B (ongerelateerd, direct) vóór die debounce afloopt.
    await pageA.click("#list li input[type=checkbox]");

    await pageB.click("#lists-btn");
    await pageB.waitForSelector("#lists-panel:not([hidden])");
    await pageB.click('#lists-panel-archived button:has-text("Verwijder definitief")');

    await pageA.waitForTimeout(700); // A's debounce laten aflopen

    check("S1. Geen JS-fouten opgetreden tijdens deze race-conditie", errors.length === 0);
    check(
      "S2. Het afvinken op toestel A overleeft de ongerelateerde opslag-actie van toestel B",
      await pageA.$eval("#list li", (li) => li.classList.contains("done"))
    );

    await pageA.reload(); // ook na herladen: bevestigt dat het echt is opgeslagen, niet alleen in-memory
    await pageA.waitForSelector("#app:not([hidden])");
    check(
      "S3. ...en blijft dat ook zo na herladen (dus ook écht opgeslagen)",
      await pageA.$eval("#list li", (li) => li.classList.contains("done"))
    );

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
