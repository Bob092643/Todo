// Boodschappenlijst — gedeeld gezinnetje via Firestore, geen login nodig.
// Eén code (?lijst=code) is voortaan een heel "gezinnetje": daaronder
// kunnen meerdere losse lijstjes hangen, gedeeld (voor iedereen met de
// code) of privé (alleen op dit ene toestel).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction,
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
  lockIcon: document.getElementById("list-lock-icon"),
  colorBtn: document.getElementById("color-btn"),
  colorPicker: document.getElementById("color-picker"),
  colorResetBtn: document.getElementById("color-reset-btn"),
  nameBtn: document.getElementById("name-btn"),
  listTabs: document.getElementById("list-tabs"),
  listsPanel: document.getElementById("lists-panel"),
  listsCloseBtn: document.getElementById("lists-close-btn"),
  listsPanelList: document.getElementById("lists-panel-list"),
  listsPanelArchivedSection: document.getElementById("lists-panel-archived-section"),
  listsPanelArchived: document.getElementById("lists-panel-archived"),
  listsAddBtn: document.getElementById("lists-add-btn"),
  archiveBtn: document.getElementById("archive-btn"),
  archivePanel: document.getElementById("archive-panel"),
  archiveCloseBtn: document.getElementById("archive-close-btn"),
  archiveList: document.getElementById("archive-list"),
  archiveEmptyHint: document.getElementById("archive-empty-hint"),
  deleteListBtn: document.getElementById("delete-list-btn"),
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
let toastTimer = null;
let undoStack = []; // { text, undo } — meest recente actie achteraan

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
  if (undoStack.length > 5) undoStack.shift();
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

  // ============================================================
  // Lokale (per-toestel) opslag: privé lijstjes, tabblad-voorkeuren
  // (vastgepind/volgorde), laatst-gezien-tijdstippen, en de "oude"
  // sleutels die gebruikt worden om bestaande gebruikers naadloos over
  // te zetten naar dit nieuwe systeem.
  // ============================================================
  const PRIVE_KEY = "boodschappenlijst:prive-lijsten";
  const PRIVE_ARCHIEF_KEY = "boodschappenlijst:prive-archief";
  const VOLGORDE_KEY = "boodschappenlijst:lijst-volgorde";
  const GEZIEN_KEY = "boodschappenlijst:laatst-gezien";
  const ACTIVE_KEY = "boodschappenlijst:actieve-lijst";
  const TABS_GEMIGREERD_KEY = "boodschappenlijst:tabs-gemigreerd";
  // Uit de allereerste versie (nog maar 1 lijstje per toestel, geen
  // tabbladen).
  const OLD_STORAGE_KEY = "boodschappenlijst:laatste-lijst-id";
  // Uit de vorige versie (wél tabbladen, maar elk tabblad een eigen, apart
  // gedeelde code i.p.v. samen onder 1 gezinscode).
  const OLD_LISTS_KEY = "boodschappenlijst:lijsten";

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed === null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* werkt nog wel voor deze sessie, wordt alleen niet onthouden */
    }
  }

  let priveLijsten = loadJSON(PRIVE_KEY, []);
  let priveArchief = loadJSON(PRIVE_ARCHIEF_KEY, []);
  // volgorde: array van lijst-id's, in jouw eigen volgorde voor dit
  // toestel. De eerste TABS_COUNT staan als tabblad bovenin; de rest vind
  // je terug in het ☰-paneel. Geen apart "vastpinnen" meer — de volgorde
  // zelf bepaalt alles (zie renderTabs/renderListsPanel verderop).
  let volgorde = loadJSON(VOLGORDE_KEY, []).map((v) => (typeof v === "string" ? v : v.id));
  const TABS_COUNT = 3;
  let laatstGezien = loadJSON(GEZIEN_KEY, {});

  function savePrive() { saveJSON(PRIVE_KEY, priveLijsten); }
  function savePriveArchief() { saveJSON(PRIVE_ARCHIEF_KEY, priveArchief); }
  function saveVolgorde() { saveJSON(VOLGORDE_KEY, volgorde); }
  function saveGezien() { saveJSON(GEZIEN_KEY, laatstGezien); }

  function saveActive(id) {
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch (e) {
      /* niet erg */
    }
  }

  // Zorgt dat een lijst-id in de lokale volgorde-lijst staat. Komt
  // standaard achteraan (dus pas een tabblad zodra 'ie, door zelf te
  // verschuiven of doordat er lijstjes vóór 'm wegvallen, in de eerste
  // TABS_COUNT terechtkomt) — behalve het eerste lijstje ooit, dat komt
  // vanzelf op plek 1 terecht.
  function ensureInVolgorde(id) {
    if (volgorde.includes(id)) return;
    volgorde.push(id);
    saveVolgorde();
  }

  function removeFromVolgorde(id) {
    volgorde = volgorde.filter((v) => v !== id);
    saveVolgorde();
  }

  // ============================================================
  // Welk gezinnetje (code) en welk lijstje daarbinnen staat er nu open.
  // ============================================================
  const HOUSEHOLD_KEY = "boodschappenlijst:gezins-code";
  const params = new URLSearchParams(location.search);
  let householdCode = params.get("lijst");

  // Onthouden welke gezinscode dit toestel voor het laatst gebruikte — zo
  // blijft, net als voorheen, de bewaarde code gebruikt als de app zonder
  // "?lijst=" wordt geopend (bijv. vanaf een geïnstalleerd app-icoontje).
  let bewaardeCode = null;
  try {
    bewaardeCode = localStorage.getItem(HOUSEHOLD_KEY);
  } catch (e) {
    /* geen probleem */
  }

  // Migratie vanaf de zeer oude, tabblad-loze versie.
  let oudeMigratieId = null;
  try {
    oudeMigratieId = localStorage.getItem(OLD_STORAGE_KEY);
  } catch (e) {
    /* geen probleem */
  }

  // Migratie vanaf de vorige tabbladen-versie (losse codes per tabblad).
  const oudeTabs = loadJSON(OLD_LISTS_KEY, null); // array van {id, naam} of null

  if (!householdCode) {
    householdCode = bewaardeCode || oudeMigratieId || (oudeTabs && oudeTabs[0] && oudeTabs[0].id) || crypto.randomUUID();
  }

  try {
    localStorage.setItem(HOUSEHOLD_KEY, householdCode);
  } catch (e) {
    /* niet erg, werkt nog wel voor deze sessie */
  }

  params.set("lijst", householdCode);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);

  const householdRef = doc(db, "lists", householdCode);

  // Live-gehouden kopie van wat er in het gezinnetje-document staat —
  // nodig om bij het opslaan van 1 lijstje de andere (mogelijk ondertussen
  // door iemand anders gewijzigde) lijstjes niet per ongeluk te
  // overschrijven.
  let householdLijsten = [];
  let householdArchivedLijsten = [];
  // "Grafstenen": id's van lijstjes die definitief (voorbij het archief)
  // verwijderd zijn, met het tijdstip waarop dat gebeurde. Zonder dit zou
  // mergeHouseholdState() een definitief verwijderd lijstje weer tevoorschijn
  // toveren zodra de server nog de oude (nog niet definitief-verwijderde)
  // versie ervan bevat — precies zoals een gewone "iets is gewijzigd"-merge
  // een echte, bewuste verwijdering niet van "ik weet dit lijstje nog niet"
  // kan onderscheiden. Wordt net als lijsten/archivedLijsten meegestuurd en
  // -ontvangen, en na 30 dagen automatisch opgeruimd (net als het archief
  // zelf, zie purgeExpiredLists).
  let householdTombstones = [];
  // Zorgt dat opeenvolgende saveHousehold()-aanroepen netjes op hun beurt
  // wachten in plaats van elkaar in de weg te zitten (zie saveHousehold
  // verderop). Moet hier al bestaan, vóór de live-koppeling (onSnapshot)
  // hieronder wordt gestart — die kan namelijk METEEN, nog synchroon
  // tijdens het opstarten, een eerste saveHousehold() aanroepen.
  let householdSaveChain = Promise.resolve();

  let items = [];
  let archivedItems = [];
  let listName = DEFAULT_LIST_NAME;
  let activeId = null;
  let activePrive = false;
  let knownIds = new Set();
  let saveTimer = null;
  let archiveOpen = false;
  let settingsOpen = false;
  let listsOpen = false;

  function setListName(name) {
    listName = name && name.trim() ? name.trim() : DEFAULT_LIST_NAME;
    el.listNameEl.textContent = listName;
    document.title = listName;
  }
  setListName(DEFAULT_LIST_NAME);

  function updateLockIcon() {
    if (el.lockIcon) el.lockIcon.hidden = !activePrive;
  }

  // --- Alle bekende lijstjes bij elkaar (gedeeld + privé), voor tabbladen
  //     en het "Lijstjes"-paneel. ---
  function getAllLists() {
    return [
      ...householdLijsten.map((l) => ({ ...l, prive: false })),
      ...priveLijsten.map((l) => ({ ...l, prive: true })),
    ];
  }

  function findList(id) {
    return getAllLists().find((l) => l.id === id) || null;
  }

  function heeftIetsNieuws(l) {
    if (l.prive || l.id === activeId) return false;
    const gezien = laatstGezien[l.id] || 0;
    return (l.updatedAt || 0) > gezien;
  }

  // Een lijstje één plekje omhoog/omlaag in de volgorde — die volgorde
  // bepaalt rechtstreeks welke lijstjes als tabblad bovenin staan (de
  // eerste TABS_COUNT) en welke alleen in het ☰-paneel te vinden zijn.
  function moveList(id, direction) {
    const myIndex = volgorde.indexOf(id);
    if (myIndex === -1) return;
    const otherIndex = myIndex + direction;
    if (otherIndex < 0 || otherIndex >= volgorde.length) return;
    [volgorde[myIndex], volgorde[otherIndex]] = [volgorde[otherIndex], volgorde[myIndex]];
    saveVolgorde();
    renderTabsAndPanel();
  }

  async function switchToList(id) {
    await flushPendingSave();
    const target = findList(id);
    if (!target) return;

    // Rechtstreeks de gegevens verversen in plaats van de hele pagina
    // opnieuw te laden — dat gaf voorheen heel eventjes een verkeerde
    // (oude, of de standaard-placeholder) titel te zien terwijl de pagina
    // aan het herladen was.
    applyActiveTarget(target);
    // Anders denkt de "net toegevoegd"-animatie dat ALLE boodschappen van
    // dit andere lijstje gloednieuw zijn (ze stonden immers niet in het
    // vorige lijstje), en flitst alles even mee als "binnenkomend".
    knownIds = new Set(items.map((i) => i.id));

    const p = new URLSearchParams(location.search);
    p.set("lijst", householdCode);
    p.set("actief", id);
    params.set("actief", id);
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);

    archiveOpen = false;
    settingsOpen = false;
    listsOpen = false;
    updateDeletedView();
    render();
    renderArchive();
    renderTabsAndPanel();
  }

  // "Verberg dit lijstje voor mij" — alleen voor gedeelde lijstjes (privé
  // lijstjes hebben geen link om ooit weer terug te vinden, dus die niet
  // per ongeluk laten verdwijnen).
  function hideList(id) {
    const l = findList(id);
    if (!l || l.prive) return;
    if (
      !confirm(
        `"${l.naam || "Lijst"}" hier niet meer laten zien op dit toestel?\n\nHet lijstje zelf blijft gewoon bestaan — jij (met de code) en anderen kunnen er nog steeds bij.`
      )
    ) {
      return;
    }
    removeFromVolgorde(id);
    delete laatstGezien[id];
    saveGezien();
    if (id === activeId) {
      const rest = getAllLists().filter((x) => x.id !== id);
      if (rest.length > 0) {
        switchToList(rest[0].id);
      } else {
        addList(true);
      }
    } else {
      renderTabsAndPanel();
    }
  }

  function addList(gedwongenNieuw) {
    const nieuw = gedwongenNieuw || confirm(
      "Nieuw leeg lijstje maken?\n\nOK = een gloednieuw lijstje aanmaken\nAnnuleren = een bestaand lijstje toevoegen via een code die je hebt gekregen"
    );

    if (nieuw) {
      const naam = prompt("Naam voor het nieuwe lijstje:", "Nieuw lijstje");
      if (naam === null) return; // geannuleerd
      const gedeeld = confirm(
        "Delen met je gezin (iedereen met de code ziet dit lijstje), of liever privé (alleen op dit toestel)?\n\nOK = delen met je gezin\nAnnuleren = privé houden"
      );
      const id = crypto.randomUUID();
      const nieuwLijstje = {
        id,
        naam: naam.trim() || "Nieuw lijstje",
        items: [],
        archivedItems: [],
        updatedAt: Date.now(),
      };
      if (gedeeld) {
        householdLijsten.push(nieuwLijstje);
        ensureInVolgorde(id);
        saveHousehold();
      } else {
        priveLijsten.push(nieuwLijstje);
        savePrive();
        ensureInVolgorde(id);
        renderTabsAndPanel();
      }
      switchToList(id);
      return;
    }

    const code = prompt("Plak hier de code (of de hele link) van het gezinnetje dat je erbij wilt:");
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
      alert('Deze code mag geen "/" bevatten. Controleer of je de juiste code hebt geplakt.');
      return;
    }
    // Overstappen naar een heel ander gezinnetje: dit toestel kan er maar
    // 1 tegelijk actief volgen (net als eerst 1 code per toestel).
    const p = new URLSearchParams();
    p.set("lijst", trimmed);
    location.href = `${location.pathname}?${p.toString()}`;
  }

  el.listCodeValue.textContent = householdCode.slice(0, 8);
  el.listCodeBtn.addEventListener("click", () => {
    const next = prompt("Gezins-code (controleer of dit klopt, of plak hier een andere):", householdCode);
    if (next === null) return;
    let trimmed = next.trim();
    try {
      const maybeUrl = new URL(trimmed);
      const fromUrl = maybeUrl.searchParams.get("lijst");
      if (fromUrl) trimmed = fromUrl.trim();
    } catch (e) {
      /* was geen volledige link */
    }
    if (!trimmed || trimmed === householdCode) return;
    if (trimmed.includes("/")) {
      alert('Deze code mag geen "/" bevatten. Controleer of je de juiste code hebt geplakt.');
      return;
    }
    const p = new URLSearchParams();
    p.set("lijst", trimmed);
    location.href = `${location.pathname}?${p.toString()}`;
  });

  el.renameBtn.addEventListener("click", () => {
    const next = prompt("Nieuwe naam voor dit lijstje:", listName);
    if (next === null) return;
    setListName(next);
    const entry = activePrive
      ? priveLijsten.find((l) => l.id === activeId)
      : householdLijsten.find((l) => l.id === activeId);
    if (entry) entry.naam = listName;
    renderTabsAndPanel();
    scheduleSave();
  });

  el.app.hidden = false;
  setSyncStatus("Verbinden...");
  setTimeout(askNameIfNeeded, 300);

  // ============================================================
  // Eenmalige migratie van losse, eerder-bekende tabbladen (uit de vorige
  // versie: elk tabblad een eigen, apart gedeelde code) naar dit
  // gezinnetje. Draait maar 1 keer per toestel.
  // ============================================================
  async function migreerOudeTabs() {
    let gedaan = false;
    try {
      gedaan = localStorage.getItem(TABS_GEMIGREERD_KEY) === "1";
    } catch (e) {
      /* dan proberen we het gewoon */
    }
    if (gedaan || !oudeTabs || oudeTabs.length <= 1) {
      try { localStorage.setItem(TABS_GEMIGREERD_KEY, "1"); } catch (e) { /* niet erg */ }
      return;
    }
    for (const tab of oudeTabs) {
      if (tab.id === householdCode) continue; // dit ís het gezinnetje al
      try {
        const snap = await getDoc(doc(db, "lists", tab.id));
        if (!snap.exists()) continue;
        const data = snap.data();
        const isOudPlatteLijst = data && !data.lijsten;
        if (!isOudPlatteLijst) continue;
        const naam = tab.naam || data.listName || "Lijst";
        const gedeeld = confirm(
          `Dit losse lijstje "${naam}" stond nog apart op dit toestel. Samenvoegen bij je gezinscode?\n\nOK = delen met je gezin\nAnnuleren = privé houden (alleen op dit toestel)`
        );
        const nieuwId = crypto.randomUUID();
        const overgezet = {
          id: nieuwId,
          naam,
          items: data.items || [],
          archivedItems: data.archivedItems || [],
          updatedAt: Date.now(),
        };
        if (gedeeld) {
          householdLijsten.push(overgezet);
        } else {
          priveLijsten.push(overgezet);
          savePrive();
        }
        ensureInVolgorde(nieuwId);
      } catch (e) {
        console.error("Kon los tabblad niet meenemen:", tab, e);
      }
    }
    try { localStorage.setItem(TABS_GEMIGREERD_KEY, "1"); } catch (e) { /* niet erg */ }
    saveHousehold();
    renderTabsAndPanel();
  }

  onSnapshot(
    householdRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : {};

      if (!data.lijsten) {
        // Oude platte structuur (of nog helemaal leeg): omzetten naar het
        // nieuwe formaat. Idempotent — zodra "lijsten" bestaat, gebeurt dit
        // nooit meer, ook niet als 2 toestellen dit tegelijk tegenkomen.
        if (snap.exists() && (data.items || data.listName)) {
          const gemigreerdeLijst = {
            id: crypto.randomUUID(),
            naam: data.listName || DEFAULT_LIST_NAME,
            items: data.items || [],
            archivedItems: data.archivedItems || [],
            updatedAt: data.updatedAt || Date.now(),
          };
          if (data.deletedAt) {
            gemigreerdeLijst.deletedAt = data.deletedAt;
            householdLijsten = [];
            householdArchivedLijsten = [gemigreerdeLijst];
          } else {
            householdLijsten = [gemigreerdeLijst];
            householdArchivedLijsten = [];
          }
        } else {
          // Gloednieuw gezinnetje: begin met 1 leeg standaard-lijstje.
          householdLijsten = [
            { id: crypto.randomUUID(), naam: DEFAULT_LIST_NAME, items: [], archivedItems: [], updatedAt: Date.now() },
          ];
          householdArchivedLijsten = [];
        }
        // Niet wachten op een nieuwe snapshot-rondgang voor het eerste
        // scherm (dat zou een onnodige vertraging geven) — meteen
        // verderwerken met deze net-omgezette data, en op de achtergrond
        // opslaan.
        saveHousehold();
      } else {
        householdLijsten = data.lijsten;
        householdArchivedLijsten = data.archivedLijsten || [];
        householdTombstones = data.tombstones || [];
      }

      // Opgeruimde (>30 dagen oude) archief-lijstjes definitief weg.
      const purgedLijsten = purgeExpiredLists();

      // Nu we het gezinnetje kennen: eenmalige migratie van losse oude
      // tabbladen (mag pas ná de eerste succesvolle snapshot, anders weten
      // we nog niet zeker of "lijsten" al bestond).
      migreerOudeTabs();

      // Zorg dat ELK gedeeld lijstje (dus ook eentje dat iemand anders op
      // een ander toestel heeft aangemaakt en dat nu voor het eerst hier
      // binnenkomt) in de lokale volgorde-lijst staat — anders bestaat het
      // lijstje wel, maar duikt het nooit op in het ☰-paneel of als
      // tabblad, want dat rendert uitsluitend op basis van `volgorde`.
      // Alleen `resolveActiveList()` aanroepen dekte enkel het op dit
      // toestel actieve lijstje, niet de rest.
      householdLijsten.forEach((l) => ensureInVolgorde(l.id));

      resolveActiveList();

      const purgedItems = purgeExpiredArchive();
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
      renderTabsAndPanel();
      setSyncStatus("Gesynchroniseerd " + new Date().toLocaleTimeString(), "synced");
      if (purgedItems || backfilled || purgedLijsten) scheduleSave();
    },
    (err) => {
      console.error("Synchronisatiefout:", err);
      setSyncStatus("Synchronisatiefout — zie console", "error");
    }
  );

  // Zet een gevonden lijstje als het actieve lijstje in de werkvariabelen
  // (zonder verder iets te tekenen of op te slaan — dat doen de aanroepers
  // hierna zelf, op het moment dat bij hen past).
  function applyActiveTarget(target) {
    activeId = target.id;
    activePrive = !!target.prive;
    items = target.items || [];
    archivedItems = target.archivedItems || [];
    setListName(target.naam);
    updateLockIcon();
    ensureInVolgorde(activeId);
    saveActive(activeId);

    laatstGezien[activeId] = target.updatedAt || Date.now();
    saveGezien();
  }

  // Bepaalt welk lijstje nu actief moet zijn, en laadt de bijbehorende
  // items/naam in de werkvariabelen. Wordt na elke snapshot opnieuw
  // gedraaid (goedkoop, en zo blijven we ook consistent als het huidige
  // lijstje ondertussen ergens anders is verwijderd).
  function resolveActiveList() {
    const gevraagdeId = params.get("actief") || localStorage.getItem(ACTIVE_KEY);
    let target = null;

    if (gevraagdeId) target = findList(gevraagdeId);
    if (!target) target = getAllLists()[0] || null;

    if (!target) {
      // Kan alleen gebeuren als zowel gedeeld als privé helemaal leeg zijn
      // (bijv. na het verwijderen van het allerlaatste lijstje) — dan
      // meteen een nieuw standaard-lijstje aanmaken.
      const fallback = { id: crypto.randomUUID(), naam: DEFAULT_LIST_NAME, items: [], archivedItems: [], updatedAt: Date.now() };
      householdLijsten.push(fallback);
      ensureInVolgorde(fallback.id);
      target = { ...fallback, prive: false };
    }

    applyActiveTarget(target);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    setSyncStatus("Wijzigen...", "saving");
    saveTimer = setTimeout(saveList, 400);
  }

  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await saveList();
    }
  }

  // Een wijziging wordt pas na 400ms opgeslagen (zodat snel achter elkaar
  // typen niet voor elk toetsaanslag een aparte opslag geeft). Als iemand
  // direct daarna de app wegklikt (van app wisselt, telefoon vergrendelt,
  // tabblad sluit) vóórdat die 400ms voorbij zijn, zou die laatste
  // wijziging anders verloren kunnen gaan. Daarom: zodra de app niet meer
  // zichtbaar is, meteen een eventueel wachtende opslag alsnog uitvoeren.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingSave();
  });
  // "visibilitychange" vuurt betrouwbaar bij van-app-wisselen/vergrendelen,
  // maar niet altijd bij het navigeren binnen hetzelfde tabblad (bijv. het
  // wisselen van lijstje) — "pagehide" wél, dus als extra vangnet.
  window.addEventListener("pagehide", () => {
    flushPendingSave();
  });

  // Voegt onze eigen (mogelijk deels verouderde) stand van de lijstjes
  // samen met de nieuwste stand op de server — lijstje voor lijstje, in
  // plaats van in één keer de hele verzameling te overschrijven. Zo kan
  // het opslaan van hier nooit een wijziging aan een ANDER lijstje
  // kwijtraken die intussen door iemand anders is gedaan, ook al hadden
  // wij die wijziging zelf nog niet gezien: we nemen per lijstje gewoon
  // de meest recente van de twee, aan de hand van het eigen tijdstip van
  // dát ene lijstje (`updatedAt`, of `deletedAt` voor een gearchiveerde),
  // niet van het hele document ineens.
  function mergeHouseholdState(serverLijsten, serverArchivedLijsten, serverTombstones) {
    const record = new Map(); // lijst-id -> { lijst, archief, tijd }

    const overweeg = (l, archief) => {
      if (!l || !l.id) return;
      const tijd = (archief ? l.deletedAt : l.updatedAt) || 0;
      const bestaand = record.get(l.id);
      // ">=" (niet enkel ">"): bij een gelijk tijdstip wint de kant die
      // hierna wordt overwogen — dat is bewust altijd onze EIGEN stand
      // (zie hieronder), zodat een lijstje dat wij zojuist zelf hebben
      // aangepast nooit per ongeluk verliest van een toevallig even oude
      // serverkopie.
      if (!bestaand || tijd >= bestaand.tijd) {
        record.set(l.id, { lijst: l, archief, tijd });
      }
    };

    serverLijsten.forEach((l) => overweeg(l, false));
    serverArchivedLijsten.forEach((l) => overweeg(l, true));
    householdLijsten.forEach((l) => overweeg(l, false));
    householdArchivedLijsten.forEach((l) => overweeg(l, true));

    // Grafstenen samenvoegen (per id de nieuwste). Zonder dit zou een
    // definitief-verwijderd lijstje dat lokaal nergens meer instaat, maar
    // waar de server nog een (oudere, nog niet definitief-verwijderde)
    // kopie van heeft, hierboven gewoon weer worden "gevonden" en dus
    // stilletjes terugkomen — precies het verschil tussen "ik weet dit
    // lijstje nog niet" en "dit lijstje is bewust voorgoed weg".
    const tombstones = new Map();
    (serverTombstones || []).forEach((t) => {
      if (!t || !t.id) return;
      const bestaand = tombstones.get(t.id);
      if (!bestaand || t.deletedForeverAt >= bestaand.deletedForeverAt) tombstones.set(t.id, t);
    });
    (householdTombstones || []).forEach((t) => {
      if (!t || !t.id) return;
      const bestaand = tombstones.get(t.id);
      if (!bestaand || t.deletedForeverAt >= bestaand.deletedForeverAt) tombstones.set(t.id, t);
    });

    const lijsten = [];
    const archivedLijsten = [];
    record.forEach(({ lijst, archief, tijd }, id) => {
      const steen = tombstones.get(id);
      if (steen && steen.deletedForeverAt >= tijd) return; // definitief weg, niet laten herleven
      (archief ? archivedLijsten : lijsten).push(lijst);
    });
    return { lijsten, archivedLijsten, tombstones: Array.from(tombstones.values()) };
  }

  // Meerdere plekken in de app kunnen (bijna) tegelijk saveHousehold()
  // aanroepen (bijv. iemand die snel achter elkaar iets doet, of het
  // meenemen van een oud los tabblad terwijl er net ook al een gewone
  // wijziging aan het opslaan was). Laat die niet allemaal hun EIGEN
  // afzonderlijke lees-en-samenvoeg-ronde tegelijk doen — dat kan elkaar
  // onnodig in de weg zitten — maar zet ze gewoon netjes achter elkaar in
  // een rijtje, zodat elke opslag altijd verdergaat op de meest recente,
  // al bijgewerkte stand. ("householdSaveChain" zelf staat hierboven al
  // gedeclareerd, vóór de live-koppeling wordt gestart.)
  function saveHousehold() {
    const beurt = householdSaveChain.then(() => saveHouseholdNu());
    // Een mislukte opslag mag de wachtrij niet blijvend blokkeren voor
    // latere pogingen.
    householdSaveChain = beurt.catch(() => {});
    return beurt;
  }

  async function saveHouseholdNu() {
    setSyncStatus("Opslaan...", "saving");
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(householdRef);
        const server = snap.exists() ? snap.data() : {};
        const merged = mergeHouseholdState(server.lijsten || [], server.archivedLijsten || [], server.tombstones || []);
        transaction.set(householdRef, {
          lijsten: merged.lijsten,
          archivedLijsten: merged.archivedLijsten,
          tombstones: merged.tombstones,
          updatedAt: Date.now(),
        });
      });
      // Bewust NIET hierna nog even snel "householdLijsten" gelijkzetten aan
      // wat we net hebben weggeschreven: terwijl dit opslaan onderweg was
      // (de transactie doet zelf ook weer een aparte lees-actie), kan er
      // intussen alweer iets nieuws lokaal zijn bijgekomen of veranderd
      // (bijv. een tweede snelle wijziging, of het meenemen van een oud
      // los tabblad) — dat zou dan alsnog verloren gaan. Onze eigen
      // live-koppeling (onSnapshot) hoort deze schrijfactie vanzelf terug,
      // en werkt de werkstand dan op de normale, veilige manier bij.
      setSyncStatus("Opgeslagen " + new Date().toLocaleTimeString(), "synced");
    } catch (e) {
      console.error("Fout bij opslaan:", e);
      setSyncStatus("Fout bij opslaan — zie console", "error");
    }
  }

  async function saveList() {
    // "saveTimer" markeert dat er nog een wachtende opslag is (voor
    // flushPendingSave, zie hierboven). Die moet ook leeggemaakt worden
    // wanneer de 400ms-timer gewoon vanzelf afloopt (niet alleen bij een
    // vroegtijdige flush) — anders blijft "er staat nog iets te wachten"
    // voor altijd waar staan, en zou elke latere keer dat het tabblad
    // verdwijnt (schermvergrendeling, van app wisselen) opnieuw een
    // opslag afdwingen, óók als er niets meer te bewaren viel. Dat kan in
    // het ergste geval zelfs verse, ondertussen van elders binnengekomen
    // wijzigingen overschrijven met een oude, in-het-geheugen-verouderde
    // kopie.
    saveTimer = null;
    const now = Date.now();
    if (activePrive) {
      const entry = priveLijsten.find((l) => l.id === activeId);
      if (entry) {
        entry.items = items;
        entry.archivedItems = archivedItems;
        entry.naam = listName;
        entry.updatedAt = now;
      }
      savePrive();
      laatstGezien[activeId] = now;
      saveGezien();
      setSyncStatus("Opgeslagen (alleen op dit toestel) " + new Date().toLocaleTimeString(), "synced");
      renderTabsAndPanel();
      return;
    }

    const entry = householdLijsten.find((l) => l.id === activeId);
    if (entry) {
      entry.items = items;
      entry.archivedItems = archivedItems;
      entry.naam = listName;
      entry.updatedAt = now;
    }
    laatstGezien[activeId] = now;
    saveGezien();
    await saveHousehold();
  }

  // Verwijdert lijstjes-archiefitems ouder dan 30 dagen definitief.
  function purgeExpiredLists() {
    const cutoff = Date.now() - ARCHIVE_MS;
    const before = householdArchivedLijsten.length;
    householdArchivedLijsten = householdArchivedLijsten.filter((l) => l.deletedAt > cutoff);
    const beforePrive = priveArchief.length;
    priveArchief = priveArchief.filter((l) => l.deletedAt > cutoff);
    if (priveArchief.length !== beforePrive) savePriveArchief();
    // Grafstenen ouder dan 30 dagen mogen ook weg: na die tijd is de
    // "gevaarlijke" oude archiefkopie toch al overal vanzelf opgeruimd
    // (zie hierboven), dus is de grafsteen niet meer nodig om herleven te
    // voorkomen — zo blijft die lijst niet eindeloos doorgroeien.
    householdTombstones = (householdTombstones || []).filter((t) => t.deletedForeverAt > cutoff);
    return householdArchivedLijsten.length !== before;
  }

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

  // Definitief weg, meteen — geen extra bevestiging nodig: het item is al
  // 2x bewust verwijderd (eerst uit de lijst, nu ook nog uit het archief).
  function permanentlyDeleteItem(id) {
    const idx = archivedItems.findIndex((i) => i.id === id);
    if (idx === -1) return;
    archivedItems.splice(idx, 1);
    renderArchive();
    scheduleSave();
  }

  function renderArchive() {
    if (!el.archiveList) return;
    el.archiveList.innerHTML = "";
    el.archiveEmptyHint.hidden = archivedItems.length > 0;

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

      const deleteForeverBtn = document.createElement("button");
      deleteForeverBtn.type = "button";
      deleteForeverBtn.className = "btn btn-ghost btn-small btn-delete-forever";
      deleteForeverBtn.textContent = "Verwijder definitief";
      deleteForeverBtn.addEventListener("click", () => permanentlyDeleteItem(item.id));

      li.append(text, meta, restoreBtn, deleteForeverBtn);
      el.archiveList.appendChild(li);
    }
  }

  // --- Dit lijstje verwijderen (met dezelfde 30-dagen-vangnet als items) ---
  function updateDeletedView() {
    if (archiveOpen) {
      el.app.hidden = true;
      el.archivePanel.hidden = false;
      if (el.settingsPanel) el.settingsPanel.hidden = true;
      if (el.listsPanel) el.listsPanel.hidden = true;
    } else if (settingsOpen) {
      el.app.hidden = true;
      el.archivePanel.hidden = true;
      if (el.settingsPanel) el.settingsPanel.hidden = false;
      if (el.listsPanel) el.listsPanel.hidden = true;
    } else if (listsOpen) {
      el.app.hidden = true;
      el.archivePanel.hidden = true;
      if (el.settingsPanel) el.settingsPanel.hidden = true;
      if (el.listsPanel) el.listsPanel.hidden = false;
    } else {
      el.app.hidden = false;
      el.archivePanel.hidden = true;
      if (el.settingsPanel) el.settingsPanel.hidden = true;
      if (el.listsPanel) el.listsPanel.hidden = true;
    }
  }

  if (el.archiveBtn) {
    el.archiveBtn.addEventListener("click", () => {
      archiveOpen = true;
      settingsOpen = false;
      listsOpen = false;
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
      listsOpen = false;
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

  if (el.listsCloseBtn) {
    el.listsCloseBtn.addEventListener("click", () => {
      listsOpen = false;
      updateDeletedView();
    });
  }

  if (el.listsAddBtn) {
    el.listsAddBtn.addEventListener("click", () => addList(false));
  }

  if (el.deleteListBtn) {
    el.deleteListBtn.addEventListener("click", async () => {
      const typed = prompt(
        `Hiermee verwijder je "${listName}" ${activePrive ? "van dit toestel" : "voor iedereen die de code heeft"}. Je hebt daarna nog ${ARCHIVE_DAYS} dagen om 'm terug te zetten — daarna is het lijstje echt weg.\n\nTyp VERWIJDER om te bevestigen:`
      );
      if (typed !== "VERWIJDER") return;

      const deletedEntry = { id: activeId, naam: listName, items, archivedItems, updatedAt: Date.now(), deletedAt: Date.now() };
      removeFromVolgorde(activeId);
      delete laatstGezien[activeId];
      saveGezien();

      if (activePrive) {
        priveLijsten = priveLijsten.filter((l) => l.id !== activeId);
        priveArchief.push(deletedEntry);
        savePrive();
        savePriveArchief();
        renderTabsAndPanel();
      } else {
        householdLijsten = householdLijsten.filter((l) => l.id !== activeId);
        householdArchivedLijsten.push(deletedEntry);
        // Altijd meteen opslaan, óók als we hierna naar een ander lijstje
        // schakelen — anders herlaadt de pagina vóórdat deze verwijdering
        // ooit is opgeslagen, en lijkt het lijstje niet verwijderd.
        await saveHousehold();
      }

      archiveOpen = false;
      const rest = getAllLists().filter((x) => x.id !== activeId);
      if (rest.length > 0) {
        await switchToList(rest[0].id);
      } else {
        // Was dit echt het allerlaatste lijstje (gedeeld of privé) van dit
        // toestel? Dan moet er meteen een nieuwe voor terugkomen — anders
        // blijft het scherm leeg staan (er is dan niets meer om naar toe te
        // schakelen, en updateDeletedView() zou anders nooit meer aangeroepen
        // worden om het hoofdscherm weer te tonen).
        addList(true);
      }
    });
  }

  // Een verwijderd lijstje (nog binnen de 30 dagen) terugzetten — vanuit
  // het ☰-lijstjespaneel, net als "Terugzetten" bij losse items.
  async function restoreList(id, prive) {
    if (prive) {
      const idx = priveArchief.findIndex((l) => l.id === id);
      if (idx === -1) return;
      const [l] = priveArchief.splice(idx, 1);
      delete l.deletedAt;
      priveLijsten.push(l);
      savePrive();
      savePriveArchief();
    } else {
      const idx = householdArchivedLijsten.findIndex((l) => l.id === id);
      if (idx === -1) return;
      const [l] = householdArchivedLijsten.splice(idx, 1);
      delete l.deletedAt;
      // Het tijdstip van terugzetten bijwerken: bij het opslaan bepaalt dít
      // tijdstip (niet het oude, van vóór de verwijdering) dat dit lijstje
      // nu weer actief is — anders zou het opslaan kunnen denken dat de
      // (oudere) verwijdering nog steeds het laatste is wat ermee gebeurd
      // is, en de teruggezette lijst per ongeluk weer laten verdwijnen.
      l.updatedAt = Date.now();
      householdLijsten.push(l);
    }
    ensureInVolgorde(id);
    renderTabsAndPanel();
    if (prive) return;
    await saveHousehold();
  }

  // Een verwijderd lijstje definitief weggooien, meteen — geen extra
  // bevestiging nodig: het lijstje is al 2x bewust verwijderd (eerst uit
  // de lijstjes, nu ook nog uit het archief), net als bij losse items.
  async function permanentlyDeleteList(id, prive) {
    if (prive) {
      const idx = priveArchief.findIndex((l) => l.id === id);
      if (idx === -1) return;
      priveArchief.splice(idx, 1);
      savePriveArchief();
      renderTabsAndPanel();
      return;
    }
    const idx = householdArchivedLijsten.findIndex((l) => l.id === id);
    if (idx === -1) return;
    householdArchivedLijsten.splice(idx, 1);
    // Een grafsteen achterlaten: zonder dit zou het opslaan hierna de
    // server nog even kunnen raadplegen, daar de (nog niet
    // definitief-verwijderde) kopie van dit lijstje aantreffen, en die
    // per ongeluk weer laten herleven (zie mergeHouseholdState hierboven).
    householdTombstones.push({ id, deletedForeverAt: Date.now() });
    renderTabsAndPanel();
    await saveHousehold();
  }

  // Geeft de volgorde-index terug van elk actief (niet-afgevinkt) item
  // binnen de onderliggende `items`-array, gescheiden per groep (vastgepind
  // of niet).
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
    if (swapWithPos < 0 || swapWithPos >= order.length) return;
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

    const attributionText = item.done
      ? item.doneBy && `Afgevinkt door ${item.doneBy}`
      : item.createdBy && `Toegevoegd door ${item.createdBy}`;
    if (attributionText) {
      const meta = document.createElement("div");
      meta.className = "item-meta";
      meta.textContent = attributionText;
      li.append(meta);
    }

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

  // ============================================================
  // Tabbladen (de eerste TABS_COUNT lijstjes, in jouw eigen volgorde) +
  // het "Lijstjes"-paneel (echt alle lijstjes, met volgorde/schakelen).
  // ============================================================
  function renderTabsAndPanel() {
    renderTabs();
    renderListsPanel();
  }

  function labelFor(l) {
    return (l.prive ? "🔒 " : "") + (l.naam || "Lijst") + (heeftIetsNieuws(l) ? " •" : "");
  }

  // De id's die als tabblad bovenin staan: de eerste TABS_COUNT uit de
  // volgorde die ook echt (nog) bestaan — een verdwenen id telt niet mee,
  // zodat er nooit minder tabbladen staan dan er lijstjes beschikbaar zijn.
  function tabIds() {
    const ids = [];
    for (const id of volgorde) {
      if (ids.length >= TABS_COUNT) break;
      if (findList(id)) ids.push(id);
    }
    return ids;
  }

  function renderTabs() {
    if (!el.listTabs) return;
    el.listTabs.innerHTML = "";
    el.listTabs.hidden = false;

    for (const id of tabIds()) {
      const l = findList(id);
      if (!l) continue;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "list-tab" + (id === activeId ? " active" : "");
      tab.title = l.naam || "Lijst";
      tab.dataset.id = id;

      const label = document.createElement("span");
      label.className = "list-tab-label";
      label.textContent = labelFor(l);
      tab.appendChild(label);

      tab.addEventListener("click", () => {
        if (id !== activeId) switchToList(id);
      });

      el.listTabs.appendChild(tab);
    }

    const listsBtnTab = document.createElement("button");
    listsBtnTab.type = "button";
    listsBtnTab.id = "lists-btn";
    listsBtnTab.className = "list-tab list-tab-add";
    listsBtnTab.textContent = "☰";
    listsBtnTab.title = "Al je lijstjes";
    listsBtnTab.addEventListener("click", () => {
      listsOpen = true;
      archiveOpen = false;
      settingsOpen = false;
      renderTabsAndPanel();
      updateDeletedView();
    });
    el.listTabs.appendChild(listsBtnTab);
  }

  function renderListsPanel() {
    if (!el.listsPanelList) return;
    el.listsPanelList.innerHTML = "";

    // Alleen id's die ook echt (nog) een bestaand lijstje zijn, in de
    // eigen volgorde van dit toestel.
    const orderedIds = volgorde.filter((id) => findList(id));
    const tabs = tabIds();

    orderedIds.forEach((id, posInGroup) => {
      const l = findList(id);
      if (!l) return;
      const isTab = tabs.includes(id);

      const li = document.createElement("li");
      li.className = "lists-panel-row" + (id === activeId ? " active" : "");

      const switchBtn = document.createElement("button");
      switchBtn.type = "button";
      switchBtn.className = "lists-panel-name";
      switchBtn.textContent = labelFor(l);
      switchBtn.addEventListener("click", () => {
        if (id !== activeId) switchToList(id);
      });

      const moveWrap = document.createElement("span");
      moveWrap.className = "move-buttons";
      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "move-btn";
      upBtn.textContent = "↑";
      upBtn.disabled = posInGroup <= 0;
      upBtn.setAttribute("aria-label", `${l.naam} naar boven verplaatsen`);
      upBtn.addEventListener("click", () => moveList(id, -1));
      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "move-btn";
      downBtn.textContent = "↓";
      downBtn.disabled = posInGroup >= orderedIds.length - 1;
      downBtn.setAttribute("aria-label", `${l.naam} naar beneden verplaatsen`);
      downBtn.addEventListener("click", () => moveList(id, 1));
      moveWrap.append(upBtn, downBtn);

      // Geen aparte "vastpinnen"-knop meer — alleen nog een informatief
      // label: de volgorde zelf (via de pijltjes hierboven) bepaalt of
      // een lijstje als tabblad bovenin staat.
      const tabBadge = document.createElement("span");
      tabBadge.className = "lists-panel-tab-badge" + (isTab ? " active" : "");
      tabBadge.textContent = isTab ? "tabblad" : "";
      tabBadge.title = isTab
        ? "Staat als tabblad bovenin"
        : "Staat niet als tabblad bovenin — verschuif naar boven met ↑ om dat te veranderen";

      li.append(switchBtn, moveWrap, tabBadge);

      if (!l.prive) {
        const hideBtn = document.createElement("button");
        hideBtn.type = "button";
        hideBtn.className = "btn-icon lists-panel-hide";
        hideBtn.textContent = "✕";
        hideBtn.title = "Dit lijstje hier niet meer tonen";
        hideBtn.setAttribute("aria-label", `${l.naam} verbergen op dit toestel`);
        hideBtn.addEventListener("click", () => hideList(id));
        li.append(hideBtn);
      }

      el.listsPanelList.appendChild(li);
    });

    if (el.listsPanelArchived) {
      el.listsPanelArchived.innerHTML = "";
      const archived = [
        ...householdArchivedLijsten.map((l) => ({ ...l, prive: false })),
        ...priveArchief.map((l) => ({ ...l, prive: true })),
      ];
      if (el.listsPanelArchivedSection) el.listsPanelArchivedSection.hidden = archived.length === 0;
      archived.forEach((l) => {
        const li = document.createElement("li");
        li.className = "lists-panel-row";

        const name = document.createElement("span");
        name.className = "lists-panel-name";
        name.textContent = (l.prive ? "🔒 " : "") + (l.naam || "Lijst");

        const meta = document.createElement("span");
        meta.className = "archive-meta";
        const d = daysLeft(l.deletedAt);
        meta.textContent = `vervalt over ${d} dag${d === 1 ? "" : "en"}`;

        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.className = "btn btn-ghost btn-small";
        restoreBtn.textContent = "Terugzetten";
        restoreBtn.addEventListener("click", () => restoreList(l.id, l.prive));

        const deleteForeverBtn = document.createElement("button");
        deleteForeverBtn.type = "button";
        deleteForeverBtn.className = "btn btn-ghost btn-small btn-delete-forever";
        deleteForeverBtn.textContent = "Verwijder definitief";
        deleteForeverBtn.addEventListener("click", () => permanentlyDeleteList(l.id, l.prive));

        li.append(name, meta, restoreBtn, deleteForeverBtn);
        el.listsPanelArchived.appendChild(li);
      });
    }
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
    if (activePrive) {
      alert("Dit is een privé lijstje — die kun je niet delen. Maak 'm gedeeld via het ☰-lijstjespaneel als je 'm alsnog wilt delen.");
      return;
    }
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
