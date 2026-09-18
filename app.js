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
};

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

  // --- Welke gedeelde lijst? ---
  // Eenmaal gekozen op dit toestel (via een geopende link, of via het
  // codevakje onderin), blijft die keuze leidend — ook als er per ongeluk
  // een andere/verkeerde code in de link staat (bijvoorbeeld een oude
  // link die nog eens werd aangetikt, of het vaste startadres van het
  // geïnstalleerde icoontje). Alleen bewust de code aanpassen via het
  // codevakje onderin verandert 'm nog.
  const STORAGE_KEY = "boodschappenlijst:laatste-lijst-id";
  const params = new URLSearchParams(location.search);
  const urlListId = params.get("lijst");

  let listId = null;
  try {
    listId = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    /* localStorage niet beschikbaar (bv. privénavigatie) */
  }

  if (!listId) {
    // Nog geen eerder opgeslagen keuze op dit toestel: pak de code uit de
    // link (bv. de eerste keer dat je een gedeelde link opent), of verzin
    // een gloednieuwe als die er niet is.
    listId = urlListId || crypto.randomUUID();
    try {
      localStorage.setItem(STORAGE_KEY, listId);
    } catch (e) {
      /* geen probleem, werkt gewoon nog voor deze ene keer */
    }
  }

  // Adresbalk altijd gelijk laten lopen met de code die nu écht gebruikt
  // wordt (kan dus afwijken van wat er origineel in de link stond).
  params.set("lijst", listId);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);

  const listRef = doc(db, "lists", listId);

  // Toon de eerste 8 tekens van de lijst-code onderin, zodat je op twee
  // telefoons naast elkaar kunt controleren of ze naar dezelfde lijst
  // wijzen. Tikken opent de vólledige code, zodat je 'm kunt controleren
  // en — indien nodig — kunt vervangen door een andere.
  el.listCodeValue.textContent = listId.slice(0, 8);
  el.listCodeBtn.addEventListener("click", () => {
    const next = prompt("Lijst-code (controleer of dit klopt, of plak hier een andere):", listId);
    if (next === null) return; // geannuleerd, niets aanpassen
    const trimmed = next.trim();
    if (!trimmed || trimmed === listId) return; // niets veranderd

    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch (e) {
      /* niet erg, de nieuwe code wordt hieronder toch meteen gebruikt */
    }
    const newParams = new URLSearchParams(location.search);
    newParams.set("lijst", trimmed);
    location.href = `${location.pathname}?${newParams.toString()}`;
  });

  let items = [];
  let knownIds = new Set(); // voor de "nieuw binnengekomen" animatie
  let saveTimer = null;

  // --- Naam van de lijst, gedeeld met iedereen die de link heeft ---
  const DEFAULT_LIST_NAME = "Onze lijst";
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
    scheduleSave();
  });

  el.app.hidden = false;
  setSyncStatus("Verbinden...");

  onSnapshot(
    listRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      items = data.items || [];
      setListName(data.listName);
      render();
      setSyncStatus("Gesynchroniseerd " + new Date().toLocaleTimeString(), "synced");
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

  async function saveList() {
    setSyncStatus("Opslaan...", "saving");
    try {
      await setDoc(listRef, { items, listName, updatedAt: Date.now() });
      setSyncStatus("Opgeslagen " + new Date().toLocaleTimeString(), "synced");
    } catch (e) {
      console.error("Fout bij opslaan:", e);
      setSyncStatus("Fout bij opslaan — zie console", "error");
    }
  }

  function removeItem(id) {
    const li = el.list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (li) {
      li.classList.add("removing");
      li.addEventListener(
        "transitionend",
        () => {
          items = items.filter((i) => i.id !== id);
          knownIds.delete(id);
          render();
          scheduleSave();
        },
        { once: true }
      );
      // Vangnet voor als transitionend niet vuurt (bv. reduced-motion).
      setTimeout(() => {
        if (items.some((i) => i.id === id)) {
          items = items.filter((i) => i.id !== id);
          knownIds.delete(id);
          render();
          scheduleSave();
        }
      }, 300);
    } else {
      items = items.filter((i) => i.id !== id);
      knownIds.delete(id);
      render();
      scheduleSave();
    }
  }

  function render() {
    el.list.innerHTML = "";
    el.emptyHint.hidden = items.length > 0;

    for (const item of items) {
      const li = document.createElement("li");
      li.className = item.done ? "done" : "";
      li.dataset.id = item.id;
      if (!knownIds.has(item.id)) li.classList.add("entering");

      const check = document.createElement("label");
      check.className = "check";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.done;
      checkbox.setAttribute("aria-label", `${item.text} afvinken`);
      checkbox.addEventListener("change", () => {
        item.done = checkbox.checked;
        render();
        scheduleSave();
      });

      const box = document.createElement("span");
      box.className = "box";
      box.innerHTML = CHECK_ICON;

      check.append(checkbox, box);

      const text = document.createElement("span");
      text.className = "item-text";
      text.textContent = item.text;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "delete-btn";
      del.textContent = "✕";
      del.setAttribute("aria-label", `Verwijder ${item.text}`);
      del.addEventListener("click", () => removeItem(item.id));

      li.append(check, text, del);
      el.list.appendChild(li);
    }

    knownIds = new Set(items.map((i) => i.id));
  }

  el.addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.newItem.value.trim();
    if (!text) return;
    items.push({ id: crypto.randomUUID(), text, done: false });
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
