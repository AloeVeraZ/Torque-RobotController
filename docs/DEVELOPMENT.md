# Development and how it works

The technical detail that used to live in the README.

## Why the local bridge exists

Many robots serve plain HTTP. Chromium restricts browser gamepad access on an
ordinary insecure IP origin. The desktop app transparently streams the selected
robot's HTTP, API, camera, and same-port WebSocket traffic through loopback. The
robot still supplies the HTML, JavaScript, controls, sessions, and safety behavior.
Nothing is hosted in the cloud.

Robot content has no Node access or desktop settings API. A narrow data-only
input bridge supplies controller slots; assignment stays in the app's UI.
The desktop uses a separate sandboxed WebContentsView, so robots with frame
restrictions still work. Robot browser cookies are isolated by network/address.
Robot passwords are never stored in the address JSON. The app does not bypass
invalid HTTPS certificates. Wi-Fi passwords are handled by the OS/network service.

Opening Settings hides the robot without disconnecting it; Drive shows it again.
Changing networks, opening Updates, or closing the robot closes its view and
transport (an FTC robot is sent STOP first). The robot's own stop/watchdog
behavior remains authoritative.
No launcher can provide a hardware emergency stop for an arbitrary robot website.

Once detected by the station, controllers stay assigned across robot reloads and Close robot/reopen.
The station forwards their current input to the robot; each robot page needs no separate controller activation.

Sleep or a lost Wi-Fi connection keeps the selected robot's address and network.
After reconnecting Wi-Fi, choose **Try again** to reopen it without restarting the app
or retyping its address. Controls stay neutral until held sticks/buttons are released;
robot enable and initialization are never automatically restored.

Robot-hosted Wi-Fi can use [Find robot automatically](DISCOVERY.md) in Settings.
It is opt-in and checks the hotspot gateway only; home/shared networks keep manual or saved addresses.
Controller setup includes [drift measurement and app deadzones](CONTROLLERS.md#calibration-and-steam-deck-navigation).

## Controller behavior

Controller 1 is the default. Recognized built-in handheld controls are preferred; if the OS
exposes an ordinary Xbox-style controller or an unknown handheld, its first standard gamepad
is selected. Both controller icons are always visible. Click one to open its live test screen:
sticks, triggers, and buttons show their standard gamepad names, indices, and values.
Choose **Assign/Reassign** and press any button on the desired pad. Selecting the other
slot's pad swaps them. The assignment press is suppressed until buttons are released and
sticks centered. **Use automatic assignment** restores the preferred built-in Controller 1.
The test screen stays open until you close it and holds robot gamepad outputs at rest.

Input support follows the actual **standard Gamepad layout** reported by Electron,
without a brand allowlist. Unmapped devices are available for raw diagnostics, but their robot
outputs stay neutral. Use a supported gamepad mode (Logitech **X**, or Steam Input **Gamepad**) and reconnect.
See [controller support and limitations](CONTROLLERS.md) and the
[100-profile software regression catalog](CONTROLLER-PROFILES.md).

Saved robots default to **one controller**. Choose **Two controllers** in that robot's Settings
when it needs a second operator. Slot assignment applies to the FTC station and websites
using the standard Gamepad API; a custom USB, Bluetooth, or proprietary robot protocol needs
its own compatible integration. Browser gamepad visibility may require pressing a button first.
Two identical controllers without distinct OS identities may need reassignment after reconnecting.

The expand button between **Close robot** and the robot-view label opens **robot-only
fullscreen**. Only a corner **×** remains. Click it or press **Esc** to restore the
previous app view; the robot page and controller assignments remain open. The three-dot
menu's **Toggle fullscreen** still controls the whole app independently.

**Steam Deck desktop shortcut:** keep Steam running and hold **☰ Menu** until Gamepad Mode
appears, then press **A**. In Desktop Mode, Steam can map sticks to the mouse and scroll;
the app needs gamepad input. Verify both sticks in the test screen before returning to Drive.
For Gaming Mode, add the app to Steam and use a **Gamepad** layout with both sticks as joysticks.
Windows/Linux handheld utilities and Steam Input layouts need the same gamepad output mode;
external controllers pair through the OS. The app does not change system-wide desktop bindings.
See [Steam Input's gamepad emulation documentation](https://partner.steamgames.com/doc/features/steam_controller/steam_input_gamepad_emulation_bestpractices).

The Apple Silicon package is not Apple-notarized; approval may be required in Privacy & Security.
See [full setup](QUICKSTART.md), [website compatibility](COMPATIBILITY.md), and
[validation and remaining device checks](VALIDATION.md). The theme and scope are in the [design audit](DESIGN.md).

## Building and testing

Use **⋮ → Updates → Check for updates**, then **Download update**. The app verifies
the download, installs it automatically, and restarts. Builds from `main` follow the **Main** (stable) channel; builds from `testing` follow **Testing**.
Checks distinguish no published release, current version, available version, and
network/access errors. A robot hotspot without internet cannot check GitHub.
See [update and release setup](UPDATES.md).

New work belongs on `testing`; approved changes merge into `main`.
Public install commands always read Main and select its latest stable release.
Testing remains available through the installed app's Main and Testing buttons.

```bash
npm install
npm start
node --test tests/*.test.cjs
node tools/preview.cjs
```

The browser preview runs at `http://127.0.0.1:8787`; native Wi-Fi controls and the
native HTTP authentication dialog require the installed app.

```bash
python3 tools/icons.py                 # Pillow; rasterize the existing robot SVG design
python3 tools/package.py --target all  # Linux, Windows, Apple Silicon
```

The desktop builder verifies official Electron runtime checksums. It preserves
Mac executable/symlink metadata and Linux executable bits. Native desktop integration
tests use `DECK_ELECTRON` and `DECK_PLAYWRIGHT` paths with `node tests/ui.cjs`.

| Code | Purpose |
| --- | --- |
| `src/main.cjs` | Desktop browser view, authentication prompt, narrow settings IPC |
| `src/library.cjs` | Saved website/network associations and v1 data migration |
| `src/network.cjs` | Platform Wi-Fi connection helpers |
| `src/robot-proxy.cjs` | Single-target streaming loopback transport |
| `src/ftc.cjs`, `src/ftc-preload.cjs` | FTC detection and UDP 20884 bridge for the Driver Station page |
| `ui/ftc/` | FTC Driver Station page and Robocol protocol (desktop app and browser preview) |
| `tools/ftc-sim.cjs` | Simulated FTC Control Hub for tests and previews |
| `ui/` | Drive/Settings shell and original robot icon |
| `packaging/` | Per-user installers and shortcuts |

The FTC Driver Station is an independent implementation of the FTC SDK's Robocol
protocol, written from the published SDK sources. It is not REV or FIRST software and
is not competition-certified: [FIRST reference](https://ftc-docs.firstinspires.org/en/latest/control_hard_compon/ds_components/index.html).
