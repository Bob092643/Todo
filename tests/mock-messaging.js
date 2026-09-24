// TEST-ONLY nepversie van de Firebase Cloud Messaging-functies die app.js
// gebruikt voor pushmeldingen. Een echte pushmelding kan hier niet
// getest worden (dat vereist een echt Firebase-project + een echt
// toestel dat een systeemmelding ontvangt) — deze mock simuleert alleen
// het "token ophalen en opslaan"-deel, zodat we kunnen testen dat de
// aan/uit-knop en de opslag in het gezinsdocument goed werken.

export function getMessaging(_app) {
  return {};
}

export async function isSupported() {
  return true;
}

// Geeft een stabiel, per-browserprofiel uniek token terug (bewaard in
// localStorage), zodat herhaaldelijk "aanzetten" in dezelfde
// testbrowser-sessie steeds hetzelfde token oplevert — net als een echt
// FCM-token op hetzelfde toestel/dezelfde browserinstallatie ook stabiel
// blijft zolang je 'm niet expliciet intrekt.
export async function getToken(_messaging, _opties) {
  const KEY = "mock-fcm-token";
  let token = localStorage.getItem(KEY);
  if (!token) {
    token = "mock-token-" + Math.random().toString(36).slice(2);
    localStorage.setItem(KEY, token);
  }
  return token;
}

export async function deleteToken(_messaging) {
  localStorage.removeItem("mock-fcm-token");
  return true;
}

export function onMessage(_messaging, _callback) {
  // In deze mock komen er nooit binnenkomende berichten binnen (dat zou
  // een echte FCM-verbinding vergen) — gewoon een no-op afmeld-functie
  // teruggeven, zoals de echte SDK ook doet.
  return () => {};
}
