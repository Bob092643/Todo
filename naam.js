// Persoonlijke naam (alleen op dit toestel) — zo zien anderen wie iets
// heeft toegevoegd, afgevinkt of op "bezig" heeft gezet.
import { el } from "./dom.js";

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

// Andere modules lezen de naam alleen (via deze functie); wijzigen kan
// alleen hier binnen, via het naam-knopje of de eerste-keer-vraag.
export function getMyName() {
  return myName;
}

function normalizeName(input) {
  const trimmed = (input || "").trim();
  return trimmed.length >= 2 ? trimmed : null;
}

export function updateNameBtn() {
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

export function askNameIfNeeded() {
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
