// Eigen dialoogvensters, ter vervanging van confirm()/prompt(): worden nooit
// stilzwijgend door de browser geblokkeerd (dat kan alleen bij de NATIVE
// confirm/prompt/alert) en passen in de stijl van de rest van de app.
//
// Alles hier bouwt zijn eigen DOM-elementen on the fly (geen vaste HTML nodig
// in index.html) en ruimt zichzelf weer op zodra de dialoog sluit.

function bouwOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const kaart = document.createElement("div");
  kaart.className = "modal-kaart";
  overlay.appendChild(kaart);
  document.body.appendChild(overlay);
  // Volgende animatieframe: pas dan de "zichtbaar"-class toevoegen, anders
  // start de transitie niet (element bestaat dan nog niet volgens de browser).
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("zichtbaar")));
  return { overlay, kaart };
}

function sluitOverlay(overlay) {
  overlay.classList.remove("zichtbaar");
  setTimeout(() => overlay.remove(), 200);
}

// Laagste-niveau primitief: jij bouwt de inhoud van de kaart zelf, en krijgt
// een sluit(waarde)-functie om de dialoog mee af te ronden. Tikken naast de
// kaart of op Escape sluit ook, met waarde null.
function openDialoog(vulKaart) {
  return new Promise((resolve) => {
    const { overlay, kaart } = bouwOverlay();
    let afgehandeld = false;

    function sluit(waarde) {
      if (afgehandeld) return;
      afgehandeld = true;
      document.removeEventListener("keydown", opEscape);
      sluitOverlay(overlay);
      resolve(waarde);
    }

    function opEscape(e) {
      if (e.key === "Escape") sluit(null);
    }
    document.addEventListener("keydown", opEscape);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) sluit(null);
    });

    vulKaart(kaart, sluit);
  });
}

function maakTitelHint(kaart, titel, hint) {
  const h2 = document.createElement("h2");
  h2.className = "modal-titel";
  h2.textContent = titel;
  kaart.appendChild(h2);
  if (hint) {
    const p = document.createElement("p");
    p.className = "modal-hint";
    p.textContent = hint;
    kaart.appendChild(p);
  }
}

function maakKnoppenrij(kaart) {
  const rij = document.createElement("div");
  rij.className = "modal-knoppen";
  kaart.appendChild(rij);
  return rij;
}

// --- Ja/nee-bevestiging (vervangt confirm()) ---
export function vraagBevestiging({ titel, hint, bevestigTekst = "OK", annulerenTekst = "Annuleren", gevaarlijk = false }) {
  return openDialoog((kaart, sluit) => {
    maakTitelHint(kaart, titel, hint);
    const knoppen = maakKnoppenrij(kaart);

    const annuleerBtn = document.createElement("button");
    annuleerBtn.type = "button";
    annuleerBtn.className = "btn modal-btn-line";
    annuleerBtn.textContent = annulerenTekst;
    annuleerBtn.addEventListener("click", () => sluit(false));

    const bevestigBtn = document.createElement("button");
    bevestigBtn.type = "button";
    bevestigBtn.className = "btn " + (gevaarlijk ? "btn-danger" : "btn-primary");
    bevestigBtn.textContent = bevestigTekst;
    bevestigBtn.addEventListener("click", () => sluit(true));

    knoppen.append(annuleerBtn, bevestigBtn);
    bevestigBtn.focus();
  });
}

// --- Eén tekstveld invullen (vervangt prompt()) ---
export function vraagInvoer({ titel, hint, waarde = "", placeholder = "", bevestigTekst = "OK", annulerenTekst = "Annuleren" }) {
  return openDialoog((kaart, sluit) => {
    maakTitelHint(kaart, titel, hint);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "modal-input";
    input.value = waarde;
    input.placeholder = placeholder;
    input.autocomplete = "off";
    kaart.appendChild(input);

    const versturen = () => sluit(input.value);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") versturen();
    });

    const knoppen = maakKnoppenrij(kaart);
    const annuleerBtn = document.createElement("button");
    annuleerBtn.type = "button";
    annuleerBtn.className = "btn modal-btn-line";
    annuleerBtn.textContent = annulerenTekst;
    annuleerBtn.addEventListener("click", () => sluit(null));

    const bevestigBtn = document.createElement("button");
    bevestigBtn.type = "button";
    bevestigBtn.className = "btn btn-primary";
    bevestigBtn.textContent = bevestigTekst;
    bevestigBtn.addEventListener("click", versturen);

    knoppen.append(annuleerBtn, bevestigBtn);
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

// --- Kiezen uit meerdere opties (vervangt confirm() dat als vertakking werd gebruikt) ---
export function vraagKeuze({ titel, hint, opties, annulerenTekst = "Annuleren" }) {
  return openDialoog((kaart, sluit) => {
    maakTitelHint(kaart, titel, hint);

    const rij = document.createElement("div");
    rij.className = "modal-keuze-rij";
    opties.forEach((optie) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "modal-keuze-btn";
      btn.textContent = optie.label;
      btn.addEventListener("click", () => sluit(optie.waarde));
      rij.appendChild(btn);
    });
    kaart.appendChild(rij);

    const knoppen = maakKnoppenrij(kaart);
    const annuleerBtn = document.createElement("button");
    annuleerBtn.type = "button";
    annuleerBtn.className = "btn modal-btn-line";
    annuleerBtn.textContent = annulerenTekst;
    annuleerBtn.style.flex = "1";
    annuleerBtn.addEventListener("click", () => sluit(null));
    knoppen.append(annuleerBtn);
  });
}

// --- Alleen-lezen tekst tonen om zelf te selecteren/kopiëren (vervangt het misbruiken van prompt() daarvoor) ---
export function toonTekst({ titel, hint, tekst, sluitenTekst = "Sluiten" }) {
  return openDialoog((kaart, sluit) => {
    maakTitelHint(kaart, titel, hint);

    const textarea = document.createElement("textarea");
    textarea.className = "modal-textarea";
    textarea.readOnly = true;
    textarea.value = tekst;
    kaart.appendChild(textarea);

    const knoppen = maakKnoppenrij(kaart);
    const sluitBtn = document.createElement("button");
    sluitBtn.type = "button";
    sluitBtn.className = "btn btn-primary";
    sluitBtn.style.flex = "1";
    sluitBtn.textContent = sluitenTekst;
    sluitBtn.addEventListener("click", () => sluit(undefined));
    knoppen.append(sluitBtn);

    setTimeout(() => { textarea.focus(); textarea.select(); }, 50);
  });
}

// --- Samengestelde dialoog: nieuw lijstje (naam + gedeeld/privé in één scherm) ---
export function vraagNieuwLijstje() {
  return openDialoog((kaart, sluit) => {
    maakTitelHint(kaart, "Nieuw lijstje", "Geef het een naam en kies of iedereen 'm ziet of alleen jij.");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "modal-input";
    input.value = "Nieuw lijstje";
    kaart.appendChild(input);

    let gedeeld = true;
    const keuzeRij = document.createElement("div");
    keuzeRij.className = "modal-keuze-rij";

    const gedeeldBtn = document.createElement("button");
    gedeeldBtn.type = "button";
    gedeeldBtn.className = "modal-keuze-btn gekozen";
    gedeeldBtn.textContent = "👨‍👩‍👧 Delen met gezin";

    const priveBtn = document.createElement("button");
    priveBtn.type = "button";
    priveBtn.className = "modal-keuze-btn";
    priveBtn.textContent = "🔒 Privé";

    function kiesGedeeld(waarde) {
      gedeeld = waarde;
      gedeeldBtn.classList.toggle("gekozen", waarde);
      priveBtn.classList.toggle("gekozen", !waarde);
    }
    gedeeldBtn.addEventListener("click", () => kiesGedeeld(true));
    priveBtn.addEventListener("click", () => kiesGedeeld(false));
    keuzeRij.append(gedeeldBtn, priveBtn);
    kaart.appendChild(keuzeRij);

    const knoppen = maakKnoppenrij(kaart);
    const annuleerBtn = document.createElement("button");
    annuleerBtn.type = "button";
    annuleerBtn.className = "btn modal-btn-line";
    annuleerBtn.textContent = "Annuleren";
    annuleerBtn.addEventListener("click", () => sluit(null));

    const aanmakenBtn = document.createElement("button");
    aanmakenBtn.type = "button";
    aanmakenBtn.className = "btn btn-primary";
    aanmakenBtn.textContent = "Aanmaken";
    aanmakenBtn.addEventListener("click", () => sluit({ naam: input.value, gedeeld }));

    knoppen.append(annuleerBtn, aanmakenBtn);
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}
