#!/bin/bash
# Zet de echte app-bestanden (één map hoger) om naar twee testklaar-gemaakte
# kopieën hieronder: "test-run" (met een nep-Firebase-config, klaar om
# tegen te testen) en "test-unconfigured" (expres NIET ingevuld, om de
# waarschuwing te kunnen testen die je te zien krijgt vóórdat je config.js
# hebt ingevuld). Draai dit opnieuw na elke wijziging aan de echte
# app-bestanden, vóórdat je de tests in deze map draait.
set -e
cd "$(dirname "$0")"
APP_DIR="$(cd .. && pwd)"

for d in test-run test-unconfigured; do
  mkdir -p "$d"
  # De echte app importeert de Firebase-SDK rechtstreeks vanaf gstatic.com
  # — voor de tests vervangen we die drie regels door onze eigen
  # nepversies (mock-firestore.js / mock-messaging.js) hieronder, die de
  # database/pushmeldingen simuleren via localStorage in plaats van een
  # echt Firebase-project nodig te hebben.
  sed -E '
    s#https://www\.gstatic\.com/firebasejs/[0-9.]+/firebase-app\.js#./mock-firestore.js#;
    s#https://www\.gstatic\.com/firebasejs/[0-9.]+/firebase-firestore\.js#./mock-firestore.js#;
    s#https://www\.gstatic\.com/firebasejs/[0-9.]+/firebase-messaging\.js#./mock-messaging.js#
  ' "$APP_DIR/app.js" > "$d/app.js"

  cp "$APP_DIR/index.html" "$d/index.html"
  cp "$APP_DIR/style.css" "$d/style.css"
  cp mock-firestore.js "$d/mock-firestore.js"
  cp mock-messaging.js "$d/mock-messaging.js"

  # manifest.json en de icoontjes hoort de service worker ook te kunnen
  # cachen (sw.js z'n APP_SHELL-lijst noemt "./manifest.json" met naam) —
  # zonder dit bestand mislukt cache.addAll(...) in zijn geheel (met een
  # 404), waardoor de installatie van de service worker faalt en de
  # browser 'm meteen weer opruimt. Dat brak eerder pushmeldingen-tests op
  # een manier die alleen in déze testmap zichtbaar werd.
  [ -f "$APP_DIR/manifest.json" ] && cp "$APP_DIR/manifest.json" "$d/manifest.json"
  [ -f "$APP_DIR/icon-192.png" ] && cp "$APP_DIR/icon-192.png" "$d/icon-192.png"
  [ -f "$APP_DIR/icon-512.png" ] && cp "$APP_DIR/icon-512.png" "$d/icon-512.png"

  # Alle losse app-modules (dom.js, kleur.js, naam.js, toast.js, sw.js,
  # ...) die app.js met "import" inleest, gewoon 1-op-1 meekopiëren.
  # config.js NIET meekopiëren: elke testmap heeft daar bewust een eigen
  # versie van (een ingevulde nep-config voor test-run, en juist de
  # niet-ingevulde placeholder voor test-unconfigured) — dat mag dit
  # script niet overschrijven.
  for f in "$APP_DIR"/*.js; do
    base="$(basename "$f")"
    if [ "$base" != "app.js" ] && [ "$base" != "config.js" ]; then
      cp "$f" "$d/$base"
    fi
  done
done

echo "synced."
