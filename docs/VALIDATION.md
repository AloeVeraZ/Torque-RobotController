## Testing 2.4.19: keyboard as Controller 1, layouts and controller brands

- Update checks read a `channel.json` manifest from a fixed release download first, so they no
  longer spend the 60-per-hour unauthenticated GitHub API allowance. The API fallback sends
  the saved ETag (304 replies are free), reuses the saved list when limited, and names the
  reset time otherwise. `tests/updater.test.cjs` covers each path; the CI install checks now
  run with the manifest and fail if the API is touched. 103/103 unit tests pass.

- Controller 1 can be a keyboard (Controller / Keyboard switch in its dialog). It feeds the
  same hub and robot output as a gamepad; `tests/keyboard.test.cjs` covers key mapping,
  diagonal normalisation, slot pinning, output to robots, and switching back.
- Layout detection names QWERTY/AZERTY/QWERTZ/Dvorak/Colemak/non-Latin layouts and country
  variants; checked with the real Chromium layout map on this PC (English (US) QWERTY).
- Brand fallback by USB vendor ID for unlisted controllers; virtual and cloned IDs stay
  generic. `node --test` passes 100/100. A headless launch with keyboard mode saved ran
  without errors. Not tested by hand: driving a real robot from the keyboard.

## Testing 2.4.18: real update sizes, code-only updates, icons, header theme switch

- The ~152 MB shown before was the true GitHub size of the full Windows package: every update
  re-downloaded the unchanged Electron runtime. Releases now add a code-only App package;
  `tests/app-update.test.cjs` covers package choice by runtime base and rebuilding a complete
  copy (Windows/Linux folder layout, macOS bundle with Info.plist and icon), plus rejecting
  archives with paths outside `app/`.
- On this Windows PC: `tests/update-app-install.cjs` ran a real App update through the PowerShell
  helper (12 KB fixture: swap, versioned shortcut icon, restart, saved data kept) and
  `tests/update-install.cjs` still passes for full packages.
- CI `install-update` runs on Ubuntu, Windows and macOS runners with real packages built as
  9.0.0 and 9.0.1: shipped installer (Setup.exe /S, SteamDeck.run, Torque.app unzipped into Applications), first
  launch, App update, full update, automatic restart (Windows/Linux), relaunch, icon checks,
  codesign verify (macOS) and silent uninstall (Windows).
- Escape leaves robot fullscreen or app fullscreen unless a station menu or dialog is open.
- Header theme switch (System, Light, Dark) next to Settings, matching MotionModule; System is
  the default. Below 960 px it moves to Settings → Preferences. `node --test` passes 94/94.

## Testing 2.4.17: light mode and driving conveniences

- Settings → Preferences: theme (System, Light, Dark), saved per device and applied by
  `ui/theme.js` before first paint. System follows `prefers-color-scheme`; checked in
  the preview with emulated light and dark schemes. Robot pages and the FTC view keep
  their own colors.
- Keep screen awake while driving (on by default): a `prevent-display-sleep` power-save
  blocker is held only while a robot is open and the device is not suspended.
- Shortcuts work from the station and from inside robot pages: F5/Ctrl+R reload,
  Alt+← back (⌘[ on macOS), F11 robot fullscreen, Ctrl +/−/0 and Ctrl+wheel zoom,
  Ctrl+1/2 Drive/Settings. Plain keys always reach the robot. `tests/shortcuts.test.cjs`
  covers the key table on Windows, Linux and macOS.
- Robot page zoom is remembered per saved robot (`robot-zoom.json`); a toolbar badge shows
  a non-100% zoom and resets it. The footer shows how long the robot has been connected.
- The layout audit checks pass in the preview at 1280×800, 577×582 and 360×480 with the new
  panel, badge and clock shown. A headless launch of the desktop app ran with no
  main-process or renderer errors. `node --test` passes 89/89. Not run locally: the
  Electron Playwright suites, and keep-awake or zoom on real hardware.

## Testing 2.4.16: flat, minimal station

- Simpler robot mark (head, antenna, eyes) in `ui/icon.svg`; `icon.png`, `icon.ico`
  and `icon.icns` were re-rendered from it, and `tools/icons.py` draws the same mark.
- Flat header and robot toolbar, solid white primary buttons, no nested boxes, and
  heavier Inter headings. Removed the small labels above headings, the panel icon tiles
  and most helper copy. Saved robots is one list, with robots on the current Wi-Fi
  listed first; the separate "Robots on this network" cards are gone.
- The controller and update dialogs keep their layout and only take the new colors.
- The layout audit's overlap, overflow, clipping and 44 px target checks were run in the
  browser preview on Drive and Settings at 1280×800, 800×600, 390×844 and 360×480:
  no problems. `node --test tests/*.test.cjs` passes 86/86. CI runs the Electron suites.

## Testing 2.4.15: restrained station controls

- `ui/elements.css` restyles station controls only: one Inter type scale in sentence
  case, flatter buttons, tabs and cards, quieter labels and status badges, and plain
  disclosure chevrons. Decorative arrows were removed from in-app buttons; the
  external System Wi-Fi link keeps its ↗. Layout, behavior and robot pages are unchanged.
- Checked in the browser preview at 1280×800 and 375×812 (Drive, Settings, the
  controller and update dialogs); no horizontal overflow at phone width.
- `node --test tests/*.test.cjs` passes 86/86. The Electron Playwright suites
  (`controller-ui`, `layout-audit`) were not run locally; Playwright is not
  installed on this PC, so CI covers them.

## Testing 2.4.14: responsive layout and visual polish

- `tests/layout-audit.cjs` exercises shell layouts at 360×480, 390×844, 640×480,
  800×600, 1024×600, 1280×720, 1280×800, 1920×1080 and 3840×2160, plus
  125%, 150% and 200% Electron zoom on the LCD viewport.
- The original audit found clipping/overflow in 51 of 144 layout/state combinations.
  Fixes add wrapping, bounded grid columns, adaptive toolbar/header controls and
  scrollable welcome/error views. Controller diagnostics now have a dedicated
  scrolling body between a fixed heading/close control and assignment/Done actions.
- Expanded coverage includes maximum-length robot names, long URLs and SSIDs,
  saved/empty search, touch keyboard, both controller slots, 24-button diagnostics,
  expanded help/driver details, calibration, network recovery, password/sign-in,
  update warnings/changelog/errors and download progress. Geometry checks detect
  overlapping sibling controls, horizontal overflow, clipped button text and
  unreachable controller exits. Keyboard keys must stay inside the keyboard.
- The expanded local run passes 192 layout/state checks with zero reported issues.
- A separate native WebContentsView test reproduced a toolbar overlap at 125% app
  zoom. Robot-view placement now converts CSS coordinates to window units. The
  regression checks real embedded-view bounds at 100/125/150/200%, followed by
  the existing fullscreen/exit restoration checks.
- These are native Electron fixtures on desktop/CI, not proof of every possible
  font, OS scale setting, accessibility configuration or embedded robot website.
  Robot web pages, robot code and control protocols are unchanged.

## Testing 2.4.13: persistent controllers and connection recovery

- Reproduced the lost-controller failure with the previous 2.4.12 code using
  `tests/controller-session.cjs`: only the station receives synthetic OS input;
  the new robot document has no local native gamepad activation. The same test
  passes after the fix, including three reloads, navigation, close/reopen and a
  manual slot swap followed by another reload, without feeding robot-page inputs.
- 86 Node tests include logical-output precision, button flags, pause/capture/
  unmapped/release-lock neutralization before IPC, per-robot count and deadzones.
- Native controller-session coverage includes post-load connection events, live
  retained Gamepads, real source disconnect/reconnect, and stale-source neutralization.
  The 100-controller native fixture and FTC UDP controller checks remain regression
  checks. Fixtures verify software behavior; physical OS/Steam Deck pairing remains
  a device check. No robot enable/initialization behavior is changed.
- `tests/recovery-app.cjs` drives real Electron powerMonitor listeners with simulated
  suspend/resume and Wi-Fi states. It checks retained addresses, names, SSIDs and
  controller counts; Retry; held-input release locks; wrong-network reconnection;
  robot renderer crashes; explicit Close; and an unfinished protocol probe, including
  a not-yet-saved target. An FTC UDP fixture confirms STOP on suspend and no automatic
  INIT/START on wake. These are simulated power events, not physical sleep tests.
- Shell-only corner tokens, panel insets, helper text and heading spacing unify
  Drive/Settings/controller/update surfaces. Native layout/touch checks cover the
  resulting screens; embedded robot websites retain their own appearance.

## Testing 2.4.12: updates, calibration and hotspot discovery

- 83 Node tests cover fixed update source/legacy preference migration, channel switching,
  verified automatic install handoff and failure recovery; radial drift filtering;
  automatic slot reset; private Wi-Fi gateway rules and discovery cancellation.
- Native Windows fixtures verify a single update action through download, real extraction,
  helper handoff, replacement, backup and restart without touching installed user apps.
- Native controller tests measure drift, apply/reset saved deadzones, exercise both slots,
  show reported extra buttons, and confirm filtering reaches the robot while raw diagnostic
  values remain visible. No default deadzone is introduced.
- Native discovery UI fixtures cover blocked home/internet networks with zero probes,
  explicit hotspot consent, real gateway/port autofill, multiple-result choice, network-switch
  rejection and no automatic robot opening/profile edits. Network and web responses are mocked;
  no local physical network was scanned. Platform command parsing has separate fixtures.
- Touch-only URL/password typing and HTTP-auth handoff remain regression checks.
- Linux CI runs the new calibration/discovery checks and all three desktop package builds.
  Steam Deck trackpad/paddle bindings are a one-time per-app Steam Input configuration;
  the app only documents that setup, never overwrites global Steam bindings, and does not
  claim to read independent paddles hidden by an emulated Xbox driver. Physical Steam Deck,
  Windows handheld and Apple Silicon execution still need device checks.

# Validation

## Testing 2.4.11: touch keyboard authentication handoff

- A robot's background HTTP authentication challenge now hides its native keyboard
  before the app's sign-in dialog appears, including when leaving robot fullscreen.
- The native touch regression first reproduces the overlapping-keyboard failure,
  then verifies the native surface is hidden and completes username/password entry
  in the app dialog using only on-screen keys. Controller outputs stay neutral.
- The 67 Node tests and the existing touch/controller/robot/package checks are retained.

## Testing 2.4.10: touch-first dashboard and robot-only gamepads

- 67 Node tests cover the existing behavior and the restricted touch-keyboard action
  contract. The native shell receives no projected gamepads; raw reports continue to
  supply live diagnostics and assignments. Robot views retain their mapped inputs.
- `tests/touch-ui.cjs` sends real Chromium touch events to the native app: 44px targets,
  Wi-Fi list swipes, URL typing/editing, Wi-Fi password dialogs with Shift/Symbols,
  native robot password entry/caret editing/submission, and touch menu/controller/fullscreen
  controls. The keyboard stays clear of fields; passwords remain masked and are not
  copied into the keyboard view. Handheld mouse-emulated taps are tested too.
- A separate native keyboard surface exposes only validated text/editing operations
  to the current robot view. Tests verify renderer isolation, neutral robot outputs
  while typing and suppression of held inputs until released after closing it.
- Existing native controller, fullscreen, Settings/auth/update, FTC and 100-profile
  checks pass. The MotionModule test accepts both its older confirmation checkbox and
  its current direct Enable button; it exercises the robot's own UI without editing it.
- Linux CI uses a real window manager for touch/fullscreen checks and packages all
  three desktop targets. These are software fixtures; physical touchscreen panels,
  SteamOS input-mode configuration and Apple Silicon execution remain device checks.

## Testing 2.4.9: robot fullscreen and controller compatibility

- 66 Node tests pass, including 100 source-documented synthetic standard controller
  profiles across Linux/Windows/macOS host policies, unknown brands, reconnects,
  conservative vendor/product naming, Nintendo positional labels and unmapped capture.
- `tests/controller-compatibility.cjs` runs all 100 standardized reports through the
  native Electron preload into a sandboxed robot page. It checks four axes, all 17
  button values/press states, both logical slots, raw-layout suppression and reconnect.
  The source catalog represents device modes; it is not a popularity ranking or a
  physical hardware certification. See [controller support](CONTROLLERS.md).
- `tests/robot-fullscreen.cjs` verifies viewport bounds, a separate topmost 40px exit
  control, X/Escape/Settings/close restoration, preservation of existing whole-app
  fullscreen, the same robot page token and controller forwarding. The native exit
  control exposes only an exit capability and no settings or Node API. Toolbar sizing
  includes Steam Deck LCD and portrait widths.
- The existing controller visual, Settings/update/auth, FTC and actual MotionModule
  checks continue to run. Linux CI runs both new native checks and packages all three
  desktop targets. Windows execution uses fixtures, not a physical robot/controller.
- Physical Steam Deck/Apple Silicon execution, Bluetooth pairing stability and the
  OS driver's mapping of every catalog device remain unverified hardware checks.

## Testing 2.4.8: Hardware Tester layout and MotionModule styling

- The controller setup uses one flat standard controller diagram with live stick
  movement, 17 independent button highlights, vertical analog trigger fills, XY
  plots and numeric axes. Product names and raw routing identities stay separate.
- Native input checks verify trigger levels, both XY plots, full standard button
  coverage, naming, LCD/desktop/portrait layouts and visible Done with expanded
  help. Steam Deck help remains specific to detected Steam Deck hardware.
- The app and FTC view share MotionModule's palette, bundled offline fonts, rounded
  panels and pill controls. The font licenses are included in each package. The
  preview asset test covers font downloads and their MIME types as well as scripts
  and stylesheets; all 62 Node tests pass.
- Native shell checks retain Wi-Fi switching, sign-in, saved addresses, updates
  and the original robot page at LCD, laptop, desktop, 4K and portrait sizes.
- Physical Steam Deck/Apple Silicon execution and Bluetooth radio behavior remain
  device checks. Robot communication, initialization and wiring are unchanged.

## Testing 2.4.7: cohesive driver station presentation

- 62 Node tests include a new HTTP check that every app/FTC script and stylesheet
  referenced by the local preview is actually served.
- Native app checks cover Settings at LCD, 1366×768, 1920×1080, 4K and portrait
  sizes, non-overlapping header controls, a visible primary setup action at LCD
  and laptop sizes, keyboard dismissal and navigation state. Wi-Fi switching,
  HTTP sign-in, persistence, updates and the original robot HTML still pass.
- Native UDP FTC checks cover INIT/START/STOP, control swapping, Settings keeping
  the robot connected, a visible and labelled STOP at LCD/laptop/desktop sizes,
  low voltage and connection loss disabling the controls. The test screenshots
  use an explicit simulator, never product-generated placeholder telemetry.
- Live-region checks ensure an unchanged robot status is not re-announced on each
  packet, while an actual mode-state change still updates the announcement.
- Controller diagnostics keep their live standard mappings and Deck-only help.
  CI runs the controller and FTC visual checks in Linux Electron and retains
  screenshots. See [design audit and scope](DESIGN.md).
- Execution on physical Steam Deck and Apple Silicon hardware remains unverified
  here. Existing robot control/communication logic is unchanged.

## Testing 2.4.6: controller illustration and identity

- 61 Node tests pass, including conservative physical-model naming, virtual Xbox
  fallback on Steam Deck, and preservation of raw assignment identities.
- Native Electron UI checks cover live standard button indices 0–16, independent
  trigger levels and stick movement, model changes after reconnecting, original
  driver details, and LCD/desktop/portrait sizing. Both controller slots remain visible.
- Hardware profiles verify that Steam Deck desktop-shortcut guidance appears on
  Steam Deck and stays absent on Windows desktop, ROG Ally and Mac, even when an
  attached controller reports a Steam Deck product name. These are simulated host
  profiles on Windows; they do not substitute for physical handheld/Mac execution.
- The native Gamepad API integration test passes for built-in Controller 1,
  external Controller 2, swapping, saved preferences, assignment-press suppression,
  paused robot inputs during setup and renderer isolation. Transport and Wi-Fi
  behavior are unchanged.

## Testing 2.4.5: live input setup and MotionModule

- 58 Node tests cover controller policy, two persistent slots independent of the
  robot's input count, bounded diagnostics, automatic built-in assignment reset,
  persistence, transports, networking and updates.
- Native input tests verify live stick/trigger/button displays, a test screen that
  stays open after assignment, paused robot outputs during testing, one-controller
  forwarding with Controller 2 on standby, and manual swapping. Diagnostics remain
  in the trusted app UI. Robot pages receive only slot routing and pause state.
- The actual MotionModule Flask app and `/driver-station` page are tested with
  `MockGPIO`. Left-stick forward/strafe and right-stick rotation reach `/api/drive`
  and change simulated motor outputs. Opening input setup stops the outputs;
  MotionModule's configured D-pad stop button also stops them. No robot wiring or
  firmware changes are needed. CI pins MotionModule commit
  `bbd8c33dadcd68256bb98e20437b02a0e99b3a0b` for this integration test.
- Native UI layouts are checked on LCD, desktop, 4K and portrait windows. The input
  test screen includes Steam Deck desktop-mode guidance and generic built-in/USB/
  Bluetooth gamepad guidance for supported Linux, Windows and Apple Silicon builds.
- Mouse/scroll emulation comes from the OS or Steam Input layout. This release
  explains the required gamepad mode; it does not silently change desktop mappings.
  Physical Steam Deck/Mac execution and Bluetooth pairing still need device checks.

## Testing 2.4.4: installation and controller slots

- The GitHub README has three install entries. Steam Deck/Linux and Apple Silicon
  share one platform-detecting Bash command; Windows uses PowerShell. The stable
  URLs resolve the current Main release, with no version in the command.
- Bootstrap fixtures exercise future versioned assets, Linux and Apple Silicon
  selection, old/new Linux installer behavior, exactly one app launch, CRLF
  checksums, corrupt downloads, prerelease rejection, and unsupported hardware.
  A separate PowerShell fixture checks Windows silent installation followed by
  launch, future stable assets, and rejection before execution on verification failure.
- 56 Node tests pass for controller policy, saved data, robot transports, networking,
  and updates. Native UI checks pass at LCD, 4K, and portrait sizes.
- Native Electron checks exercise default Controller 1, optional Controller 2,
  header click/press assignment and swapping, neutral assignment presses,
  disconnect/reconnect, and actual FTC UDP axis delivery. A separate native website
  fixture verifies the selected slots through its own standard Gamepad API,
  Settings input pause, and sandbox isolation. Test controller injection is absent
  from normal app launches.
- This does not validate physical Steam Deck input, Bluetooth radio stability,
  physical robot motion, or execution on Apple Silicon. Those need device tests.

## Testing 2.4.3: built-in handheld controllers

- 49 Node tests pass, including Linux/Windows hardware detection, built-in preference,
  sparse gamepad indices, generic Steam Input identities, no-controller and ordinary-PC
  behavior, manual overrides, disconnects, reconnects, and index reuse.
- Native Electron against a simulated Control Hub passes with LCD, OLED, ROG Ally X,
  and Legion Go device profiles. An external controller is enumerated first. The
  built-in pad's axes arrive over real UDP as User 1 without a button chord; manual
  User 1/User 2 assignments, chord suppression, header slots, and reconnects also pass.
- The native LCD test checks INIT/START/STOP, Settings visibility, heartbeat continuity,
  saved robot reopening, and automatic reopening on the saved network.
- These tests simulate controller and device identities; physical handheld input,
  Steam Input configuration, Bluetooth pairing, and robot motion still need device checks.

## GitHub installation (2.4.2)

- The GitHub README provides Steam Deck, Windows, and Apple Silicon downloads and
  one-line installers directly. A separate download website is not required.
- Bootstrap installers resolve GitHub's latest stable release and use its versioned
  assets and checksums; prerelease tags are refused. The app's existing Main/Testing
  selector remains available after installation, including its experimental warning.
- The real Steam Deck `.run` installs into an isolated directory, creates branded
  desktop/application shortcuts, and preserves saved-data fixtures. This ran under
  Git Bash with a scoped platform fixture, without executing the Linux runtime.
  CI also runs this installer fixture on Linux.

Physical Steam Deck installation and launch remain untested in this workspace.

Validated in this Windows development environment:

- 28 Node tests covering bookmark persistence/migration, same-IP/different-SSID
  records, name preservation, URL validation, password exclusion, NetworkManager
  parsing and connection commands, private temporary password files, original
  HTML/API pass-through, POST actions, cookies, authentication challenges,
  redirects, foreign-origin rejection, and streaming responses.
- Update tests cover testing/main release filtering, version ordering, missing
  platform assets, repository restrictions, verified downloads, checksum fallback,
  corrupt downloads, GitHub errors, and protection of development checkouts.
  Native Electron tests exercise the Updates menu and popup with unpublished,
  current, available, and rate-limit responses plus download verification.
  A real Windows helper test extracts a fixture archive, waits for its launcher
  to exit, replaces files, retains a previous-version backup, restarts a harmless
  fixture executable, and preserves separate saved data.
  Empty-repository responses were checked before the first release was published.
  The Linux helper passes replacement, backup, restart and forced-failure rollback
  shell fixtures under Git Bash; this does not substitute for a SteamOS run.
- Native Electron: the selected original robot webpage appears in a separate
  sandboxed WebContentsView with no Node or launcher bridge exposed. Its origin
  is a Chromium secure context and the Gamepad API is present.
- A test robot's own Initialize button sends its command; the launcher sends
  no initialization or robot control command itself. The real HTTP auth prompt
  accepts credentials. Saved website title/address/network records survive app
  restart and reopen from the saved list.
- Settings hides (does not close) the robot view, and the three-dot menu remains usable above
  the native child view. Responsive layouts have no horizontal overflow at LCD
  Deck, 4K, and phone window sizes.
- Desktop bundle builds verify upstream Electron SHA-256 checksums and check
  executable permissions, macOS bundle metadata, and app entry points. The Mac
  installer performs local ad-hoc signing because the app is not notarized.

Not validated here: physical Steam Deck hardware, SteamOS NetworkManager policy,
real robot motion, Bluetooth controller pairing, or Mac execution/signing on a Mac. Robot
control behavior and watchdogs remain the robot website/firmware's responsibility.
Main 2.4.2 is published. Its Steam Deck and Windows installer downloads pass
live checksum checks. Windows replacement is exercised with local fixtures;
SteamOS/macOS updater execution needs device tests.

Version 2.2 adds native UI checks for scanned Wi-Fi selection, Connect, password prompts, dropdown collapse, automatic network association, a larger update popup, and Main/Testing confirmation. Unit checks verify channel persistence and desktop return to an older Main release. Windows setup and the app launcher embed the robot icon; the Linux single-file installer verifies its included archive.

## FTC Driver Station

Validated in this Windows development environment against a simulated Control Hub
(`tools/ftc-sim.cjs`), which implements the Robot Controller side from the FTC SDK 11.0 sources:

- Byte layouts of peer discovery, heartbeat, gamepad (version 5), command, and telemetry
  packets; discovery, op mode list, active configuration, INIT/START/STOP, gamepad delivery,
  synthetic release gamepads, command retry and duplicate suppression, auto-transition,
  disconnect and reconnect, rejection by a robot with another station, Robocol version
  matching, camera frames, toasts, and telemetry formats (`tests/ftc.test.cjs`).
- Real UDP on port 20884, detection versus a non-FTC address, and the port-in-use error.
- The desktop app (`tests/ftc-app.cjs`): an address is detected and saved as FTC, the
  Driver Station connects (ping and battery shown), an op mode inits and runs on the robot,
  Settings keeps it connected and running, heartbeats continue, Close robot sends STOP,
  and a saved FTC robot reopens without detection.
- The Driver Station screen at 1280×800 in the browser preview: op mode lists, the 30 s
  autonomous timer, auto-transition, and the camera stream.
- Windows Wi-Fi listing: a fresh scan raised the visible networks on this PC from 1 to 20.

Not validated: a physical Control Hub or Robot Controller phone, real gamepads sending
input to a robot (Steam Deck controls, Bluetooth controllers), and SteamOS/macOS UDP behavior.
