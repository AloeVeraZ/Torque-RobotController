# Install and use Torque 2

Download the **Main** installer directly from the [GitHub README](../README.md#%EF%B8%8F-download),
or paste one line into a terminal:

- Steam Deck / Linux and Mac: `curl -fsSL https://raw.githubusercontent.com/AloeVeraZ/Torque-RobotController/main/install.sh | bash`
- Windows (PowerShell): `irm https://raw.githubusercontent.com/AloeVeraZ/Torque-RobotController/main/install.ps1 | iex`

The sections below describe the downloadable packages and manual setup.
All initial installs use the latest stable Main release. After installing, open
**⋮ → Updates → Testing** and accept the experimental warning to change channels.
Return to **Main** from that same menu. Saved robots and Wi-Fi settings are kept.
These commands contain no version number and continue to work for future stable
releases. Close the app before running an installer again; saved data is kept separately.

## Steam Deck LCD / OLED and Linux x64

1. Download `DeckDriverStation-2.4.2-SteamDeck.run` onto the Deck.
2. In Desktop Mode, open a terminal in your Downloads folder.
3. Run `bash DeckDriverStation-2.4.2-SteamDeck.run`. It verifies its payload and creates desktop and application-menu shortcuts. The tar archive remains available for portable use.
4. Launch **Torque**. To use Gaming Mode, add it through Steam's
   **Games → Add a Non-Steam Game**. If needed, browse to
   `~/.local/share/deck-driver-station/launch.sh`.
5. Select a **Gamepad** template with both sticks set to joysticks and leave Proton disabled.
   Use the screen to navigate. In Testing 2.4.10+, tapping a text field opens the app's
   touch keyboard; **Steam + X** remains available for the system keyboard.

The app runs natively without root or changes to SteamOS's read-only system.
The LCD and OLED Decks both have 1280×800 built-in screens; the app also resizes
for docked displays and display scaling. The installer includes its own runtime.

### Desktop shortcut: sticks scroll or move the mouse

Keep Steam running. Hold the Deck's **☰ Menu** button until Gamepad Mode appears,
then press **A**. Click **Controller 1** in this app to see its live test screen.
Left X/Y should follow the left stick; Right X/Y should follow the right stick.
If the default desktop layout was customized, restore it in Steam's Controller →
Desktop Layout settings, or launch this app through Steam with a Gamepad layout.
The app cannot turn mouse/scroll events back into the original joystick positions.

## Windows

Download and double-click **DeckDriverStation-2.4.2-Windows-Setup.exe**.
It installs per-user with no administrator account, a robot icon, desktop and Start
menu shortcuts, and an entry in Installed apps. For a silent terminal install, run
`.\DeckDriverStation-2.4.2-Windows-Setup.exe /S`. The portable ZIP also includes
**DeckDriverStation.exe** and **Install-Windows.cmd**.
Keep the complete `app` and `runtime` folders together. No administrator account
or separate Node installation is required. Unsigned personal software may be
subject to your Windows application policies.

## Mac

Use the **arm64** build for Apple Silicon. Extract the ZIP and run
**Install-Mac.command**. It copies the app into `~/Applications`, ad-hoc signs it
using macOS's `codesign`, and creates a desktop link when one is not present.

This is a personal build, not Apple-notarized. If macOS requires explicit approval,
use **System Settings → Privacy & Security → Open Anyway** for this app. The
installer does not disable Gatekeeper or change global security settings.
Local-network access may require macOS's normal permission prompt.

## Daily workflow

**⋮ → Settings → Wi-Fi → robot address → Open robot.** Enter an IP such as
`192.168.4.1`, a hostname such as `pushbot.local`, or a full URL including a port
or path. No robot protocol or type is selected: an FTC Control Hub (usually
`192.168.43.1`) is recognized and opens the [FTC Driver Station](FTC.md); any other
address opens the robot's website. Names can be left blank; desktop builds take the
robot website's title after it opens. A name you type always overrides that title.

The app caches the robot name, final address, associated Wi-Fi, and last-opened
time. Saved entries can be searched, edited, deleted, and opened. Entries on the
current network appear first, and Settings shows them as a grid of cards under the
connection steps; the grid wraps into rows and scrolls when it fills. Robots on different hotspots can share the same
`192.168.4.1` address without overwriting one another.

In desktop Settings, open the Wi-Fi dropdown, select a nearby network, and press
**Connect**. Saved credentials are tried first; enter a password if requested.
The dropdown closes after connecting. The robot form associates its address with
the current network automatically; there is no editable associated-SSID field.

On desktop, **Open** first tries OS-saved credentials when a network switch is
needed. If a password is needed, the app prompts for it and then opens the robot.
Linux uses NetworkManager, Windows uses saved WLAN profiles, and macOS uses the
system network service. Enterprise Wi-Fi or restrictive system permissions may
require **System Wi-Fi settings**. macOS scan APIs and Windows SSID visibility
vary with OS permissions. On Windows the app asks for a fresh scan each time the
list opens, so it takes a few seconds; Windows 11 may require Location access for
desktop apps before it reveals nearby networks.

For website authentication, ordinary login forms appear within the robot page.
HTTP authentication challenges open a username/password prompt. Robot passwords
are not saved in the address list. The browser's robot-specific cookie storage
can retain website sessions; HTTP authentication may ask again after reopening.

### Setup & Calibrate

One tab, three steps. **1 Setup** picks the robot control system, checks the connection over USB-C or Wi-Fi, and **Scan** shows what is connected, as Configure Robot's Scan does on a Driver Hub. **Available configurations** lists the ones on the robot, to edit, activate, delete or make new. **2 Configure** edits one, port by port on each hub, with only the parts a Control Hub allows. **3 Calibrate** works on the real robot. Over USB-C this needs ADB, which the REV Hardware Client installs.

**Calibrate** has a **Debug** tab with **Live debug**, and a **Calibrate** tab with two more.
**Electronics** reads the Control Hub (Set up from the Control Hub over USB-C), shows every motor, servo and
sensor with its port, and runs the guided check. In **Live debug**, put Torque Debug on the robot once, start it, and every
port reads live while motors and continuous servos run only while you hold their slider. **Mechanisms** unlocks
once the hub is read and walks each mechanism through the steps its sensors allow (confirm it, its direction,
units, zero, range, feedforward, feedback, sensor thresholds, commit). Put the robot on blocks first.
See [CALIBRATION.md](CALIBRATION.md).

## Drive view and controllers

For an FTC robot, Drive shows the built-in [FTC Driver Station](FTC.md). Otherwise,
the page displayed is served by your robot. **Initialize, Teleop, Auto, Enable,
STOP, mechanisms, and camera controls belong to that page.** The launcher sends
none of those commands on its own. Header controls only reload, navigate back,
close the page, or open the three-dot settings menu.

Controller 1 defaults to recognized built-in handheld controls, with the first
standard gamepad as a fallback on other devices. Both slots stay visible. Click an
icon for the live test screen, then use **Assign/Reassign** to choose a pad. The test
screen stays open after assignment, and **Done** returns to Drive. Saved robots default to one controller;
select **Two controllers** in that robot's Settings for a second operator. Controller 2
can be assigned on standby before it is needed. Choosing the other assigned pad swaps slots. The assignment
press is consumed until buttons are released and sticks centered. Manual preferences
are saved in `controller-settings.json` in the user-data directory.
Bluetooth/USB pairing is handled by the OS. Standard Gamepad API websites receive
Controller 1 at index 0 and Controller 2 at index 1. The robot must implement its own
second-operator behavior; proprietary controller APIs require a compatible integration.

Opening Settings hides the robot without disconnecting it; press Drive to return.
Changing Wi-Fi or closing the robot closes its transport (FTC robots are sent STOP).
The robot's firmware must stop stale commands when a client or network disappears.
Keep the robot's normal physical stop/power controls available.

## Saved data and updates

Use **⋮ → Updates → Check for updates**. Stable builds follow Main releases (Testing builds follow testing releases)
from GitHub. **Download update** verifies the package, automatically installs it, and restarts
the app. Saved robot data is retained. No update is available until a
release is published. [Release setup](UPDATES.md).

Desktop settings normally live in Electron's **Torque** user-data
directory: `~/.config` on Linux, `%APPDATA%` on Windows, and
`~/Library/Application Support` on Mac. `robots.json` stores bookmarks and SSIDs,
not passwords.

Close the old app before rerunning an installer. Version-one saved custom robots
and edited addresses migrate to generic website entries. Remove the installed application
and its shortcuts to uninstall; remove the user-data directory separately if you
also want to discard the saved robot library.

## Windows: reinstalling over a sandboxed copy

If the desktop shortcut shows a blank page icon, the app was installed by a sandboxed program
(for example an AI coding app) into that program's private folder. Close Torque,
then double-click **DeckDriverStation-<version>-Windows-Setup.exe** in File Explorer. It installs
to the normal location and replaces the shortcuts; on first start the app brings over the robot
list saved by the sandboxed copy.
