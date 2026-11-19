#!/bin/bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
destination="$HOME/Applications/Torque.app"
mkdir -p "$HOME/Applications"
# Torque was Deck Driver Station: the old app and its Desktop link go. Saved setups, robots and
# settings live in ~/Library/Application Support, not in the app, so they are kept.
legacy="$HOME/Applications/Deck Driver Station.app"
if [[ -d "$legacy" ]]; then /usr/bin/pkill -f "$legacy/Contents/MacOS/" 2>/dev/null || true; rm -rf -- "$legacy"; fi
if [[ -L "$HOME/Desktop/Deck Driver Station.app" ]]; then rm -f -- "$HOME/Desktop/Deck Driver Station.app"; fi
rm -rf -- "$destination"
/usr/bin/ditto "$source_dir/Torque.app" "$destination"
# Ad-hoc sign locally after adding our app and icon to the Electron bundle.
# This needs no Apple account and does not alter system Gatekeeper settings.
/usr/bin/codesign --force --deep --sign - "$destination"
if [[ -d "$HOME/Desktop" && ! -e "$HOME/Desktop/Torque.app" ]]; then
  /bin/ln -s "$destination" "$HOME/Desktop/Torque.app"
fi
printf '\nInstalled Torque in ~/Applications. This personal build is not Apple-notarized.\nIf macOS asks for approval, use Privacy & Security > Open Anyway.\n'
if [[ "${DECK_NO_LAUNCH:-}" != 1 ]]; then /usr/bin/open "$destination"; fi
