// Boodschappenlijst — gedeeld gezinnetje via Firestore, geen login nodig.
// Eén code (?lijst=code) is voortaan een heel "gezinnetje": daaronder
// kunnen meerdere losse lijstjes hangen, gedeeld (voor iedereen met de
// code) of privé (alleen op dit ene toestel).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  deleteToken,
  onMessage,
  isSupported as pushWordtOndersteund,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js";

import { el } from "./dom.js";
import "./kleur.js";
import "./compact.js";
import { getMyName, askNameIfNeeded, updateNameBtn } from "./naam.js";
import { showToast } from "./toast.js";
import { normaliseerTekst } from "./tekst.js";

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// Klokje voor de "bezig"-knop bij een item — los van het gewone vinkje
// (open/afgevinkt): een extra, apart te zetten seintje dat iemand hiermee
// bezig is, zonder dat het item daarmee al klaar is.
const CLOCK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></svg>';

// Hoe lang een verwijderd item (of een verwijderd lijstje) bewaard blijft
// voor het definitief weg is.
const ARCHIVE_DAYS = 30;
const ARCHIVE_MS = ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

// state: "neutral" | "saving" | "synced" | "error"
function setSyncStatus(text, state = "neutral") {
  el.syncStatus.textContent = text;
  el.statusDot.className = "status-dot" + (state !== "neutral" ? ` ${state}` : "");
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
  // Bewaart de laatst-gesynchroniseerde stand ook lokaal (IndexedDB), niet
  // alleen in het geheugen van de pagina. Zonder dit zou een herlaad-beurt
  // zonder internet (bijv. in de winkel, weinig bereik) een helemaal lege
  // lijst laten zien tot de verbinding terug is — mét deze instelling
  // verschijnt gewoon de laatst bekende lijst meteen, en werkt afvinken /
  // toevoegen ook zonder verbinding gewoon door (de wijzigingen wachten
  // dan lokaal totdat er weer bereik is, en gaan er dan vanzelf uit).
  // "MultipleTabManager" is nodig omdat iemand dit lijstje soms in meer
  // dan één tabblad tegelijk open heeft staan — zonder die instelling zou
  // alleen het eerst-geopende tabblad deze lokale opslag mogen gebruiken.
  let db;
  try {
    db = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    // Kan in zeldzame gevallen mislukken (bijv. privénavigatie op sommige
    // toestellen, waar IndexedDB niet of nauwelijks beschikbaar is) — dan
    // gewoon terugvallen op de gewone werking van hiervoor (alles alleen
    // in het geheugen van de pagina, geen lokale opslag na herladen).
    console.warn("Kon geen lokale (offline) opslag instellen, val terug op alleen-geheugen:", e);
    db = initializeFirestore(firebaseApp, {});
  }

  const DEFAULT_LIST_NAME = "Onze lijst";

  // Welk item-actiemenu ("⋯") nu openstaat (of null). Bewaard op module-
  // niveau (niet als lokale DOM-state) zodat het openblijft over een
  // render() heen (bijv. na een klik op een van de acties erin), en met
  // een document-brede klik dichtgaat zodra je ergens anders klikt. Moet
  // hier, vóór de sync-opzet verderop, gedeclareerd worden: die kan (via
  // de eerste snapshot) meteen synchroon een render() aanroepen, die op
  // zijn beurt deze variabele al leest.
  let openItemMenuId = null;

  // Kleurenpalet voor de "wie"-badges (zie kleurVoor()/maakAttributieBadge()
  // verderop) — moet net als openItemMenuId hierboven al vroeg bestaan,
  // want diezelfde meteen-synchrone eerste render() kan al een badge willen
  // tekenen.
  const BADGE_KLEUREN = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
    "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b",
  ];

  // Door mensen zelf gekozen badge-kleur, per naam ({ naam: "#hex" }) —
  // gedeeld binnen het hele gezinnetje (zie badgeKleurenOpslaan()) en
  // gelezen door kleurVoor() als voorkeur boven de automatische kleur
  // hierboven. Moet, om dezelfde reden als openItemMenuId/BADGE_KLEUREN,
  // hier al vroeg bestaan.
  let badgeKleuren = {};

  // Welke lijst-id's er NU daadwerkelijk als tabblad bovenin staan (zie
  // renderTabs() verderop, die dit na elke render opnieuw uitrekent aan de
  // hand van de beschikbare breedte — geen vast aantal meer). Wordt ook
  // gelezen door renderListsPanel() (voor het "tabblad"-label per rij), en
  // moet daarom, om dezelfde reden als hierboven, al vroeg bestaan.
  let huidigeTabIds = [];

  // ============================================================
  // Lokale (per-toestel) opslag: privé lijstjes, tabblad-voorkeuren
  // (vastgepind/volgorde), laatst-gezien-tijdstippen, en de "oude"
  // sleutels die gebruikt worden om bestaande gebruikers naadloos over
  // te zetten naar dit nieuwe systeem.
  // ============================================================
  const PRIVE_KEY = "boodschappenlijst:prive-lijsten";
  const PRIVE_ARCHIEF_KEY = "boodschappenlijst:prive-archief";
  const VOLGORDE_KEY = "boodschappenlijst:lijst-volgorde";
  const VERBORGEN_KEY = "boodschappenlijst:lijst-verborgen";
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
  // toestel. Zoveel mogelijk hiervan (van voren af aan) staan als tabblad
  // bovenin — hoeveel dat er zijn hangt af van de beschikbare breedte en
  // hoe lang de naampjes zijn (zie renderTabs() verderop), geen vast
  // aantal meer. De rest vind je terug in het ☰-paneel. Geen apart
  // "vastpinnen" meer — de volgorde zelf bepaalt alles (zie
  // renderTabs/renderListsPanel verderop).
  let volgorde = loadJSON(VOLGORDE_KEY, []).map((v) => (typeof v === "string" ? v : v.id));
  let laatstGezien = loadJSON(GEZIEN_KEY, {});
  // Gedeelde lijstjes die je op dit toestel bewust "verborgen" hebt (via het
  // ✕-knopje in het ☰-paneel) — ze bestaan nog gewoon (voor iedereen met de
  // code), maar mogen niet automatisch weer in `volgorde` terugkomen zolang
  // ze hier staan. Zie ook de "Verborgen op dit toestel"-lijst in het
  // ☰-paneel, waar je zo'n lijstje weer kunt terugzetten.
  let verborgenLijsten = loadJSON(VERBORGEN_KEY, []);

  function savePrive() { saveJSON(PRIVE_KEY, priveLijsten); }
  function savePriveArchief() { saveJSON(PRIVE_ARCHIEF_KEY, priveArchief); }
  function saveVolgorde() { saveJSON(VOLGORDE_KEY, volgorde); }
  function saveGezien() { saveJSON(GEZIEN_KEY, laatstGezien); }
  function saveVerborgen() { saveJSON(VERBORGEN_KEY, verborgenLijsten); }

  function saveActive(id) {
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch (e) {
      /* niet erg */
    }
  }

  // Zorgt dat een lijst-id in de lokale volgorde-lijst staat. Komt
  // standaard achteraan (dus pas een tabblad zodra 'ie, door zelf te
  // verschuiven of doordat er lijstjes vóór 'm wegvallen, alsnog binnen de
  // beschikbare breedte past) — behalve het eerste lijstje ooit, dat komt
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
  // Wat er nu in het zoekveldje staat (leeg = geen filter actief). Puur
  // schermweergave, hoeft niet bewaard te worden.
  let zoekTerm = "";
  // Snel toevoegen: favorieten zijn zelf gekozen ({id, tekst}, blijft staan
  // tot iemand 'm weer verwijdert) en itemFrequentie telt gewoon hoe vaak
  // een itemnaam (genormaliseerd -> {aantal, tekst}) is toegevoegd, zodat
  // vaak-toegevoegde dingen vanzelf als suggestie verschijnen zonder dat
  // iemand ze apart hoeft aan te vinken. "tekst" bewaart daarbij steeds de
  // laatst getypte schrijfwijze (hoofdletters etc.), zodat de suggestie er
  // ook nog netjes uitziet nadat alle exemplaren allang zijn afgevinkt en
  // verwijderd. Beide reizen mee met het lijstje.
  let favorieten = [];
  let itemFrequentie = {};
  const SNEL_TOEVOEGEN_MAX = 10;
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
    // Het archief is centraal (alle lijstjes tegelijk, zie renderArchive()),
    // maar "dit lijstje verwijderen" in de gevarenzone daaronder werkt nog
    // steeds alleen op de actieve lijst — daarom hier expliciet noemen om
    // welk lijstje het gaat, anders is dat in die centrale weergave niet
    // meer vanzelfsprekend.
    if (el.dangerZoneLijstNaam) el.dangerZoneLijstNaam.textContent = `"${listName}"`;
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
  // bepaalt rechtstreeks welke lijstjes als tabblad bovenin staan (zoveel
  // als er van voren af aan op één regel passen, zie renderTabs()) en
  // welke alleen in het ☰-paneel te vinden zijn.
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

    // "archiveOpen" bewust NIET meer resetten: het archief is sinds kort
    // een centrale weergave over AL je lijstjes heen (zie renderArchive()),
    // dus wisselen van "actief" lijstje op de achtergrond hoort je daar
    // niet meer zomaar uit te knallen — dat viel eerder juist vervelend op.
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
        `"${l.naam || "Lijst"}" hier niet meer laten zien op dit toestel?\n\nHet lijstje zelf blijft gewoon bestaan — jij (met de code) en anderen kunnen er nog steeds bij. Terugzetten kan later via ☰ Lijstjes, onderaan bij "Verborgen op dit toestel".`
      )
    ) {
      return;
    }
    removeFromVolgorde(id);
    if (!verborgenLijsten.includes(id)) {
      verborgenLijsten.push(id);
      saveVerborgen();
    }
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

  // Een eerder verborgen lijstje weer laten zien op dit toestel.
  function unhideList(id) {
    verborgenLijsten = verborgenLijsten.filter((v) => v !== id);
    saveVerborgen();
    ensureInVolgorde(id);
    renderTabsAndPanel();
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

  // Duidelijk (en geruststellend, niet als een storing) laten zien
  // wanneer dit toestel geen internet heeft: afvinken/toevoegen/etc.
  // blijft gewoon werken (dankzij de lokale opslag hierboven), maar wordt
  // dan pas echt met anderen gedeeld zodra er weer bereik is. Overschrijft
  // bewust de normale status-tekst zolang je offline bent; zodra je weer
  // online bent nemen de gewone save/sync-meldingen het vanzelf weer over.
  function updateOnlineStatus() {
    if (!navigator.onLine) {
      setSyncStatus("Offline — wijzigingen worden bewaard", "offline");
    }
  }
  updateOnlineStatus();
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

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
      badgeKleuren = data.badgeKleuren || {};

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
      // Behalve: een lijstje dat je hier bewust verborgen hebt mag NIET
      // door deze automatische aanvulling meteen weer terugkomen — anders
      // zou "verbergen" bij elke volgende sync (dus ook gewoon bij een
      // herlaad van de pagina) vanzelf ongedaan gemaakt worden.
      householdLijsten.forEach((l) => {
        if (!verborgenLijsten.includes(l.id)) ensureInVolgorde(l.id);
      });

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
      renderBadgeKleurPicker();
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
    favorieten = target.favorieten || [];
    itemFrequentie = target.itemFrequentie || {};
    archivedItems = target.archivedItems || [];
    setListName(target.naam);
    updateLockIcon();
    // Actief geworden (bijv. omdat het de enige overgebleven lijst is, of
    // via een link met "actief=" erin) betekent: niet meer "verborgen" —
    // anders zou 'm nu wél zien als actieve lijst, maar 'm tegelijk ook nog
    // in "Verborgen op dit toestel" tegenkomen.
    if (verborgenLijsten.includes(activeId)) {
      verborgenLijsten = verborgenLijsten.filter((v) => v !== activeId);
      saveVerborgen();
    }
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

    // Grafstenen ouder dan 30 dagen hier ook echt uit de UITKOMST filteren
    // (niet alleen uit de lokale kopie, zie purgeExpiredLists) — anders
    // levert het samenvoegen van server+lokaal een oude, server-kant
    // grafsteen steeds weer opnieuw op, ook nadat purgeExpiredLists 'm
    // lokaal al had opgeruimd: bij elke save zou die dan gewoon weer
    // worden teruggeschreven, en groeit de lijst nooit echt in.
    const tombstoneCutoff = Date.now() - ARCHIVE_MS;
    const geldigeTombstones = Array.from(tombstones.values()).filter((t) => t.deletedForeverAt > tombstoneCutoff);

    return { lijsten, archivedLijsten, tombstones: geldigeTombstones };
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
          // "...server" eerst: dit schrijft de HELE document opnieuw weg
          // (geen { merge: true }), dus alles wat hier niet expliciet
          // wordt overgenomen zou anders stilletjes verdwijnen — zoals
          // eerder de pushTokens hieronder deed, tot iemand pushmeldingen
          // aanzette en de eerstvolgende gewone lijst-opslag het token
          // alweer wegveegde.
          ...server,
          lijsten: merged.lijsten,
          archivedLijsten: merged.archivedLijsten,
          tombstones: merged.tombstones,
          updatedAt: Date.now(),
          // Welk toestel (via zijn eigen pushtoken, of null als dit toestel
          // geen pushmeldingen aan heeft staan) deze opslag deed. De Cloud
          // Function (functions/index.js) gebruikt dit om precies dát ene
          // toestel over te slaan bij het versturen van de melding — anders
          // zou je ook een melding krijgen over je eigen toevoeging.
          laatsteSchrijver: huidigPushToken() || null,
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
        entry.favorieten = favorieten;
        entry.itemFrequentie = itemFrequentie;
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
      entry.favorieten = favorieten;
      entry.itemFrequentie = itemFrequentie;
      entry.archivedItems = archivedItems;
      entry.naam = listName;
      entry.updatedAt = now;
    }
    laatstGezien[activeId] = now;
    saveGezien();
    await saveHousehold();
  }

  // Verwijdert lijstjes-archiefitems ouder dan 30 dagen definitief.
  // Geeft true terug als er in het GEDEELDE gezinnetje iets veranderde
  // (archief-lijst of grafstenen) — dat moet dan ook echt opgeslagen
  // worden, anders staat het bij de volgende snapshot van de server weer
  // gewoon terug.
  function purgeExpiredLists() {
    const cutoff = Date.now() - ARCHIVE_MS;
    const beforeLijsten = householdArchivedLijsten.length;
    householdArchivedLijsten = householdArchivedLijsten.filter((l) => l.deletedAt > cutoff);
    const beforePrive = priveArchief.length;
    priveArchief = priveArchief.filter((l) => l.deletedAt > cutoff);
    if (priveArchief.length !== beforePrive) savePriveArchief();
    // Grafstenen ouder dan 30 dagen mogen ook weg: na die tijd is de
    // "gevaarlijke" oude archiefkopie toch al overal vanzelf opgeruimd
    // (zie hierboven), dus is de grafsteen niet meer nodig om herleven te
    // voorkomen — zo blijft die lijst niet eindeloos doorgroeien.
    const beforeTombstones = (householdTombstones || []).length;
    householdTombstones = (householdTombstones || []).filter((t) => t.deletedForeverAt > cutoff);
    return householdArchivedLijsten.length !== beforeLijsten || householdTombstones.length !== beforeTombstones;
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

  // Alle afgevinkte items in één keer opruimen (i.p.v. steeds los eentje
  // per eentje) — belanden net als bij een los item gewoon in het archief
  // (zelfde 30-dagen-vangnet), met één gezamenlijke "Ongedaan maken".
  function wisAfgevinkte() {
    const klaar = items.filter((i) => i.done);
    if (klaar.length === 0) return;
    const ids = klaar.map((i) => i.id);
    for (const id of ids) {
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) continue;
      const [item] = items.splice(idx, 1);
      item.deletedAt = Date.now();
      archivedItems.push(item);
      knownIds.delete(id);
    }
    render();
    renderArchive();
    scheduleSave();
    showToast(
      ids.length === 1 ? `"${klaar[0].text}" is verwijderd` : `${ids.length} afgeronde items zijn verwijderd`,
      () => ids.forEach((id) => restoreItem(id))
    );
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

  // Centraal archief: toont verwijderde items van AL je lijstjes bij
  // elkaar (i.p.v. steeds per lijstje apart moeten kijken), elk met een
  // tagje erbij welk lijstje het was.
  function renderArchive() {
    if (!el.archiveList) return;
    el.archiveList.innerHTML = "";
    const alles = alleGearchiveerdeItems();
    el.archiveEmptyHint.hidden = alles.length > 0;

    for (const { item, lijstId, lijstNaam, prive } of alles) {
      const li = document.createElement("li");

      const text = document.createElement("span");
      text.className = "item-text";
      text.textContent = item.text;

      const tag = document.createElement("span");
      tag.className = "archive-lijst-tag";
      tag.textContent = (prive ? "🔒 " : "") + lijstNaam;
      tag.title = `Uit lijstje "${lijstNaam}"`;

      const meta = document.createElement("span");
      meta.className = "archive-meta";
      const d = daysLeft(item.deletedAt);
      meta.textContent = `vervalt over ${d} dag${d === 1 ? "" : "en"}`;

      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn btn-ghost btn-small";
      restoreBtn.textContent = "Terugzetten";
      restoreBtn.addEventListener("click", () => restoreArchivedItem(lijstId, prive, item.id));

      const deleteForeverBtn = document.createElement("button");
      deleteForeverBtn.type = "button";
      deleteForeverBtn.className = "btn btn-ghost btn-small btn-delete-forever";
      deleteForeverBtn.textContent = "Verwijder definitief";
      deleteForeverBtn.addEventListener("click", () => permanentlyDeleteArchivedItem(lijstId, prive, item.id));

      li.append(text, tag, meta, restoreBtn, deleteForeverBtn);
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
      renderBadgeKleurPicker();
      updateDeletedView();
    });
  }

  if (el.nameBtn) {
    // naam.js verwerkt de naamwijziging zelf (prompt() is synchroon, dus
    // meteen klaar); hier alleen de badge-kleurkiezer en de lijst zelf
    // opnieuw tekenen, want die tonen ook de naam/kleur.
    el.nameBtn.addEventListener("click", () => {
      renderBadgeKleurPicker();
      render();
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
      const bevestigd = confirm(
        `Hiermee verwijder je "${listName}" ${activePrive ? "van dit toestel" : "voor iedereen die de code heeft"}. Je hebt daarna nog ${ARCHIVE_DAYS} dagen om 'm terug te zetten — daarna is het lijstje echt weg.\n\nWeet je het zeker?`
      );
      if (!bevestigd) return;

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
      } else if (activePrive) {
        // Een privé lijstje verwijderen raakt de server niet (geen
        // saveHousehold-rondje, dus ook geen onSnapshot-echo die straks
        // vanzelf een vervangend lijstje aanmaakt) — dus moet dat hier
        // expliciet, anders blijft het scherm leeg staan.
        addList(true);
      }
      // Was dit echt het allerlaatste GEDEELDE lijstje? Dan hoeft hier
      // niets extra's te gebeuren: saveHousehold() hierboven triggert de
      // eigen onSnapshot-echo, en resolveActiveList() maakt daar (via
      // z'n eigen "geen enkel lijstje meer over"-vangnet) vanzelf een
      // nieuw leeg lijstje van — dat nog een keer hier doen zou een 2e,
      // overbodig lijstje kunnen opleveren als die twee elkaar kruisen.
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
    if (verborgenLijsten.includes(id)) {
      verborgenLijsten = verborgenLijsten.filter((v) => v !== id);
      saveVerborgen();
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

  // Past de volgorde binnen één groep (vastgepind/niet) aan, zonder de
  // plek van de ANDERE groep in het items-array te verstoren: dezelfde
  // posities (activeIndexOrder) blijven bezet, alleen welke items erin
  // staan verandert.
  function herschikGroep(pinned, geordendeIds) {
    const posities = activeIndexOrder(pinned);
    if (posities.length !== geordendeIds.length) return; // zou niet moeten gebeuren; voorzichtigheidshalve niks doen
    const nieuweItems = geordendeIds.map((id) => items.find((i) => i.id === id));
    if (nieuweItems.some((it) => !it)) return;
    posities.forEach((idx, i) => { items[idx] = nieuweItems[i]; });
  }

  // ============================================================
  // Verslepen om te herordenen — vervangt de oude ↑/↓-knoppen. Werkt met
  // zowel muis als vinger via Pointer Events (dezelfde events voor allebei,
  // dus geen aparte touch-behandeling nodig). Alleen binnen dezelfde groep
  // (vastgepind, of niet — net als de oude pijltjes ook al deden).
  //
  // Aanpak: bij het vastpakken leggen we de huidige (verticale) middens
  // van alle sleepbare items in dezelfde groep vast. Tijdens het slepen
  // schuift alleen het vastgepakte item zelf visueel mee (via CSS
  // transform) — de andere items blijven op hun plek, dat houdt het
  // simpel en voorspelbaar. Pas bij loslaten wordt op basis van waar het
  // vastgepakte item dan terecht is gekomen (vergeleken met die vastgelegde
  // middens) de nieuwe volgorde echt toegepast.
  // ============================================================
  let sleepState = null;

  // Welk item-actiemenu ("⋯") nu openstaat (of null, zie ook de declaratie
  // hierboven aan het begin van start() — die moet vóór de eerste
  // (soms synchrone) render() staan, anders kan lezen hier nog in de
  // "temporal dead zone" van deze `let` terechtkomen).
  document.addEventListener("click", () => {
    if (openItemMenuId !== null) {
      openItemMenuId = null;
      render();
    }
  });

  function startSlepen(e, itemId, pinned) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const li = el.list.querySelector(`li[data-id="${CSS.escape(itemId)}"]`);
    if (!li) return;
    e.preventDefault();

    const groepLis = Array.prototype.filter.call(el.list.querySelectorAll("li[data-id]"), (candidate) => {
      const it = items.find((i) => i.id === candidate.dataset.id);
      return it && !it.done && !!it.pinned === !!pinned;
    });
    const middens = groepLis.map((candidate) => {
      const r = candidate.getBoundingClientRect();
      return { id: candidate.dataset.id, midden: r.top + r.height / 2 };
    });

    const rect = li.getBoundingClientRect();
    sleepState = {
      itemId,
      pinned,
      li,
      startY: e.clientY,
      origMidden: rect.top + rect.height / 2,
      middens,
    };
    li.classList.add("slepen");
    document.addEventListener("pointermove", onSlepen);
    document.addEventListener("pointerup", eindigSlepen);
    document.addEventListener("pointercancel", eindigSlepen);
  }

  function onSlepen(e) {
    if (!sleepState) return;
    // Zodra we echt aan het slepen zijn (via het handvatje, dat al vanaf
    // het begin touch-action:none heeft), mag de vinger niet ALSNOG de
    // pagina laten scrollen — dat zou het item en de lijst tegelijk laten
    // bewegen, zodat het versleepte item nauwelijks lijkt te verplaatsen
    // t.o.v. het scherm.
    e.preventDefault();
    const deltaY = e.clientY - sleepState.startY;
    sleepState.li.style.transform = `translateY(${deltaY}px)`;
  }

  function eindigSlepen(e) {
    document.removeEventListener("pointermove", onSlepen);
    document.removeEventListener("pointerup", eindigSlepen);
    document.removeEventListener("pointercancel", eindigSlepen);
    if (!sleepState) return;
    const { itemId, pinned, li, startY, origMidden, middens } = sleepState;
    sleepState = null;
    li.classList.remove("slepen");
    li.style.transform = "";

    const deltaY = e.clientY - startY;
    const eindMidden = origMidden + deltaY;

    const oorspronkelijkeVolgorde = middens.map((m) => m.id);
    const anderen = middens.filter((m) => m.id !== itemId);
    let nieuwePositie = 0;
    anderen.forEach((m) => { if (m.midden < eindMidden) nieuwePositie++; });
    const geordendeIds = anderen.map((m) => m.id);
    geordendeIds.splice(nieuwePositie, 0, itemId);

    // Niks veranderd (bijv. gewoon een tikje op het handvat, geen echte
    // sleepbeweging)? Dan ook geen onnodige render/opslag.
    if (geordendeIds.join(",") === oorspronkelijkeVolgorde.join(",")) return;

    herschikGroep(pinned, geordendeIds);
    render();
    scheduleSave();
  }

  // ============================================================
  // Snel toevoegen: favorieten (zelf gekozen, blijven staan) + vaak
  // toegevoegde items (automatisch geteld). Werkt allebei op de
  // genormaliseerde tekst, niet op een los item — een favoriet/telling
  // hoort bij "dit soort item", niet bij dit ene ding dat nu op de lijst
  // staat (en dat morgen weer is afgevinkt en verwijderd).
  // ============================================================

  function isFavoriet(tekst) {
    const genormaliseerd = normaliseerTekst(tekst);
    return favorieten.some((f) => normaliseerTekst(f.tekst) === genormaliseerd);
  }

  function toggleFavoriet(tekst) {
    const genormaliseerd = normaliseerTekst(tekst);
    if (!genormaliseerd) return;
    if (isFavoriet(tekst)) {
      favorieten = favorieten.filter((f) => normaliseerTekst(f.tekst) !== genormaliseerd);
    } else {
      favorieten.push({ id: crypto.randomUUID(), tekst: tekst.trim() });
    }
  }

  // Eén centrale plek om een nieuw item toe te voegen — gebruikt door zowel
  // het invulveld bovenaan als de "Snel toevoegen"-chips hieronder, zodat
  // favorieten en telling er altijd hetzelfde bij horen.
  function voegItemToe(tekst) {
    const schoon = tekst.trim();
    if (!schoon) return;
    const item = { id: crypto.randomUUID(), text: schoon, done: false, createdAt: Date.now() };
    if (getMyName()) item.createdBy = getMyName();
    items.push(item);
    const genormaliseerd = normaliseerTekst(schoon);
    if (genormaliseerd) {
      const bestaand = itemFrequentie[genormaliseerd];
      itemFrequentie[genormaliseerd] = { aantal: (bestaand ? bestaand.aantal : 0) + 1, tekst: schoon };
    }
    render();
    scheduleSave();
  }

  // Favorieten altijd (in de volgorde die iemand zelf koos), aangevuld met
  // de meest toegevoegde items die nog geen favoriet zijn — allebei alleen
  // als dat item niet al openstaat op de lijst (dan heeft "snel toevoegen"
  // ervan geen zin). Totaal begrensd zodat het rijtje niet uit de hand
  // loopt bij een lijstje met een lange geschiedenis.
  function berekenSnelSuggesties() {
    const actieveTeksten = new Set(
      items.filter((i) => !i.done).map((i) => normaliseerTekst(i.text))
    );
    const favTeksten = new Set();
    const suggesties = [];
    favorieten.forEach((f) => {
      const genormaliseerd = normaliseerTekst(f.tekst);
      if (!genormaliseerd || actieveTeksten.has(genormaliseerd) || favTeksten.has(genormaliseerd)) return;
      favTeksten.add(genormaliseerd);
      suggesties.push({ tekst: f.tekst, favoriet: true });
    });
    Object.entries(itemFrequentie)
      .filter(([genormaliseerd, info]) => info.aantal >= 2 && !actieveTeksten.has(genormaliseerd) && !favTeksten.has(genormaliseerd))
      .sort((a, b) => b[1].aantal - a[1].aantal)
      .forEach(([, info]) => {
        if (suggesties.length >= SNEL_TOEVOEGEN_MAX) return;
        suggesties.push({ tekst: info.tekst, favoriet: false });
      });
    return suggesties.slice(0, SNEL_TOEVOEGEN_MAX);
  }

  function renderSnelToevoegen() {
    if (!el.snelToevoegenRij) return;
    const suggesties = berekenSnelSuggesties();
    el.snelToevoegenRij.innerHTML = "";
    el.snelToevoegenRij.hidden = suggesties.length === 0;
    suggesties.forEach((s) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "snel-chip" + (s.favoriet ? " favoriet" : "");
      if (s.favoriet) chip.append(document.createTextNode("★ "));
      chip.append(document.createTextNode(s.tekst));
      chip.title = `"${s.tekst}" toevoegen`;
      chip.addEventListener("click", () => voegItemToe(s.tekst));
      el.snelToevoegenRij.appendChild(chip);
    });
  }

  // Eén item één plekje omhoog/omlaag, net als moveList() hierboven voor
  // lijstjes — maar dan binnen de eigen "baan" (open+vastgepind,
  // open+niet-vastgepind, of afgevinkt), want dat zijn ook de groepen
  // waarin render()/buildItemRow ze los van elkaar laat zien.
  function moveItem(id, direction) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const zelfdeGroep = items.filter((i) => i.done === item.done && !!i.pinned === !!item.pinned);
    const posInGroep = zelfdeGroep.indexOf(item);
    const buur = zelfdeGroep[posInGroep + direction];
    if (!buur) return;
    const i1 = items.indexOf(item);
    const i2 = items.indexOf(buur);
    [items[i1], items[i2]] = [items[i2], items[i1]];
    render();
    scheduleSave();
  }

  // Compacte weergave van "wie": een klein rond badge met (zo kort mogelijk
  // unieke) initialen in plaats van een hele regel "Toegevoegd door X" /
  // "Afgevinkt door X" — dat nam te veel ruimte in terwijl het niet zoveel
  // toevoegde. Bij twee mensen met dezelfde eerste letter krijgen beiden
  // vanzelf 2 (of zo nodig meer) letters, zodat ze uit elkaar te houden
  // blijven. (Het kleurenpalet zelf staat hierboven, vroeg in start().)
  function alleBekendeNamen() {
    const namen = new Set();
    const voegToe = (lijst) => {
      for (const it of [...(lijst.items || []), ...(lijst.archivedItems || [])]) {
        if (it.createdBy) namen.add(it.createdBy);
        if (it.doneBy) namen.add(it.doneBy);
        if (it.bezigDoor) namen.add(it.bezigDoor);
      }
    };
    householdLijsten.forEach(voegToe);
    priveLijsten.forEach(voegToe);
    voegToe({ items, archivedItems }); // de actieve lijst zelf
    return namen;
  }

  // Geeft het ECHTE lijst-object terug (dus rechtstreeks uit
  // householdLijsten/priveLijsten, niet de kopie die getAllLists()/
  // findList() teruggeven) — nodig zodra we ook een EIGENSCHAP als
  // "updatedAt" willen aanpassen, niet alleen iets binnen een array
  // (items/archivedItems) die toch al gedeeld wordt met de kopie.
  function echteLijst(lijstId, prive) {
    return (prive ? priveLijsten : householdLijsten).find((l) => l.id === lijstId) || null;
  }

  // Alle gearchiveerde items van ALLE lijstjes (gedeeld + privé) samen, elk
  // gemerkt met bij welk lijstje het hoort — voor de centrale
  // archiefweergave (zie renderArchive()). Voor de actieve lijst gebruiken
  // we de live werkvariabelen (die kunnen nog net iets verser zijn dan wat
  // al in householdLijsten/priveLijsten staat, zie ook alleBekendeNamen()
  // hierboven), voor de rest gewoon de laatst bekende stand van dat
  // lijstje zelf.
  function alleGearchiveerdeItems() {
    const resultaat = [];
    getAllLists().forEach((l) => {
      const bron = l.id === activeId ? archivedItems : (l.archivedItems || []);
      for (const item of bron) {
        resultaat.push({ item, lijstId: l.id, lijstNaam: l.naam || "Lijst", prive: !!l.prive });
      }
    });
    resultaat.sort((a, b) => (b.item.deletedAt || 0) - (a.item.deletedAt || 0));
    return resultaat;
  }

  // Zet een gearchiveerd item terug, ongeacht of het bij de actieve lijst
  // hoort of bij een ander lijstje (voor dat laatste: rechtstreeks de
  // ECHTE lijst aanpassen en los opslaan, want scheduleSave()/saveList()
  // slaan alleen de actieve lijst op).
  async function restoreArchivedItem(lijstId, prive, itemId) {
    if (lijstId === activeId) {
      restoreItem(itemId);
      return;
    }
    const l = echteLijst(lijstId, prive);
    if (!l) return;
    const idx = (l.archivedItems || []).findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const [item] = l.archivedItems.splice(idx, 1);
    delete item.deletedAt;
    l.items = l.items || [];
    l.items.push(item);
    l.updatedAt = Date.now();
    renderArchive();
    renderTabsAndPanel();
    if (prive) savePrive();
    else await saveHousehold();
  }

  // Zelfde verhaal als permanentlyDeleteItem(), maar dan voor een item dat
  // niet per se bij de actieve lijst hoort.
  async function permanentlyDeleteArchivedItem(lijstId, prive, itemId) {
    if (lijstId === activeId) {
      permanentlyDeleteItem(itemId);
      return;
    }
    const l = echteLijst(lijstId, prive);
    if (!l) return;
    const idx = (l.archivedItems || []).findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    l.archivedItems.splice(idx, 1);
    renderArchive();
    if (prive) savePrive();
    else await saveHousehold();
  }

  function initialenVoor(naam, alleNamen) {
    const andere = [...alleNamen].filter((n) => n !== naam);
    let lengte = 1;
    while (
      lengte < naam.length &&
      andere.some((n) => n.slice(0, lengte).toLowerCase() === naam.slice(0, lengte).toLowerCase())
    ) {
      lengte++;
    }
    return naam.slice(0, lengte).toUpperCase();
  }

  function kleurVoor(naam) {
    if (badgeKleuren[naam]) return badgeKleuren[naam];
    let hash = 0;
    for (let i = 0; i < naam.length; i++) hash = (hash * 31 + naam.charCodeAt(i)) >>> 0;
    return BADGE_KLEUREN[hash % BADGE_KLEUREN.length];
  }

  function maakAttributieBadge(naam, alleNamen, titel) {
    const badge = document.createElement("span");
    badge.className = "attributie-badge";
    badge.textContent = initialenVoor(naam, alleNamen);
    badge.style.background = kleurVoor(naam);
    badge.title = titel;
    badge.setAttribute("aria-label", titel);
    return badge;
  }

  // Los van de gewone lijst-opslag (net als de pushTokens hierboven): een
  // eigen kleine transactie die alleen badgeKleuren aanpast, niet de
  // lijsten/archief/grafstenen van dat moment.
  async function stelBadgeKleurIn(naam, kleur) {
    // Alvast lokaal bijwerken en opnieuw tekenen: dan zie je je nieuwe
    // kleurtje meteen, zonder te wachten op de round-trip naar de server.
    badgeKleuren = { ...badgeKleuren, [naam]: kleur };
    render();
    renderBadgeKleurPicker();
    // Belangrijk: eerst een eventueel nog wachtende lijst-opslag (zie
    // scheduleSave(), 400ms-debounce) afdwingen. Zonder dit zou deze losse
    // transactie de server nog met de VORIGE stand van de lijsten kunnen
    // lezen (je nieuwste toevoeging stond dan nog niet op de server), en
    // die oudere stand er met "...server" zo weer overheen terugschrijven
    // — en daarmee je net-toegevoegde item stilletjes weer laten
    // verdwijnen zodra deze schrijfactie via onSnapshot terugkomt.
    await flushPendingSave();
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(householdRef);
        const server = snap.exists() ? snap.data() : {};
        transaction.set(householdRef, {
          ...server,
          badgeKleuren: { ...(server.badgeKleuren || {}), [naam]: kleur },
        });
      });
    } catch (e) {
      console.error("Kon badge-kleur niet opslaan:", e);
    }
  }

  function renderBadgeKleurPicker() {
    if (!el.badgeKleurOpties) return;
    const naam = getMyName();
    if (!naam) {
      el.badgeKleurOpties.innerHTML = "";
      if (el.badgeKleurHint) {
        el.badgeKleurHint.textContent = "Stel hierboven eerst je naam in — dan kun je hier je eigen badge-kleurtje kiezen.";
      }
      return;
    }
    if (el.badgeKleurHint) {
      el.badgeKleurHint.textContent = 'Jouw bolletje bij "Toegevoegd door" / "Afgevinkt door" — deze kleur zien ook je huisgenoten.';
    }
    const huidigeKleur = kleurVoor(naam);
    el.badgeKleurOpties.innerHTML = "";
    for (const kleur of BADGE_KLEUREN) {
      const optie = document.createElement("button");
      optie.type = "button";
      optie.className = "badge-kleur-optie";
      if (kleur === huidigeKleur) optie.classList.add("actief");
      optie.style.background = kleur;
      optie.title = kleur;
      optie.setAttribute("aria-label", `Kies deze kleur (${kleur})`);
      optie.addEventListener("click", () => stelBadgeKleurIn(naam, kleur));
      el.badgeKleurOpties.append(optie);
    }
  }

  function buildItemRow(item, { showMoveButtons, alleNamen }) {
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
        if (getMyName()) item.doneBy = getMyName();
        // Afgevinkt = klaar: een eventueel "bezig"-seintje is dan niet meer
        // relevant, dus dat gaat er meteen af.
        delete item.bezig;
        delete item.bezigNotitie;
        delete item.bezigDoor;
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

    const attributieNaam = item.done ? item.doneBy : item.createdBy;
    if (attributieNaam) {
      const titel = item.done ? `Afgevinkt door ${attributieNaam}` : `Toegevoegd door ${attributieNaam}`;
      row.append(maakAttributieBadge(attributieNaam, alleNamen, titel));
    }

    if (showMoveButtons) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "drag-handle";
      handle.textContent = "⠿";
      handle.title = "Verslepen om te verplaatsen";
      handle.setAttribute("aria-label", `${item.text} verslepen om te verplaatsen`);
      handle.addEventListener("pointerdown", (e) => startSlepen(e, item.id, !!item.pinned));
      row.append(handle);
    }

    // Alle overige acties (favoriet, bezig, vastpinnen, verwijderen) zitten
    // achter één "⋯"-knopje in plaats van steeds allemaal los naast elkaar
    // te staan — dat werd al gauw te veel knopjes op één regel.
    const menuWrap = document.createElement("div");
    menuWrap.className = "item-menu-wrap";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "item-menu-btn";
    menuBtn.textContent = "⋯";
    menuBtn.title = "Meer acties";
    menuBtn.setAttribute("aria-label", `Meer acties voor ${item.text}`);
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openItemMenuId = openItemMenuId === item.id ? null : item.id;
      render();
    });
    menuWrap.append(menuBtn);

    const menu = document.createElement("div");
    menu.className = "item-menu";
    menu.hidden = openItemMenuId !== item.id;
    menu.addEventListener("click", (e) => e.stopPropagation());

    // Favoriet-knopje: dit item (op tekst, niet op dit ene exemplaar) altijd
    // laten meedoen bij "Snel toevoegen" hierboven, ook nadat het is
    // afgevinkt/verwijderd — precies daarom werkt dit op de tekst, niet op
    // een los item-id.
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    const isFav = isFavoriet(item.text);
    favBtn.className = "fav-btn" + (isFav ? " active" : "");
    favBtn.textContent = isFav ? "★ Favoriet af" : "☆ Favoriet maken";
    favBtn.setAttribute("aria-label", `${item.text} ${isFav ? "als favoriet afhalen" : "favoriet maken"}`);
    favBtn.addEventListener("click", () => {
      toggleFavoriet(item.text);
      openItemMenuId = null;
      render();
      scheduleSave();
    });
    menu.append(favBtn);

    // "Bezig"-knop: los van het vinkje hierboven (dat blijft gewoon
    // open/afgevinkt) — een extra seintje dat iemand hier al mee bezig is,
    // met optioneel een kort notitietje. Niet nodig meer zodra het item al
    // is afgevinkt.
    if (!item.done) {
      const bezigBtn = document.createElement("button");
      bezigBtn.type = "button";
      bezigBtn.className = "bezig-btn" + (item.bezig ? " active" : "");
      bezigBtn.innerHTML = CLOCK_ICON + " " + (item.bezig ? "Niet meer 'bezig'" : "Op 'bezig' zetten");
      bezigBtn.setAttribute(
        "aria-label",
        `${item.text} ${item.bezig ? "niet meer op 'bezig' zetten" : "op 'bezig' zetten"}`
      );
      bezigBtn.addEventListener("click", () => {
        openItemMenuId = null;
        if (item.bezig) {
          delete item.bezig;
          delete item.bezigNotitie;
          delete item.bezigDoor;
        } else {
          const notitie = prompt(`Kort notitie bij "${item.text}" (mag leeg blijven):`, "");
          if (notitie === null) {
            render(); // geannuleerd: niks aanpassen, menu wel sluiten
            return;
          }
          item.bezig = true;
          item.bezigNotitie = notitie.trim() || null;
          if (getMyName()) item.bezigDoor = getMyName();
          else delete item.bezigDoor;
        }
        render();
        scheduleSave();
      });
      menu.append(bezigBtn);
    }

    if (showMoveButtons) {
      // Naast slepen (het handvatje) en "Vastpinnen bovenaan" (dat maar 1
      // vaste plek kent) ook gewoon met knopjes een plekje omhoog/omlaag
      // kunnen, zoals bij lijstjes in het ☰-paneel al kon — fijner dan
      // preciesmoeten mikken met een sleepbeweging, zeker op een telefoon.
      const zelfdeGroep = items.filter((i) => i.done === item.done && !!i.pinned === !!item.pinned);
      const posInGroep = zelfdeGroep.indexOf(item);

      const omhoogBtn = document.createElement("button");
      omhoogBtn.type = "button";
      omhoogBtn.className = "move-item-btn";
      omhoogBtn.textContent = "↑ Naar boven";
      omhoogBtn.disabled = posInGroep <= 0;
      omhoogBtn.setAttribute("aria-label", `${item.text} naar boven verplaatsen`);
      omhoogBtn.addEventListener("click", () => {
        openItemMenuId = null;
        moveItem(item.id, -1);
      });
      menu.append(omhoogBtn);

      const omlaagBtn = document.createElement("button");
      omlaagBtn.type = "button";
      omlaagBtn.className = "move-item-btn";
      omlaagBtn.textContent = "↓ Naar beneden";
      omlaagBtn.disabled = posInGroep >= zelfdeGroep.length - 1;
      omlaagBtn.setAttribute("aria-label", `${item.text} naar beneden verplaatsen`);
      omlaagBtn.addEventListener("click", () => {
        openItemMenuId = null;
        moveItem(item.id, 1);
      });
      menu.append(omlaagBtn);

      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "pin-btn" + (item.pinned ? " active" : "");
      pinBtn.textContent = "📌 " + (item.pinned ? "Losmaken van bovenaan" : "Vastpinnen bovenaan");
      pinBtn.setAttribute("aria-label", `${item.pinned ? "Losmaken van bovenaan" : "Vastpinnen bovenaan"} voor ${item.text}`);
      pinBtn.addEventListener("click", () => {
        item.pinned = !item.pinned;
        openItemMenuId = null;
        render();
        scheduleSave();
      });
      menu.append(pinBtn);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-btn";
    del.textContent = "✕ Verwijderen";
    del.setAttribute("aria-label", `Verwijder ${item.text}`);
    del.addEventListener("click", () => {
      openItemMenuId = null;
      removeItem(item.id);
    });
    menu.append(del);

    menuWrap.append(menu);
    row.append(menuWrap);

    li.append(row);

    // Regeltje bij "bezig": notitie + naam als er allebei zijn, anders wat
    // er wél is (alleen de naam, of alleen de notitie als er (nog) geen
    // naam is ingesteld) — nooit een tijdstip, dat voegt hier niks toe.
    if (item.bezig) {
      const bezigTekst = item.bezigNotitie
        ? item.bezigDoor
          ? `${item.bezigDoor}: ${item.bezigNotitie}`
          : item.bezigNotitie
        : item.bezigDoor || null;
      if (bezigTekst) {
        const log = document.createElement("div");
        log.className = "item-bezig-log";
        log.textContent = bezigTekst;
        li.append(log);
      }
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
    renderSnelToevoegen();

    // Zoekveldje: alleen tonen als er ook echt iets te doorzoeken valt, en
    // filtert op alles (open én afgevinkt) — zo vind je ook een afgevinkt
    // item terug.
    if (el.zoekVeld) el.zoekVeld.hidden = items.length === 0;
    const zoekTermSchoon = zoekTerm.trim().toLowerCase();
    const zoekActief = zoekTermSchoon.length > 0;
    const bronItems = zoekActief
      ? items.filter((i) => i.text.toLowerCase().includes(zoekTermSchoon))
      : items;

    el.emptyHint.hidden = !(items.length === 0);
    if (el.zoekGeenResultaten) {
      el.zoekGeenResultaten.hidden = !(zoekActief && items.length > 0 && bronItems.length === 0);
      if (el.zoekGeenResultatenTerm) el.zoekGeenResultatenTerm.textContent = `voor "${zoekTerm.trim()}".`;
    }

    const alleNamen = alleBekendeNamen();
    const active = bronItems.filter((i) => !i.done);
    const done = bronItems.filter((i) => i.done);
    const pinnedActive = active.filter((i) => i.pinned);
    const normalActive = active.filter((i) => !i.pinned);

    if (pinnedActive.length > 0) {
      const pinHeader = document.createElement("li");
      pinHeader.className = "list-divider";
      pinHeader.textContent = `📌 Vastgepind (${pinnedActive.length})`;
      el.list.appendChild(pinHeader);
    }

    pinnedActive.forEach((item) => {
      el.list.appendChild(buildItemRow(item, { showMoveButtons: true, alleNamen }));
    });

    normalActive.forEach((item) => {
      el.list.appendChild(buildItemRow(item, { showMoveButtons: true, alleNamen }));
    });

    if (active.length > 0 && done.length > 0) {
      const divider = document.createElement("li");
      divider.className = "list-divider list-divider-afgerond";
      const label = document.createElement("span");
      label.textContent = `Afgerond (${done.length})`;
      const wisBtn = document.createElement("button");
      wisBtn.type = "button";
      wisBtn.className = "wis-afgevinkte-btn";
      wisBtn.textContent = "Wis alles";
      wisBtn.setAttribute("aria-label", "Alle afgevinkte items in één keer verwijderen");
      wisBtn.addEventListener("click", wisAfgevinkte);
      divider.append(label, wisBtn);
      el.list.appendChild(divider);
    }

    done.forEach((item) => {
      el.list.appendChild(buildItemRow(item, { showMoveButtons: false, alleNamen }));
    });

    knownIds = new Set(items.map((i) => i.id));
  }

  // ============================================================
  // Tabbladen (zoveel lijstjes als er, in jouw eigen volgorde, op één
  // regel passen) + het "Lijstjes"-paneel (echt alle lijstjes, met
  // volgorde/schakelen).
  // ============================================================
  function renderTabsAndPanel() {
    renderTabs();
    renderListsPanel();
  }

  function labelFor(l) {
    return (l.prive ? "🔒 " : "") + (l.naam || "Lijst") + (heeftIetsNieuws(l) ? " •" : "");
  }

  // De id's die NU als tabblad bovenin staan — bijgehouden in huidigeTabIds
  // (bijgewerkt door renderTabs() hieronder, telkens na het opnieuw
  // passend maken), niet zelf hier opnieuw berekend: dat kan alleen aan de
  // hand van de daadwerkelijk gerenderde (en gemeten) breedte.
  function tabIds() {
    return huidigeTabIds;
  }

  function renderTabs() {
    if (!el.listTabs) return;
    el.listTabs.innerHTML = "";
    el.listTabs.hidden = false;

    // Kandidaten: ALLE bestaande lijstjes in jouw eigen volgorde — geen
    // vast aantal meer. Hoeveel daarvan uiteindelijk als tabblad blijven
    // staan hangt af van de beschikbare breedte (zie de meet-stap
    // hieronder): kortere naampjes → meer tabbladen passen er vanzelf bij.
    const kandidaatIds = volgorde.filter((id) => findList(id));
    const tabElementen = [];

    for (const id of kandidaatIds) {
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
        if (id !== activeId) {
          switchToList(id);
        } else if (archiveOpen || settingsOpen || listsOpen) {
          // Al op dit lijstje, maar je zit nog in het archief/instellingen/
          // ☰-paneel: dan moet een tik op dit tabblad je (net als het
          // kruisje) terugbrengen naar de gewone lijst-weergave.
          archiveOpen = false;
          settingsOpen = false;
          listsOpen = false;
          updateDeletedView();
        }
      });

      el.listTabs.appendChild(tab);
      tabElementen.push({ id, tab });
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

    // Passend maken: zolang de tabbladen + de ☰-knop niet allemaal op één
    // regel passen (dus zolang er, ook al staat overflow-x normaal op
    // "auto", eigenlijk gescrold zou moeten worden), het LAATSTE tabblad
    // weghalen — dat lijstje bestaat gewoon nog steeds, en staat dan
    // sowieso (ook) in het ☰-paneel. "+1" als kleine marge tegen
    // afrondingsverschillen die anders bij een exacte pasvorm per ongeluk
    // toch nog één tabblad te veel zouden laten staan.
    while (tabElementen.length > 0 && el.listTabs.scrollWidth > el.listTabs.clientWidth + 1) {
      const laatste = tabElementen.pop();
      laatste.tab.remove();
    }

    huidigeTabIds = tabElementen.map((t) => t.id);
  }

  // Hoeveel tabbladen er op één regel passen kan veranderen zodra het
  // scherm van formaat wisselt (venster verslepen, telefoon draaien) —
  // dan opnieuw uitrekenen. Licht gedebounced, want "resize" kan tijdens
  // het slepen van een vensterrand heel vaak achter elkaar afgaan.
  let tabsResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(tabsResizeTimer);
    tabsResizeTimer = setTimeout(renderTabs, 150);
  });

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
        if (id !== activeId) {
          switchToList(id);
        } else {
          listsOpen = false;
          settingsOpen = false;
          archiveOpen = false;
          updateDeletedView();
        }
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
        hideBtn.className = "btn btn-ghost btn-small lists-panel-hide";
        hideBtn.textContent = "Verbergen";
        hideBtn.title = "Dit lijstje hier niet meer tonen (blijft gewoon bestaan)";
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

    if (el.listsPanelHidden) {
      el.listsPanelHidden.innerHTML = "";
      // Een verborgen lijstje dat inmiddels (door iemand anders) verwijderd
      // of niet meer vindbaar is, ruimen we hier meteen lokaal op — anders
      // zou het voor altijd als "verborgen" blijven meetellen.
      const geldig = verborgenLijsten.filter((id) => findList(id));
      if (geldig.length !== verborgenLijsten.length) {
        verborgenLijsten = geldig;
        saveVerborgen();
      }
      if (el.listsPanelHiddenSection) el.listsPanelHiddenSection.hidden = geldig.length === 0;
      geldig.forEach((id) => {
        const l = findList(id);
        const li = document.createElement("li");
        li.className = "lists-panel-row";

        const name = document.createElement("span");
        name.className = "lists-panel-name";
        name.textContent = l.naam || "Lijst";

        const showBtn = document.createElement("button");
        showBtn.type = "button";
        showBtn.className = "btn btn-ghost btn-small";
        showBtn.textContent = "Terug laten zien";
        showBtn.addEventListener("click", () => unhideList(id));

        li.append(name, showBtn);
        el.listsPanelHidden.appendChild(li);
      });
    }
  }

  el.addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.newItem.value.trim();
    if (!text) return;
    voegItemToe(text);
    el.newItem.value = "";
  });

  if (el.zoekVeld) {
    el.zoekVeld.addEventListener("input", () => {
      zoekTerm = el.zoekVeld.value;
      render();
    });
  }

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

  // ============================================================
  // Pushmeldingen — los van (en boven op) de gewone realtime-sync
  // hierboven: die werkt alleen zolang de app op de achtergrond of
  // voorgrond open staat, dit geeft een melding op het toestel zelf, ook
  // als de app helemaal niet open is. Werkt per TOESTEL, niet per
  // lijstje: elk toestel meldt een eigen "token" aan bij het gezinnetje
  // (in het gedeelde document zelf, náást de lijsten), en een Cloud
  // Function (zie functions/index.js in dit project — moet Bob apart,
  // eenmalig zelf deployen, zie README.md) stuurt bij een nieuw item een
  // melding naar alle aangemelde toestellen.
  //
  // Bewust verborgen (via el.pushSection.hidden) tot: (a) de browser dit
  // ondersteunt (isSupported()) — Firefox op iPhone bijvoorbeeld niet, en
  // (b) er een vapidKey in config.js staat (zonder Cloud Messaging
  // ingesteld in Firebase zou de knop toch nooit kunnen werken).
  // ============================================================
  const PUSH_TOKEN_KEY = "boodschappenlijst:push-token";

  function huidigPushToken() {
    try { return localStorage.getItem(PUSH_TOKEN_KEY); } catch (e) { return null; }
  }

  function bewaarPushToken(token) {
    try {
      if (token) localStorage.setItem(PUSH_TOKEN_KEY, token);
      else localStorage.removeItem(PUSH_TOKEN_KEY);
    } catch (e) { /* niet erg, dan onthoudt dit toestel het gewoon niet */ }
  }

  function updatePushKnop() {
    if (!el.pushBtn) return;
    const aan = !!huidigPushToken();
    el.pushBtn.textContent = `Pushmeldingen: ${aan ? "aan" : "uit"}`;
    el.pushBtn.classList.toggle("active", aan);
  }

  // Los van de gewone lijst-opslag hierboven (saveHousehold/saveList):
  // tokens hebben niets te maken met de inhoud van een lijstje, dus een
  // eigen kleine transactie die verder niets aan lijsten/archief/
  // grafstenen verandert, wat die ook op dat moment waren.
  async function voegPushTokenToe(token) {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(householdRef);
      const server = snap.exists() ? snap.data() : {};
      const zonderDitToken = (server.pushTokens || []).filter((t) => t.token !== token);
      zonderDitToken.push({ token, bijgewerktOp: Date.now() });
      transaction.set(householdRef, { ...server, pushTokens: zonderDitToken });
    });
  }

  async function verwijderPushToken(token) {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(householdRef);
      const server = snap.exists() ? snap.data() : {};
      const zonderDitToken = (server.pushTokens || []).filter((t) => t.token !== token);
      transaction.set(householdRef, { ...server, pushTokens: zonderDitToken });
    });
  }

  async function zetPushMeldingenAan() {
    try {
      const permissie = await Notification.requestPermission();
      if (permissie !== "granted") {
        alert("Zonder toestemming voor meldingen kan dit toestel geen pushmeldingen krijgen. Je kunt dit later alsnog toestaan via de site-instellingen van je browser.");
        return;
      }
      const swRegistratie = await navigator.serviceWorker.ready;
      const messaging = getMessaging(firebaseApp);
      const token = await getToken(messaging, {
        vapidKey: CONFIG.vapidKey,
        serviceWorkerRegistration: swRegistratie,
      });
      if (!token) {
        alert("Kon geen pushmeldingen-token krijgen. Probeer het later nog eens.");
        return;
      }
      await voegPushTokenToe(token);
      bewaarPushToken(token);
      updatePushKnop();
      // Meldingen terwijl de app op de voorgrond openstaat komen hier
      // binnen (i.p.v. als systeemmelding) — gewoon als toastje laten
      // zien, dan blijft het rustig als je toch al aan het kijken bent.
      onMessage(messaging, (payload) => {
        showToast((payload.notification && payload.notification.body) || "Er is iets nieuws toegevoegd");
      });
    } catch (e) {
      console.error("Pushmeldingen aanzetten is niet gelukt:", e);
      alert("Pushmeldingen aanzetten is niet gelukt. Zie de console voor details.");
    }
  }

  async function zetPushMeldingenUit() {
    const token = huidigPushToken();
    try {
      const messaging = getMessaging(firebaseApp);
      if (token) await deleteToken(messaging).catch(() => {});
      if (token) await verwijderPushToken(token);
    } catch (e) {
      console.error("Pushmeldingen uitzetten ging niet helemaal goed (lokaal wel uitgezet):", e);
    }
    bewaarPushToken(null);
    updatePushKnop();
  }

  if (el.pushSection && CONFIG.vapidKey && CONFIG.vapidKey !== "VUL-HIER-IN") {
    pushWordtOndersteund().then((ondersteund) => {
      if (!ondersteund) return; // bijv. Firefox/Safari op iPhone
      el.pushSection.hidden = false;
      updatePushKnop();
      el.pushBtn.addEventListener("click", () => {
        if (huidigPushToken()) zetPushMeldingenUit();
        else zetPushMeldingenAan();
      });
    });
  }
}

// --- Service worker (PWA) ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.error("SW-registratie mislukt:", e));
  });
}
