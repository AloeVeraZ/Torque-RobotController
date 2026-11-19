#!/usr/bin/env bash
# Tests the real .run installation in isolated directories.
# Under Git Bash only, emulate uname; this does not execute the Linux runtime.
set -euo pipefail
repo="$(cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p "$repo/test-results"
fixture="$(mktemp -d "$repo/test-results/steamdeck-installer.XXXXXX")"
shell_os="$(uname -s)"
mkdir -p "$fixture/bin" "$fixture/desktop" "$fixture/data" "$fixture/config" "$fixture/tmp"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s/desktop"\n' "$fixture" > "$fixture/bin/xdg-user-dir"
for command in gio update-desktop-database; do printf '#!/usr/bin/env bash\nexit 0\n' > "$fixture/bin/$command"; done
case "$shell_os" in MINGW*|MSYS*) printf '#!/usr/bin/env bash\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; *) exit 1;; esac\n' > "$fixture/bin/uname";; esac
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH" XDG_DATA_HOME="$fixture/data" XDG_CONFIG_HOME="$fixture/config" TMPDIR="$fixture/tmp" DECK_NO_LAUNCH=1
printf 'saved robot library' > "$fixture/config/robots.json"
installer="$repo/dist/DeckDriverStation-SteamDeck.run"
[[ -f "$installer" ]]
bash "$installer"
installed="$fixture/data/deck-driver-station"
[[ -f "$installed/runtime/electron" && -f "$installed/launch.sh" ]]
if [[ "$shell_os" == Linux ]]; then [[ -x "$installed/runtime/electron" && -x "$installed/launch.sh" ]]; fi
[[ -f "$installed/app/ui/icon.png" && -f "$fixture/desktop/Deck Driver Station.desktop" ]]
grep -q 'Deck Driver Station' "$fixture/data/applications/deck-driver-station.desktop"
grep -q 'Icon=.*icon.png' "$fixture/data/applications/deck-driver-station.desktop"
# The package carries its branch's update channel (tools/package.py --channel), so name and version are compared.
node -e 'const [a,b]=process.argv.slice(1).map(f=>require(f));if(a.name!==b.name||a.version!==b.version)process.exit(1)' "$repo/package.json" "$installed/app/package.json"
[[ "$(cat "$fixture/config/robots.json")" == 'saved robot library' ]]
printf 'PASS: real Steam Deck installer, branded desktop/application shortcuts, source version, and saved-data preservation. Runtime execution requires SteamOS.\n'
[[ "$fixture" == "$repo/test-results/steamdeck-installer."* ]] && rm -rf -- "$fixture"
