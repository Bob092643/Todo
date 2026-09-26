// Verifieert dat #color-btn een <label for="..."> is die naar #color-picker wijst, en de swatch de actuele kleur toont.

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

  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector("#app:not([hidden])");
  await page.click("#settings-btn");
  await page.waitForSelector("#settings-panel:not([hidden])");

  const tag = await page.$eval("#color-btn", (el) => el.tagName.toLowerCase());
  check("L1. #color-btn is nu een <label> (niet meer een <button>)", tag === "label");

  const forAttr = await page.$eval("#color-btn", (el) => el.getAttribute("for"));
  const pickerId = await page.$eval("#color-picker", (el) => el.id);
  check("L2. Het label wijst via for=... naar #color-picker", forAttr === pickerId);

  const swatchColorInitial = await page.$eval("#color-swatch", (el) => getComputedStyle(el).backgroundColor);
  check("L3. Het kleur-bolletje heeft meteen een achtergrondkleur", swatchColorInitial && swatchColorInitial !== "rgba(0, 0, 0, 0)");

  await page.click("#color-btn"); // moet foutloos verlopen, ook al opent headless Chromium geen echt kleurenkiezer-scherm
  await page.waitForTimeout(150);

  await page.$eval("#color-picker", (input) => {
    input.value = "#9333ea";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const swatchAfterChange = await page.$eval("#color-swatch", (el) => getComputedStyle(el).backgroundColor);
  check("L4. Na kleurwijziging past het bolletje zich meteen aan", swatchAfterChange !== swatchColorInitial);

  await page.click("#color-reset-btn");
  await page.waitForTimeout(150);
  const swatchAfterReset = await page.$eval("#color-swatch", (el) => getComputedStyle(el).backgroundColor);
  check("L5. Na 'Standaardkleur' past het bolletje zich weer terug aan", swatchAfterReset === swatchColorInitial);

  check("Geen JS-fouten opgetreden tijdens deze test", jsErrors.length === 0);
  if (jsErrors.length) console.log(jsErrors);

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail > 0 ? 1 : 0);
})();
