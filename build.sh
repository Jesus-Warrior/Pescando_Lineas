#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./manifest.json').version")
node -e "if(require('./manifest.json').description.length>132){console.error('description >132');process.exit(1)}"
OUT=dist
STAGE="$OUT/pescandoLineas-$VERSION"

rm -rf "$OUT"
mkdir -p "$STAGE/icons"

cp manifest.json popup.html popup.css popup.js background.js content.js companies.js storage.js i18n.js "$STAGE/"
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png "$STAGE/icons/" 2>/dev/null || true
if [ -f rules.json ]; then cp rules.json "$STAGE/"; fi

# Chrome
(cd "$STAGE" && zip -r "../pescandoLineas-chrome-$VERSION.zip" .)

# Firefox/AMO (stage separado para no contaminar el manifest de Chrome)
FFTOOL=tools/firefox-manifest.js; [ -f "$FFTOOL" ] || FFTOOL=firefox-manifest.js
FFSTAGE="$OUT/firefox-stage-$VERSION"
cp -r "$STAGE" "$FFSTAGE"
node "$FFTOOL" "$FFSTAGE/manifest.json"
(cd "$FFSTAGE" && zip -r "../pescandoLineas-firefox-$VERSION.zip" .)
rm -rf "$FFSTAGE"

echo "Listo:"
ls -1 "$OUT"/*.zip
