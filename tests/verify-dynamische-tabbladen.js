// Verifieert dat het aantal tabbladen dynamisch is (afhankelijk van breedte en
// naamlengte, niet een vast maximum), inclusief live opnieuw berekenen bij resize.

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

// Onderdrukt de "Hoe wil je genoemd worden?"-vraag, anders kan die de dialoogwachtrij van deze test verstoren.
async function onderdrukNaamVraag(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("boodschappenlijst:naam-gevraagd", "1");
    } catch (e) {
      /* niet erg, dan loopt de test iets minder soepel maar niet stuk */
    }
  });
}

async function nieuwGedeeldLijstje(page, naam) {
  await openListsPanel(page);
  await withDialogQueue(page, [true, naam, true], async () => {
    await page.click("#lists-add-btn");
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
  });
  await page.waitForSelector("#app:not([hidden])");
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // A. Bij een brede viewport passen met korte namen meer dan 3 lijstjes als tabblad.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await onderdrukNaamVraag(page);
    await page.goto(`${base}/index.html?lijst=dynamisch-breed-test`);
    await page.waitForSelector("#app:not([hidden])");

    for (const naam of ["Tweede lijst", "Derde lijst", "Vierde lijst"]) {
      await nieuwGedeeldLijstje(page, naam);
    }

    const labels = await page.locator(".list-tab .list-tab-label").allInnerTexts(); // 4 lijstjes + ☰-knop = 5 .list-tab
    check(
      "A1. Bij 1280px passen alle 4 (korte) lijstjes als tabblad",
      (await page.locator(".list-tab").count()) === 5 &&
        ["Onze lijst", "Tweede lijst", "Derde lijst", "Vierde lijst"].every((n) => labels.some((l) => l.includes(n)))
    );

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // B. Bij een smalle viewport passen minder lijstjes, de rest blijft bereikbaar via het ☰-paneel.
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await onderdrukNaamVraag(page);
    await page.goto(`${base}/index.html?lijst=dynamisch-smal-test`);
    await page.waitForSelector("#app:not([hidden])");

    for (const naam of ["Tweede lijst", "Derde lijst", "Vierde lijst"]) {
      await nieuwGedeeldLijstje(page, naam);
    }

    const tabCountSmal = await page.locator(".list-tab").count();
    const labelsSmal = await page.locator(".list-tab .list-tab-label").allInnerTexts();
    check("B1. Bij 360px passen er minder dan 4 lijstjes als tabblad", tabCountSmal - 1 < 4);

    await openListsPanel(page);
    const paneelTekst = await page.textContent("#lists-panel-list");
    const nietAlsTabblad = ["Onze lijst", "Tweede lijst", "Derde lijst", "Vierde lijst"].filter(
      (n) => !labelsSmal.some((l) => l.includes(n))
    );
    check(
      "B2. Elk lijstje dat niet als tabblad past, staat wél gewoon in het ☰-paneel",
      nietAlsTabblad.length > 0 && nietAlsTabblad.every((n) => paneelTekst.includes(n))
    );

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // C. Het venster live breder/smaller maken berekent opnieuw hoeveel lijstjes passen, zonder herladen.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await onderdrukNaamVraag(page);
    await page.goto(`${base}/index.html?lijst=dynamisch-resize-test`);
    await page.waitForSelector("#app:not([hidden])");

    for (const naam of ["Tweede lijst", "Derde lijst", "Vierde lijst"]) {
      await nieuwGedeeldLijstje(page, naam);
    }

    const tabCountBreed = await page.locator(".list-tab").count();
    check("C1. Breed: alle 4 lijstjes passen (5 tabbladelementen incl. ☰)", tabCountBreed === 5);

    await page.setViewportSize({ width: 360, height: 720 });
    await page.waitForTimeout(400); // resize-listener is 150ms gedebouncet
    const tabCountSmalNaResize = await page.locator(".list-tab").count();
    check("C2. Na smaller maken van het venster passen er minder tabbladen", tabCountSmalNaResize < tabCountBreed);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(400);
    const tabCountWeerBreed = await page.locator(".list-tab").count();
    check("C3. Weer breder maken herstelt het aantal tabbladen weer naar 5", tabCountWeerBreed === 5);

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // D. Lange namen laten er minder passen dan korte namen bij dezelfde viewport (tekstbreedte telt, geen vast aantal).
  {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await onderdrukNaamVraag(page);
    await page.goto(`${base}/index.html?lijst=dynamisch-lange-namen-test`);
    await page.waitForSelector("#app:not([hidden])");

    const langeNamen = [
      "Een heel erg lange naam voor een lijstje",
      "Nog een andere hele lange naam",
      "En nog een derde lange lijstjesnaam",
    ];
    for (const naam of langeNamen) {
      await nieuwGedeeldLijstje(page, naam);
    }

    const tabCountLangeNamen = await page.locator(".list-tab").count();
    check(
      "D1. Met lange namen passen er bij 600px minder dan 4 lijstjes als tabblad",
      tabCountLangeNamen - 1 < 4
    );

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
