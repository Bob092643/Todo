// Verifieert twee nieuwe dingen:
// 1. De "bezig"-knop bij een item: los te zetten van het gewone vinkje, met
//    optioneel een notitie, met naam-toeschrijving (of alleen de naam als er
//    geen notitie is), en automatisch weg zodra het item wordt afgevinkt.
// 2. De "Standaardkleur"-knop zet nu echt exact de originele kleuren terug
//    (niet meer een net-iets-hardere, opnieuw berekende variant).

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

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // ============================================================
  // W. "Bezig"-knop bij een item
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=bezig-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    // Naam instellen, zodat de toeschrijving getest kan worden.
    await page.click("#settings-btn");
    await page.waitForSelector("#settings-panel:not([hidden])");
    await withDialogQueue(page, ["Bob"], async () => {
      await page.click("#name-btn");
      await page.waitForTimeout(150);
    });
    await page.click("#settings-close-btn");

    await page.fill("#new-item", "Oma bellen");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);

    const bezigKnopVoor = await page.locator(".bezig-btn").count();
    check("W1. Elk item heeft een 'bezig'-knop", bezigKnopVoor === 1);

    const logVoor = await page.locator(".item-bezig-log").count();
    check("W2. Vóór het zetten op bezig is er geen logregel", logVoor === 0);

    // Op bezig zetten mét een notitie.
    await withDialogQueue(page, ["gebeld, voicemail ingesproken"], async () => {
      await page.click(".bezig-btn");
      await page.waitForTimeout(150);
    });
    const logTekst1 = await page.textContent(".item-bezig-log");
    check("W3. Met een notitie staat 'Naam: notitie' in de logregel (geen tijdstip)", logTekst1.trim() === "Bob: gebeld, voicemail ingesproken");

    const knopActief = await page.locator(".bezig-btn.active").count();
    check("W4. De 'bezig'-knop zelf ziet er nu ook 'actief' uit", knopActief === 1);

    // Weer uitzetten.
    await page.click(".bezig-btn");
    await page.waitForTimeout(150);
    check("W5. Na nog een keer klikken is de logregel weer weg", (await page.locator(".item-bezig-log").count()) === 0);

    // Op bezig zetten ZONDER notitie (leeg gelaten) → alleen de naam.
    await withDialogQueue(page, [""], async () => {
      await page.click(".bezig-btn");
      await page.waitForTimeout(150);
    });
    const logTekst2 = await page.textContent(".item-bezig-log");
    check("W6. Zonder notitie staat alleen de naam in de logregel (geen extra zin, geen tijd)", logTekst2.trim() === "Bob");

    // Annuleren van de prompt laat de status ongemoeid.
    await page.click(".bezig-btn"); // eerst weer uitzetten
    await page.waitForTimeout(100);
    await withDialogQueue(page, [false], async () => {
      await page.click(".bezig-btn");
      await page.waitForTimeout(150);
    });
    check("W7. Annuleren van de notitie-prompt zet het item niet alsnog op bezig", (await page.locator(".bezig-btn.active").count()) === 0);

    // Op bezig zetten en dan afvinken: bezig moet automatisch verdwijnen.
    await withDialogQueue(page, ["notitie die zo weer weg moet"], async () => {
      await page.click(".bezig-btn");
      await page.waitForTimeout(150);
    });
    check("W8. (setup) Item staat weer op bezig vóór het afvinken", (await page.locator(".item-bezig-log").count()) === 1);
    await page.click(".check input");
    await page.waitForTimeout(150);
    check("W9. Na afvinken is de 'bezig'-logregel automatisch weg", (await page.locator(".item-bezig-log").count()) === 0);
    check("W10. En de 'bezig'-knop zelf is ook niet meer te zien bij een afgevinkt item", !(await page.locator(".bezig-btn").isVisible()));

    // Blijft dit ook na herladen correct (dus echt opgeslagen, niet alleen
    // in het geheugen van deze pagina)?
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);
    check("W11. Na herladen nog steeds geen 'bezig'-logregel (definitief opgeslagen)", (await page.locator(".item-bezig-log").count()) === 0);

    check("Geen JS-fouten tijdens deze hele test", errors.length === 0);

    await ctx.close();
  }

  // ============================================================
  // X. Kleur "Standaard" zet echt exact de oorspronkelijke tinten terug
  // ============================================================
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=kleur-reset-test-1`);
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);

    async function huidigeKleuren() {
      return page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        return {
          b600: s.getPropertyValue("--blue-600").trim(),
          b700: s.getPropertyValue("--blue-700").trim(),
          b500: s.getPropertyValue("--blue-500").trim(),
          b50: s.getPropertyValue("--blue-50").trim(),
        };
      });
    }

    // De ORIGINELE kleuren, vóórdat er ooit iets aan de kleur is veranderd —
    // dit is de "waarheid" waar alles straks weer exact op moet uitkomen.
    const origineel = await huidigeKleuren();

    // Een eigen kleur kiezen (simuleert de kleurenkiezer).
    await page.click("#settings-btn");
    await page.waitForSelector("#settings-panel:not([hidden])");
    await page.evaluate(() => {
      const picker = document.getElementById("color-picker");
      picker.value = "#9333ea";
      picker.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(100);
    const naEigenKleur = await huidigeKleuren();
    check("X1. Een eigen kleur wijzigt de tinten echt", naEigenKleur.b600.toLowerCase() === "#9333ea");

    // Nu op "Standaardkleur" klikken.
    await page.click("#color-reset-btn");
    await page.waitForTimeout(100);
    const naReset = await huidigeKleuren();

    check("X2. Na 'Standaardkleur' is --blue-600 weer exact de oorspronkelijke tint", naReset.b600 === origineel.b600);
    check("X3. Na 'Standaardkleur' is --blue-700 weer exact de oorspronkelijke (niet een net-iets-hardere) tint", naReset.b700 === origineel.b700);
    check("X4. Na 'Standaardkleur' is --blue-500 weer exact de oorspronkelijke tint", naReset.b500 === origineel.b500);
    check("X5. Na 'Standaardkleur' is --blue-50 weer exact de oorspronkelijke tint", naReset.b50 === origineel.b50);

    // En blijft dat ook zo ná een herlaad (dus niet dat de live-weergave na
    // reset ineens weer anders is dan wat er na een herlaad staat)?
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(200);
    const naHerladen = await huidigeKleuren();
    check("X6. Ook ná herladen zijn alle 4 tinten nog steeds exact de oorspronkelijke", JSON.stringify(naHerladen) === JSON.stringify(origineel));

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
