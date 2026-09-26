#!/bin/bash
# Zet de echte app-bestanden om naar test-run (nep-config) en test-unconfigured
# (leeg, voor de "niet ingesteld"-waarschuwing). Draai opnieuw na elke wijziging.
set -e
cd "$(dirname "$0")"
APP_DIR="$(cd .. && pwd)"

for d in test-run test-unconfigured; do
  mkdir -p "$d"
  # Vervangt de Firebase-SDK-imports door onze mocks (localStorage-gebaseerd).
  sed -E '
    s#https://www\.gstatic\.com/firebasejs/[0-9.]+/firebase-app\.js#./mock-firestore.js#;
    s#https://www\.gstatic\.com/firebasejs/[0-9.]+/firebase-firestore\.js#./mock-firestore.js#;
    s#https://www\.gstatic\.com/firebasejs/[0-9.]+/firebase-messaging\.js#./mock-messaging.js#;
    s#setTimeout\(askNameIfNeeded, 300\);#/* TEST-ONLY: uitgeschakeld -- deze prompt() kon anders willekeurig tussen test-dialogen door verschijnen en een antwoord voor de verkeerde vraag opeten, wat tests liet vastlopen. */#
  ' "$APP_DIR/app.js" > "$d/app.js"

  cp "$APP_DIR/index.html" "$d/index.html"
  cp "$APP_DIR/style.css" "$d/style.css"
  cp mock-firestore.js "$d/mock-firestore.js"
  cp mock-messaging.js "$d/mock-messaging.js"

  # sw.js APP_SHELL noemt manifest.json met naam; zonder dit bestand faalt cache.addAll() (404) en de SW-install.
  [ -f "$APP_DIR/manifest.json" ] && cp "$APP_DIR/manifest.json" "$d/manifest.json"
  [ -f "$APP_DIR/icon-192.png" ] && cp "$APP_DIR/icon-192.png" "$d/icon-192.png"
  [ -f "$APP_DIR/icon-512.png" ] && cp "$APP_DIR/icon-512.png" "$d/icon-512.png"

  # Losse app-modules 1-op-1 meekopiëren; config.js niet (elke testmap krijgt hieronder zijn eigen versie).
  for f in "$APP_DIR"/*.js; do
    base="$(basename "$f")"
    if [ "$base" != "app.js" ] && [ "$base" != "config.js" ]; then
      cp "$f" "$d/$base"
    fi
  done
done

# test-run: nep-config die "ingevuld" lijkt (waarden zijn niet echt, mocks onderscheppen alle Firebase-aanroepen).
cat > test-run/config.js << 'EOF'
const CONFIG = {
  firebaseConfig: {
    apiKey: "test-api-key",
    authDomain: "test-project.firebaseapp.com",
    projectId: "test-project",
    storageBucket: "test-project.firebasestorage.app",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:0000000000000000000000",
  },
  vapidKey: "test-vapid-key",
};
EOF

# test-unconfigured: expres niet ingevuld, om de "niet ingesteld"-waarschuwing te testen.
cat > test-unconfigured/config.js << 'EOF'
const CONFIG = {
  firebaseConfig: {
    apiKey: "VUL-HIER-IN",
    authDomain: "VUL-HIER-IN",
    projectId: "VUL-HIER-IN",
    storageBucket: "VUL-HIER-IN",
    messagingSenderId: "VUL-HIER-IN",
    appId: "VUL-HIER-IN",
  },
  vapidKey: "VUL-HIER-IN",
};
EOF

echo "synced."
