# Agent handoff

- Branch: `testing`. Commits are local only and nothing was pushed. `git log --oneline 4c1c039..HEAD` lists this session's work.
- **Apple Silicon Mac (local, with CAD):** `node tools/simulation/fetch.cjs && node tools/simulation/build.cjs`, then the Strafer CAD as in `ui/assets/robots/NOTICES.md` (a Python 3.12 venv in `.cache/cad-venv` has `cadquery-ocp-novtk`), then `tools/simulation/install-local-mac.sh` installs `~/Applications/Torque.app` (old bundle moved to `~/Applications/Torque-backups`). Open CASCADE meshes the STEP slightly differently per OS, so `catalog.json` lists the Windows and Mac hashes.
- The Test setup and the A301 Swerve preset are gone from the app; UI tests still start on the Test setup with `DECK_TEST_SETUP=1`.
- Node is not on PATH. Use `ELECTRON_RUN_AS_NODE=1 .cache/runtime-win32-x64-44.8.0/electron.exe` for tests, `deck-sim`, `build.cjs` and checks.
  - Its Node 24 strips TypeScript types, which is how the Pedro Visualizer's own `.ts` modules were run against Deck's `.pp` output.
- Playwright for probes and the E2E: `C:/Users/angel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`.
  - Run the E2E with `DECK_PLAYWRIGHT=<that path> DECK_ELECTRON=<repo>/.cache/runtime-win32-x64-44.8.0/electron.exe`, then `tests/simulation-ui.cjs` (about 18 minutes).
  - All 16 sections pass.
  - Open a setup in the app with `--deck-sim-open=<file> --deck-sim-tab=plan` and a temporary `DECK_DATA_DIR`, so the user's saved setups are never touched.
- After editing `tools/simulation/java/**`, run `tools/simulation/build.cjs` (about 10 s).
- Real-library compile check: `tools/simulation/check-ftc-sdk.cjs` (needs network; downloads FTC SDK 12.0.0 and Pedro 3.0.2, then deletes them).
- Pedro runtime tests need `tools/simulation/fetch-pedro.cjs` first; it caches into `.cache/pedro/3.0.2`.
- After changing a code generator, regenerate the example exports:
  - `deck-sim export examples/<x>.json --format onbot|pp|pedro --out ...`
  - The output paths match the files already in `examples/`.
- Bash tool quirk: `\\` inside heredocs collapses to `\`. Write edit scripts with the Write tool.
  - The Edit tool and JSON tool arguments can also turn `\u002a` into `*`, so describe unicode escapes in words.
- `output/` (PDF reports and an AdvantageScope `.wpilog` from 21–23 October) predates this session and is untracked. It was left alone.
  - Its `.wpilog` is a handy real file: `deck-sim compare examples/biobuzz-red-auto.json output/advantagescope/biobuzz-red-auto.wpilog`.

## Coordinates (worth knowing before touching .pp or Pedro code)

- **Deck's game fields** are a 144 in square with the perimeter wall inside it: BIOBUZZ's playing area runs from 1.326 to 142.674 (`info.bounds`).
  - This matches Pedro's documented frame (FTC field-centre frame plus 72), so the Pedro Java export uses Deck coordinates as they are.
- **The Pedro Visualizer** draws a 141.5 in field starting at the inner wall.
  - `.pp` files for game fields are therefore shifted by the wall and record it as `deckOrigin`.
  - `fromPP` adds it back. A Visualizer file without `deckOrigin` gets the wall offset on game fields.
- **The Visualizer's own code is the oracle for `.pp` behaviour.** Its `.ts` modules (cloned at commit f953ee0) ran under the Electron Node with type stripping. Re-clone it and copy `utils/normalize.ts`, `pathTraversal.ts`, `headingInterpolation.ts`, `animation.ts` and their imports, with `.ts` added to the import specifiers.

## Odometry conventions (before touching the Pinpoint, OTOS or Pedro constants)

- Deck's robot frame is x forward, y left, heading counterclockwise. `robot.odometry` (in `ui/sim-config.js`) stores only what differs from `ODOMETRY`.
- **Pinpoint:** goBILDA's own `setOffsets` terms. `xOffset` is the forward X pod's inches left of centre, and `yOffset` the strafe Y pod's inches forward. Pedro's `PinpointConstants` take them as they are.
- **OTOS:** SparkFun's offset. `heading` is where the chip's X axis points, in degrees counterclockwise from the front; -90 (the Y arrow forward) is the default.
  - RobotDrive uses it as it is.
  - Pedro's `OTOSLocalizer` adds π/2 to both the offset heading and the pose, so the starter constants pass `Pose(y, -x, h - 180°)`.
  - `tests/sim-pedro-runtime.test.cjs` would catch a wrong mapping. Three wrong ones were tried, and each failed.
- **Virtual hub:** `SimSensors.Pinpoint` and `SimSensors.Otos` are mounted from `hardware().pinpointMount` and `otosMount` (the truth). They compute the pose from what the code configured, so a wrong export setting shows up as a wrong pose. The guided-check tests rely on this.
- **Guided check:** it measures with both Pinpoint pods set FORWARD, and with the OTOS offset at 0 and its scalars at 1. Each reading's change is fit against the turn (least squares over the spin). The 48 in push gives the pod type or the linear scalar.

## The user's request: optimize "lunala red auto"

Done and committed (`examples/lunala-red-auto.json` plus exports in `examples/lunala-red-auto/`).

| Runtime | Before | After |
|---|---|---|
| Simulator follower | 9.98 s | 9.77 s |
| OnBot Java | 10.22 s | 9.83 s |
| Pedro export | 10.25 s | 10.0 s |

- Scoring is unchanged: 40 points, 12/12 shots.
- The user's own saved setup inside the app was not modified. They can open the optimized one with `deck-sim show examples/lunala-red-auto.json --tab plan`, which adds it as a new saved setup.

## Mechanism hardware and Send to robot

- Read `docs/MECHANISM_ACTIONS.md` first. It covers how actions reach hardware, the research, the decision and the one-button plan.
- **One device list.** `F.mechanismDevices(m, robot)` in `ui/sim-ftc.js` is the single list of mechanism devices, and three things are built from it:
  - `Mechanisms.java` (`mechanismsSource`);
  - the virtual hub wiring (`mechanismHardware`, read by `VirtualHub.java`);
  - the robot check (`robotNeeds`).

  Change it there, rebuild with `tools/simulation/build.cjs`, then run `tests/sim-mechanism-hardware.test.cjs`.
- **Mounting is physical truth.** `mount: -1` in the hub JSON means the setup says the device turns the other way, and the code must set REVERSE. The engine only counts forward commands (`src/sim-engine.cjs` programTick). The MotionModule bridge applies the same mounts.
- **The Robocol and OnBot Java formats** came from FTC SDK 12.0 AARs on Maven Central, read with `.cache/simulation-runtime/jdk/.../javap.exe`:
  - `FtcEventLoopBase` handles the configuration commands. `CMD_SAVE_CONFIGURATION` is `<RobotConfigFile JSON>;<XML>`, and it saves and activates.
  - `OnBotJavaProgrammingMode` lists the routes; `SaveFile` takes `f` plus form `data`.
  - A missing file is a 404 with "File Not Found!".
  - `/java/build/start` returns the start time as JSON.
- **Testing Send to robot without a robot:** run `node tools/ftc-sim.cjs 127.0.0.2 --onbot`. In the app, the station must bind 127.0.0.1 to reach 127.0.0.2 (the E2E patches `FtcSocket.prototype.open` for that), and the robot has to be saved as an FTC robot to appear in the list.
- **Another session works in this folder.** It committed `a7dfa9b` (run videos) on `testing` during this work. Stage only your own files.

## One-button setup, phase 2

- **Saving a configuration.** `CMD_SAVE_CONFIGURATION` is split at every `;` by the robot, so the XML may not contain one (an `&amp;` in a name counts). The robot overwrites a configuration of the same name, so `writeConfiguration` refuses any existing name, ignoring case.
- **Hubs are keyed by portal plus address.** The portal is the USB serial, `(embedded)` for a Control Hub. A device's ports come from its tag:
  - motor tags take motor ports;
  - `@ServoType` tags (Servo, ContinuousRotationServo, RevBlinkinLedDriver, RevSPARKMini) take servo ports;
  - digital and analog tags take none;
  - an unknown tag blocks both a motor and a servo port.
- **The check's results protocol** is `v1 key=value ...`. Values are absolute settings (`robot.frontRight.reversed=true`, `intakes.0.downPos=0.150`, `turret.servoDegrees=272.7`, `shooter.pidf=p,i,0,f`), and a value starting with `?` is a problem. Numbers are written with `Locale.US`.
  - The keys come from `mechanismDevices` settings (`list.index.field`).
  - `applyCheck` ignores keys for devices the setup does not have.
- **Testing the check:** `tests/sim-guided-check.test.cjs` runs the real check TeleOp on the virtual hub. Its `operate()` presses buttons for 3 ticks and reads `e.hubDevices`. If a step's wording changes, update the operator's patterns (`A: yes | B: no`, `D-pad up/down: move`, `D-pad left/right: turn 1 degree`).
- **`tests/robot-setup-app.cjs`** is the app test for Send to robot and the Guided check (about 1 minute). It uses robot 127.0.0.6, station 127.0.0.7 and CDP port 9337, so it can run beside the other app tests.
- **The SimTelemetry value limit** was raised to 4000 characters, because a results line is longer than the old 200.

## Mechanism engine (universal)

- **Read these first.** `docs/MECHANISM_ENGINE.md` is the design. `docs/MECHANISM_RESEARCH.md` has the sources, the decisions, the test coverage, the limits, and the iteration log from 7 on.
- **Actuator values are in joint units.** `ratio` (from `transmission` stages) is used only for motor-model conversion and for encoder counts. A motor's free speed and stall torque are the datasheet figures at the motor shaft; load and inertia are entered at the joint.
- **`Driver.values()` returns only driven joints.** Pass them to `pose()`, which sets coupled joints and solves loop joints. Giving `pose()` a value for every joint holds loops open.
- **Robot files:**
  - `ui/sim-robot-formats.js` reads SDFormat, MJCF and text USD into one description (`links`, `joints`, `loops`, `couplings`, `actuators`, `notes`), then builds the body and the joints. URDF stays in `sim-urdf.js`.
  - Fixtures: `tests/fixtures/scara.sdf`, `fourbar.sdf`, `arm_mjcf.xml`, `fourbar_mjcf.xml`, `gripper_arm.usda`.
- **Checking in the app:**
  - Use Playwright `_electron` with a temporary `DECK_DATA_DIR`.
  - Choose the empty layout via `#sim-field`. On BIOBUZZ, Moving parts shows only when game mechanisms are on.
  - Stub `dialog.showOpenDialog`, click `#sim-model-open` then `#sim-start-yes`, and wait for `#sim-model-import-status` to change.
  - Open the `mechanisms` setup step; the panel host is `#mech-joints`.

## Next steps

AGENT_BACKLOG.md is in priority order.

## Route steps (pins and paths with several mechanism steps)

- **Steps are the source of truth.** `pin.steps` and `pin.path.steps` are `[{action, seconds|null, cell}]`. `planner.pinEffects` / `pathEffects` derive the old single `action`, `actionSeconds` and `cell` from them, so every runtime that reads one action still works. Several steps are joined into one name: "Shoot then Ramp down" (a pin: one after another) or "Intake + Ramp down" (a path: together). Step names cannot contain → or +.
- **Where they run.** `Export.legs` gives each leg `steps` (pin) and `moving.steps` (path), and `Export.sequences(route)` lists them. `Mech.Runner.steps()` runs them in the simulator (route and timed programs); it starts moving-part steps through the engine's `kin` (`joints` hook). RouteActions.java has a `Steps` helper, and MotionModule's autonomous.py has `STEPS` and `call_steps`. The Java route follower waits up to 30 s (`MECHANISM_LIMIT`) for a pin's steps.
- **Ramps.** A ramp moves only on Ramp down / Ramp up (`cmd.ramp`, latched in the Runner; Y in teleop). Intake runs only the rollers, and a raised ramp still takes floor pieces; a ramp has to be down to reach a flower. A kicker still follows Intake.
- **New built-in actions:** "Ramp down", "Ramp up", "Turret to 30°", "Turret 2 to -45°", "Wait", and "<part> to 40°" / "to 4 in" (`Kin.Driver.start`, clamped to end stops).
- **UI.** `ui/sim-steps.js` is the step editor (catalogue, rows, add chips). The route list in `ui/simulation.js` puts a pin row (`.sim-stop-row`, `data-pin`) under each path row; `openPart` says which one is open. Tests: `tests/sim-route-steps.test.cjs`.

## One Mechanisms list (26 October)

- **Setup → 3 · Mechanisms** is one list on every field, with **+ Add mechanism** and **Configure from CAD** at the top. Read `docs/MECHANISM_RESEARCH.md` §8 first.
  - `ui/sim-mechanism-list.js` draws the moving mechanisms' cards and the picker.
  - `simulation.js` draws the BIOBUZZ intake and shooter cards into the same list (`#mech-intakes`, `#mech-shooters`, `#mech-parts`).
  - The right-hand **Moving parts** panel (`sim-joints.js`) still holds every joint's geometry, but no longer has its own + Add.
- **Actuators.** `ui/sim-actuators.js` (`DeckActuators`) holds the FTC motor and servo models.
  - It also has the servo math: positions sent with 600–2400 µs by default, `perUnit`, `position`/`valueAt`, `limits`, and encoder counts through gearing (`countsPer`, `ticks`).
  - `device(actuator, states)` is what exporters should read.
  - Kinematics actuators keep `model`, `device`, `reversed`, `servo{min,max,center,range,pwm,pulse}`, `cpr` and `power` (`hardwareOf` in `sim-kinematics.js`).
- **Configure from CAD:**
  - `DeckMechanismTypes.likeness` scores names.
  - `DeckDiscovery.discover({want})` marks the joint found for each added mechanism with `for` and `matched`.
  - `sim-joints.js` `adopt`/`takeGeometry` merges it into the team's joint, and `DeckMechanisms.adoptCad` merges the game's intakes and shooters.
- **The other session** (route steps, `sim-steps.js`) committed its work first. Both sessions staged only their own hunks of shared files (`simulation.js`, `simulation.css`, `sim-mechanisms.js`, `sim-kinematics.js`, `index.html`, `preview.cjs`, `docs/SIMULATION.md`).
- **Probes** of the team's lunala CAD drive Playwright on Electron with a temporary `DECK_DATA_DIR`:
  - copy `%APPDATA%/Deck Driver Station/simulation/models/4c16d882bfb3dfcaff8f3de412161d8a.glb` into `<dir>/simulation/models/`;
  - launch with `--deck-sim-open=<copy of examples/lunala-red-auto-cycles.json> --deck-sim-tab=setup`;
  - wait for `#sim-mesh-size` to say "fitted", click `[data-setup-step=mechanisms]`, then `#mech-add`, a `#mech-picker [data-v=…]` tile and `#mech-from-cad`;
  - read `#mech-list-status`.

## Set up from the Control Hub (27 October)

- **One button, hub plugged in by USB.** "Set up from the Control Hub" is in Setup → Mechanisms, and also in Robot controller → The robot's configuration.
  - It reads the active configuration over USB (`robot-link read-usb`).
  - `ui/sim-hub-setup.js` (`DeckHubSetup.plan`/`apply`) matches every Setup row to a configured device by name and kind, then takes the device's name, hub and port.
- **What it matches:** drive motors, steering, the IMU, Pinpoint and OTOS, mechanism devices (intakes, shooters, kinematics actuators) and their sensors.
  - A drive motor matches on direction words only (frontLeft, LF, left_front_drive); any other word in the name rules it out.
  - Other devices match on shared name words, and a left device never matches a right one.
  - A robot sensor Setup lacks is added to the device its name is about.
- **What else it sets:** a Pinpoint or OTOS on the robot sets the localization. The Expansion Hub (or Servo Hub) mirrors the robot. A motor type that names exactly one model sets that model.
- **No hub plugged in:** the status line says to plug it in with a USB-C data cable.
- **Preset robots** set up the chassis only. In Mechanisms, "Edit the chassis motors" shows only the drive motors: their names, models and ports, plus the hub button. The preset's mechanisms stay locked.
- **Tests:** `tests/sim-hub-setup.test.cjs`. The app probe stubs `ipcMain`'s `robot-link` with a configuration XML; no hub was plugged in.
