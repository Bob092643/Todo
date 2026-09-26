// Verifieert dat de app zonder ?lijst= (geïnstalleerd icoontje) de eerder bezochte code hergebruikt i.p.v. een nieuwe te verzinnen.

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.join(__dirname, "test-run");

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (filePath.endsWith("/")) filePath = path.join(filePath, "index.html");
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("not found: " + filePath);
      return;
    }
    const ext = path.extname(filePath);
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
});

(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const firstUrl = `${base}/index.html?lijst=test-code-AAA`;
  await page.goto(firstUrl);
  await page.waitForSelector("#app:not([hidden])");
  const urlAfterFirstVisit = page.url();

  await page.goto(`${base}/index.html`); // zonder code, zoals het geïnstalleerde icoontje
  await page.waitForSelector("#app:not([hidden])");
  const urlAfterSecondVisit = page.url();

  await browser.close();
  server.close();

  console.log("Na 1e bezoek (met code):   ", urlAfterFirstVisit);
  console.log("Na 2e bezoek (zonder code):", urlAfterSecondVisit);

  const secondListId = new URL(urlAfterSecondVisit).searchParams.get("lijst");
  if (secondListId === "test-code-AAA") {
    console.log("\n✅ GESLAAGD: de oude lijst-code werd hergebruikt in plaats van een nieuwe te verzinnen.");
    process.exit(0);
  } else {
    console.log("\n❌ MISLUKT: er werd een andere/nieuwe code gebruikt:", secondListId);
    process.exit(1);
  }
})();
