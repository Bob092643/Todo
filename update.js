// Registreert de service worker en toont een balkje zodra er een nieuwe
// versie klaarstaat, in plaats van dat de gebruiker de app zelf handmatig
// moet afsluiten en heropenen. Alleen laden als de browser dit ondersteunt.
import { el } from "./dom.js";

// Wordt pas op true gezet zodra de gebruiker zelf op "Ververs" tikt — het
// "controllerchange"-event hieronder vuurt namelijk OOK de allereerste keer
// dat de service worker een nog niet-gecontroleerde pagina overneemt (door
// self.clients.claim() in sw.js), dus zonder deze vlag zou de app zichzelf
// meteen na de allereerste installatie ongevraagd herladen.
let verversGevraagd = false;

function toonUpdateBalk(wachtendeWorker) {
  if (!el.updateBalk) return;
  el.updateBalk.hidden = false;
  requestAnimationFrame(() => el.updateBalk.classList.add("zichtbaar"));

  function verbergBalk() {
    el.updateBalk.classList.remove("zichtbaar");
    setTimeout(() => { el.updateBalk.hidden = true; }, 300);
  }

  if (el.updateVersBtn) {
    el.updateVersBtn.onclick = () => {
      verversGevraagd = true;
      wachtendeWorker.postMessage("SKIP_WAITING");
      verbergBalk();
    };
  }
  if (el.updateSluitBtn) {
    el.updateSluitBtn.onclick = verbergBalk;
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        // Kan gebeuren als een vorige sessie de tab niet sloot na een update.
        if (reg.waiting && navigator.serviceWorker.controller) {
          toonUpdateBalk(reg.waiting);
        }
        reg.addEventListener("updatefound", () => {
          const nieuweWorker = reg.installing;
          if (!nieuweWorker) return;
          nieuweWorker.addEventListener("statechange", () => {
            // "navigator.serviceWorker.controller" bestaat alleen als er al
            // een actieve worker was — anders is dit gewoon de allereerste
            // installatie en hoeft er niets getoond te worden.
            if (nieuweWorker.state === "installed" && navigator.serviceWorker.controller) {
              toonUpdateBalk(nieuweWorker);
            }
          });
        });
      })
      .catch((e) => console.error("SW-registratie mislukt:", e));

    let herladenBezig = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (herladenBezig || !verversGevraagd) return;
      herladenBezig = true;
      location.reload();
    });
  });
}
