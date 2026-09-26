// Volledige testreeks tegen de mock-Firestore: basisfunctionaliteit, sync, lijst-code,
// naam, kleur, meerdere lijstjes, tabblad-volgorde, archief, migraties en de config-waarschuwing.

const { chromium } = require("playwright");
const path = require("path");
const http = require("http");
const fs = require("fs");

const SCRATCH = __dirname;

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

// Handelt meerdere dialogs (bv. confirm() gevolgd door prompt()) één voor één af via een antwoorden-wachtrij.
async function withDialogQueue(page, answers, fn) {
  const queue = [...answers];
  const handler = async (dialog) => {
    const answer = queue.shift();
    if (answer === false || answer === undefined) await dialog.dismiss();
    else if (answer === true) await dialog.accept();
    else await dialog.accept(answer);
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

async function withServer(root, fn) {
  const server = makeServer(root);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    await fn(`http://localhost:${port}`);
  } finally {
    server.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  const configuredRoot = path.join(SCRATCH, "test-run");
  const unconfiguredRoot = path.join(SCRATCH, "test-unconfigured");

  // A. Basisfunctionaliteit (toevoegen, afvinken, verwijderen, leeg)
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=basis-test`);
    await page.waitForSelector("#app:not([hidden])");

    check("A1. Lege lijst toont het 'leeg'-bericht", await page.isVisible("#empty-hint"));

    await page.fill("#new-item", "Melk halen");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);
    check("A2. Nieuw item verschijnt in de lijst", (await page.textContent("#list")).includes("Melk halen"));
    check("A3. 'Leeg'-bericht verdwijnt zodra er een item is", !(await page.isVisible("#empty-hint")));

    await page.click("#list li input[type=checkbox]");
    await page.waitForTimeout(150);
    check("A4. Item afvinken markeert 'm als gedaan", await page.$eval("#list li", (li) => li.classList.contains("done")));

    await page.click("#list li .item-menu-btn");
    await page.click("#list li .delete-btn");
    await page.waitForTimeout(500); // animatie + vangnet-timeout
    check("A5. Item verwijderen laat de lijst weer leeg zien", await page.isVisible("#empty-hint"));

    await ctx.close();
  });

  // B. Realtime synchronisatie tussen twee "gezinsleden" (zelfde lijst)
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    const page2 = await ctx.newPage();
    await page1.goto(`${base}/index.html?lijst=sync-test`);
    await page1.waitForSelector("#app:not([hidden])");
    await page2.goto(`${base}/index.html?lijst=sync-test`);
    await page2.waitForSelector("#app:not([hidden])");

    await page1.fill("#new-item", "Brood");
    await page1.click("button[type=submit]");
    await page2.waitForFunction(() => document.getElementById("list").textContent.includes("Brood"), { timeout: 15000 }).catch(() => {});
    check("B1. Item toegevoegd op toestel 1 verschijnt op toestel 2", (await page2.textContent("#list")).includes("Brood"));

    page1.on("dialog", (d) => d.accept("Takenlijst gezin Boot"));
    await page1.click("#rename-btn");
    await page2.waitForFunction(() => document.getElementById("list-name").textContent === "Takenlijst gezin Boot", { timeout: 15000 }).catch(() => {});
    check("B2. Naam aangepast op toestel 1 verschijnt op toestel 2", (await page2.textContent("#list-name")) === "Takenlijst gezin Boot");

    await ctx.close();
  });

  // C. Lijst-code gedrag
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(`${base}/index.html?lijst=code-AAA`);
    await page.waitForSelector("#app:not([hidden])");
    check("C1. Eerste bezoek met code in de link gebruikt die code", new URL(page.url()).searchParams.get("lijst") === "code-AAA");

    await page.goto(`${base}/index.html`);
    await page.waitForSelector("#app:not([hidden])");
    check("C2. Zonder code (geïnstalleerd icoontje) blijft de bewaarde code gebruikt", new URL(page.url()).searchParams.get("lijst") === "code-AAA");

    await page.goto(`${base}/index.html?lijst=code-BBB-ander-gezinnetje`);
    await page.waitForSelector("#app:not([hidden])");
    check("C3. Andere code in de link stapt over naar dat andere gezinnetje", new URL(page.url()).searchParams.get("lijst") === "code-BBB-ander-gezinnetje");

    page.on("dialog", (d) => d.accept("code-AAA")); // terug naar het eerste gezinnetje voor de rest van de C-serie
    await page.click("#list-code-btn");
    await page.waitForURL(/lijst=code-AAA/, { timeout: 3000 }).catch(() => {});
    page.removeAllListeners("dialog");

    page.on("dialog", (d) => d.accept("code-CCC-bewust"));
    await page.click("#list-code-btn");
    await page.waitForURL(/lijst=code-CCC-bewust/, { timeout: 3000 }).catch(() => {});
    check("C4. Bewust aanpassen via het codevakje werkt", new URL(page.url()).searchParams.get("lijst") === "code-CCC-bewust");

    page.removeAllListeners("dialog");
    page.on("dialog", (d) => d.dismiss());
    await page.click("#list-code-btn");
    await page.waitForTimeout(300);
    check("C5. Annuleren via het codevakje verandert niets", new URL(page.url()).searchParams.get("lijst") === "code-CCC-bewust");

    page.removeAllListeners("dialog");
    page.on("dialog", (d) => d.accept(`${base}/index.html?lijst=code-uit-volledige-link`));
    await page.click("#list-code-btn");
    await page.waitForURL(/lijst=code-uit-volledige-link/, { timeout: 3000 }).catch(() => {});
    check("C6. Hele link plakken haalt er automatisch de juiste code uit", new URL(page.url()).searchParams.get("lijst") === "code-uit-volledige-link");

    page.removeAllListeners("dialog");
    let alertMsg = null;
    page.on("dialog", async (d) => {
      if (d.type() === "alert") { alertMsg = d.message(); await d.accept(); }
      else await d.accept("foute/code/met/slash");
    });
    await page.click("#list-code-btn");
    await page.waitForTimeout(400);
    check("C7. Code met '/' wordt geweigerd met duidelijke melding", !!alertMsg);
    check("C8. Lijst-code blijft ongewijzigd na weigering", new URL(page.url()).searchParams.get("lijst") === "code-uit-volledige-link");

    check("C9. Codevakje toont de eerste 8 tekens van de code", (await page.textContent("#list-code-value")) === "code-uit".slice(0, 8));

    await ctx.close();
  });

  // D. Naam
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=naam-test-2`);
    await page.waitForSelector("#app:not([hidden])");
    check("D1. Standaardnaam is 'Onze lijst' als er nog niets is opgeslagen", (await page.textContent("#list-name")) === "Onze lijst");

    page.on("dialog", (d) => d.accept("Mijn eigen naam"));
    await page.click("#rename-btn");
    await page.waitForTimeout(150);
    check("D2. Naam wijzigt direct in de UI", (await page.textContent("#list-name")) === "Mijn eigen naam");
    check("D3. Documenttitel volgt de naam", (await page.title()) === "Mijn eigen naam");

    await ctx.close();
  });

  // E. Persoonlijke kleur
  await withServer(configuredRoot, async (base) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(`${base}/index.html?lijst=kleur-test-2`);
    await pageA.waitForSelector("#app:not([hidden])");

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(`${base}/index.html?lijst=kleur-test-2`);
    await pageB.waitForSelector("#app:not([hidden])");

    await pageA.$eval("#color-picker", (input) => {
      input.value = "#9333ea"; // paars
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const colorA = await pageA.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--blue-600").trim());
    check("E1. Kleur wordt toegepast op eigen toestel", colorA.toLowerCase() === "#9333ea");

    const colorB = await pageB.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--blue-600").trim());
    check("E2. Kleur lekt niet door naar ander toestel", colorB.toLowerCase() !== "#9333ea");

    await pageA.reload();
    await pageA.waitForSelector("#app:not([hidden])");
    const colorAfterReload = await pageA.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--blue-600").trim());
    check("E3. Kleur blijft staan na herladen", colorAfterReload.toLowerCase() === "#9333ea");

    await pageA.click("#settings-btn");
    await pageA.waitForTimeout(100);
    await pageA.click("#color-reset-btn");
    await pageA.waitForTimeout(150);
    const colorAfterReset = await pageA.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--blue-600").trim());
    check("E4. 'Standaard'-knop zet de kleur terug naar de oorspronkelijke", colorAfterReset.toLowerCase() === "#3b63e0");

    await pageA.reload();
    await pageA.waitForSelector("#app:not([hidden])");
    const colorAfterResetReload = await pageA.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--blue-600").trim());
    check("E5. Standaardkleur blijft ook staan na herladen (niet alsnog de oude kleur)", colorAfterResetReload.toLowerCase() === "#3b63e0");

    await ctxA.close();
    await ctxB.close();
  });

  // G. Meerdere lijstjes binnen 1 gezinnetje (☰-paneel, gedeeld/privé)
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto(`${base}/index.html?lijst=multi-eerste-lijst`);
    await page.waitForSelector("#app:not([hidden])");
    check("G1. Bij 1 lijstje staat dat lijstje als tabblad, naast de ☰-knop", (await page.locator(".list-tab").count()) === 2);

    await openListsPanel(page);
    check("G2. Het ☰-paneel toont het eerste lijstje ('Onze lijst')", (await page.textContent("#lists-panel-list")).includes("Onze lijst"));

    await withDialogQueue(page, [true, "Klusjes", true], async () => {
      await page.click("#lists-add-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");
    check("G3. Na het aanmaken is het nieuwe gedeelde lijstje meteen actief", (await page.textContent("#list-name")) === "Klusjes");

    await page.fill("#new-item", "Prullenbak buiten zetten");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);
    check("G4. Het nieuwe item staat in 'Klusjes'", (await page.textContent("#list")).includes("Prullenbak buiten zetten"));

    await openListsPanel(page);
    await page.click(`.lists-panel-name:has-text("Onze lijst")`);
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector("#app:not([hidden])");
    check("G5. Het eerste lijstje blijft leeg (lijstjes staan los van elkaar)", await page.isVisible("#empty-hint"));

    await openListsPanel(page);
    await page.click(`.lists-panel-name:has-text("Klusjes")`);
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector("#app:not([hidden])");
    check("G6. Terug op 'Klusjes' staat het item er nog steeds", (await page.textContent("#list")).includes("Prullenbak buiten zetten"));

    await openListsPanel(page);
    await withDialogQueue(page, [true, "Verjaardagslijst", false], async () => {
      await page.click("#lists-add-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");
    check("G7. Nieuw privé lijstje krijgt een zichtbaar 🔒-slotje bij de titel", await page.isVisible("#list-lock-icon"));

    let alertMsg = null;
    page.once("dialog", async (d) => { alertMsg = d.message(); await d.accept(); });
    await page.click("#share-btn");
    await page.waitForTimeout(100);
    check("G8. Delen van een privé lijstje wordt geblokkeerd met uitleg", !!alertMsg && alertMsg.includes("niet delen"));

    await openListsPanel(page);
    const priveRow = page.locator(".lists-panel-row", { hasText: "Verjaardagslijst" });
    const gedeeldRow = page.locator(".lists-panel-row", { hasText: "Klusjes" });
    check("G9. Een privé lijstje heeft geen 'verbergen'-knop", (await priveRow.locator(".lists-panel-hide").count()) === 0);
    check("G10. Een gedeeld lijstje heeft wél een 'verbergen'-knop", (await gedeeldRow.locator(".lists-panel-hide").count()) === 1);

    page.once("dialog", (d) => d.accept());
    await gedeeldRow.locator(".lists-panel-hide").click();
    await page.waitForTimeout(150);
    check("G11. Na verbergen staat 'Klusjes' niet meer in het paneel", !(await page.textContent("#lists-panel-list")).includes("Klusjes"));

    await ctx.close();
  });

  // H. Volgorde bepaalt de tabbladen en het "iets nieuws"-teken. Hoeveel
  // lijstjes passen is dynamisch (breedte-afhankelijk, zie renderTabs() in
  // app.js); een vast 400px-viewport hier houdt "3 passen, een 4e niet"
  // voorspelbaar (zie verify-dynamische-tabbladen.js voor de breedte-test zelf).
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 720 } });
    const page1 = await ctx.newPage();
    await page1.goto(`${base}/index.html?lijst=volgorde-test`);
    await page1.waitForSelector("#app:not([hidden])");

    async function nieuwGedeeldLijstje(naam) {
      await openListsPanel(page1);
      await withDialogQueue(page1, [true, naam, true], async () => {
        await page1.click("#lists-add-btn");
        await page1.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
      });
      await page1.waitForSelector("#app:not([hidden])");
      return new URL(page1.url()).searchParams.get("actief");
    }

    const tweedeId = await nieuwGedeeldLijstje("Tweede lijst");
    check("H1. Met 2 lijstjes (nog geen 3) staan ze allebei automatisch als tabblad", (await page1.locator(".list-tab").count()) === 3);

    await nieuwGedeeldLijstje("Derde lijst");
    check("H2. Met precies 3 lijstjes staan ze alle drie als tabblad", (await page1.locator(".list-tab").count()) === 4);

    await nieuwGedeeldLijstje("Vierde lijst");
    const tabLabelsNa4 = await page1.locator(".list-tab .list-tab-label").allInnerTexts();
    check("H3. Een 4e lijstje wordt niet automatisch een tabblad (alleen de eerste 3 uit de volgorde)", (await page1.locator(".list-tab").count()) === 4 && !tabLabelsNa4.some((t) => t.includes("Vierde lijst")));

    await openListsPanel(page1);
    check("H3b. Het 4e lijstje staat wél gewoon in het ☰-paneel", (await page1.textContent("#lists-panel-list")).includes("Vierde lijst"));

    const vierdeRow = page1.locator(".lists-panel-row", { hasText: "Vierde lijst" });
    await vierdeRow.locator(".move-btn").first().click();
    await page1.waitForTimeout(80);
    await vierdeRow.locator(".move-btn").first().click();
    await page1.waitForTimeout(80);
    await vierdeRow.locator(".move-btn").first().click();
    await page1.waitForTimeout(100);

    const eersteTabLabel = await page1.locator(".list-tab .list-tab-label").first().innerText();
    check("H4. Naar boven verplaatsen maakt 'Vierde lijst' zelf een tabblad (1e plek)", eersteTabLabel.includes("Vierde lijst"));
    const tabLabelsNaVerschuiven = await page1.locator(".list-tab .list-tab-label").allInnerTexts();
    check("H5. ...en 'Derde lijst' is daardoor geen tabblad meer", !tabLabelsNaVerschuiven.some((t) => t.includes("Derde lijst")));

    await page1.click(`.lists-panel-name:has-text("Onze lijst")`); // niet meer het actieve lijstje, nodig voor het "iets nieuws"-teken
    await page1.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page1.waitForSelector("#app:not([hidden])");

    const page2 = await ctx.newPage(); // 2e tabblad, bewerkt "Tweede lijst" om het teken te triggeren
    await page2.goto(`${base}/index.html?lijst=volgorde-test&actief=${encodeURIComponent(tweedeId)}`);
    await page2.waitForSelector("#app:not([hidden])");
    await page2.fill("#new-item", "Iets nieuws toevoegen");
    await page2.click("button[type=submit]");
    await page2.waitForTimeout(200);

    await page1.waitForFunction(
      () => document.getElementById("list-tabs")?.textContent.includes("Tweede lijst •"),
      { timeout: 15000 }
    ).catch(() => {});
    check("H6. Een lijstje dat elders wijzigde krijgt een 'iets nieuws'-teken (•)", (await page1.textContent("#list-tabs")).includes("Tweede lijst •"));

    await page1.click(`.list-tab:has-text("Tweede lijst")`);
    await page1.waitForFunction(
      () => document.querySelector(".list-tab.active")?.textContent.includes("Tweede lijst"),
      { timeout: 3000 }
    ).catch(() => {});
    check("H7. Het teken verdwijnt zodra je het lijstje zelf bekijkt", !(await page1.textContent("#list-tabs")).includes("•"));

    await ctx.close();
  });

  // I. Lijst archiveren/terugzetten, en een item definitief verwijderen
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html?lijst=archief-lijst-test`);
    await page.waitForSelector("#app:not([hidden])");

    await openListsPanel(page);
    await withDialogQueue(page, [true, "Op te ruimen lijstje", true], async () => {
      await page.click("#lists-add-btn");
      await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    });
    await page.waitForSelector("#app:not([hidden])");

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    await page.click(".danger-zone-summary"); // gevarenzone uitklappen
    await page.waitForSelector("#delete-list-btn:visible");
    page.once("dialog", (d) => d.accept());
    await page.click("#delete-list-btn");
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector("#app:not([hidden])");
    check("I1. Na verwijderen schakelt de app naar een overgebleven lijstje", (await page.textContent("#list-name")) !== "Op te ruimen lijstje");

    await openListsPanel(page);
    check("I2. Het verwijderde lijstje staat in het archiefgedeelte van het paneel", (await page.textContent("#lists-panel-archived")).includes("Op te ruimen lijstje"));

    await page.click(`#lists-panel-archived button:has-text("Terugzetten")`);
    await page.waitForTimeout(150);
    check("I3. 'Terugzetten' zet het lijstje weer terug tussen de gewone lijstjes", (await page.textContent("#lists-panel-list")).includes("Op te ruimen lijstje"));

    await page.click(`.lists-panel-name:has-text("Op te ruimen lijstje")`);
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector("#app:not([hidden])");
    await page.fill("#new-item", "Weg te gooien item");
    await page.click("button[type=submit]");
    await page.waitForTimeout(150);
    await page.click("#list li .item-menu-btn");
    await page.click("#list li .delete-btn");
    await page.waitForTimeout(500);

    await page.click("#archive-btn");
    await page.waitForSelector("#archive-panel:not([hidden])");
    check("I4. Het verwijderde item staat in het archief", (await page.textContent("#archive-list")).includes("Weg te gooien item"));
    check("I5. Er staat een 'Verwijder definitief'-knop bij, zonder extra bevestiging nodig", (await page.locator(".btn-delete-forever").count()) === 1);

    let dialogFiredOnForeverDelete = false;
    page.once("dialog", async (d) => { dialogFiredOnForeverDelete = true; await d.dismiss(); });
    await page.click(".btn-delete-forever");
    await page.waitForTimeout(150);
    check("I6. 'Verwijder definitief' vraagt geen extra bevestiging", !dialogFiredOnForeverDelete);
    check("I7. Het item is na 'Verwijder definitief' echt weg uit het archief", !(await page.textContent("#archive-list")).includes("Weg te gooien item"));

    await ctx.close();
  });

  // J. Bestaande (heel oude) gebruikers migreren naadloos naar een gezinnetje
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html`); // simuleert een toestel van vóór de tabbladen-update
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("boodschappenlijst:laatste-lijst-id", "migratie-test-lijst");
    });
    await page.goto(`${base}/index.html`);
    await page.waitForSelector("#app:not([hidden])");
    check("J1. Oude gebruikers komen automatisch weer in hun eigen gezinnetje uit", new URL(page.url()).searchParams.get("lijst") === "migratie-test-lijst");
    check("J2. Dat lijstje staat na migratie meteen als tabblad klaar", (await page.locator(".list-tab").count()) >= 1);

    await ctx.close();
  });

  // K. Losse oude tabbladen (vorige versie) samenvoegen tot 1 gezinnetje
  await withServer(configuredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Simuleert een toestel met de vorige tabbladen-versie: 2 losse, apart gedeelde lijstjes.
    await page.goto(`${base}/index.html`);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "boodschappenlijst:lijsten",
        JSON.stringify([
          { id: "oud-tabblad-hoofd", naam: "Boodschappen" },
          { id: "oud-tabblad-klusjes", naam: "Klusjes van vroeger" },
        ])
      );
      localStorage.setItem(
        "mockdoc:lists/oud-tabblad-klusjes",
        JSON.stringify({ items: [{ id: "x1", text: "Kliko buiten zetten", done: false }], archivedItems: [], listName: "Klusjes van vroeger", updatedAt: Date.now() })
      );
    });

    // Het eerste tabblad wordt het gezinnetje zelf; het tweede wordt via 1 dialoog (gedeeld/privé) samengevoegd.
    await withDialogQueue(page, [true], async () => {
      await page.goto(`${base}/index.html`);
      await page.waitForSelector("#app:not([hidden])");
      await page.waitForTimeout(300);
    });

    check("K1. Het eerste oude tabblad wordt het gezinnetje zelf", new URL(page.url()).searchParams.get("lijst") === "oud-tabblad-hoofd");

    await openListsPanel(page);
    check("K2. Het tweede, losse oude tabblad is meegenomen als extra lijstje", (await page.textContent("#lists-panel-list")).includes("Klusjes van vroeger"));

    await page.click(`.lists-panel-name:has-text("Klusjes van vroeger")`);
    await page.waitForURL(/actief=/, { timeout: 3000 }).catch(() => {});
    await page.waitForSelector("#app:not([hidden])");
    check("K3. De items van dat oude lijstje zijn behouden bij het samenvoegen", (await page.textContent("#list")).includes("Kliko buiten zetten"));

    await ctx.close();
  });

  // F. Config-waarschuwing (config.js nog niet ingevuld)
  await withServer(unconfiguredRoot, async (base) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/index.html`);
    await page.waitForTimeout(300);
    check("F1. Waarschuwing verschijnt als config.js nog niet is ingevuld", await page.isVisible("#config-hint"));
    check("F2. De app zelf blijft verborgen zolang config.js niet is ingevuld", !(await page.isVisible("#app")));
    await ctx.close();
  });

  await browser.close();

  console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
  process.exit(fail === 0 ? 0 : 1);
})();
