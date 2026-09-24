// TEST-ONLY nepversie van de Firestore SDK-functies die app.js gebruikt.
// Simuleert een cloud-database via localStorage (gedeeld tussen tabs van
// dezelfde origin) + BroadcastChannel (voor live updates tussen tabs),
// zodat we de echte app-logica kunnen testen zonder een echt
// Firebase-project nodig te hebben.

const localListeners = {};

function readDoc(path) {
  const raw = localStorage.getItem("mockdoc:" + path);
  return raw ? JSON.parse(raw) : undefined;
}

function notify(path) {
  const data = readDoc(path);
  (localListeners[path] || []).forEach((cb) => cb(data));
}

export function initializeApp() {
  return {};
}

export function getFirestore() {
  return {};
}

// TEST-ONLY: de echte app gebruikt initializeFirestore() met een
// persistentLocalCache() voor beter offline-gedrag (zie app.js). Deze
// nepversie hoeft dat niet echt te doen — de testomgeving simuleert de
// database toch al via localStorage, wat op zich al "blijft bestaan na
// herladen" oplevert — maar moet de aanroep wel kunnen accepteren zonder
// fouten te geven.
export function initializeFirestore(_app, _settings) {
  return {};
}

export function persistentLocalCache(_settings) {
  return {};
}

export function persistentMultipleTabManager() {
  return {};
}

export function doc(_db, ...segments) {
  return { path: segments.join("/") };
}

export async function getDoc(ref) {
  const data = readDoc(ref.path);
  return {
    exists: () => data !== undefined,
    data: () => data,
  };
}

export async function setDoc(ref, data) {
  localStorage.setItem("mockdoc:" + ref.path, JSON.stringify(data));
  // Een los kanaal-object (ook al heet het hetzelfde) ontvangt zijn eigen
  // berichten niet, maar ANDERE kanaal-objecten met deze naam - inclusief
  // het luisterende kanaal van onSnapshot in dit zelfde tabblad - wel. Dus
  // niet ook nog lokaal direct notify() aanroepen, anders komt de update
  // dubbel binnen (once direct, once via de broadcast).
  const ch = new BroadcastChannel("mock-firestore-" + ref.path);
  ch.postMessage({ type: "update" });
  ch.close();
}

// TEST-ONLY nepversie van een Firestore-transactie: leest de nieuwste
// stand, laat de meegegeven functie daarmee een nieuwe waarde bepalen, en
// schrijft die pas weg als er tussen het lezen en het schrijven niemand
// anders is geweest (simpele "compare-and-swap", net als de echte
// Firestore-transacties onder de motorkap doen). Is er ondertussen wél
// iemand anders geweest, dan proberen we het gewoon opnieuw met de
// allernieuwste stand — ook precies zoals de échte Firestore-SDK dat doet.
export async function runTransaction(_db, updateFunction, { maxAttempts = 8 } = {}) {
  for (let poging = 0; poging < maxAttempts; poging++) {
    let gelezenPad = null;
    let gelezenRuw = null;
    let teSchrijvenRef = null;
    let teSchrijvenData = null;

    const transaction = {
      async get(ref) {
        gelezenPad = ref.path;
        gelezenRuw = localStorage.getItem("mockdoc:" + ref.path);
        const data = gelezenRuw ? JSON.parse(gelezenRuw) : undefined;
        return { exists: () => data !== undefined, data: () => data };
      },
      set(ref, data) {
        teSchrijvenRef = ref;
        teSchrijvenData = data;
      },
    };

    await updateFunction(transaction);

    if (!teSchrijvenRef) return; // de functie heeft niets weggeschreven

    // Vlak vóór het echt schrijven nog één keer vergelijken met wat er nu
    // (op dit allerlaatste moment) in de opslag staat — is dat nog exact
    // hetzelfde als wat we bij transaction.get() lazen, dan schrijven we
    // gewoon weg. Is het ondertussen veranderd, dan botsen we en proberen
    // we de hele functie (met de nieuwste stand) nog een keer.
    const nuRuw = localStorage.getItem("mockdoc:" + gelezenPad);
    if (nuRuw !== gelezenRuw) continue;

    localStorage.setItem("mockdoc:" + teSchrijvenRef.path, JSON.stringify(teSchrijvenData));
    const ch = new BroadcastChannel("mock-firestore-" + teSchrijvenRef.path);
    ch.postMessage({ type: "update" });
    ch.close();
    return;
  }
  throw new Error(`runTransaction: bleef botsen met andere schrijfacties, ook na ${maxAttempts} pogingen.`);
}

export function onSnapshot(ref, onNext, _onError) {
  const path = ref.path;
  const wrap = (data) => {
    onNext({
      exists: () => data !== undefined,
      data: () => data,
    });
  };

  wrap(readDoc(path));

  localListeners[path] = localListeners[path] || [];
  localListeners[path].push(wrap);

  const ch = new BroadcastChannel("mock-firestore-" + path);
  const handler = () => wrap(readDoc(path));
  ch.addEventListener("message", handler);

  return () => {
    ch.removeEventListener("message", handler);
    ch.close();
    localListeners[path] = (localListeners[path] || []).filter((f) => f !== wrap);
  };
}
