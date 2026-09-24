// Simpele, uitlegbare tekstnormalisatie: kleine letters, spaties
// opgeruimd. Gebruikt door app.js om itemnamen te vergelijken voor
// favorieten en "snel toevoegen" (hoe vaak iets is toegevoegd), ongeacht
// hoofdlettergebruik of dubbele spaties.
export function normaliseerTekst(tekst) {
  return (tekst || "").trim().toLowerCase().replace(/\s+/g, " ");
}
