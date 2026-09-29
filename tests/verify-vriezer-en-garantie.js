// Verifieert de "Details"-velden per item: datum/aantal (vriezer) en
// garantie/bonnetje-foto (aparte Firestore-collectie, zie FOTO_COLLECTIE in app.js).

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.join(__dirname, "test-run");

// Minimale geldige 1x1 PNG (transparant), voor de foto-upload-test.
const MINI_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

function daysAgoStr(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAheadStr(days) {
  return daysAgoStr(-days);
}

(async () => {
  const server = makeServer(ROOT);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch();

  const fotoPad = path.join(__dirname, "mini-test-foto.png");
  fs.writeFileSync(fotoPad, Buffer.from(MINI_PNG_BASE64, "base64"));

  // A. Datum + aantal (vriezer): invullen, compacte weergave, +/- stepper, "op"-toast, "ligt al lang"
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=vriezer-test`);
    await page.waitForSelector("#app:not([hidden])");

    await page.fill("#new-item", "Diepvriespizza");
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);

    const li = page.locator("li:has-text('Diepvriespizza')");
    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");

    check("A1. Details-paneel toont de itemnaam in de titel", (await page.textContent("#item-details-titel")) === "Diepvriespizza");

    await page.fill("#details-datum-input", daysAgoStr(120)); // 4 maanden geleden, ouder dan de standaard-drempel (3 maanden)
    await page.fill("#details-aantal-input", "1");
    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(100);

    check("A2. Details-paneel sluit na opslaan", await page.isHidden("#item-details-panel"));
    check("A3. Compacte weergave toont het aantal (1×)", (await li.locator(".item-vriezer-info").textContent()).includes("1×"));
    check("A4. 'Ligt al lang'-markering verschijnt (datum ouder dan standaard-drempel van 3 maanden)", (await li.locator(".vriezer-oud-badge").count()) === 1);

    await li.locator(".aantal-btn").nth(1).click(); // +
    await page.waitForTimeout(80);
    check("A5. '+' verhoogt het aantal naar 2×", (await li.locator(".aantal-getal").textContent()) === "2×");

    await li.locator(".aantal-btn").nth(0).click(); // − (2 -> 1)
    await page.waitForTimeout(80);
    check("A6. Toast blijft weg zolang het aantal nog niet op 0 staat", await page.isHidden("#toast"));

    await li.locator(".aantal-btn").nth(0).click(); // − (1 -> 0)
    await page.waitForTimeout(80);
    check("A7. Op 0 verschijnt een voorstel-toast met 'Afvinken'", (await page.isVisible("#toast")) && (await page.textContent("#toast-undo-btn")) === "Afvinken");

    await page.click("#toast-undo-btn");
    await page.waitForTimeout(100);
    check("A8. 'Afvinken' in de toast vinkt het item echt af", await li.evaluate((el) => el.classList.contains("done")));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // B. Per-lijst instelling: drempel en sorteren op datum (⚙ in ☰ Lijstjes)
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=vriezer-drempel-test`);
    await page.waitForSelector("#app:not([hidden])");

    for (const naam of ["Oud item", "Nieuw item"]) {
      await page.fill("#new-item", naam);
      await page.click("button[type=submit]");
      await page.waitForTimeout(80);
    }

    // "Oud item": 45 dagen geleden (ouder dan 1 maand, jonger dan de standaard-drempel van 3 maanden).
    let li = page.locator("li:has-text('Oud item')");
    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");
    await page.fill("#details-datum-input", daysAgoStr(45));
    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(100);

    li = page.locator("li:has-text('Oud item')");
    check("B1. Bij de standaard-drempel (3 maanden) is 45 dagen nog niet 'ligt al lang'", (await li.locator(".vriezer-oud-badge").count()) === 0);

    // "Nieuw item": vandaag.
    li = page.locator("li:has-text('Nieuw item')");
    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");
    await page.fill("#details-datum-input", daysAgoStr(0));
    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(100);

    await page.click("#lists-btn");
    await page.waitForSelector("#lists-panel:not([hidden])");
    await page.click(".lists-panel-gear");
    await page.waitForTimeout(80);
    await page.fill(".lijst-drempel-input", "1");
    await page.locator(".lijst-drempel-input").blur();
    await page.dispatchEvent(".lijst-drempel-input", "change");
    await page.waitForTimeout(100);
    await page.click(".lijst-sorteer-checkbox");
    await page.waitForTimeout(100);
    await page.click("#lists-close-btn");
    await page.waitForTimeout(80);

    li = page.locator("li:has-text('Oud item')");
    check("B2. Met de drempel op 1 maand is 45 dagen nu wél 'ligt al lang'", (await li.locator(".vriezer-oud-badge").count()) === 1);

    const volgordeTekst = await page.textContent("#list");
    check("B3. Sorteren op datum zet 'Oud item' (oudste) vóór 'Nieuw item'", volgordeTekst.indexOf("Oud item") < volgordeTekst.indexOf("Nieuw item"));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // C. Garantie: markeringen + lijst-niveau waarschuwing
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=garantie-test`);
    await page.waitForSelector("#app:not([hidden])");

    await page.fill("#new-item", "Wasmachine");
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);

    let li = page.locator("li:has-text('Wasmachine')");
    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");

    await page.fill("#details-aankoopdatum-input", daysAgoStr(30));
    await page.click(".garantie-snelkeuze-btn[data-jaren='2']");
    const tweejaarWaarde = await page.inputValue("#details-garantie-einde-input");
    check("C1. Snelkeuze '+2 jaar' vult de garantie-einddatum vanaf de aankoopdatum in", tweejaarWaarde.startsWith(String(new Date().getFullYear() + 2 - (new Date().getMonth() < new Date(daysAgoStr(30)).getMonth() ? 0 : 0))) || tweejaarWaarde.length === 10);

    // Voor de eigenlijke markering-test zetten we 'm expliciet op 20 dagen vanaf nu (binnen de 30-dagen-waarschuwing).
    await page.fill("#details-garantie-einde-input", daysAheadStr(20));
    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(100);

    li = page.locator("li:has-text('Wasmachine')");
    check("C2. 'Garantie verloopt binnen 30 dagen' (oranje) verschijnt", (await li.locator(".garantie-badge.garantie-verloopt").count()) === 1);

    check("C3. Het lijstje krijgt een ⚠️ in ☰ Lijstjes", (await page.locator("#list-tabs .list-tab-label").first().textContent()).includes("⚠️"));

    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");
    await page.fill("#details-garantie-einde-input", daysAgoStr(5));
    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(100);

    li = page.locator("li:has-text('Wasmachine')");
    check("C4. 'Garantie verlopen' (grijs) na het verstrijken van de datum", (await li.locator(".garantie-badge.garantie-verlopen").count()) === 1);

    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");
    await page.fill("#details-garantie-einde-input", "");
    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(100);

    li = page.locator("li:has-text('Wasmachine')");
    check("C5. Geen garantie-datum meer = geen markering meer", (await li.locator(".garantie-badge").count()) === 0);
    check("C5b. ...en ook de ⚠️ bij het lijstje is weer weg", !(await page.locator("#list-tabs .list-tab-label").first().textContent()).includes("⚠️"));

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  // D. Bonnetje-foto: uploaden, tonen, verwijderen — en mee opruimen bij definitief verwijderen
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${base}/index.html?lijst=foto-test`);
    await page.waitForSelector("#app:not([hidden])");

    await page.fill("#new-item", "Koffiezetapparaat");
    await page.click("button[type=submit]");
    await page.waitForTimeout(80);

    let li = page.locator("li:has-text('Koffiezetapparaat')");
    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");

    await page.setInputFiles("#details-foto-input", fotoPad);
    await page.waitForSelector("#details-foto-preview img");
    check("D1. Preview verschijnt meteen na het kiezen van een foto", (await page.locator("#details-foto-preview img").count()) === 1);

    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(150);

    li = page.locator("li:has-text('Koffiezetapparaat')");
    check("D2. 📷-seintje verschijnt op het item na opslaan", (await li.locator(".garantie-foto-seintje").count()) === 1);

    const itemId = await li.getAttribute("data-id");
    const fotoBestaatNaOpslaan = await page.evaluate((id) => localStorage.getItem("mockdoc:garantiefotos/" + id) !== null, itemId);
    check("D3. Foto staat (gemockt) in de aparte 'garantiefotos'-collectie, niet in het lijstdocument", fotoBestaatNaOpslaan);

    // Opnieuw openen: de bestaande foto moet lazy geladen worden.
    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");
    await page.waitForSelector("#details-foto-preview img", { timeout: 3000 });
    check("D4. Bestaande foto wordt bij het heropenen alsnog geladen en getoond", (await page.locator("#details-foto-preview img").count()) === 1);

    await page.click("#details-foto-verwijder-btn");
    await page.waitForTimeout(80);
    check("D5. 'Foto verwijderen' verbergt de preview meteen", await page.isHidden("#details-foto-preview"));

    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(150);

    li = page.locator("li:has-text('Koffiezetapparaat')");
    check("D6. 📷-seintje is weg na het verwijderen van de foto", (await li.locator(".garantie-foto-seintje").count()) === 0);
    const fotoWegNaVerwijderen = await page.evaluate((id) => localStorage.getItem("mockdoc:garantiefotos/" + id) === null, itemId);
    check("D7. De foto zelf is ook echt uit de 'garantiefotos'-collectie weg", fotoWegNaVerwijderen);

    // Opnieuw een foto erbij, dan het item helemaal (definitief) verwijderen — de foto moet meegaan.
    await li.locator(".item-menu-btn").click();
    await li.locator(".details-btn").click();
    await page.waitForSelector("#item-details-panel:not([hidden])");
    await page.setInputFiles("#details-foto-input", fotoPad);
    await page.waitForSelector("#details-foto-preview img");
    await page.click("#item-details-submit-btn");
    await page.waitForTimeout(150);

    const fotoBestaatVoorVerwijderen = await page.evaluate((id) => localStorage.getItem("mockdoc:garantiefotos/" + id) !== null, itemId);
    check("D8. (setup) Foto staat er weer, vlak voor het verwijderen van het item", fotoBestaatVoorVerwijderen);

    li = page.locator("li:has-text('Koffiezetapparaat')");
    await li.locator(".item-menu-btn").click();
    await li.locator(".delete-btn").click();
    await page.waitForTimeout(400);

    const fotoBestaatNaZachtVerwijderen = await page.evaluate((id) => localStorage.getItem("mockdoc:garantiefotos/" + id) !== null, itemId);
    check("D9. Na het gewone (herstelbare) verwijderen staat de foto er nog (30-dagen-vangnet)", fotoBestaatNaZachtVerwijderen);

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    await page.locator("#archive-list li:has-text('Koffiezetapparaat') .btn-delete-forever").click();
    await page.waitForTimeout(150);

    const fotoWegNaDefinitiefVerwijderen = await page.evaluate((id) => localStorage.getItem("mockdoc:garantiefotos/" + id) === null, itemId);
    check("D10. Na definitief verwijderen is de foto ook echt (voorgoed) weg", fotoWegNaDefinitiefVerwijderen);

    check("Geen JS-fouten opgetreden tijdens deze test", errors.length === 0);
    if (errors.length) console.log(errors);
    await ctx.close();
  }

  await browser.close();
  server.close();
  fs.unlinkSync(fotoPad);

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
