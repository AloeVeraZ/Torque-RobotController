# FTC robots (REV Control Hub / Robot Controller)

Torque includes its own FTC Driver Station. It is used only for FTC robots;
your other robots keep opening their own website.

## Setting up an FTC robot once

FTC robots make their own Wi-Fi network (named like `1234-RC`) and always sit at a fixed
address on it: a Control Hub is `192.168.43.1`, and a Robot Controller phone using Wi-Fi
Direct is `192.168.49.1`.

1. In Settings, join the robot's Wi-Fi.
2. Under **Robot type**, choose **FTC · Control Hub**. The address is `192.168.43.1`; for a
   Robot Controller phone press **Use a different address** and enter `192.168.49.1`.
3. Press **Open on Wi-Fi**, or plug the Control Hub's USB-C into this computer and press
   **Open on USB**. Drive shows the Driver Station; the banner turns green:
   **Robot Connected**.

## After that: just join its Wi-Fi

Like the FTC Driver Station app, a saved FTC robot needs nothing else. The moment this device
joins that robot's Wi-Fi again, the app switches to Drive and connects. Because a Control Hub's
Wi-Fi comes up before its software is ready, the app keeps checking every few seconds until the
robot answers. Closing the robot stops the automatic connection until the network changes.

## How the app tells robots apart

The **Robot type** choice decides it directly. When **Other robot** is chosen and an address is opened
for the first time, the app sends an FTC
*peer discovery* message to UDP port 20884. A Robot Controller always answers it, so:

- **Answer received** → the robot is saved as **FTC** and the Driver Station opens in Drive.
- **No answer within 1.5 s** → the robot is saved as a **Website** and its own page opens.

The type is remembered with the saved address, so later opens skip the check. Editing the
address clears the remembered type and the check runs again. The FTC robot's code stays on the
robot; the op mode list, telemetry, and controls come from the robot over the network.

## The Driver Station

The screen follows the REV Driver Hub layout: dark red panels, side by side on the Deck and
desktops, stacked on narrow windows like the phone app.

| Area | What it does |
| --- | --- |
| Top bar | Driver Station name (`9999-C-DS` for robot network `9999-C-RC`), **Robot Connected** banner, Network, Ping, signal, User 1 / User 2 gamepads, Close robot, fullscreen, ⋯ menu |
| Practice Timer | 2:30 match clock with ▶: start at Autonomous (3 s lead-in), the Auto → TeleOp transition (8 s), TeleOp (2:00), or Endgame (last 30 s). Beeps mark each change. It runs independently of op modes |
| Config tile | The robot's active configuration, or `<No Config Set>` |
| ▼ Select Op Mode ▼ | Left ▼ lists Autonomous op modes, right ▼ lists TeleOp, grouped like the FTC Driver Station |
| INIT → START → STOP | The white circle walks through the op mode lifecycle; the small ■ button aborts INIT |
| Stopwatch and switch | Autonomous 30 s timer: on by default for Autonomous, stops the op mode after 30 s |
| DS battery | This device's battery, when it has one |
| Robot battery | Voltage now and the lowest seen (green; yellow below 12 V; red below 11 V); a phone Robot Controller's battery is also shown |
| Status | `Robot is stopped` / `Initialized …` / `Running …`, robot errors and warnings, then the op mode's telemetry (classic, monospace, and HTML formats) |
| ••• menu | Restart Robot, Program & Manage, Camera Stream, Gamepad assignment, About |

- **Gamepads (Testing 2.4.5):** Controller 1 (`gamepad1`) defaults to recognized built-in
  handheld controls, or the OS's first standard gamepad. This also works on ordinary
  computers and unknown handhelds. Both header slots stay visible. Click a slot to
  test its sticks, triggers and buttons; choose **Assign/Reassign**, then press a button
  to select a pad. The test screen stays open until **Done**. Manual choices are saved.
  Each saved robot defaults to one controller. Select **Two controllers** in its
  Settings to send Controller 2 (`gamepad2`) to the robot; it can be assigned on standby
  beforehand. Choosing the other slot's pad swaps the two. Assignment presses stay
  neutral until buttons are released and sticks centered.
  Inputs are sent only while the Driver Station is visible and
  focused. Opening Settings, a dialog, or another window sends the gamepads back to rest.
- **Auto-transition:** when an Autonomous op mode with `autoTransition` stops, its TeleOp is
  selected and initialized automatically.
- **Program & Manage** opens the Robot Controller's own web page (port 8080) above the Driver
  Station; **← Driver Station** in the toolbar returns. The robot connection stays up.
- **Space** stops an initialized or running op mode.
- Rumble, robot toasts, dialogs, crash stack traces, progress, text-to-speech, and camera
  frames from the robot are shown or played.

## Safety behavior

- Closing the robot, switching Wi-Fi, or quitting sends STOP before the connection closes.
  The robot also stops on its own when it hears nothing for 2 seconds.
- Settings hides the Driver Station without disconnecting, so a running op mode keeps running
  with gamepads at rest. Use STOP first if the robot should not move.
- If another Driver Station is already connected, the robot refuses this one and the screen
  says so; nothing is sent to the robot.

## Compatibility and limits

- Speaks Robocol, the FTC SDK network protocol, version 124 (SDK 10.x–11.x). Robots on other
  recent SDK versions are matched automatically; versions before 121 are refused.
- One Driver Station app per computer: the protocol requires UDP port 20884. Close other FTC
  Driver Station apps or emulators first. Windows may ask to allow the app on private networks.
- This is an independent implementation written from the published FTC SDK sources. It is not
  the REV Driver Hub software and is not certified for FIRST competitions; event rules may
  require an official Driver Station.
- Not implemented: editing a robot configuration device by device, Wi-Fi channel/password
  changes, firmware updates, Self Inspect, match logging, and gamepad LED effects. The simulator's
  Send to robot (below) saves new configurations, but never changes or replaces a saved one.

## Sending an autonomous from the simulator

Simulation → Run & review → Export → **Send to robot** puts an OnBot Java autonomous and its
check TeleOp on a Control Hub, over its USB cable or its Wi-Fi: the panel looks for a hub on USB and
for a robot network, and picks what it finds (USB first). It reads the robot's active configuration with the
same commands the FTC Driver Station uses (`CMD_REQUEST_CONFIGURATIONS`,
`CMD_REQUEST_PARTICULAR_CONFIGURATION`) and checks every device name the code uses. A device the
robot does not have goes into a new configuration: Deck scans the hubs (`CMD_SCAN`,
`CMD_DISCOVER_LYNX_MODULES`), plans a port for each device, and saves and activates the result
(`CMD_SAVE_CONFIGURATION`, then `CMD_RESTART_ROBOT`). Then it uploads and builds the files with
the hub's own OnBot Java server on port 8080, and Drive selects the new autonomous the next time
the robot is opened. It never starts the autonomous.

**Calibrate** (step 3 of the Setup & Calibrate tab) has the same Send to robot panel, then the **Guided check**,
a list of what the check measures for the setup, the on-robot checklist, and gamepad stick
calibration. The guided check runs the check TeleOp: INIT and START as a Driver Station,
each question shown with buttons that press gamepad 1 on the robot (Controller 1 answers too), STOP
or Space to stop. With odometry pods, a Pinpoint or an OTOS, its last steps are on the floor: two
pushes by hand and one turn on the spot find which way each pod counts and where each one sits.
The answers are put into the setup. Close the robot in Drive first, because only
one Driver Station can talk to a robot at a time. See
[the simulator guide](SIMULATION.md#send-to-robot).

`node tools/ftc-sim.cjs 127.0.0.2 --onbot` also serves a simulated OnBot Java on port 8080, with a
robot configuration (or none, with `--empty`), a hub scan, and a stand-in for the check TeleOp,
for trying it all without a robot.

## Testing without a robot

```bash
node tools/ftc-sim.cjs 127.0.0.2
```

This runs a simulated Control Hub on `127.0.0.2`. Open that address in the app or the browser
preview. `node --test tests/ftc.test.cjs` covers the protocol, and `node tests/ftc-app.cjs`
drives the desktop app against the simulator.
