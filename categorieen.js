// Categorieën per item — helemaal per lijstje eigen in te delen (er is
// geen wereldwijde vaste lijst), met twee manieren om het intikken lichter
// te maken:
//  1. Een ingebouwd "woordenboek" met veelgebruikte boodschappen-namen,
//     dat bij een treffer meteen de bijbehorende categorie aanmaakt (als
//     die nog niet bestond) en toewijst.
//  2. Wat je zelf een keer aan een itemnaam hebt toegekend, onthoudt de
//     app per lijstje (categorieGeschiedenis) en stelt hij de volgende
//     keer vanzelf weer voor — dit werkt voor elk soort lijstje, niet
//     alleen boodschappen (bijv. "verf kopen" → "Onderhoud").

// Kleurenpalet waaruit een nieuwe, zelf aangemaakte categorie een kleur
// krijgt (gewoon om de beurt, geen aparte kleurenkiezer nodig).
export const CATEGORIE_PALET = [
  "#1fb17a", "#4f7cff", "#e5a92a", "#d94f6b", "#8a63d6", "#3b8fc4", "#c46a3b", "#5aa3a3",
];

export function volgendeCategorieKleur(bestaandAantal) {
  return CATEGORIE_PALET[bestaandAantal % CATEGORIE_PALET.length];
}

// { categorienaam: [herkenningswoorden] } — een woord hoeft niet exact
// gelijk te zijn aan wat je typt: "yoghurtjes" herkent bijv. ook "yoghurt".
const WOORDENBOEK = {
  "Groente & fruit": ["appel", "banaan", "sla", "tomaat", "ui", "aardappel", "komkommer", "paprika", "wortel", "fruit", "groente", "citroen", "sinaasappel", "avocado"],
  "Zuivel": ["melk", "yoghurt", "kaas", "boter", "room", "kwark", "vla", "karnemelk"],
  "Brood & gebak": ["brood", "stokbrood", "croissant", "beschuit", "koek", "cracker", "bolletje"],
  "Vlees & vis": ["kip", "gehakt", "worst", "zalm", "vis", "bacon", "vlees", "spek"],
  "Drogisterij": ["tandpasta", "shampoo", "zeep", "wc-papier", "deo", "tampons", "maandverband", "pleisters"],
  "Huishouden": ["afwasmiddel", "wasmiddel", "vuilniszak", "sponsje", "wc-eend", "allesreiniger", "batterij"],
};

// Simpele, uitlegbare normalisatie: kleine letters, spaties opgeruimd.
// Geen taalkundige trucjes (meervoud/enkelvoud e.d.) — "bevat"-matching
// hieronder vangt de meeste voorkomende gevallen al voldoende af.
export function normaliseerTekst(tekst) {
  return (tekst || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Geeft een categorienaam terug (of null) op basis van het ingebouwde
// woordenboek — geen AI, gewoon een simpele, uitlegbare woordenlijst.
export function raadCategorienaamUitWoordenboek(tekst) {
  const woord = normaliseerTekst(tekst);
  if (!woord) return null;
  for (const [naam, sleutels] of Object.entries(WOORDENBOEK)) {
    if (sleutels.some((s) => woord.includes(s))) return naam;
  }
  return null;
}
