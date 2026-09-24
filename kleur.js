// Persoonlijke kleur (alleen op dit toestel, niet gedeeld met het gezin).
// Deze module regelt zichzelf helemaal: importeren is genoeg, verder is
// er niets uit nodig in app.js.
import { el } from "./dom.js";

const COLOR_STORAGE_KEY = "boodschappenlijst:kleur";

// De kleur waarmee de app standaard start (zie ook style.css en de
// "value" van #color-picker in index.html) — hier gebruikt om "Standaard"
// weer te kunnen terugzetten.
const DEFAULT_COLOR = "#3b63e0";

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

// Rondje in het "Kies kleur"-knopje dat de huidige kleur laat zien — puur
// cosmetisch, maar zo zie je in één oogopslag of tikken op de knop iets
// heeft gedaan (handig juist omdat het openen van de kleurenkiezer zelf
// een systeemvenster is dat niet in de app-screenshot terugkomt).
function updateColorSwatch(hex) {
  if (el.colorSwatch) el.colorSwatch.style.background = hex;
}

(function loadSavedColor() {
  let saved = null;
  try {
    saved = localStorage.getItem(COLOR_STORAGE_KEY);
  } catch (e) {
    /* localStorage niet beschikbaar; app blijft gewoon de standaardkleur tonen */
  }
  if (saved) {
    applyAccentColor(saved);
    if (el.colorPicker) el.colorPicker.value = saved;
  }
  updateColorSwatch(saved || DEFAULT_COLOR);
})();

if (el.colorPicker) {
  // Geen los knopje meer dat met JavaScript ("click()") het verborgen
  // kleurveld probeert te openen — dat bleek op sommige toestellen (o.a.
  // iPhone) niet betrouwbaar te werken (er gebeurde dan helemaal niets bij
  // een tik). "Kies kleur" is nu een <label for="color-picker">, en het
  // openen van de kleurenkiezer is daarmee gewoon standaard browsergedrag,
  // net als bij een gewoon vinkje — dat werkt overal.
  el.colorPicker.addEventListener("input", () => {
    const hex = el.colorPicker.value;
    applyAccentColor(hex);
    updateColorSwatch(hex);
    try {
      localStorage.setItem(COLOR_STORAGE_KEY, hex);
    } catch (e) {
      /* kleur werkt nog wel voor deze sessie, wordt alleen niet onthouden */
    }
  });
}

if (el.colorResetBtn) {
  el.colorResetBtn.addEventListener("click", () => {
    // Niet applyAccentColor(DEFAULT_COLOR) gebruiken: dat berekent de 3
    // afgeleide tinten opnieuw met dezelfde HSL-formule als voor een door
    // de gebruiker gekozen kleur, en dat gaf een iets andere (merkbaar
    // hardere) tint dan de eigenlijke standaardkleuren hieronder in
    // style.css — je zag dus meteen een andere kleur, ook al had je "de
    // standaard" al. In plaats daarvan gewoon de eigen kleur-overrides
    // weghalen: dan valt de pagina vanzelf terug op de originele waardes
    // uit style.css (en ook automatisch op de donkere-modus-varianten
    // daarvan, als dat van toepassing is) — precies dezelfde kleur die je
    // ook na herladen zou zien.
    const root = document.documentElement.style;
    root.removeProperty("--blue-600");
    root.removeProperty("--blue-700");
    root.removeProperty("--blue-500");
    root.removeProperty("--blue-50");
    if (el.colorPicker) el.colorPicker.value = DEFAULT_COLOR;
    updateColorSwatch(DEFAULT_COLOR);
    try {
      localStorage.removeItem(COLOR_STORAGE_KEY);
    } catch (e) {
      /* niet erg, de standaardkleur staat nu sowieso weer actief */
    }
  });
}
