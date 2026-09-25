// Regressietest voor een kritieke bug die bij de kritische-blik-review van
// 25-09-2026 aan het licht kwam.
//
// Een wijziging aan het actieve lijstje (bijv. een afgevinkt item) leeft
// meteen in het geheugen, maar wordt pas na 400ms écht via saveHousehold()
// naar de server geschreven (scheduleSave/saveList — zodat snel-achter-
// elkaar wijzigen niet steeds apart hoeft te worden opgeslagen). Op HETZELFDE
// toestel is dat onschuldig (de mutatie zit al in hetzelfde in-het-geheugen
// object dat ook wordt weggeschreven door elke andere actie die ondertussen
// opslaat). Maar komt er in die 400ms een onSnapshot binnen die van een
// ANDER toestel komt — met zijn eigen, losse (en dus nog niet van deze
// wijziging wetende) kopie van de data — dan verving resolveActiveList()
// zonder enige check de lokale `items` door die binnenkomende, oudere
// kopie. Het eigen afvinkje verdween dan stilletjes, en de eigen (nu zelf
// ook teruggedraaide) 400ms-opslag bevestigde dat verlies vervolgens actief.
//
// De fix: resolveActiveList() slaat het overschrijven van de
// werkvariabelen over zolang er nog een wachtende, niet-opgeslagen
// wijziging is (saveTimer) én het gaat om hetzelfde lijstje dat al actief
// was — de wachtende opslag zelf stuurt de juiste stand dan gewoon zelf
// door zodra hij aan de beurt is.
//
// Let op bij het simuleren van "twee toestellen" hieronder: de
// mock-Firestore (mock-firestore.js) deelt de "cloud"-data via localStorage
// + BroadcastChannel, wat alleen werkt tussen pagina's in DEZELFDE
// browser-context. Maar gewone localStorage-sleutels (o.a. welk lijstje
// actief is, per toestel) zijn dan OOK gedeeld tussen "toestel A" en
// "toestel B" — anders dan bij echte, losse toestellen. Toestel B mag dus
// tijdens de kritieke test-stap zelf niet van actief lijstje wisselen
// (bijv. via het aanmaken van een nieuw lijstje), anders overschrijft dat
// stiekem ook toestel A's "welk lijstje is actief"-status. Vandaar dat het
// aanmaken + weer verwijderen van het "derde lijstje" hieronder bewust vóór
// het kritieke moment gebeurt (en toestel B daarna vanzelf terugschakelt
// naar hetzelfde lijstje als A) — de kritieke actie zelf
// ("Verwijder definitief") wisselt nooit van actief lijstje.

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

  // ============================================================
  // S. Een net-gedane wijziging op het actieve lijstje (afvinken), op
  //    toestel A, overleeft een ONGERELATEERDE opslag-actie op toestel B
  //    (een al gearchiveerd, ander lijstje definitief verwijderen) die
  //    binnenkomt VOORDAT toestel A's eigen 400ms-debounce is verlopen.
  // ============================================================
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

    // Voorbereiding op toestel B (vóór het kritieke moment): een derde
    // lijstje aanmaken en meteen weer verwijderen, zodat er iets in het
    // archief staat om zo dadelijk definitief te verwijderen. Na deze
    // verwijdering schakelt B vanzelf terug naar "Onze lijst" — hetzelfde
    // lijstje als waar A op zit.
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

    // === Het kritieke moment ===
    // 1. Op toestel A: het item afvinken. Start de 400ms-debounce
    //    (scheduleSave), schrijft nog NIET meteen naar de server.
    await pageA.click("#list li input[type=checkbox]");

    // 2. VOORDAT die 400ms voorbij zijn: op toestel B het net gearchiveerde
    //    "Derde lijstje" definitief verwijderen — dit slaat direct op
    //    (geen debounce, en zonder van actief lijstje te wisselen) en heeft
    //    an sich niets met "Onze lijst" (het actieve lijstje op A) te
    //    maken. Dat triggert wél een onSnapshot-echo op toestel A.
    await pageB.click("#lists-btn");
    await pageB.waitForSelector("#lists-panel:not([hidden])");
    await pageB.click('#lists-panel-archived button:has-text("Verwijder definitief")');

    // 3. Nu ook de rest van toestel A's eigen 400ms-debounce laten
    //    aflopen.
    await pageA.waitForTimeout(700);

    check("S1. Geen JS-fouten opgetreden tijdens deze race-conditie", errors.length === 0);
    check(
      "S2. Het afvinken op toestel A overleeft de ongerelateerde opslag-actie van toestel B",
      await pageA.$eval("#list li", (li) => li.classList.contains("done"))
    );

    // En ook na een volledige herlaad van A — dus de echte, opgeslagen
    // serverstand, niet toevallig alleen een in-memory toevalstreffer?
    await pageA.reload();
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
