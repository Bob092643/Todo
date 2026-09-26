// TEST-ONLY nepversie van FCM: simuleert alleen het token ophalen/opslaan, geen echte pushmelding.

export function getMessaging(_app) {
  return {};
}

export async function isSupported() {
  return true;
}

// Stabiel token per browserprofiel (bewaard in localStorage), zoals een echt FCM-token.
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
  return () => {}; // no-op afmeld-functie, zoals de echte SDK
}
