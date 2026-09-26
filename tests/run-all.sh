#!/bin/bash
# Draait de hele testverzameling: sync.sh, dan full-regression-suite.js, dan alle verify-*.js.
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
