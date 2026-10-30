#!/usr/bin/env bash
# Deck Driver Station one-line installer for Steam Deck / Linux x64 and Apple Silicon Macs:
#   curl -fsSL https://raw.githubusercontent.com/AloeVeraZ/Torque-RobotController/main/install.sh | bash
# Downloads the latest stable release from GitHub, checks its SHA-256, and runs the bundled installer.
# No sudo. DECK_DOWNLOAD_ONLY=1 stops after the verified download.
set -euo pipefail
if (( $# )); then echo 'Installation uses Main only. Choose Testing from Updates after installing.' >&2; exit 2; fi
repo="AloeVeraZ/Torque-RobotController"

# The latest-release redirect excludes prereleases. Use versioned assets so
# existing Main releases do not need version-free filename aliases.
echo 'Finding the latest Main release ...'
release_url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")"
if [[ ! "$release_url" =~ ^https://github\.com/AloeVeraZ/Torque-RobotController/releases/tag/v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo 'No valid Main release was found. Testing builds are not installed by this command.' >&2; exit 1
fi
version="${BASH_REMATCH[1]}"
base="https://github.com/$repo/releases/download/v$version"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) file="DeckDriverStation-$version-SteamDeck.run" ;;
  Darwin-arm64) file="DeckDriverStation-$version-macOS-arm64.zip" ;;
  Darwin-*) echo "Deck Driver Station needs an Apple Silicon Mac; Intel Macs are not supported." >&2; exit 1 ;;
  *) echo "This installer is for Steam Deck / Linux x64 and Apple Silicon Macs. On Windows, use install.ps1." >&2; exit 1 ;;
esac

stage="$(mktemp -d "${TMPDIR:-/tmp}/deck-driver-station.XXXXXX")"
cleanup() { rm -rf -- "$stage"; }
[[ "${DECK_DOWNLOAD_ONLY:-}" == 1 ]] || trap cleanup EXIT

echo "Downloading $file from github.com/$repo ..."
curl -fL --progress-bar -o "$stage/$file" "$base/$file"
curl -fsSL -o "$stage/$file.sha256" "$base/$file.sha256"
echo "Checking download ..."
# Earlier Windows-built releases wrote CRLF checksum files. Accept both line
# endings, and require the checksum to name exactly the installer we downloaded.
checksum="$(tr -d '\r' < "$stage/$file.sha256")"
if [[ ! "$checksum" =~ ^([[:xdigit:]]{64})[[:blank:]]+\*?(.+)$ ]] || [[ "${BASH_REMATCH[2]}" != "$file" ]]; then
  echo 'The release checksum is invalid. Nothing was installed.' >&2; exit 1
fi
expected="${BASH_REMATCH[1]}"
if command -v sha256sum >/dev/null; then (cd "$stage" && printf '%s  %s\n' "$expected" "$file" | sha256sum -c -)
else (cd "$stage" && printf '%s  %s\n' "$expected" "$file" | shasum -a 256 -c -); fi

if [[ "${DECK_DOWNLOAD_ONLY:-}" == 1 ]]; then echo "Verified download: $stage/$file"; exit 0; fi
if [[ "$file" == *.run ]]; then
  # Older Main installers install without launching. New installers honor this
  # flag, so this stable entry point launches exactly once with either version.
  DECK_NO_LAUNCH=1 bash "$stage/$file"
  launcher="${XDG_DATA_HOME:-$HOME/.local/share}/deck-driver-station/launch.sh"
  [[ -f "$launcher" ]] || { echo 'The installed launcher could not be found.' >&2; exit 1; }
  nohup bash "$launcher" </dev/null >"${TMPDIR:-/tmp}/deck-driver-station-launch.log" 2>&1 &
  echo 'Opening Deck Driver Station. Its robot icon is on your desktop and application menu.'
else
  /usr/bin/ditto -x -k "$stage/$file" "$stage/app"
  bash "$stage/app/Install-Mac.command"
fi
