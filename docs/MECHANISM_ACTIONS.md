# Mechanism actions: from a path pin to a spinning motor

How Intake, Spin up, Aim and Shoot get from Path planning to the motors and servos on a real robot,
what could stop that from working, what other path planners do, and how a Control Hub is set up
with one button. Written 24 October 2026; phase 2 (configurations, the guided check, Drive
selection) and phase 3 (where the odometry sits) added the same day.

## Short answer

- **The path planner decides when and where.** A pin or a path says "Shoot here" or "Intake while
  driving this path", and for how long. Every planner works this way: PathPlanner, Road Runner and
  Pedro Pathing all leave the mechanism code to the team.
- **Deck goes one step further for common mechanisms.** Setup → Mechanisms describes the hardware
  (which motors and servos, their names, which way they turn, servo positions, flywheel speed), and
  the export writes the mechanism code from that. No code is needed when the robot is built the way
  the settings describe.
- **Anything else is the team's code, in one known place.** Every action has a method in
  `RobotActions`. A team overrides just the action its settings cannot describe, and keeps Deck's
  code for the rest.
- **Before this change, the generated code assumed one robot design.** It worked for that design
  only: a motor intake, a single-motor flywheel with an encoder, a motor or continuous-servo feeder,
  and every mechanism motor turning forward. A robot built differently would crash at INIT or run
  something backwards. This change describes the common variants and adds a way to test each device
  on the robot.
- **One-button setup is built (phase 2).** The app is already an FTC Driver Station. The FTC SDK
  lets a Driver Station read and save the robot's configuration and scan its hubs, and the Control
  Hub's OnBot Java server accepts uploads and builds over Wi-Fi. Send to robot checks every name
  against the robot, takes the robot's own names, and adds any missing device to a new configuration
  with the port to plug it into. It then uploads and builds the code and selects the autonomous in
  Drive. What settings cannot tell (which way each motor turns, servo positions, the real flywheel
  speed, the turret's encoder, where the odometry sits) needs the robot itself. The guided check
  finds each one from a yes or no answer, a servo moved into place, or the robot pushed by hand and
  turned on the spot, and puts it into the setup.

## How an action runs today

1. **Path planning.** A pin has a pause and an action ("Shoot", "Intake", "Spin up", "Aim" or your
   own name) with a time (0: until it finishes). A path can be an action path: its action runs while
   the robot drives it, for the whole path or a set time.
2. **The export's OpMode** drives the route leg by leg. While it drives an action path it calls that
   action every loop. At a pin it settles, pauses, then calls the pin's action every loop until it
   reports done or its time is up. The follower keeps running in every loop, so the robot holds its
   position at a pin and keeps following a path while an action runs.
3. **`RouteActions.run(name, step)`** sends the action to its method by name (`shoot`, `intake`,
   `spinUp`, `aim`, or a method for your own action).
4. **`Mechanisms.java`** does the hardware part. It never waits or sleeps, so the follower never
   stops. Each method below is called again on the next loop.

| Action | What the robot does |
| --- | --- |
| Intake | Every intake roller runs at its power. Kickers and ramps go to their down positions. When the action ends the rollers stop and the servos go back up. |
| Spin up | The flywheels start toward their speed, and the action finishes at once (the flywheels keep spinning). |
| Aim | Each turret turns toward the hive cell from the robot's current position, measured from the turret's own spot on the robot. |
| Shoot | Spin up and aim. Once every flywheel is at speed, the turret has arrived and the last intake's pieces have had the transfer time to move up, the feeder runs long enough for N shots. Then the feeder and flywheels stop. |

**How "at speed" is decided.** With an encoder, the flywheel runs with the motor controller's own
velocity control (`RUN_USING_ENCODER` and `setVelocity`). The SDK's control loop on the hub ramps
the power up and holds the speed. `ready()` is true once the measured speed is within the tolerance
(5%). If it never gets there, shooting starts anyway after the spin-up time plus half a second, so a
low battery cannot freeze the autonomous. Without an encoder the flywheel runs at a set power and
counts as ready after the spin-up time.

**How the number of shots is decided.** There is no piece sensor, so it is timed. The first piece
is already in the shooter and fires as soon as the flywheel and turret are ready. Each next piece
needs the indexing time to move up. "Shoot 3" feeds for 2 × indexing time plus a short margin.

The simulator runs the same rules with the same numbers, which is why a route's simulated time
matches the exported code's time.

## What stopped it from working on a real robot

The generated `Mechanisms.java` (before this change) had these limits:

| Problem | What happens on the robot |
| --- | --- |
| No motor directions for mechanisms | Every mechanism motor ran FORWARD. A roller mounted the other way spits pieces out, and a flywheel spins backwards. |
| Intake rollers had to be DC motors | An intake on a continuous servo (common in FTC) crashed at INIT: `hardwareMap.get(DcMotorEx.class, ...)` finds no motor with that name. |
| One flywheel motor per shooter | The second motor of a two-motor flywheel was never driven. |
| The flywheel needed an encoder | With no encoder cable, velocity control drives full power and "at speed" is never reached, so it fell back to the timeout. |
| Feeders had to be a motor or a continuous servo | A servo pusher that flicks each piece in, or a servo gate, crashed at INIT. |
| Turrets had to be motors with encoders | A servo turret crashed at INIT. |
| Velocity control used the SDK's untuned defaults | REV notes the hub's preset PIDF assumes a freely spinning motor. A heavy flywheel recovers slowly between shots. |
| Device names were fixed, and drive motor names could not be changed at all | Any name that differs from the robot's configuration crashes at INIT with "Unable to find a hardware device". The Pedro and Road Runner quickstarts use `leftFront`, `leftRear` and so on, while Deck used `front_left`. |
| Nothing to test on the robot | Directions, servo positions and flywheel speed could only be found by running the whole autonomous. |

The virtual Control Hub could not catch any of this. It builds its devices from the export's own
list, so the code and the virtual robot always agreed even when the real robot would not.

## What other planners do

| Planner | Where it puts mechanism actions | Who writes the mechanism code |
| --- | --- | --- |
| PathPlanner (FRC) | Event markers along a path (zoned markers have a start and an end) and commands in autos. | The team. Robot code registers each name with `NamedCommands.registerCommand` before the autos are built. When a path ends, its marker commands are ended. |
| Road Runner 1.0 (FTC) | Actions in a `SequentialAction` or `ParallelAction`, plus markers on a trajectory. | The team. An `Action` is a class whose `run(packet)` returns `true` while it is still running (for example, a shooter spin-up that returns true until the velocity is reached). |
| Pedro Pathing (FTC) | A state machine in the OpMode that starts the next path when `follower.isBusy()` turns false, or path callbacks. | The team. |
| Deck (before) | Pin actions and action paths. | Deck for one built-in design, the team for anything else. |

None of them writes mechanism code. They cannot know the hardware. Deck can, because Setup →
Mechanisms already describes the robot for the simulator. The contract Deck uses (an action is
called every loop and returns true when finished) is the same contract as Road Runner's actions
and PathPlanner's commands, and it is the right one: it never blocks the path follower.

## Decision: settings first, code only where settings cannot reach

Three options were weighed:

1. **Placeholders only.** Every action is an empty method with a comment saying "put your shooter
   code here". It works for any robot, but beginners get no working code. The simulator's timing
   would no longer match the robot. Hand-written mechanism code also tends to use `sleep()`, which
   freezes the path follower while it waits.
2. **Settings only.** Deck writes everything. That cannot cover every design, and a robot outside
   the template fails with no way out.
3. **Both (chosen).** The settings describe the hardware of the common designs, and the export
   writes readable code from them. Each action can be replaced in `RobotActions` without touching
   the rest. A generated check OpMode tests every device on the robot.

What the settings now describe:

| Part | Hardware options |
| --- | --- |
| Intake rollers | DC motor or continuous servo. An optional second roller (side rollers usually have two). Each can turn the other way. Power. |
| Kicker, ramp | Servo name and its positions down and up. |
| Flywheel | One or two motors, each able to turn the other way. Velocity control with an encoder (speed, ticks per revolution, at-speed tolerance, optional PIDF) or a set power with no encoder. |
| Feeder (indexer) | Motor, continuous servo, servo pusher (swings to its feed position for each shot, then back), or servo gate (open while shooting). |
| Turret | Motor with an encoder (ticks per degree), or a servo (position facing forward, degrees across its range). Either can turn the other way. |
| Drive and sensors | The motor, IMU, odometry, Pinpoint and OTOS names can be renamed to match the robot. |

What stays the team's job, and where it goes:

- **Anything the settings cannot describe**, such as an arm, a lift, a sorter, or a color sensor
  that stops the intake when the robot is full. Override that action's method in `RobotActions`.
  The generated code shows the built-in version as a starting point.
- **Physical facts**: which way each motor turns, servo positions and the real flywheel speed. The
  check OpMode finds them on the robot.

## One-button setup on a Control Hub

Goal: join the robot's Wi-Fi, press one button, and the autonomous is ready to INIT.

### What the robot already allows

Checked in FIRST's own FTC SDK 12.0 libraries (RobotCore, FtcCommon, OnBotJava and RobotServer
12.0.0 from Maven Central, SHA-1 verified, inspected with `javap`):

- **Reading the configuration.** A Driver Station sends `CMD_REQUEST_CONFIGURATIONS`. The robot
  answers `CMD_REQUEST_CONFIGURATIONS_RESP` with a JSON list such as
  `{"name":"competition","resourceId":0,"location":"LOCAL_STORAGE","isDirty":false}`. Sending
  `CMD_REQUEST_PARTICULAR_CONFIGURATION` with one of those entries returns its XML (every hub, port,
  device type and name). `CMD_REQUEST_ACTIVE_CONFIG` names the active one.
- **Writing a configuration.** `CMD_SAVE_CONFIGURATION` carries `<that JSON>;<XML>`. The robot
  splits it at every `;` (so a name with `;`, or with `&amp;` and the like, cannot be sent), writes
  `<name>.xml`, makes it active and announces it with `CMD_NOTIFY_ACTIVE_CONFIGURATION`. It replaces
  a file of the same name, so Deck refuses any name the robot already has. `CMD_ACTIVATE_CONFIGURATION`
  switches configurations, and `CMD_RESTART_ROBOT` rebuilds the hardware map from the active one.
- **Scanning the hubs.** `CMD_SCAN` answers `{"map":[{"key":"(embedded)","value":"LYNX_USB_DEVICE"}]}`
  (a Control Hub's own board is `(embedded)`; an Expansion Hub on USB has its serial number).
  `CMD_DISCOVER_LYNX_MODULES` with a serial number answers the hubs behind it:
  `{"serialNumber":...,"modules":[{"moduleAddress":173,"isParent":true,"imuType":"BHI260"}]}`.
  The robot checks each hub's IMU for this (`discoverModules(true)`), so the right IMU tag is known:
  `ControlHubImuBHI260AP` for a BHI260, `LynxEmbeddedIMU` for a BNO055.
- **Uploading code.** The Control Hub's OnBot Java server (port 8080) saves a file with
  `POST /java/file/save?f=/src/org/firstinspires/ftc/teamcode/Name.java` and a form field `data`.
  It reads one back with `/java/file/get`.
- **Building.** `/java/build/start` starts a build, `/java/build/status` reports it as JSON
  (`completed`, `successful`, `startTimestamp`), and `/java/build/wait` and `/java/build/log` return
  the compiler output. After a successful build the robot registers the new OpModes and sends the
  Driver Station its new list (`checkForChangedOpModes`). No sign-in is needed: the web console is
  open to anyone on the robot's network.
- **Selecting and running.** The app already sends INIT and START. Selecting the new autonomous is
  safe to automate. Starting it is not: INIT and START stay with the driver.

### The button, step by step

**Send to robot…** (Run & review → Export) does steps 2 to 4 and says what it will do. **Save and
send** (or **Upload and build**) then does steps 5 to 7.

1. **Connect.** Join the robot's Wi-Fi (Settings already saves it). The Control Hub is at
   `192.168.43.1`.
2. **Read the robot.** Read the active configuration and list every device: name, kind (motor,
   servo, continuous servo, IMU, Pinpoint, OTOS...), hub and port.
3. **Check the export against it.** Every name the code uses must exist on the robot as the right
   kind. A name the robot has under another spelling (`leftFront` for `front_left`) is picked
   already. Another device of that kind can be picked from a list, and the choice becomes the name
   in the setup, so the code uses the robot's own names.
4. **Plan what is missing.** A device the robot does not have at all is added to the robot's
   configuration. Deck scans the robot's hubs and gives each device a free port:
   - drive motors on the Control Hub;
   - other motors on the Expansion Hub first;
   - servos and sensors on the Control Hub first, sensors from I2C bus 1 (bus 0 has the hub's own
     IMU).

   A list shows the port for each device and a motor type for each motor. Picking another port for
   one device swaps it with whatever device was planned there. A robot with no configuration gets
   one with every hub its scan found.
5. **Save the configuration.** It is saved under a new name ("competition Deck", or "Deck <setup>"
   for a robot that had none) and made active, and the robot restarts. A saved configuration is
   never replaced. Deck reads the new one back and compares it with what it sent.
6. **Upload and build.** Save the files with OnBot Java and build. Compiler errors are shown with
   their file and line. Before replacing a file, the app reads the robot's copy. If someone edited
   it there, a copy is kept on this computer. OnBot Java also keeps its own copy on every build.
7. **Select it.** The next time this robot is opened in Drive (within the hour), the new autonomous
   is selected.
8. **Check on the robot.** **Start the guided check…** runs the check TeleOp from the same panel.
   Each step turns one device or moves one servo, and the panel asks what happened, with buttons for
   the answers. Controller 1's buttons answer too, and so does a gamepad on any Driver Station.
   With pods, a Pinpoint or an OTOS, the last steps are on the floor: two pushes by hand and one
   turn on the spot find which way each pod counts and where each one sits.
   **Use these settings and send…** stops the check and puts the answers into the setup. It then
   runs Send to robot again, so only **Upload and build** is left to press.
9. **Drive.** INIT, START.

### What one button cannot do, and how to close each gap

| Gap | Why the app cannot know | How it is closed |
| --- | --- | --- |
| A robot with no configuration yet, or missing devices | The app cannot see which port each motor is plugged into. | Done: Deck plans a port for each device from the robot's scan, the team moves any that are wired elsewhere, and the result is saved as a new configuration. |
| Motor directions | Depends on how each motor is mounted. | Done: the guided check turns each one and asks. "No, the other way" flips its setting. |
| Servo positions, turret calibration, flywheel speed | Physical measurements. | Done: the guided check moves each servo with the D-pad until the person saves it. It points the turret straight ahead, then a quarter turn left, and measures the flywheel's top speed for REV's PIDF. The results come back over telemetry. |
| IMU mounting | Depends on how the Control Hub is mounted. | Reported, not fixed: the check says when the hub reads the robot as tilted, or a left turn as a right turn. The mounting setting has to be changed by hand. |
| Odometry pod, Pinpoint and OTOS directions and offsets | Depend on where each one is mounted and which way it faces. | Done: settings in Setup → Robot controller → Where the odometry sits. The guided check finds them on the floor. A push forward and a push left give each direction, and the Pinpoint's pod type or the OTOS's distance scalar. A turn on the spot gives the offsets and the OTOS's turn scalar. |
| Shot speed for a distance | Needs real shots. | Test shots on the field. |
| Firmware, Wi-Fi channel | Outside the autonomous. | The REV Hardware Client. |

### Phases

- **Phase 1 (this change):**
  - The hardware settings above, with the generated code and the simulator using them.
  - The mechanism check OpMode.
  - Robot names for drive motors and sensors.
  - Reading the robot's configuration and checking the export against it.
  - Upload and build through OnBot Java.
- **Phase 2 (done):**
  - Writing a configuration for a new robot, or adding missing devices to a copy of one.
  - The guided check: directions answered with yes or no, servo positions, turret calibration and
    flywheel PIDF coming back from telemetry, run from Deck or any Driver Station.
  - Selecting the new autonomous in Drive after the build.
- **Phase 3 (done):**
  - Pinpoint, OTOS and odometry pod directions and offsets, as settings the check can find.
- **Later:**
  - Piece sensors (stop intaking when full, shoot until empty).
  - An adjustable hood.
  - TeamCode upload with ADB for Android Studio teams.

## What was built (phase 1)

| Piece | Where |
| --- | --- |
| Hardware settings for every part, stored only when they differ from the plain setup, so older saves load unchanged | `ui/sim-mechanisms.js`, Setup → Mechanisms → Robot hardware, `deck-sim mech` flags |
| Device names and directions for the drive motors and sensors | `ui/sim-config.js`, Setup → Robot controller → Ports → Device names and motor directions, `deck-sim robot --names --reversed` |
| `Mechanisms.java` written device by device, with every direction set in `init`, PIDF when set, power control without an encoder, pushers that push once per feed cycle, gates, and servo turrets tracked to 2° | `ui/sim-ftc.js` (`mechanismDevices`, `mechanismsSource`) |
| The check TeleOp for TeamCode, OnBot Java and Pedro (made a guided check in phase 2) | `ui/sim-ftc.js` (`checkOpMode`) |
| `RobotActions` shows how to replace a built-in action | `ui/sim-ftc.js` (`robotActions`) |
| MotionModule: continuous-servo rollers, second motors, servo feeders, directions as signed power | `ui/sim-motionmodule.js`, `tools/simulation/motionmodule-bridge.py` |
| The virtual Control Hub registers each device as what it is, mounted as the settings say, and only a forward command takes pieces in, feeds or spins a flywheel | `tools/simulation/java/deck/sim/hub/VirtualHub.java`, `src/sim-engine.cjs` |
| Reading a robot configuration and checking the export against it, with suggested names and fixes | `ui/ftc/robot-config.js` |
| Reading the configuration over Robocol, uploading and building with OnBot Java, backups | `src/robot-link.cjs` |
| Send to robot in Run & review → Export | `ui/simulation.js` |
| A simulated Control Hub that answers the configuration commands and serves OnBot Java | `tools/ftc-sim.cjs` |

### How it was checked

- **The virtual Control Hub, with BIOBUZZ physics.** Three hardware variants each shoot exactly what
  the simulator planned (same shots, pickups and points):
  - continuous-servo side rollers with a reversed second roller, a two-motor flywheel with PIDF, a
    reversed feeder and turret;
  - a set-power flywheel, a servo pusher and a servo turret;
  - a kicker and a servo gate.

  The same code with the second roller's direction flipped picks up nothing, as a real robot would.
- **MotionModule** shows the same in its own runtime: it picks up and shoots with the directions as
  set, and picks up nothing with one roller flipped.
- **The real FTC SDK 12.0 and Pedro Pathing 3.0.2.** Every export compiles with no warnings: TeamCode,
  OnBot Java with its check TeleOp, and Pedro, for these variants plus a two-shooter case, every
  localizer case and every example. The SDK stand-ins still match the real SDK (240 members).
- **Send to robot, against the simulated Control Hub.** Unit tests and a run in the real app cover:
  - reading the configuration;
  - five Pedro-style names found and applied with one button;
  - uploading and building both files;
  - backing up a file edited on the robot;
  - files kept on the robot;
  - compile errors;
  - a robot already in use by another Driver Station;
  - a robot with no active configuration.

## What was built (phase 2)

| Piece | Where |
| --- | --- |
| Port planning, adding devices to a configuration without changing anything else in it, a new configuration from a scan in the SDK's own layout, new configuration names | `ui/ftc/robot-config.js` (`planPorts`, `portChoices`, `movePort`, `addDevices`, `newConfiguration`) |
| Scanning the hubs, saving and activating a configuration (refusing a name the robot has), reading it back, restarting the robot | `src/robot-link.cjs` (`readRobot` with `scan`, `writeConfiguration`) |
| Send to robot as one flow: names, the port list, one confirmation for the configuration, upload and build | `ui/simulation.js` |
| Drive selects the autonomous just built | `src/main.cjs` (`ftc-info`), `ui/ftc/ds.js` |
| The guided check TeleOp. It replaces the hold-a-button check, and its results are Deck settings: `v1 robot.frontRight.reversed=true intakes.0.downPos=0.150 shooter.pidf=...` | `ui/sim-ftc.js` (`checkOpMode`, `checkResults`, `applyCheck`) |
| Running the check from Deck: INIT and START, gamepad 1 pressed from the panel or from Controller 1, STOP (Space too), stopped when leaving the Simulation view | `src/robot-link.cjs` (`runCheck`), `src/main.cjs`, `ui/simulation.js` |
| Gamepad input for team code on the virtual Control Hub, and what each device physically does (a wheel's forward command, a roller's pull-in, a servo's position, a turret's angle) | `VirtualHub.java`, `RunBridge.java`, `src/sim-engine.cjs` (`setGamepad`, `hubDevices`) |
| The simulated Control Hub answers Scan, discovery, Save and Activate, lists the op modes OnBot Java built, and runs a stand-in for the check | `tools/ftc-sim.cjs` (`--empty --onbot` tries it all without a robot) |

### How it was checked (phase 2)

- **The guided check on the virtual Control Hub** (`tests/sim-guided-check.test.cjs`). The virtual
  robot is wired one way, and the code is exported from settings that get it wrong. A scripted
  person answers each question from what the device really did, and moves servos to where they
  really belong.
  - On a robot with two drive wheels, the second roller, one flywheel motor and the feeder all
    turning the wrong way, and a turret encoder of 5 ticks per degree against the setting's 4.6, the
    check found every direction and measured 5.011 ticks per degree. It also measured the top speed
    and REV's PIDF from it.
  - On a robot with a kicker, a servo pusher and a reversed servo turret, it found every position
    exactly (0.15 and 0.85, 0.25 and 0.65). It found the turret's center (0.55), range (272.7
    degrees against 270) and direction.
  - In both cases the autonomous exported from the corrected settings shoots, picks up and scores
    exactly what the simulator planned.
- **Writing configurations** (`tests/robot-link.test.cjs`):
  - free ports on the right hubs;
  - nothing in the robot's own configuration changes, and the added line goes inside the Control Hub;
  - from a scan, the configuration Configure Robot saved, line for line;
  - swaps, refusals for taken ports, an IMU of unknown type, names with `;` or escapes;
  - saved and made active over Robocol, read back, robot restarted;
  - a second save under the same name (in any case) refused.
- **Running the check from Deck** against the simulated hub: INIT and START, answers pressed on
  gamepad 1 (from the panel and from Controller 1), the results line read back, STOP.
- **In the app** (`tests/robot-setup-app.cjs`, against the simulated hub and its OnBot Java):
  - a robot with the Pedro Quickstart's drive names and two devices missing: four names taken from
    the robot, two devices added to "competition Deck" with one port swapped by hand, built;
  - the Guided check answered from the panel and its setting saved;
  - Drive opened with the autonomous selected;
  - a robot with no configuration got one with all ten devices.

## What was built (phase 3)

| Piece | Where |
| --- | --- |
| Where the odometry sits: each pod's position and direction, the Pinpoint's offsets, pod type and directions, the OTOS's position, X-axis heading and scalars. Only what differs from Deck's defaults is stored. | `ui/sim-config.js` (`odometry`, `odometryOf`), Setup → Robot controller → Where the odometry sits, `deck-sim robot --odometry` |
| The exports set the hardware up with them: `setOffsets`, `setEncoderResolution` and `setEncoderDirections` for the Pinpoint, `setOffset` and the scalars for the OTOS, a sign per pod. Pedro's starter constants use the same settings. | `ui/sim-ftc.js` (`hardware`, `robotDrive`), `ui/sim-pedro.js` |
| The guided check's last steps, on the floor: a 48 in push forward, a push left, then one turn on the spot. A least-squares fit of each reading against the turn gives each offset. | `ui/sim-ftc.js` (`checkOpMode`, `applyCheck`) |
| The virtual Control Hub's Pinpoint and OTOS work as the chips do. They are mounted where the setup says, and they compute the pose with what the code configured, so wrong settings put the robot off course. | `tools/simulation/java/deck/sim/hub/SimSensors.java`, `VirtualHub.java` |

The OTOS offset now follows SparkFun's definition: where the chip sits and which way its X axis
points, with the robot's X forward. The export used to add a quarter turn to the OTOS's heading
instead. Pedro's `OTOSLocalizer` adds that quarter turn itself, so its starter constants get the
offset turned to match.

### How it was checked (phase 3)

- **The guided check on the virtual Control Hub** (`tests/sim-guided-check.test.cjs`). The virtual
  robot is mounted one way, and the check is exported from the plain settings. A scripted person
  pushes the robot 48 in forward and 24 in left, then lets it turn. Then the autonomous is run on a
  route with a turn, once from the check's settings and once from the plain ones:

  | Robot | The check found | End of route, check's settings | Plain settings |
  | --- | --- | --- | --- |
  | Pinpoint: swingarm pods, the strafe pod reversed, pods at -2.5 in and 5 in | swingarm, Y reversed, -2.500 in, 5.000 in | 0.37 in | 44.8 in |
  | OTOS: half a turn from the usual way (90°, its Y arrow backward), 3 in forward and 1 in right, reading 2% short and turns 1% long | 90.1°, 2.979 in, -0.988 in, scalars 1.0124 and 0.990 | 0.27 in | 80.6 in |
  | Two pods: the forward one at 5 in left, the sideways one reversed at 5 in back | 5.000 in, reversed, -5.000 in | 0.48 in | 52.7 in |
  | Three pods: 6.5 in left, 5.5 in right and reversed | 6.500 in, -5.500 in, reversed | 0.49 in | 90.3 in |

  The OTOS's distance scalar needed was 1.0149, because the simulator's optical sensor also reads
  0.5% long; the check found 1.0124.
- **Pedro's own localizers** (`tests/sim-pedro-runtime.test.cjs`). Pedro's `PinpointLocalizer` and
  `OTOSLocalizer` drive a route with a turn, configured from the same settings the virtual chips are
  mounted by: swingarm pods, a reversed strafe pod and offsets for the Pinpoint, and an OTOS off
  centre and turned. Both end within 1.5 in. With the OTOS offset passed to Pedro unturned, or the
  Pinpoint's offsets swapped, the run misses.
- **Compiled against the real FTC SDK 12.0 and Pedro 3.0.2** for every localizer. The stand-ins'
  new members (`getEncoderX`, `getEncoderY`, the OTOS scalars and their limits) match the real
  SDK.

## What was built (phase 4): wiring, sensors and every route action on the robot

Setup now holds the robot's wiring (`project.robot.wiring`): the hubs, each device's model and
port, and the sensors on each mechanism. The export is generated from it.

| Piece | Where |
| --- | --- |
| **Robot → Control Hub wiring**: the drivetrain from the CAD's wheel names (or chosen), the Expansion Hub and Servo Hub with their addresses, and each drive motor, odometry pod, Pinpoint, OTOS and IMU with its model and port. A port left to Deck shows the one it planned. Four drive motors of one model set the wheel RPM. | `ui/sim-wiring.js`, `ui/simulation.js` (`wiringPanel`) |
| **Robot controller → Ports → Everything plugged in, as a list**: every port in use, hub by hub. | `DeckWiring.summaryHtml` |
| **Mechanisms → Hardware** on each card: every motor and servo with its model, its port and its sensors (motor encoder, Through Bore, Axon feedback wire, potentiometer, limit or touch switch, colour or distance), each with its port and a line on what it tells. A shooter can have a hood servo. | `DeckWiring.deviceHtml`, `sensorsHtml` |
| Two devices on one port are kept as set and shown red; red wiring holds the next steps like a red value. | `DeckHardware.sanitizeWiring`, `conflicts`; `ui/simulation.js` (`wiringRed`) |
| The CAD parts of the row being edited glow on the model (click, focus, open, or scroll its card to the middle). | `DeckWiring.focusRefs`, `ui/simulation.js` (`mechGlow`) |
| **The robot configuration** from the wiring, written without a scan (Export → Robot configuration (.xml)). | `DeckSimFtc.robotConfiguration`, `DeckRobotConfig.configurationFor` |
| **Mechanisms.java** sets a hood servo for Spin up and Shoot (its rest position holds the CAD pose). A ramp with a position sensor is down or up once the sensor says so; without one, or if it never gets there, after its time (plus 0.5 s). | `DeckSimFtc.mechanismsSource`, `hoodPositions` |
| **Parts.java**: every motor or servo on a part route actions move. "Lift up" and "Lift to 30" move it. A servo with a position sensor is there once the sensor says so; without one, after the time the simulator gives the move; a motor once RUN_TO_POSITION is done. The CAD pose is each encoder's zero. | `DeckSimFtc.partDevices`, `partAction`, `partsSource` |
| **Bulk caching** (`LynxModule.BulkCachingMode.AUTO`) in the autonomous, so sensor reads cost no extra loop time. | `opMode`, Pedro's OpMode |
| **The RobotActions trap.** RobotActions.java is the team's and is never overwritten, so an old file still had Deck's empty `return true` method for "Lift up", which overrode the new code. Writing TeamCode now takes out such methods when they are untouched (a `.bak` copy is kept); a method the team wrote stays. OnBot Java's single file is regenerated every time, so it never had the trap. | `DeckSimFtc.retireStubs`, `src/sim-bridge.cjs` (`teamcode-save`) |
| **Send to robot** puts each device on the port Setup gives it, sensors, hood and parts included, and reports a device the robot has on another port or as another motor type. Opening Export with a robot saved in Settings checks its configuration once a session. | `ui/simulation.js` (`robotNeeds`, `crossCheck`) |
| **The virtual Control Hub** reads the same sensors under the same names and calibration as the export (`DeckSimFtc.sensorHardware`). | `src/sim-engine.cjs` (`hubSensors`) |

The Test setup's ramp is an Axon MAX with its feedback wire on analog port 0, so its default
export closes the ramp on the sensor.

### How it was checked (phase 4)

- **The same actions in the simulator and on the virtual Control Hub.** `deck-sim test
  examples/test-setup.json` against `deck-sim test examples/test-setup.json --code onbot`:

  | Run | Time | Picked | Shot | Landed | Points |
  | --- | --- | --- | --- | --- | --- |
  | Simulator | 50.35 s | 24 | 28 | 28 | 60 |
  | Exported OnBot Java | 51.53 s | 24 | 28 | 28 | 60 |

  Before this phase the export took 51.35 s. Each ramp move now ends on the Axon's reading, about
  one loop after the timed rule would. A sensor timeout would add 0.5 s per move.
- **Moving parts** (`tests/sim-route-parts.test.cjs`, fixture `tests/fixtures/route-parts.json`):
  "Arm up" on an Axon with its feedback wire, "Lift up" on a motor, then "Arm down". In the
  simulator and as exported OnBot Java the arm reaches 90°, the lift 12 in (11.98 in on the hub,
  rounded to whole encoder counts) and the arm comes back down. In both, the robot leaves the first
  pin only once the arm is up. The two runs take 6.5 s and 6.7 s.
- **Compiled against the real FTC SDK 12.0 and Pedro 3.0.2**, every example export and the
  moving-parts fixture (`tools/simulation/check-ftc-sdk.cjs`).
- `tests/sim-wiring.test.cjs`: the Test setup's wiring has no problems; a port conflict is red on
  its own step; the glow resolver.

## Limits

- No physical robot was available. The protocol details come from FIRST's own SDK classes, and the
  app's client is tested against a simulated Control Hub built from them, not against a real hub.
- Generated mechanism code is a starting point. It is compiled against the real FTC SDK 12.0 and
  run on the virtual Control Hub, but the first real run should be with the robot on blocks.
- Shooting is timed. Piece sensors can be wired and the virtual hub reads them, but the code does not
  count shots with them yet, so it cannot tell a jam from a shot.
- Closed on a sensor today: a ramp and a moving part with an analog position sensor (an Axon's
  feedback wire, a potentiometer, an analog encoder), and every motor on its own encoder. A Through
  Bore is wired and configured but not yet used in place of a turret's motor encoder, a limit switch
  does not home a part yet, and a servo kicker or pusher still runs on its times.
- An action of several steps made under Moving parts (`model.actions`) runs in the simulator but is
  not exported; the route actions that move one part ("Lift up", "Lift to 30") are. MotionModule
  exports do not move the robot's own parts yet.
- The guided check does not yet calibrate the new sensors: an analog sensor reads its model's span
  until its volts at the CAD pose and volts per degree are set.
- The flywheel's at-speed check trusts the encoder. A flywheel with no encoder cable plugged in reads 0
  in velocity mode, so it shoots after the timeout. Use "Set power (no encoder)" for that robot. The
  guided check says so when its top-speed step reads no speed.
- Adding devices uses the hubs already in the robot's configuration. An Expansion Hub that is
  plugged in but not configured, or a Servo Hub, is not used; when ports run out, Deck says so.
  An I2C sensor gets a bus of its own.
- The guided check covers what Deck has settings for. It reports a wrong Control Hub mounting but
  does not work out the right one.
- The odometry steps need room on the floor and straight pushes. The pod type and the OTOS's
  distance scalar come from the 48 in push, so they are only as good as that measurement. A push of
  another length still finds the directions. The robot turns on the spot under its own power at
  30% for one full turn. The OTOS's turn scalar is measured against the hub's IMU, so it is only as
  good as that IMU.
- After saving a configuration the robot restarts. Deck waits up to 8 s for OnBot Java to answer
  again before uploading.

## Sources

- [PathPlanner named commands](https://pathplanner.dev/pplib-named-commands.html) and
  [event markers](https://pathplanner.dev/gui-editing-paths-and-autos.html).
- [Road Runner 1.0 actions](https://rr.brott.dev/docs/v1-0/actions/).
- [REV PIDF tuning for hub motors](https://docs.revrobotics.com/first-global/fgc-pid) (F = 32767 ÷
  top speed, P = 0.1 × F, I = 0.1 × P, D = 0, set with `setVelocityPIDFCoefficients`).
- [REV DECODE flywheel tips](https://docs.revrobotics.com/ftc-kickoff-concepts/decode-2025-26/programming-tips-and-tricks).
- FTC SDK 12.0.0 libraries on Maven Central: `org.firstinspires.ftc` RobotCore, FtcCommon,
  OnBotJava and RobotServer (classes `FtcEventLoopBase`, `RobotConfigFile`,
  `OnBotJavaProgrammingMode`, `SaveFile`, `BuildMonitor`).
