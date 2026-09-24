// Verifieert het aan/uit-zetten van pushmeldingen: knop verschijnt pas als
// het "ondersteund" is en er een vapidKey is ingevuld, aanzetten vraagt om
// toestemming en slaat een token op bij het gezinnetje, uitzetten haalt
// het weer weg. De echte melding zelf (Cloud Function + systeemmelding op
// een toestel) kan hier niet getest worden — zie mock-messaging.js en het
// bijbehorende stuk in het testrapport aan Bob.

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.join(__dirname, "test-run");
const ROOT_ONGECONFIGUREERD = path.join(__dirname, "test-unconfigured");

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

// Na een klik op de pushmeldingen-knop loopt er een hele reeks async
// stappen (toestemming vragen, wachten tot de service worker klaar is,
// een token ophalen, dat opslaan) voordat de knoptekst verandert. Hoe
// lang dat precies duurt kan per testrun verschillen (drukte op de
// machine waar dit draait) — dus in plaats van een vaste, geraden
// wachttijd (die soms net te kort bleek, met een vals-negatieve test tot
// gevolg) wachten we hier actief tot de knop de verwachte tekst toont,
// met een ruime bovengrens.
async function wachtOpPushKnop(page, verwachteTekst, timeout = 8000) {
  await page.waitForFunction(
    (tekst) => document.querySelector("#push-btn")?.textContent.includes(tekst),
    verwachteTekst,
    { timeout }
  ).catch(() => {}); // laat de eropvolgende check() het zelf constateren en netjes ❌ tonen
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ["notifications"] });
  const page = await context.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));

  await page.goto(`http://localhost:${port}/index.html?lijst=push-test`);
  await page.waitForSelector("#app:not([hidden])");
  // De sectie zit in het ⚙️ Instellingen-paneel — moet dus eerst open.
  await page.click("#settings-btn");
  await page.waitForSelector("#push-section:not([hidden])", { timeout: 5000 }).catch(() => {});

  check("P1. Pushmeldingen-sectie verschijnt (vapidKey ingevuld + ondersteund)", await page.isVisible("#push-section"));
  check("P2. Begint op 'uit'", (await page.textContent("#push-btn")).includes("uit"));

  await page.click("#push-btn");
  await wachtOpPushKnop(page, "aan");
  check("P3. Na aanzetten staat er 'aan'", (await page.textContent("#push-btn")).includes("aan"));

  // Niet alleen de knoptekst, ook echt gecontroleerd dat het token bij het
  // gezinnetje terecht is gekomen (de mock-Firestore bewaart dat als
  // gewoon localStorage onder "mockdoc:lists/push-test").
  const opgeslagen = await page.evaluate(() => {
    const raw = localStorage.getItem("mockdoc:lists/push-test");
    return raw ? JSON.parse(raw) : null;
  });
  check("P3b. Het token staat echt in het gezinsdocument (pushTokens)", !!(opgeslagen && Array.isArray(opgeslagen.pushTokens) && opgeslagen.pushTokens.length === 1));

  // Blijft aan staan na herladen (token wordt onthouden op dit toestel).
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await page.click("#settings-btn");
  await page.waitForSelector("#push-section:not([hidden])", { timeout: 5000 }).catch(() => {});
  check("P4. Blijft 'aan' na herladen", (await page.textContent("#push-btn")).includes("aan"));

  await page.click("#push-btn");
  await wachtOpPushKnop(page, "uit");
  check("P5. Na uitzetten staat er weer 'uit'", (await page.textContent("#push-btn")).includes("uit"));

  const opgeslagenNaUit = await page.evaluate(() => {
    const raw = localStorage.getItem("mockdoc:lists/push-test");
    return raw ? JSON.parse(raw) : null;
  });
  check("P5b. Het token is ook echt weer weg uit het gezinsdocument", !!(opgeslagenNaUit && Array.isArray(opgeslagenNaUit.pushTokens) && opgeslagenNaUit.pushTokens.length === 0));

  // --- Cruciale check: een pushtoken mag niet stiekem weer verdwijnen
  // zodra er daarna gewoon een item wordt toegevoegd/afgevinkt (dat is
  // een heel andere schrijfactie op hetzelfde gezinsdocument — die mag
  // het token-veld niet overschrijven). ---
  await page.click("#push-btn"); // weer aanzetten (stond na P5 op "uit")
  await wachtOpPushKnop(page, "aan");
  await page.click("#settings-close-btn");
  await page.fill("#new-item", "Iets");
  await page.click("button[type=submit]");
  // Een gewone lijst-opslag is bewust 400ms vertraagd (zie "scheduleSave"
  // in app.js) — actief wachten tot het item ook echt in het document
  // staat, in plaats van te gokken hoe lang dat duurt (dat bleek soms net
  // te kort, met een vals-negatieve test tot gevolg).
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem("mockdoc:lists/push-test");
      const doc = raw ? JSON.parse(raw) : null;
      return !!(doc && doc.lijsten && doc.lijsten.some((l) => (l.items || []).some((i) => i.text === "Iets")));
    },
    { timeout: 8000 }
  ).catch(() => {});
  const naGewoneOpslag = await page.evaluate(() => {
    const raw = localStorage.getItem("mockdoc:lists/push-test");
    return raw ? JSON.parse(raw) : null;
  });
  check("P7. Pushtoken overleeft een gewone lijst-opslag (item toevoegen)", !!(naGewoneOpslag && Array.isArray(naGewoneOpslag.pushTokens) && naGewoneOpslag.pushTokens.length === 1));

  // --- Zodat de Cloud Function (functions/index.js) dit toestel kan
  // overslaan bij het versturen van de melding (anders krijg je ook een
  // melding over je eigen toevoeging): elke gewone opslag schrijft mee
  // welk toestel 'm deed, via zijn eigen pushtoken. ---
  const eigenToken = await page.evaluate(() => localStorage.getItem("boodschappenlijst:push-token"));
  check("P8. De opslag markeert dit toestel als de schrijver (voor het overslaan bij pushmeldingen)", !!(eigenToken && naGewoneOpslag && naGewoneOpslag.laatsteSchrijver === eigenToken));

  check("Geen JS-fouten opgetreden tijdens deze hele test", jsErrors.length === 0);
  if (jsErrors.length) console.log(jsErrors);

  await browser.close();
  server.close();

  // --- Zonder vapidKey (test-unconfigured heeft "VUL-HIER-IN"): de knop
  // moet dan verborgen blijven, niet een kapotte knop tonen. ---
  const server2 = makeServer(ROOT_ONGECONFIGUREERD);
  await new Promise((resolve) => server2.listen(0, resolve));
  const port2 = server2.address().port;
  const browser2 = await chromium.launch();
  const page2 = await browser2.newPage();
  const jsErrors2 = [];
  page2.on("pageerror", (e) => jsErrors2.push(String(e)));
  // test-unconfigured heeft ook geen ingevulde firebaseConfig, dus de app
  // zelf start niet eens (zie F1/F2 in de grote regressietest) — hier gaat
  // het er puur om dat de push-code zelf nergens een fout gooit als de
  // vapidKey nog op "VUL-HIER-IN" staat, en dat blijkt uit "geen JS-fouten".
  await page2.goto(`http://localhost:${port2}/index.html?lijst=push-onconf-test`);
  await page2.waitForTimeout(500);
  check("P6. Geen JS-fouten zonder ingevulde vapidKey", jsErrors2.length === 0);

  await browser2.close();
  server2.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail > 0 ? 1 : 0);
})();
