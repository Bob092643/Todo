// Verifieert de nieuwe "Compacte weergave"-knop in Instellingen: een
// eigen keuze van de gebruiker (aan/uit), niet iets dat vanzelf verandert
// naarmate de lijst groeit, en blijft staan na herladen.

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

(async () => {
  const server = makeServer(ROOT);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));

  await page.goto(`http://localhost:${port}/index.html?lijst=compact-test`);
  await page.waitForSelector("#app:not([hidden])");

  for (const naam of ["Melk", "Appels", "Brood"]) {
    await page.fill("#new-item", naam);
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);
  }

  check("Z1. Standaard staat compacte weergave uit", !(await page.$eval("#list", (el) => el.classList.contains("compact"))));

  await page.click("#settings-btn");
  await page.waitForSelector("#settings-panel:not([hidden])");
  check("Z2. De knop toont 'uit' als starttekst", (await page.textContent("#compact-btn")).includes("uit"));

  await page.click("#compact-btn");
  await page.waitForTimeout(80);
  check("Z3. Na klikken staat #list op compact", await page.$eval("#list", (el) => el.classList.contains("compact")));
  check("Z4. De knoptekst wisselt mee naar 'aan'", (await page.textContent("#compact-btn")).includes("aan"));

  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  check("Z5. Blijft aan staan na herladen", await page.$eval("#list", (el) => el.classList.contains("compact")));

  await page.click("#settings-btn");
  await page.waitForSelector("#settings-panel:not([hidden])");
  await page.click("#compact-btn");
  await page.waitForTimeout(80);
  check("Z6. Weer uitzetten werkt ook", !(await page.$eval("#list", (el) => el.classList.contains("compact"))));

  check("Geen JS-fouten opgetreden tijdens deze test", jsErrors.length === 0);
  if (jsErrors.length) console.log(jsErrors);

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail > 0 ? 1 : 0);
})();
