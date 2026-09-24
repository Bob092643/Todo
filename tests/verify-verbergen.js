// Verifieert de "Verbergen" van een gedeeld lijstje op dit toestel:
// 1. Blijft écht verborgen, ook na een sync/herlaad (dit was stuk: elke
//    onSnapshot-tik zette het lijstje automatisch weer terug in de lokale
//    volgorde).
// 2. Staat na het verbergen in het nieuwe "Verborgen op dit toestel"-blok.
// 3. Kan daar met "Terug laten zien" weer teruggezet worden (en verschijnt
//    dan weer als tabblad/in de gewone lijst).
// 4. Een privé lijstje heeft geen "Verbergen"-knop (kan niet, geen andere
//    manier om 'm terug te vinden).

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

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${base}/index.html?lijst=verbergen-test-1`);
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForTimeout(200);

  // Een 2e gedeeld lijstje erbij, zodat er iets is om te verbergen zonder
  // meteen het allerlaatste lijstje kwijt te raken.
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await withDialogQueue(page, [true, "Zomerkamp lijstje", true], async () => {
    await page.click("#lists-add-btn");
    await page.waitForTimeout(300);
  });
  await page.waitForSelector("#app:not([hidden])");

  // En een privé lijstje, om te checken dat die geen "Verbergen"-knop heeft.
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await withDialogQueue(page, [true, "Ons privé lijstje", false], async () => {
    await page.click("#lists-add-btn");
    await page.waitForTimeout(300);
  });
  await page.waitForSelector("#app:not([hidden])");

  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");

  const priveRowKnoppen = await page.locator('.lists-panel-row:has-text("Ons privé lijstje") button:has-text("Verbergen")').count();
  check("V1. Een privé lijstje heeft geen 'Verbergen'-knop", priveRowKnoppen === 0);

  const zichtbaarVoor = await page.locator('.lists-panel-list .lists-panel-name:has-text("Zomerkamp lijstje")').count();
  check("V2. 'Zomerkamp lijstje' staat gewoon in de lijst vóór het verbergen", zichtbaarVoor === 1);

  // Verbergen.
  await withDialogQueue(page, [true], async () => {
    await page.click('.lists-panel-row:has-text("Zomerkamp lijstje") button:has-text("Verbergen")');
    await page.waitForTimeout(200);
  });

  const zichtbaarNa = await page.locator('#lists-panel-list .lists-panel-name:has-text("Zomerkamp lijstje")').count();
  check("V3. Na verbergen staat het lijstje niet meer in het gewone rijtje", zichtbaarNa === 0);

  const inVerborgenSectie = await page.isVisible("#lists-panel-hidden-section");
  const verborgenTekst = inVerborgenSectie ? await page.textContent("#lists-panel-hidden") : "";
  check("V4. Het lijstje staat nu in 'Verborgen op dit toestel'", inVerborgenSectie && verborgenTekst.includes("Zomerkamp lijstje"));

  // De kern van de bug: blijft het verborgen na een herlaad (dus een verse
  // onSnapshot-subscribe, precies het moment dat de oude code het stiekem
  // weer terugzette)?
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForTimeout(200);
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  await page.waitForTimeout(150);

  const zichtbaarNaHerladen = await page.locator('#lists-panel-list .lists-panel-name:has-text("Zomerkamp lijstje")').count();
  check("V5. Blijft verborgen ná een herlaad (dit was de bug: kwam anders vanzelf terug)", zichtbaarNaHerladen === 0);
  const nogSteedsInVerborgenSectie = await page.isVisible("#lists-panel-hidden-section");
  check("V6. En staat na herladen nog steeds in 'Verborgen op dit toestel'", nogSteedsInVerborgenSectie);

  // Ook een gewone actie van een ANDER (gesimuleerd) toestel — bijv. een
  // save op het huidige actieve lijstje — mag het verborgen lijstje niet
  // laten terugkomen (dat was letterlijk het mechanisme van de bug: elke
  // onSnapshot-tik, niet alleen een page-load).
  await page.click("#lists-close-btn");
  await page.fill("#new-item", "Iets toevoegen om een sync-tik te forceren");
  await page.click("button[type=submit]");
  await page.waitForTimeout(400);
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  const zichtbaarNaSync = await page.locator('#lists-panel-list .lists-panel-name:has-text("Zomerkamp lijstje")').count();
  check("V7. Blijft ook verborgen na een gewone sync-tik (niet alleen na herladen)", zichtbaarNaSync === 0);

  // Terug laten zien.
  await page.click('#lists-panel-hidden button:has-text("Terug laten zien")');
  await page.waitForTimeout(200);
  const weerZichtbaar = await page.locator('#lists-panel-list .lists-panel-name:has-text("Zomerkamp lijstje")').count();
  check("V8. Na 'Terug laten zien' staat het lijstje weer gewoon in de lijst", weerZichtbaar === 1);
  const verborgenSectieLeeg = await page.isHidden("#lists-panel-hidden-section");
  check("V9. En de 'Verborgen'-sectie is weer leeg (verdwijnt dus zelf ook)", verborgenSectieLeeg);

  // Blijft dat ook na herladen zo (dus niet alleen in-memory teruggezet)?
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await page.click("#lists-btn");
  await page.waitForSelector("#lists-panel:not([hidden])");
  const weerZichtbaarNaHerladen = await page.locator('#lists-panel-list .lists-panel-name:has-text("Zomerkamp lijstje")').count();
  check("V10. Ook na herladen blijft het teruggezette lijstje gewoon zichtbaar", weerZichtbaarNaHerladen === 1);

  check("Geen JS-fouten opgetreden tijdens deze hele test", errors.length === 0);

  await ctx.close();
  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
