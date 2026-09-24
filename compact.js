// Compacte weergave (alleen op dit toestel) — de gebruiker zet dit zelf
// aan of uit; de lijst wordt bewust NIET automatisch kleiner naarmate er
// meer items bijkomen (dat voelt onrustig en "goed leesbaar" is voor
// iedereen anders), maar iemand kan er zelf voor kiezen om items iets
// krapper op elkaar te zetten zodat er meer op één scherm past.
import { el } from "./dom.js";

const COMPACT_STORAGE_KEY = "boodschappenlijst:compact";

function loadCompact() {
  try {
    return localStorage.getItem(COMPACT_STORAGE_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function saveCompact(aan) {
  try {
    if (aan) localStorage.setItem(COMPACT_STORAGE_KEY, "1");
    else localStorage.removeItem(COMPACT_STORAGE_KEY);
  } catch (e) {
    /* werkt nog wel voor deze sessie, wordt alleen niet onthouden */
  }
}

function applyCompact(aan) {
  if (el.list) el.list.classList.toggle("compact", aan);
  if (el.compactBtn) el.compactBtn.textContent = `Compacte weergave: ${aan ? "aan" : "uit"}`;
}

let compactAan = loadCompact();
applyCompact(compactAan);

if (el.compactBtn) {
  el.compactBtn.addEventListener("click", () => {
    compactAan = !compactAan;
    saveCompact(compactAan);
    applyCompact(compactAan);
  });
}
