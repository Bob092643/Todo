// Boodschappenlijst — gedeelde lijst via Firestore, geen login nodig.
// Iedereen die de gedeelde link opent (met dezelfde ?lijst=code) ziet en
// bewerkt dezelfde lijst, in realtime.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// --- DOM references ---
const el = {
  app: document.getElementById("app"),
  configHint: document.getElementById("config-hint"),
  addForm: document.getElementById("add-form"),
  newItem: document.getElementById("new-item"),
  list: document.getElementById("list"),
  emptyHint: document.getElementById("empty-hint"),
  syncStatus: document.getElementById("sync-status"),
  statusDot: document.getElementById("status-dot"),
  shareBtn: document.getElementById("share-btn"),
  listCodeBtn: document.getElementById("list-code-btn"),
  listCodeValue: document.getElementById("list-code-value"),
  renameBtn: document.getElementById("rename-btn"),
  listNameEl: document.getElementById("list-name"),
  colorBtn: document.getElementById("color-btn"),
  colorPicker: document.getElementById("color-picker"),
  colorResetBtn: document.getElementById("color-reset-btn"),
  nameBtn: document.getElementById("name-btn"),
  listTabs: document.getElementById("list-tabs"),
  archiveBtn: document.getElementById("archive-btn"),
  archiveCount: document.getElementById("archive-count"),
  archivePanel: document.getElementById("archive-panel"),
  archiveCloseBtn: document.getElementById("archive-close-btn"),
  archiveList: document.getElementById("archive-list"),
  archiveEmptyHint: document.getElementById("archive-empty-hint"),
  deleteListBtn: document.getElementById("delete-list-btn"),
  deletedHint: document.getElementById("deleted-hint"),
  deletedText: document.getElementById("deleted-text"),
  restoreListBtn: document.getElementById("restore-list-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  settingsPanel: document.getElementById("settings-panel"),
  settingsCloseBtn: document.getElementById("settings-close-btn"),
  settingsNameHint: document.getElementById("settings-name-hint"),
  toast: document.getElementById("toast"),
  toastText: document.getElementById("toast-text"),
  toastUndoBtn: document.getElementById("toast-undo-btn"),
};

// Hoe lang een verwijderd item (of een verwijderd lijstje) bewaard blijft
// voor het definitief weg is.
const ARCHIVE_DAYS = 30;
const ARCHIVE_MS = ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

// De kleur waarmee de app standaard start (zie ook style.css en de
// "value" van #color-picker in index.html) — hier gebruikt om "Standaard"
// weer te kunnen terugzetten.
const DEFAULT_COLOR = "#3b63e0";

// state: "neutral" | "saving" | "synced" | "error"
function setSyncStatus(text, state = "neutral") {
  el.syncStatus.textContent = text;
  el.statusDot.className = "status-dot" + (state !== "neutral" ? ` ${state}` : "");
}

// --- Persoonlijke kleur (alleen op dit toestel, niet gedeeld) ---
// De hoofdkleur wordt aan de hand van één gekozen kleur automatisch
// omgerekend naar de iets donkerdere/lichtere tinten die de app al
// gebruikt (voor de kop, knoppen, en lichte accentvlakjes).
const COLOR_STORAGE_KEY = "boodschappenlijst:kleur";

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function applyAccentColor(hex) {
  const [h, s, l] = hexToHsl(hex);
  const root = document.documentElement.style;
  root.setProperty("--blue-600", hex);
  root.setProperty("--blue-700", hslToHex(h, s, Math.max(l - 10, 8)));
  root.setProperty("--blue-500", hslToHex(h, Math.min(s + 5, 100), Math.min(l + 12, 88)));
  root.setProperty("--blue-50", hslToHex(h, Math.min(s, 60), 94));
}

(function loadSavedColor() {
  try {
    const saved = localStorage.getItem(COLOR_STORAGE_KEY);
    if (saved) {
      applyAccentColor(saved);
      if (el.colorPicker) el.colorPicker.value = saved;
    }
  } catch (e) {
    /* localStorage niet beschikbaar; app blijft gewoon de standaardkleur tonen */
  }
})();

if (el.colorBtn && el.colorPicker) {
  el.colorBtn.addEventListener("click", () => el.colorPicker.click());
  el.colorPicker.addEventListener("input", () => {
    const hex = el.colorPicker.value;
    applyAccentColor(hex);
    try {
      localStorage.setItem(COLOR_STORAGE_KEY, hex);
    } catch (e) {
      /* kleur werkt nog wel voor deze sessie, wordt alleen niet onthouden */
    }
  });
}

// Terug naar de oorspronkelijke standaardkleur (ongedaan maken van een
// eigen kleurkeuze op dit toestel).
if (el.colorResetBtn) {
  el.colorResetBtn.addEventListener("click", () => {
    applyAccentColor(DEFAULT_COLOR);
    if (el.colorPicker) el.colorPicker.value = DEFAULT_COLOR;
    try {
      localStorage.removeItem(COLOR_STORAGE_KEY);
    } catch (e) {
      /* niet erg, de standaardkleur staat nu sowieso weer actief */
    }
  });
}

// --- Persoonlijke naam (alleen op dit toestel) ---
// Wordt gebruikt om te laten zien wie een item heeft toegevoegd of
// afgevinkt. Niet verplicht — als iemand geen naam invult, wordt dat er
// gewoon niet bij getoond.
const NAME_STORAGE_KEY = "boodschappenlijst:naam";
const NAME_ASKED_KEY = "boodschappenlijst:naam-gevraagd";

function loadMyName() {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || null;
  } catch (e) {
    return null;
  }
}

function saveMyName(name) {
  try {
    if (name) localStorage.setItem(NAME_STORAGE_KEY, name);
    else localStorage.removeItem(NAME_STORAGE_KEY);
  } catch (e) {
    /* werkt nog wel voor deze sessie, wordt alleen niet onthouden */
  }
}

let myName = loadMyName();

// Geeft een bruikbare naam terug, of null. Kan iemand die "xx" of "-"
// intypt niet tegenhouden — maar filtert in elk geval lege invoer of een
// enkel teken eruit, zodat zulke invoer niet als "naam" wordt opgeslagen
// en overal in de lijst gaat verschijnen.
function normalizeName(input) {
  const trimmed = (input || "").trim();
  return trimmed.length >= 2 ? trimmed : null;
}

function updateNameBtn() {
  if (el.nameBtn) el.nameBtn.textContent = myName ? "Naam wijzigen" : "Naam instellen";
  if (el.settingsNameHint) {
    el.settingsNameHint.textContent = myName
      ? `Nu ingesteld als "${myName}".`
      : "Nog niet ingesteld — anderen zien dan niet wie iets heeft toegevoegd of afgevinkt.";
  }
}
updateNameBtn();

if (el.nameBtn) {
  el.nameBtn.addEventListener("click", () => {
    const naam = prompt(
      "Hoe wil je genoemd worden in deze lijst? (bijv. Papa, Mama, Joris)\n\nZo zien anderen wie iets heeft toegevoegd of afgevinkt.",
      myName || ""
    );
    if (naam === null) return; // geannuleerd
    myName = normalizeName(naam);
    saveMyName(myName);
    updateNameBtn();
  });
}

// Bij de allereerste keer op dit toestel eenmalig om een naam vragen —
// daarna nooit meer opnieuw vragen (ook niet als iemand toen niets invulde),
// om de app niet steeds te onderbreken.
function askNameIfNeeded() {
  let asked = false;
  try {
    asked = localStorage.getItem(NAME_ASKED_KEY) === "1";
  } catch (e) {
    /* geen probleem, dan vragen we het gewoon (nogmaals) */
  }
  if (myName || asked) return;
  try {
    localStorage.setItem(NAME_ASKED_KEY, "1");
  } catch (e) {
    /* niet erg */
  }
  const naam = prompt(
    "Hoe wil je genoemd worden in deze lijst? (bijv. Papa, Mama, Joris)\n\nZo zien anderen wie iets heeft toegevoegd of afgevinkt. Je kunt dit later nog aanpassen via ⚙️ Instellingen. Leeg laten kan ook.",
    ""
  );
  const normalized = normalizeName(naam);
  if (normalized) {
    myName = normalized;
    saveMyName(myName);
  }
  updateNameBtn();
}

// --- Kort meldingsbalkje onderin, met "Ongedaan maken" ---
// Een stapeltje in plaats van maar 1 plekje: als je snel twee dingen na
// elkaar afvinkt/verwijdert, raakte eerder de eerste actie meteen z'n
// "Ongedaan maken"-knopje kwijt (nog wel terug te vinden via het archief,
// maar niet meer met 1 tik). Nu blijft elke actie even in de rij staan.
let toastTimer = null;
let undoStack = []; // { text, undo } — meest recente actie achteraan

// Zet het balkje boven de voettekst (sync-status/Code) in plaats van
// er half overheen — de voettekst-hoogte wordt bij elke keer opnieuw
// opgemeten, voor het geval de tekst daarin ooit breder/hoger wordt.
function positionToastAboveFooter() {
  if (!el.toast) return;
  const footer = document.querySelector(".statusbar");
  const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
  el.toast.style.bottom = `calc(${footerHeight}px + env(safe-area-inset-bottom, 0px) + 10px)`;
}

function renderToast() {
  if (!el.toast || undoStack.length === 0) return;
  const top = undoStack[undoStack.length - 1];
  el.toastText.textContent =
    undoStack.length > 1 ? `${top.text} (+${undoStack.length - 1} eerder)` : top.text;
  positionToastAboveFooter();
  el.toast.hidden = false;
}

function hideToast() {
  clearTimeout(toastTimer);
  undoStack = [];
  if (el.toast) el.toast.hidden = true;
}

function showToast(text, undoFn) {
  if (!el.toast) return;
  undoStack.push({ text, undo: undoFn });
  if (undoStack.length > 5) undoStack.shift(); // niet eindeloos laten opstapelen
  clearTimeout(toastTimer);
  renderToast();
  toastTimer = setTimeout(hideToast, 5000);
}

if (el.toastUndoBtn) {
  el.toastUndoBtn.addEventListener("click", () => {
    const top = undoStack.pop();
    clearTimeout(toastTimer);
    if (top) top.undo();
    if (undoStack.length > 0) {
      renderToast();
      toastTimer = setTimeout(hideToast, 5000);
    } else {
      hideToast();
    }
  });
}

// --- Config-check ---
if (!CONFIG.firebaseConfig || CONFIG.firebaseConfig.apiKey === "VUL-HIER-IN") {
  el.configHint.hidden = false;
  setSyncStatus("Niet ingesteld");
} else {
  start();
}

function start() {
  const firebaseApp = initializeApp(CONFIG.firebaseConfig);
  const db = getFirestore(firebaseApp);

  const DEFAULT_LIST_NAME = "Onze lijst";

  // --- Meerdere lijstjes naast elkaar ---
  // Elk toestel onthoudt zélf welke lijstjes het kent (naam + code) en welk
  // lijstje nu open staat. De lijstjes zelf staan gewoon in Firestore, dit
  // is alleen de "kladlijst met snelkoppelingen" die lokaal op dit toestel
  // leeft.
  const LISTS_KEY = "boodschappenlijst:lijsten";
  const ACTIVE_KEY = "boodschappenlijst:actieve-lijst";
  // Uit de vorige versie van de app (toen er nog maar 1 lijstje per
  // toestel kon zijn) — gebruikt om bestaande gebruikers naadloos te
  // migreren naar het nieuwe, meerdere-lijstjes-systeem.
  const OLD_STORAGE_KEY = "boodschappenlijst:laatste-lijst-id";

  function loadLists() {
    try {
      const raw = localStorage.getItem(LISTS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch (e) {
      /* localStorage niet beschikbaar, of kapotte opgeslagen data */
    }
    return null;
  }

  function saveLists(value) {
    try {
      localStorage.setItem(LISTS_KEY, JSON.stringify(value));
    } catch (e) {
      /* werkt nog wel voor deze sessie, wordt alleen niet onthouden */
    }
  }

  function saveActive(id) {
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch (e) {
      /* niet erg */
    }
  }

  const params = new URLSearchParams(location.search);
  const urlListId = params.get("lijst");

  let lists = loadLists();

  if (!lists) {
    // Eerste keer op dit toestel, of migratie vanaf de vorige versie
    // (die nog maar 1 lijstje per toestel kende).
    let migratedId = null;
    try {
      migratedId = localStorage.getItem(OLD_STORAGE_KEY);
    } catch (e) {
      /* geen probleem */
    }
    const startId = migratedId || urlListId || crypto.randomUUID();
    lists = [{ id: startId, naam: DEFAULT_LIST_NAME }];
    saveLists(lists);
    saveActive(startId);
  }

  let listId = null;
  try {
    listId = localStorage.getItem(ACTIVE_KEY);
  } catch (e) {
    /* niet erg */
  }
  if (!listId || !lists.some((l) => l.id === listId)) {
    listId = lists[0].id;
    saveActive(listId);
  }

  // Een link met een lijst-code die je nog niet kent (bv. gedeeld door een
  // gezinslid): voeg 'm toe als nieuw tabblad en open 'm meteen. Een code
  // die je al kent, schakelt gewoon naar dat bestaande tabblad. Zo kan het
  // openen van een link nooit een ander lijstje overschrijven — er komt
  // hooguit een tabblad bij.
  if (urlListId && urlListId !== listId) {
    if (!lists.some((l) => l.id === urlListId)) {
      lists.push({ id: urlListId, naam: "Lijst" });
      saveLists(lists);
    }
    listId = urlListId;
    saveActive(listId);
  }

  // Adresbalk altijd gelijk laten lopen met het lijstje dat nu écht actief is.
  params.set("lijst", listId);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);

  const listRef = doc(db, "lists", listId);

  async function switchToList(id) {
    // Eerst een eventuele nog-niet-opgeslagen wijziging (binnen de korte
    // vertraging na typen/afvinken) meteen wegschrijven — anders zou een
    // snelle wisseling van tabblad die laatste wijziging kunnen verliezen.
    await flushPendingSave();
    saveActive(id);
    const p = new URLSearchParams(location.search);
    p.set("lijst", id);
    location.href = `${location.pathname}?${p.toString()}`;
  }

  function renderTabs() {
    if (!el.listTabs) return;
    el.listTabs.innerHTML = "";
    el.listTabs.hidden = false;

    for (const l of lists) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "list-tab" + (l.id === listId ? " active" : "");
      tab.title = l.naam || "Lijst";

      const label = document.createElement("span");
      label.className = "list-tab-label";
      label.textContent = l.naam || "Lijst";
      tab.appendChild(label);

      tab.addEventListener("click", () => {
        if (l.id !== listId) switchToList(l.id);
      });

      // Alleen laten "vergeten" als er nog een ander lijstje overblijft.
      if (lists.length > 1) {
        const removeBtn = document.createElement("span");
        removeBtn.className = "list-tab-remove";
        removeBtn.textContent = "✕";
        removeBtn.title = "Dit lijstje hier niet meer tonen";
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (
            !confirm(
              `"${l.naam || "Lijst"}" hier niet meer laten zien op dit toestel?\n\nHet lijstje zelf blijft gewoon bestaan — jij (met de code) en anderen kunnen er nog steeds bij.`
            )
          ) {
            return;
          }
          lists = lists.filter((x) => x.id !== l.id);
          saveLists(lists);
          if (l.id === listId) {
            switchToList(lists[0].id);
          } else {
            renderTabs();
          }
        });
        tab.appendChild(removeBtn);
      }

      el.listTabs.appendChild(tab);
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "list-tab list-tab-add";
    addBtn.textContent = "+";
    addBtn.title = "Lijstje toevoegen";
    addBtn.addEventListener("click", addList);
    el.listTabs.appendChild(addBtn);
  }

  function addList() {
    const nieuw = confirm(
      "Nieuw leeg lijstje maken?\n\nOK = een gloednieuw lijstje aanmaken\nAnnuleren = een bestaand lijstje toevoegen via een code die je hebt gekregen"
    );

    if (nieuw) {
      const naam = prompt("Naam voor het nieuwe lijstje:", "Nieuw lijstje");
      if (naam === null) return; // geannuleerd
      const id = crypto.randomUUID();
      lists.push({ id, naam: naam.trim() || "Nieuw lijstje" });
      saveLists(lists);
      switchToList(id);
      return;
    }

    const code = prompt("Plak hier de code (of de hele link) van het lijstje dat je erbij wilt:");
    if (code === null) return; // geannuleerd
    let trimmed = code.trim();
    try {
      const maybeUrl = new URL(trimmed);
      const fromUrl = maybeUrl.searchParams.get("lijst");
      if (fromUrl) trimmed = fromUrl.trim();
    } catch (e) {
      /* was geen volledige link, gewoon de geplakte tekst zelf gebruiken */
    }
    if (!trimmed) return;
    if (trimmed.includes("/")) {
      alert("Deze code mag geen \"/\" bevatten. Controleer of je de juiste code hebt geplakt.");
      return;
    }
    if (!lists.some((l) => l.id === trimmed)) {
      lists.push({ id: trimmed, naam: "Lijst" });
      saveLists(lists);
    }
    switchToList(trimmed);
  }

  renderTabs();

  // Toon de eerste 8 tekens van de lijst-code onderin, zodat je op twee
  // telefoons naast elkaar kunt controleren of ze naar dezelfde lijst
  // wijzen. Tikken opent de vólledige code, zodat je 'm kunt controleren
  // en — indien nodig — kunt vervangen door een andere (dit tábblad blijft
  // dan bestaan, alleen de code erachter verandert).
  el.listCodeValue.textContent = listId.slice(0, 8);
  el.listCodeBtn.addEventListener("click", () => {
    const next = prompt("Lijst-code (controleer of dit klopt, of plak hier een andere):", listId);
    if (next === null) return; // geannuleerd, niets aanpassen

    // Mensen plakken hier weleens de hele link in plaats van alleen het
    // codestukje erachter — haal 'm er dan automatisch uit.
    let trimmed = next.trim();
    try {
      const maybeUrl = new URL(trimmed);
      const fromUrl = maybeUrl.searchParams.get("lijst");
      if (fromUrl) trimmed = fromUrl.trim();
    } catch (e) {
      /* was geen volledige link, gewoon de geplakte tekst zelf gebruiken */
    }

    if (!trimmed || trimmed === listId) return; // niets veranderd

    // Een "/" zou de verwijzing naar de verkeerde plek in de database sturen
    // — dat laten we niet toe, met een duidelijke uitleg waarom.
    if (trimmed.includes("/")) {
      alert("Deze code mag geen \"/\" bevatten. Controleer of je de juiste code hebt geplakt.");
      return;
    }

    const entry = lists.find((l) => l.id === listId);
    if (entry) entry.id = trimmed;
    saveLists(lists);
    switchToList(trimmed);
  });

  let items = [];
  let archivedItems = []; // verwijderde items, nog binnen de 30-dagen-termijn
  let deletedAt = null; // gezet zodra de hele lijst "verwijderd" is
  let knownIds = new Set(); // voor de "nieuw binnengekomen" animatie
  let saveTimer = null;
  // Of het archiefpaneel resp. het instellingenpaneel nu open staat — eigen,
  // lokale schermkeuzes die niet door een (mogelijk synchroon binnenkomende)
  // onSnapshot-update ongedaan gemaakt mogen worden. Moeten vóór de
  // onSnapshot-registratie hieronder bestaan, want de eerste update kan
  // daar synchroon binnenkomen.
  let archiveOpen = false;
  let settingsOpen = false;

  // --- Naam van de lijst, gedeeld met iedereen die de link heeft ---
  let listName = DEFAULT_LIST_NAME;

  function setListName(name) {
    listName = name && name.trim() ? name.trim() : DEFAULT_LIST_NAME;
    el.listNameEl.textContent = listName;
    document.title = listName;
  }

  setListName(DEFAULT_LIST_NAME);

  el.renameBtn.addEventListener("click", () => {
    const next = prompt("Nieuwe naam voor jullie lijst:", listName);
    if (next === null) return; // geannuleerd
    setListName(next);
    const entry = lists.find((l) => l.id === listId);
    if (entry && entry.naam !== listName) {
      entry.naam = listName;
      saveLists(lists);
      renderTabs();
    }
    scheduleSave();
  });

  el.app.hidden = false;
  setSyncStatus("Verbinden...");
  // Even laten wachten tot ná het opzetten van de synchronisatie (hieronder),
  // zodat een eventuele naam-vraag (een blokkerend dialoogvenster) nooit het
  // meteen laden en synchroniseren van de lijst zelf ophoudt.
  setTimeout(askNameIfNeeded, 300);

  onSnapshot(
    listRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      items = data.items || [];
      archivedItems = data.archivedItems || [];
      deletedAt = data.deletedAt || null;

      if (!snap.exists()) {
        // Gloednieuw (nog leeg) lijstje: gebruik de naam die net bij het
        // aanmaken/toevoegen is gekozen als startnaam, en sla die meteen op
        // zodat ook anderen die de link krijgen 'm meteen goed zien.
        const entry = lists.find((l) => l.id === listId);
        setListName(entry ? entry.naam : DEFAULT_LIST_NAME);
        scheduleSave();
      } else {
        setListName(data.listName);
        // Houd het tabblad-label in de pas met de echte (gedeelde) naam.
        const entry = lists.find((l) => l.id === listId);
        if (entry && entry.naam !== listName) {
          entry.naam = listName;
          saveLists(lists);
          renderTabs();
        }
      }

      // Archiefitems die al langer dan 30 dagen geleden zijn verwijderd,
      // definitief opruimen (gebeurt op elk toestel dat toevallig deze
      // lijst opent — er draait geen server die dit los doet).
      const purged = purgeExpiredArchive();

      // Items van vóór deze update hebben nog geen "sinds wanneer staat dit
      // hier"-datum — die krijgen 'm nu alsnog (vanaf nu, niet met
      // terugwerkende kracht), zodat ze niet meteen als "al lang geleden"
      // verschijnen.
      let backfilled = false;
      for (const item of items) {
        if (!item.createdAt) {
          item.createdAt = Date.now();
          backfilled = true;
        }
      }

      updateDeletedView();
      render();
      renderArchive();
      setSyncStatus("Gesynchroniseerd " + new Date().toLocaleTimeString(), "synced");
      if (purged || backfilled) scheduleSave();
    },
    (err) => {
      console.error("Synchronisatiefout:", err);
      setSyncStatus("Synchronisatiefout — zie console", "error");
    }
  );

  function scheduleSave() {
    clearTimeout(saveTimer);
    setSyncStatus("Wijzigen...", "saving");
    saveTimer = setTimeout(saveList, 400);
  }

  // Schrijft een nog "in de wacht" staande wijziging (uit scheduleSave)
  // meteen weg, in plaats van te wachten op de normale korte vertraging.
  // Nodig vlak vóórdat de pagina ergens anders naartoe gaat (bv. wisselen
  // van tabblad), anders zou die wijziging nooit opgeslagen worden.
  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await saveList();
    }
  }

  async function saveList() {
    setSyncStatus("Opslaan...", "saving");
    try {
      await setDoc(listRef, { items, archivedItems, listName, deletedAt, updatedAt: Date.now() });
      setSyncStatus("Opgeslagen " + new Date().toLocaleTimeString(), "synced");
    } catch (e) {
      console.error("Fout bij opslaan:", e);
      setSyncStatus("Fout bij opslaan — zie console", "error");
    }
  }

  // Verwijdert items ouder dan 30 dagen definitief uit het archief.
  // Geeft true terug als er echt iets is opgeruimd (zodat de aanroeper kan
  // besluiten dit ook meteen op te slaan).
  function purgeExpiredArchive() {
    const cutoff = Date.now() - ARCHIVE_MS;
    const before = archivedItems.length;
    archivedItems = archivedItems.filter((i) => i.deletedAt > cutoff);
    return archivedItems.length !== before;
  }

  function daysLeft(since) {
    return Math.max(1, Math.ceil((ARCHIVE_MS - (Date.now() - since)) / (24 * 60 * 60 * 1000)));
  }

  function archiveItem(id) {
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const [item] = items.splice(idx, 1);
    item.deletedAt = Date.now();
    archivedItems.push(item);
    knownIds.delete(id);
    render();
    renderArchive();
    scheduleSave();
    showToast(`"${item.text}" is verwijderd`, () => restoreItem(id));
  }

  function removeItem(id) {
    const li = el.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (li) {
      li.classList.add("removing");
      li.addEventListener("transitionend", () => archiveItem(id), { once: true });
      // Vangnet voor als transitionend niet vuurt (bv. reduced-motion).
      setTimeout(() => {
        if (items.some((i) => i.id === id)) archiveItem(id);
      }, 300);
    } else {
      archiveItem(id);
    }
  }

  function restoreItem(id) {
    const idx = archivedItems.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const [item] = archivedItems.splice(idx, 1);
    delete item.deletedAt;
    items.push(item);
    render();
    renderArchive();
    scheduleSave();
  }

  function renderArchive() {
    if (!el.archiveList) return;
    el.archiveList.innerHTML = "";
    el.archiveEmptyHint.hidden = archivedItems.length > 0;
    el.archiveCount.hidden = archivedItems.length === 0;
    el.archiveCount.textContent = archivedItems.length;

    for (const item of archivedItems) {
      const li = document.createElement("li");

      const text = document.createElement("span");
      text.className = "item-text";
      text.textContent = item.text;

      const meta = document.createElement("span");
      meta.className = "archive-meta";
      const d = daysLeft(item.deletedAt);
      meta.textContent = `vervalt over ${d} dag${d === 1 ? "" : "en"}`;

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn btn-ghost btn-small";
      restoreBtn.textContent = "Terugzetten";
      restoreBtn.addEventListener("click", () => restoreItem(item.id));

      li.append(text, meta, restoreBtn);
      el.archiveList.appendChild(li);
    }
  }

  // --- Hele lijst verwijderen (met dezelfde 30-dagen-vangnet als items) ---
  function updateDeletedView() {
    if (deletedAt) {
      el.app.hidden = true;
      el.archivePanel.hidden = true;
      if (el.settingsPanel) el.settingsPanel.hidden = true;
      el.deletedHint.hidden = false;

      if (Date.now() - deletedAt > ARCHIVE_MS) {
        el.deletedText.textContent = `"${listName}" is definitief verwijderd.`;
        el.restoreListBtn.hidden = true;
      } else {
        const d = daysLeft(deletedAt);
        el.deletedText.textContent = `"${listName}" is verwijderd. Nog ${d} dag${d === 1 ? "" : "en"} om 'm terug te zetten.`;
        el.restoreListBtn.hidden = false;
      }
      return;
    }

    el.deletedHint.hidden = true;

    if (archiveOpen) {
      el.app.hidden = true;
      el.archivePanel.hidden = false;
      if (el.settingsPanel) el.settingsPanel.hidden = true;
    } else if (settingsOpen) {
      el.app.hidden = true;
      el.archivePanel.hidden = true;
      if (el.settingsPanel) el.settingsPanel.hidden = false;
    } else {
      el.app.hidden = false;
      el.archivePanel.hidden = true;
      if (el.settingsPanel) el.settingsPanel.hidden = true;
    }
  }

  if (el.archiveBtn) {
    el.archiveBtn.addEventListener("click", () => {
      archiveOpen = true;
      settingsOpen = false;
      renderArchive();
      updateDeletedView();
    });
  }

  if (el.archiveCloseBtn) {
    el.archiveCloseBtn.addEventListener("click", () => {
      archiveOpen = false;
      updateDeletedView();
    });
  }

  if (el.settingsBtn) {
    el.settingsBtn.addEventListener("click", () => {
      settingsOpen = true;
      archiveOpen = false;
      updateNameBtn();
      updateDeletedView();
    });
  }

  if (el.settingsCloseBtn) {
    el.settingsCloseBtn.addEventListener("click", () => {
      settingsOpen = false;
      updateDeletedView();
    });
  }

  if (el.deleteListBtn) {
    el.deleteListBtn.addEventListener("click", async () => {
      const typed = prompt(
        `Hiermee verwijder je "${listName}" voor iedereen die de link/code heeft. Je hebt daarna nog ${ARCHIVE_DAYS} dagen om 'm terug te zetten — daarna is de lijst echt weg.\n\nTyp VERWIJDER om te bevestigen:`
      );
      if (typed !== "VERWIJDER") return;
      deletedAt = Date.now();
      archiveOpen = false;
      updateDeletedView();
      await saveList();
    });
  }

  if (el.restoreListBtn) {
    el.restoreListBtn.addEventListener("click", async () => {
      deletedAt = null;
      updateDeletedView();
      await saveList();
    });
  }

  // Geeft de volgorde-index terug van elk actief (niet-afgevinkt) item
  // binnen de onderliggende `items`-array, gescheiden per groep (vastgepind
  // of niet) — dat is de volgorde waarin de pijltjes-omhoog/omlaag bewegen.
  // Een vastgepind item kan zo nooit per ongeluk via de pijltjes tussen de
  // gewone items belanden (dat kan alleen via de 📌-knop).
  function activeIndexOrder(pinned) {
    const order = [];
    items.forEach((it, i) => {
      if (!it.done && !!it.pinned === !!pinned) order.push(i);
    });
    return order;
  }

  function moveItem(id, direction) {
    const myIndex = items.findIndex((i) => i.id === id);
    if (myIndex === -1) return;
    const order = activeIndexOrder(items[myIndex].pinned);
    const pos = order.indexOf(myIndex);
    if (pos === -1) return;
    const swapWithPos = pos + direction;
    if (swapWithPos < 0 || swapWithPos >= order.length) return; // al helemaal boven-/onderaan
    const otherIndex = order[swapWithPos];
    [items[myIndex], items[otherIndex]] = [items[otherIndex], items[myIndex]];
    render();
    scheduleSave();
  }

  function buildItemRow(item, { isFirstActive, isLastActive, showMoveButtons }) {
    const li = document.createElement("li");
    li.className = item.done ? "done" : "";
    li.dataset.id = item.id;
    if (!knownIds.has(item.id)) li.classList.add("entering");

    const row = document.createElement("div");
    row.className = "item-row";

    const check = document.createElement("label");
    check.className = "check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.setAttribute("aria-label", `${item.text} afvinken`);
    checkbox.addEventListener("change", () => {
      const wordtAfgevinkt = !item.done && checkbox.checked;
      item.done = checkbox.checked;
      if (item.done) {
        if (myName) item.doneBy = myName;
      } else {
        delete item.doneBy;
      }
      render();
      scheduleSave();
      if (wordtAfgevinkt) {
        showToast(`"${item.text}" is afgevinkt`, () => {
          item.done = false;
          delete item.doneBy;
          render();
          scheduleSave();
        });
      }
    });

    const box = document.createElement("span");
    box.className = "box";
    box.innerHTML = CHECK_ICON;

    check.append(checkbox, box);

    const text = document.createElement("span");
    text.className = "item-text";
    text.textContent = item.text;

    row.append(check, text);

    if (showMoveButtons) {
      const moveWrap = document.createElement("span");
      moveWrap.className = "move-buttons";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "move-btn";
      upBtn.textContent = "↑";
      upBtn.disabled = isFirstActive;
      upBtn.setAttribute("aria-label", `${item.text} naar boven verplaatsen`);
      upBtn.addEventListener("click", () => moveItem(item.id, -1));

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "move-btn";
      downBtn.textContent = "↓";
      downBtn.disabled = isLastActive;
      downBtn.setAttribute("aria-label", `${item.text} naar beneden verplaatsen`);
      downBtn.addEventListener("click", () => moveItem(item.id, 1));

      moveWrap.append(upBtn, downBtn);
      row.append(moveWrap);

      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "pin-btn" + (item.pinned ? " active" : "");
      pinBtn.textContent = "📌";
      pinBtn.title = item.pinned ? "Losmaken van bovenaan" : "Vastpinnen bovenaan";
      pinBtn.setAttribute("aria-label", `${item.pinned ? "Losmaken van bovenaan" : "Vastpinnen bovenaan"} voor ${item.text}`);
      pinBtn.addEventListener("click", () => {
        item.pinned = !item.pinned;
        render();
        scheduleSave();
      });
      row.append(pinBtn);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "✕";
    del.setAttribute("aria-label", `Verwijder ${item.text}`);
    del.addEventListener("click", () => removeItem(item.id));
    row.append(del);

    li.append(row);

    // Wie het item heeft toegevoegd (of, als het klaar is, wie het heeft
    // afgevinkt) — alleen als diegene een naam heeft ingevuld.
    const attributionText = item.done
      ? item.doneBy && `Afgevinkt door ${item.doneBy}`
      : item.createdBy && `Toegevoegd door ${item.createdBy}`;
    if (attributionText) {
      const meta = document.createElement("div");
      meta.className = "item-meta";
      meta.textContent = attributionText;
      li.append(meta);
    }

    // "Ligt hier al lang"-regeltje: alleen voor nog-niet-afgevinkte items
    // die al langer dan de drempel op de lijst staan, en niet gedempt zijn.
    if (!item.done && !item.staleMuted && item.createdAt && Date.now() - item.createdAt > ARCHIVE_MS) {
      const stale = document.createElement("div");
      stale.className = "item-stale";

      const staleText = document.createElement("span");
      const days = Math.floor((Date.now() - item.createdAt) / (24 * 60 * 60 * 1000));
      staleText.textContent = `Staat hier al ${days} dag${days === 1 ? "" : "en"}`;

      const muteBtn = document.createElement("button");
      muteBtn.type = "button";
      muteBtn.className = "stale-mute-btn";
      muteBtn.textContent = "🔕";
      muteBtn.title = "Niet meer laten zien voor dit item";
      muteBtn.setAttribute("aria-label", `Melding 'ligt hier al lang' voor ${item.text} niet meer tonen`);
      muteBtn.addEventListener("click", () => {
        item.staleMuted = true;
        render();
        scheduleSave();
      });

      stale.append(staleText, muteBtn);
      li.append(stale);
    }

    return li;
  }

  function render() {
    el.list.innerHTML = "";
    el.emptyHint.hidden = items.length > 0;

    const active = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);
    const pinnedActive = active.filter((i) => i.pinned);
    const normalActive = active.filter((i) => !i.pinned);

    if (pinnedActive.length > 0) {
      const pinHeader = document.createElement("li");
      pinHeader.className = "list-divider";
      pinHeader.textContent = `📌 Vastgepind (${pinnedActive.length})`;
      el.list.appendChild(pinHeader);
    }

    pinnedActive.forEach((item, i) => {
      el.list.appendChild(
        buildItemRow(item, {
          isFirstActive: i === 0,
          isLastActive: i === pinnedActive.length - 1,
          showMoveButtons: true,
        })
      );
    });

    normalActive.forEach((item, i) => {
      el.list.appendChild(
        buildItemRow(item, {
          isFirstActive: i === 0,
          isLastActive: i === normalActive.length - 1,
          showMoveButtons: true,
        })
      );
    });

    if (active.length > 0 && done.length > 0) {
      const divider = document.createElement("li");
      divider.className = "list-divider";
      divider.textContent = `Afgerond (${done.length})`;
      el.list.appendChild(divider);
    }

    done.forEach((item) => {
      el.list.appendChild(buildItemRow(item, { showMoveButtons: false }));
    });

    knownIds = new Set(items.map((i) => i.id));
  }

  el.addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.newItem.value.trim();
    if (!text) return;
    const item = { id: crypto.randomUUID(), text, done: false, createdAt: Date.now() };
    if (myName) item.createdBy = myName;
    items.push(item);
    el.newItem.value = "";
    render();
    scheduleSave();
  });

  el.shareBtn.addEventListener("click", async () => {
    const url = location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: listName, url });
        return;
      } catch (e) {
        /* geannuleerd door gebruiker, val terug op kopiëren */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      const original = el.shareBtn.textContent;
      el.shareBtn.textContent = "Link gekopieerd!";
      setTimeout(() => (el.shareBtn.textContent = original), 1500);
    } catch (e) {
      prompt("Deel deze link met je gezin:", url);
    }
  });
}

// --- Service worker (PWA) ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.error("SW-registratie mislukt:", e));
  });
}
