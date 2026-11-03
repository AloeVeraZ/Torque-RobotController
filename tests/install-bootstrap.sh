#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p "$repo/test-results"
fixture="$(mktemp -d "$repo/test-results/main-bootstrap.XXXXXX")"
mkdir -p "$fixture/bin" "$fixture/tmp"
cat > "$fixture/payload" <<'SH'
#!/usr/bin/env bash
# Simulates both an old install-only release and a new auto-launching release.
mkdir -p "$XDG_DATA_HOME/deck-driver-station"
cat > "$XDG_DATA_HOME/deck-driver-station/launch.sh" <<'LAUNCH'
printf 'launch\n' >> "$BOOTSTRAP_FIXTURE/launches"
LAUNCH
if [[ "${BOOTSTRAP_AUTO_LAUNCH:-}" == 1 && "${DECK_NO_LAUNCH:-}" != 1 ]]; then
  bash "$XDG_DATA_HOME/deck-driver-station/launch.sh"
fi
SH
sha256sum "$fixture/payload" | cut -d ' ' -f 1 > "$fixture/hash"
cat > "$fixture/bin/uname" <<'SH'
#!/usr/bin/env bash
case "$1" in -s) echo "${BOOTSTRAP_OS:-Linux}";; -m) echo "${BOOTSTRAP_ARCH:-x86_64}";; esac
SH
cat > "$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
destination='';previous=''
for argument in "$@"; do
  if [[ "$previous" == -o ]]; then destination="$argument"; fi
  previous="$argument"
done
url="${!#}"
if [[ "$url" == https://github.com/AloeVeraZ/Torque-RobotController/releases/latest ]]; then
  printf '%s' "https://github.com/AloeVeraZ/Torque-RobotController/releases/tag/$BOOTSTRAP_TEST_TAG"
elif [[ "$url" == "https://github.com/AloeVeraZ/Torque-RobotController/releases/download/v9.8.7/$BOOTSTRAP_ASSET.sha256" ]]; then
  printf '%s  %s\r\n' "$(cat "$BOOTSTRAP_FIXTURE/hash")" "$BOOTSTRAP_ASSET" > "$destination"
elif [[ "$url" == "https://github.com/AloeVeraZ/Torque-RobotController/releases/download/v9.8.7/$BOOTSTRAP_ASSET" ]]; then
  if [[ "${BOOTSTRAP_CORRUPT:-}" == 1 ]]; then echo corrupt > "$destination"; else cp "$BOOTSTRAP_FIXTURE/payload" "$destination"; fi
else
  echo "Unexpected download URL: $url" >&2; exit 47
fi
SH
chmod +x "$fixture/bin/"*
export PATH="$fixture/bin:$PATH" TMPDIR="$fixture/tmp" BOOTSTRAP_FIXTURE="$fixture" DECK_DOWNLOAD_ONLY=1
export BOOTSTRAP_TEST_TAG=v9.8.7 BOOTSTRAP_ASSET=DeckDriverStation-9.8.7-SteamDeck.run XDG_DATA_HOME="$fixture/data"
bash "$repo/install.sh"
unset DECK_DOWNLOAD_ONLY
for auto_launch in 0 1; do
  export BOOTSTRAP_AUTO_LAUNCH="$auto_launch"
  rm -f "$fixture/launches"
  bash "$repo/install.sh"
  for attempt in {1..50}; do [[ -f "$fixture/launches" ]] && break; sleep 0.1; done
  [[ "$(wc -l < "$fixture/launches")" -eq 1 ]]
done
export DECK_DOWNLOAD_ONLY=1 BOOTSTRAP_OS=Darwin BOOTSTRAP_ARCH=arm64 BOOTSTRAP_ASSET=DeckDriverStation-9.8.7-macOS-arm64.zip
bash "$repo/install.sh"
export BOOTSTRAP_ARCH=x86_64
if bash "$repo/install.sh"; then echo 'Unsupported Intel Mac accepted'; exit 1; fi
export BOOTSTRAP_OS=Linux BOOTSTRAP_ARCH=x86_64 BOOTSTRAP_ASSET=DeckDriverStation-9.8.7-SteamDeck.run
export BOOTSTRAP_TEST_TAG=testing-v9.8.7
if bash "$repo/install.sh"; then echo 'Testing unexpectedly installed'; exit 1; fi
export BOOTSTRAP_TEST_TAG=v9.8.7 BOOTSTRAP_CORRUPT=1
if bash "$repo/install.sh"; then echo 'Corrupt download unexpectedly accepted'; exit 1; fi
if bash "$repo/install.sh" testing; then echo 'Testing argument unexpectedly accepted'; exit 1; fi
printf 'PASS: platform detection, old/new installer single launch, Main-only future assets, CRLF checksums, corruption/prerelease/unsupported-platform refusal.\n'
[[ "$fixture" == "$repo/test-results/main-bootstrap."* ]] && rm -rf -- "$fixture"
