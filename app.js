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
};

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
  const db = getFirestore(firebaseApp);

  // --- Welke gedeelde lijst? Bepaald door ?lijst=code in de link ---
  // Wordt de app geopend zónder code (bijvoorbeeld via het icoontje na
  // "Installeren" — dat gebruikt altijd het vaste startadres, niet de link
  // waar je vandaan installeerde), dan pakken we de laatst gebruikte code
  // van dít toestel erbij, in plaats van steeds een nieuwe lijst te
  // verzinnen.
  const STORAGE_KEY = "boodschappenlijst:laatste-lijst-id";
  const params = new URLSearchParams(location.search);
  let listId = params.get("lijst");

  if (listId) {
    try {
      localStorage.setItem(STORAGE_KEY, listId);
    } catch (e) {
      /* localStorage niet beschikbaar (bv. privénavigatie) — geen probleem */
    }
  } else {
    let rememberedId = null;
    try {
      rememberedId = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      /* localStorage niet beschikbaar — val terug op een nieuwe lijst */
    }
    listId = rememberedId || crypto.randomUUID(); // lange, willekeurige code
    params.set("lijst", listId);
    history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
    try {
      localStorage.setItem(STORAGE_KEY, listId);
    } catch (e) {
      /* zie boven */
    }
  }

  const listRef = doc(db, "lists", listId);

  let items = [];
  let knownIds = new Set(); // voor de "nieuw binnengekomen" animatie
  let saveTimer = null;

  el.app.hidden = false;
  setSyncStatus("Verbinden...");

  onSnapshot(
    listRef,
    (snap) => {
      items = snap.exists() ? snap.data().items || [] : [];
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
      await setDoc(listRef, { items, updatedAt: Date.now() });
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
        await navigator.share({ title: "Boodschappenlijst", url });
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