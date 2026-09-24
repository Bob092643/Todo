// Cloud Function die pushmeldingen verstuurt zodra iemand een nieuw
// (nog niet afgevinkt) item toevoegt aan een gedeeld lijstje.
//
// BELANGRIJK — dit bestand draait NIET automatisch mee met de rest van de
// app (die is puur statische bestanden op GitHub Pages). Dit moet je zelf
// éénmalig deployen naar Firebase Cloud Functions — zie README.md
// "Stap 4 — Pushmeldingen" voor de exacte stappen. Dat vergt ook het
// omzetten van je Firebase-project naar het "Blaze" (pay-as-you-go)
// betaalplan; voor een gezinslijstje met dit soort volumes val je in de
// praktijk ruim binnen de gratis quota van dat plan (zie de README voor
// de details en actuele bedragen).
//
// Dit bestand is geschreven volgens de gangbare patronen van de Firebase
// Functions v2 SDK, maar kon in deze omgeving niet tegen een echt
// Firebase-project getest worden (dat vergt een gedeployede Cloud
// Function + een echt toestel dat een systeemmelding ontvangt). Test dit
// dus zelf even goed uit na het deployen — zie de teststappen onderaan de
// README.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

exports.stuurPushBijNieuwItem = onDocumentWritten("lists/{listId}", async (event) => {
  const voor = event.data.before.exists ? event.data.before.data() : {};
  const na = event.data.after.exists ? event.data.after.data() : {};

  const pushTokens = na.pushTokens || [];
  if (pushTokens.length === 0) return; // niemand op dit gezinnetje aangemeld

  const voorLijsten = voor.lijsten || [];
  const naLijsten = na.lijsten || [];

  // Per lijstje vergelijken welke item-id's er zijn bijgekomen (t.o.v. de
  // vorige stand van DEZELFDE lijst-id) — zo tellen we nooit een item dat
  // toevallig alleen maar is verplaatst, hernoemd of afgevinkt mee als
  // "nieuw".
  const nieuweItems = [];
  naLijsten.forEach((naLijst) => {
    const voorLijst = voorLijsten.find((l) => l.id === naLijst.id);
    const voorIds = new Set((voorLijst ? voorLijst.items : []) .map((i) => i.id));
    (naLijst.items || []).forEach((item) => {
      if (!item.done && !voorIds.has(item.id)) {
        nieuweItems.push({ lijstNaam: naLijst.naam || "Lijst", tekst: item.text });
      }
    });
  });

  if (nieuweItems.length === 0) return;

  let titel;
  let body;
  if (nieuweItems.length === 1) {
    titel = nieuweItems[0].lijstNaam;
    body = `${nieuweItems[0].tekst} is toegevoegd`;
  } else {
    const lijstNamen = [...new Set(nieuweItems.map((n) => n.lijstNaam))];
    titel = lijstNamen.length === 1 ? lijstNamen[0] : "Boodschappenlijst";
    body = `${nieuweItems.length} nieuwe items toegevoegd`;
  }

  // Het toestel dat deze opslag zélf deed (app.js schrijft dit mee bij
  // elke gewone lijst-opslag, zie "laatsteSchrijver" in saveHouseholdNu())
  // krijgt geen melding over zijn eigen toevoeging — dat zou alleen maar
  // storen. Andere toestellen (ook van hetzelfde gezin) krijgen 'm gewoon.
  const schrijver = na.laatsteSchrijver || null;
  const tokens = pushTokens
    .map((t) => t.token)
    .filter(Boolean)
    .filter((token) => token !== schrijver);
  if (tokens.length === 0) return;

  const resultaat = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: titel, body },
  });

  // Tokens die niet meer geldig zijn (app verwijderd, toestemming
  // ingetrokken, langere tijd niet gebruikt) gewoon opruimen — anders
  // blijft dit lijstje met "dode" tokens rondzeulen en elke keer weer
  // (nutteloos) proberen ze te bereiken.
  const ongeldigeTokens = new Set();
  resultaat.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        ongeldigeTokens.add(tokens[i]);
      }
    }
  });
  if (ongeldigeTokens.size > 0) {
    const overgebleven = pushTokens.filter((t) => !ongeldigeTokens.has(t.token));
    await getFirestore().collection("lists").doc(event.params.listId).update({ pushTokens: overgebleven });
  }
});
