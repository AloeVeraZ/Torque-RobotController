#!/usr/bin/env bash
set -euo pipefail
source_dir="$1"; destination="$2"; app_pid="$3"; platform="$4"; stage="$5"
[[ "$source_dir" == "$stage/extracted/"* && -d "$destination" ]] || exit 1
for ((i=0;i<120;i++)); do kill -0 "$app_pid" 2>/dev/null || break; sleep .5; done
if kill -0 "$app_pid" 2>/dev/null; then echo 'App did not exit; update cancelled'; exit 1; fi
if [[ "$platform" == darwin ]]; then
  # Whatever fails, the app that was installed is put back if it was moved, and opened again: a failed update must not
  # leave Torque closed.
  reopen() { if [[ ! -e "$destination" && -e "$stage/previous.app" ]]; then mv -- "$stage/previous.app" "$destination" || true; fi; /usr/bin/open "$destination" || true; }
  trap reopen ERR
  /usr/bin/codesign --force --deep --sign - "$source_dir"
  mv -- "$destination" "$stage/previous.app"
  if ! mv -- "$source_dir" "$destination"; then rm -rf -- "$destination"; reopen; exit 1; fi
  trap - ERR
  # Finder and the Dock cache bundle icons; touching and re-registering shows the new one.
  touch -- "$destination" || true
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$destination" >/dev/null 2>&1 || true
  /usr/bin/open "$destination"
else
  [[ -f "$destination/app/package.json" && -f "$source_dir/launch.sh" ]] || exit 1
  mkdir -- "$stage/previous"
  moved=(); installed=()
  # The previous version goes back and is started again: a failed update must not leave Torque closed, or half replaced.
  rollback() {
    trap - ERR; set +e
    for item in ${installed[@]+"${installed[@]}"}; do mv -- "$destination/$item" "$stage/failed-$item"; done
    for item in ${moved[@]+"${moved[@]}"}; do
      # A copy that stopped part way left a piece of the new one here: with it in place the old one would be moved inside it.
      if [[ -e "$destination/$item" ]]; then rm -rf -- "$destination/$item"; fi
      mv -- "$stage/previous/$item" "$destination/$item"
    done
    if [[ -x "$destination/launch.sh" ]]; then "$destination/launch.sh" >/dev/null 2>&1 & fi
    exit 1
  }
  trap rollback ERR
  for item in app runtime launch.sh; do
    mv -- "$destination/$item" "$stage/previous/$item"; moved+=("$item")
    mv -- "$source_dir/$item" "$destination/$item"; installed+=("$item")
  done
  trap - ERR
  # Refresh the menu icon copy and desktop entries so launchers show the updated icon.
  data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
  menu_icon="$data_dir/icons/hicolor/scalable/apps/deck-driver-station.svg"
  if [[ -f "$menu_icon" && -f "$destination/app/ui/icon.svg" ]]; then cp -- "$destination/app/ui/icon.svg" "$menu_icon" || true; fi
  desktop_dir="$(xdg-user-dir DESKTOP 2>/dev/null || printf '%s/Desktop' "$HOME")"
  for entry in "$data_dir/applications/deck-driver-station.desktop" "$desktop_dir/Deck Driver Station.desktop"; do
    if [[ -f "$entry" ]]; then touch -- "$entry" || true; fi
  done
  if [[ -d "$data_dir/icons/hicolor" ]]; then touch -- "$data_dir/icons/hicolor" || true; fi
  command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$data_dir/icons/hicolor" >/dev/null 2>&1 || true
  command -v update-desktop-database >/dev/null && update-desktop-database "$data_dir/applications" >/dev/null 2>&1 || true
  "$destination/launch.sh" >/dev/null 2>&1 &
fi
