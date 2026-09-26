// TEST-ONLY nepversie van Firestore: simuleert de database via localStorage + BroadcastChannel (voor live updates).

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
  // Geen losse notify() hier: de onSnapshot-listener in dit tabblad heeft een eigen kanaal-object en hoort dit bericht al.
  const ch = new BroadcastChannel("mock-firestore-" + ref.path);
  ch.postMessage({ type: "update" });
  ch.close();
}

// Simuleert een Firestore-transactie via compare-and-swap: schrijft alleen weg als niemand
// anders tussen lezen en schrijven iets veranderde, anders opnieuw proberen met de nieuwste stand.
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

    const nuRuw = localStorage.getItem("mockdoc:" + gelezenPad); // botst als dit is veranderd sinds get()
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
