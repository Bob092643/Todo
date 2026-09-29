// Twee soorten meldingsbalkjes onderin: het gewone (grijs, met "Ongedaan
// maken" of een voorgestelde vervolgactie) en het foutmelding-balkje (rood,
// voor iets dat écht mislukt is — i.p.v. een blokkerende alert()). Ze staan
// in dezelfde stapel (#toast-stack) en kunnen tegelijk zichtbaar zijn.
import { el } from "./dom.js";

let toastTimer = null;
let undoStack = []; // { text, undo, actieLabel } — meest recente actie achteraan
let foutTimer = null;

function positionStackAboveFooter() {
  if (!el.toastStack) return;
  const footer = document.querySelector(".statusbar");
  const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
  el.toastStack.style.bottom = `calc(${footerHeight}px + env(safe-area-inset-bottom, 0px) + 10px)`;
}

function renderToast() {
  if (!el.toast || undoStack.length === 0) return;
  const top = undoStack[undoStack.length - 1];
  el.toastText.textContent =
    undoStack.length > 1 ? `${top.text} (+${undoStack.length - 1} eerder)` : top.text;
  if (el.toastUndoBtn) el.toastUndoBtn.textContent = top.actieLabel || "Ongedaan maken";
  positionStackAboveFooter();
  el.toast.hidden = false;
}

function hideToast() {
  clearTimeout(toastTimer);
  undoStack = [];
  if (el.toast) el.toast.hidden = true;
}

// actieLabel: optioneel, voor een toast die geen "ongedaan maken" is maar een
// voorgestelde vervolgactie (bijv. "Afvinken" als een aantal op 0 komt).
export function showToast(text, undoFn, actieLabel) {
  if (!el.toast) return;
  undoStack.push({ text, undo: undoFn, actieLabel });
  if (undoStack.length > 5) undoStack.shift();
  clearTimeout(toastTimer);
  renderToast();
  toastTimer = setTimeout(hideToast, 5000);
}

if (el.toastUndoBtn) {
  el.toastUndoBtn.addEventListener("click", () => {
    const top = undoStack.pop();
    clearTimeout(toastTimer);
    if (top) top.undo();
    if (undoStack.length > 0) {
      renderToast();
      toastTimer = setTimeout(hideToast, 5000);
    } else {
      hideToast();
    }
  });
}

// Foutmelding-toast: voor iets dat écht mislukt is (opslaan, foto-upload,
// een ongeldige invoer). In tegenstelling tot alert() blokkeert dit de rest
// van het scherm niet, en verdwijnt vanzelf (of via de actieknop).
// actieLabel/actieFn zijn beide optioneel (bijv. "Probeer opnieuw").
export function showErrorToast(text, actieLabel, actieFn) {
  if (!el.errorToast) return;
  el.errorToastText.textContent = text;
  positionStackAboveFooter();
  if (el.errorToastActieBtn) {
    if (actieLabel && actieFn) {
      el.errorToastActieBtn.textContent = actieLabel;
      el.errorToastActieBtn.hidden = false;
    } else {
      el.errorToastActieBtn.hidden = true;
    }
  }
  el.errorToast.hidden = false;
  clearTimeout(foutTimer);
  foutTimer = setTimeout(() => {
    if (el.errorToast) el.errorToast.hidden = true;
  }, 7000);

  if (el.errorToastActieBtn && actieFn) {
    el.errorToastActieBtn.onclick = () => {
      clearTimeout(foutTimer);
      el.errorToast.hidden = true;
      actieFn();
    };
  }
}
