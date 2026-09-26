// Verifieert de "wie"-badges bij items (initialen + kleur) en de
// instelling waarmee je zelf een badge-kleur kiest.

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

async function stelNaamIn(page, naam) {
  await page.evaluate(() => localStorage.setItem("boodschappenlijst:naam", ""));
  page.once("dialog", (d) => d.accept(naam));
  await page.click("#settings-btn");
  await page.waitForSelector("#settings-panel:not([hidden])");
  await page.click("#name-btn");
  await page.waitForTimeout(80);
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  // A. Initialen en automatische kleur bij "Toegevoegd door"
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=badge-test`);
    await page.waitForSelector("#app:not([hidden])");

    await stelNaamIn(page, "Joris");
    await page.click("#settings-close-btn");
    await page.fill("#new-item", "Appels");
    await page.click("button[type=submit]");
    await page.waitForTimeout(100);

    const badge = page.locator("li:has-text('Appels') .attributie-badge");
    check("A1. Badge met initiaal 'J' verschijnt bij een item van Joris", (await badge.textContent()) === "J");
    check("A2. Badge heeft een titel die 'Joris' noemt", (await badge.getAttribute("title") || "").includes("Joris"));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // B. Botsende voorletters: 2 letters zodra 2 namen dezelfde 1e letter delen
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=badge-botsing-test`);
    await page.waitForSelector("#app:not([hidden])");

    await stelNaamIn(page, "Joris");
    await page.click("#settings-close-btn");
    await page.fill("#new-item", "Appels");
    await page.click("button[type=submit]");
    await page.waitForTimeout(100);

    await stelNaamIn(page, "Julia");
    await page.click("#settings-close-btn");
    await page.fill("#new-item", "Bananen");
    await page.click("button[type=submit]");
    await page.waitForTimeout(100);

    const badgeJoris = await page.locator("li:has-text('Appels') .attributie-badge").textContent();
    const badgeJulia = await page.locator("li:has-text('Bananen') .attributie-badge").textContent();
    check("B1. Bij een botsende voorletter krijgt Joris 2 letters ('JO')", badgeJoris === "JO");
    check("B2. ...en Julia ook 2 letters ('JU')", badgeJulia === "JU");

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // C. Zelf een badge-kleur kiezen in Instellingen
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=badge-kleur-test`);
    await page.waitForSelector("#app:not([hidden])");

    await page.click("#settings-btn");
    await page.waitForSelector("#settings-panel:not([hidden])");
    check("C1. Zonder naam: uitleg dat je eerst een naam moet instellen, geen kleurbolletjes", (await page.locator("#badge-kleur-opties button").count()) === 0);

    await stelNaamIn(page, "Sanne");
    check("C2. Met naam: 10 kleurbolletjes om uit te kiezen", (await page.locator("#badge-kleur-opties button").count()) === 10);
    await page.click("#settings-close-btn");

    await page.fill("#new-item", "Kaas");
    await page.click("button[type=submit]");
    await page.waitForTimeout(100);
    const kleurVoorKeuze = await page.locator("li:has-text('Kaas') .attributie-badge").evaluate((n) => n.style.background);

    await page.click("#settings-btn");
    await page.waitForSelector("#settings-panel:not([hidden])");

    const bolletjes = page.locator("#badge-kleur-opties button"); // kies er een die nog niet actief is
    const aantalBolletjes = await bolletjes.count();
    let gekozenIndex = -1;
    for (let i = 0; i < aantalBolletjes; i++) {
      const isActief = await bolletjes.nth(i).evaluate((n) => n.classList.contains("actief"));
      if (!isActief) { gekozenIndex = i; break; }
    }
    await bolletjes.nth(gekozenIndex).click();
    await page.waitForTimeout(150);

    const kleurNaKeuze = await page.locator("li:has-text('Kaas') .attributie-badge").evaluate((n) => n.style.background);
    check("C3. Na het kiezen van een ander bolletje verandert de badge-kleur van je items", kleurNaKeuze !== kleurVoorKeuze);
    check("C4. Het gekozen bolletje zelf krijgt de 'actief'-markering", await bolletjes.nth(gekozenIndex).evaluate((n) => n.classList.contains("actief")));

    await page.click("#settings-close-btn");
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    const kleurNaHerladen = await page.locator("li:has-text('Kaas') .attributie-badge").evaluate((n) => n.style.background);
    check("C5. Na herladen staat de gekozen kleur er nog steeds (bewaard in het gezinnetje)", kleurNaHerladen === kleurNaKeuze);

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // D. Een gekozen kleur is voor het hele gezinnetje zichtbaar
  {
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    const page2 = await ctx.newPage();
    const errors = [];
    page1.on("pageerror", (e) => errors.push(e.message));
    page2.on("pageerror", (e) => errors.push(e.message));

    await page1.goto(`${base}/index.html?lijst=badge-kleur-sync-test`);
    await page1.waitForSelector("#app:not([hidden])");
    await stelNaamIn(page1, "Tom");
    await page1.click("#settings-close-btn");

    await page1.click("#settings-btn");
    await page1.waitForSelector("#settings-panel:not([hidden])");
    await page1.locator("#badge-kleur-opties button").nth(3).click();
    await page1.waitForTimeout(150);
    const gekozenKleur = await page1.locator("#badge-kleur-opties button").nth(3).evaluate((n) => n.style.background);
    await page1.click("#settings-close-btn");

    await page1.fill("#new-item", "Eieren");
    await page1.click("button[type=submit]");
    await page1.waitForTimeout(600); // wacht tot de 400ms-debounce voorbij is en de opslag is voltooid

    await page2.goto(`${base}/index.html?lijst=badge-kleur-sync-test`);
    await page2.waitForSelector("#app:not([hidden])");
    await page2.waitForTimeout(200);
    const kleurOpToestel2 = await page2.locator("li:has-text('Eieren') .attributie-badge").evaluate((n) => n.style.background);
    check("D1. Een op toestel 1 gekozen badge-kleur is ook op toestel 2 te zien", kleurOpToestel2 === gekozenKleur);

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
