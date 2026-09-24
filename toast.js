// Kort meldingsbalkje onderin, met "Ongedaan maken" — gebruikt door de app
// na het verwijderen of afvinken van een item.
import { el } from "./dom.js";

let toastTimer = null;
let undoStack = []; // { text, undo } — meest recente actie achteraan

function positionToastAboveFooter() {
  if (!el.toast) return;
  const footer = document.querySelector(".statusbar");
  const footerHeight = footer ? footer.getBoundingClientRect().height : 0;
  el.toast.style.bottom = `calc(${footerHeight}px + env(safe-area-inset-bottom, 0px) + 10px)`;
}

function renderToast() {
  if (!el.toast || undoStack.length === 0) return;
  const top = undoStack[undoStack.length - 1];
  el.toastText.textContent =
    undoStack.length > 1 ? `${top.text} (+${undoStack.length - 1} eerder)` : top.text;
  positionToastAboveFooter();
  el.toast.hidden = false;
}

function hideToast() {
  clearTimeout(toastTimer);
  undoStack = [];
  if (el.toast) el.toast.hidden = true;
}

export function showToast(text, undoFn) {
  if (!el.toast) return;
  undoStack.push({ text, undo: undoFn });
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
