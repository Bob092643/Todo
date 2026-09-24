#!/bin/bash
# Draait de hele testverzameling in één keer: eerst de testkopieën
# verversen (sync.sh), dan de grote regressietest, dan alle losse
# verify-*.js-scripts. Stopt meteen met een foutmelding zodra er ergens
# iets misgaat (dankzij "set -e") — precies wat je wilt in een
# CI-omgeving, waar een gemiste fout anders onopgemerkt zou blijven.
#
# Handig om lokaal te draaien na een wijziging ("bash tests/run-all.sh"
# vanuit de hoofdmap, of "npm test" vanuit tests/), en dit is ook precies
# wat .github/workflows/test.yml automatisch draait bij elke push/PR.
set -e
cd "$(dirname "$0")"

bash sync.sh

echo ""
echo "=== full-regression-suite.js ==="
node full-regression-suite.js

for f in verify-*.js; do
  echo ""
  echo "=== $f ==="
  node "$f"
done

echo ""
echo "Alle tests geslaagd. ✅"
