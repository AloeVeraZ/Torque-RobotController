#!/bin/bash
# Installs this checkout's app files and simulator runtime, with the locally prepared CAD, as
# ~/Applications/Torque.app on this Mac: the macOS counterpart of install-local.ps1. Development use on
# this computer only; nothing is published, and public packages (tools/package.py) still leave the CAD out.
# - Starts from the installed Torque.app, or the older Deck Driver Station.app (its Electron runtime and
#   Java stay), and moves the bundle it replaces to ~/Applications/Torque-backups first.
# - Closes only that bundle's own app; leaves user data (~/Library/Application Support/Torque) untouched.
# Usage: tools/simulation/install-local-mac.sh [--no-launch]   (run node tools/simulation/build.cjs first)
set -euo pipefail
source="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
apps="$HOME/Applications"; target="$apps/Torque.app"; legacy="$apps/Deck Driver Station.app"
for required in sim-runtime/manifest.json sim-runtime/driver/classes/deck/sim/RunBridge.class sim-runtime/occt/occt-import-js.wasm ui/vendor/three-view.js; do
  [[ -e "$source/$required" ]] || { echo "Missing $required. Run: node tools/simulation/build.cjs" >&2; exit 1; }
done
if [[ -d "$target" ]]; then base="$target"; elif [[ -d "$legacy" ]]; then base="$legacy"; else
  echo "No installed Torque.app or Deck Driver Station.app in ~/Applications. Install a macOS package first." >&2; exit 1; fi
version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$base/Contents/Info.plist" 2>/dev/null || echo unknown)"
backup="$apps/Torque-backups/$(basename "$base" .app)-$version-$(date +%Y%m%d-%H%M%S).app"
mkdir -p "$apps/Torque-backups"

# Close only the app running from the bundle being replaced, gracefully first.
if /usr/bin/pgrep -f "$base/Contents/MacOS/Electron" >/dev/null; then
  /usr/bin/pkill -TERM -f "$base/Contents/MacOS/Electron" || true
  for _ in $(seq 1 20); do /usr/bin/pgrep -f "$base/Contents/MacOS/Electron" >/dev/null || break; sleep 0.5; done
  /usr/bin/pkill -KILL -f "$base/Contents/MacOS/Electron" 2>/dev/null || true
  echo "Closed $(basename "$base" .app)."
fi

# Build the new bundle beside the old one, then swap, so a failure leaves the old app in place.
stage="$apps/.Torque-installing.app"; rm -rf -- "$stage"
/usr/bin/ditto "$base" "$stage"
app="$stage/Contents/Resources/app"
for dir in src ui sim-runtime; do rm -rf -- "$app/$dir"; /usr/bin/ditto "$source/$dir" "$app/$dir"; done
cp "$source/package.json" "$app/package.json"
cp "$source/ui/icon.icns" "$stage/Contents/Resources/deck.icns"
plist="$stage/Contents/Info.plist"; pkgversion="$(node -p "require('$source/package.json').version")"
for kv in "CFBundleName=Torque" "CFBundleDisplayName=Torque" "CFBundleShortVersionString=$pkgversion" "CFBundleVersion=$pkgversion"; do
  /usr/bin/plutil -replace "${kv%%=*}" -string "${kv#*=}" "$plist"; done
/usr/bin/codesign --force --deep --sign - "$stage" 2>/dev/null

# Verify the copy byte for byte against the checkout.
checked=0
while IFS= read -r -d '' file; do rel="${file#$source/}"
  cmp -s "$file" "$app/$rel" || { echo "Installed $rel differs from the source; the old app is untouched." >&2; rm -rf -- "$stage"; exit 1; }
  checked=$((checked+1)); done < <(find "$source/src" "$source/ui" "$source/sim-runtime" -type f -print0)

mv -- "$base" "$backup"; mv -- "$stage" "$target"
[[ -L "$HOME/Desktop/Deck Driver Station.app" ]] && rm -f -- "$HOME/Desktop/Deck Driver Station.app"
[[ -d "$HOME/Desktop" && ! -e "$HOME/Desktop/Torque.app" ]] && ln -s "$target" "$HOME/Desktop/Torque.app"
echo "Backup: $backup"
echo "Installed and verified $checked files into $target."
[[ "${1:-}" == "--no-launch" ]] || { /usr/bin/open "$target"; echo "Launched Torque."; }
