# Calibrate: live hardware debug and gated mechanism calibration

Calibrate (the third view in the header) turns a robot configuration into tuned mechanisms. It rests on one rule from the research behind it: **a mechanism can only be calibrated against something that measures what it did.** A motor's encoder counts its speed or position, an Axon's feedback wire or an absolute encoder tells a servo's angle, a limit switch marks zero. Where nothing measures a part, there is nothing to tune: only where its positions are.

The view has three tabs, left to right in the order a team works. It opens on the first:

- **Camera**: what a webcam sees, with everything that can be set right beside it. The picture shows by itself: see [Camera](#camera) below. Headed by the camera's name, with a row of names when there is more than one. A camera that is only plugged in says so and has Auto-configure, since the Robot Controller can only open cameras in its active configuration. Under the picture, one line says what needs doing or All good, and closed sections hold Details and Measure this lens. A Limelight's status takes the picture's place.
- **Debug**: **Live debug**, a box for each device on the hub: see [Live debug's boxes](#live-debugs-boxes). Under them, what is on the hub's USB ports: whether a webcam is streaming and its frame rate, a Limelight's status, and what the rules say about the rest.
- **Calibrate**, once everything else is set up, with two tabs of its own:
  - **Electronics**: Send to robot and the guided check, with **USB devices** and what the configuration lists on the right. USB devices goes port by port through what each thing is, what it does, the rule and what to do, and a camera has a button to Camera ([USB devices on a Control Hub](USB-DEVICES.md)). What the configuration lists is what it says is on each port, every motor, servo and sensor, not what is plugged in. It stays hidden until the hub has been read over USB-C, and ports cannot be changed here because they come from the hub.
  - **Mechanisms**: the gated flow. It shows nothing until the Control Hub's devices are read.

Axon servos have their own tab, Axon Programmer, at the far right of the same row of steps. See [Programming Axon servos](AXON.md).

Code: `ui/sim-tune.js` (templates, gates, unit transforms, fits; pure and unit-tested in `tests/sim-tune.test.cjs`), `ui/sim-debug.js` (the Live debug panel), the calibrate section of `ui/simulation.js` (the flow), `src/onbot/TorqueDebug.java` (the robot side), `runDebug` in `src/robot-link.cjs` (the link). `tests/robot-setup-app.cjs` part C runs the whole chain against the simulated hub's stand-in (`startDebugServer` in `tools/ftc-sim.cjs`).

## Live debug's boxes

Over USB the tab starts Torque Debug by itself, the way Camera does, building it once a visit if the robot's copy is not this one, until someone presses Stop live debug there. Over Wi-Fi it takes a press, since nothing could bring the app back from a crash. Put Torque Debug on the robot builds straight away.

Check all, one at a time and a big STOP sit above the boxes. STOP, or Space anywhere on the tab, stops a check and every output. Each box is everything for one device:

| Device | Its control | What it reads | Its check |
|---|---|---|---|
| Motor | A slider held to run, reverse to forward, that springs back to 0 | Ticks, ticks a second, RPM, amps; Zero encoder | At the speed set on the box |
| Continuous servo, SPARK Mini | The same slider | Power | At the speed set on the box |
| Positional servo | A dial that turns over the servo's real travel, or type an angle. Range sets the travel; Holding and Keep holding say what it does when left | Where it was told to go | Between the two angles set on the box |
| LED, Blinkin | An on and off switch | Whether it is on | The switch is the check |
| Digital input, touch sensor | None | High or low, on or off, released or pressed; how many changes | Press it and let go, twice |
| Analog input | None | Volts, the range seen, the full range | Turn it until told to stop |
| I2C device, one to a bus box | None | Connected or Not answering, then all it outputs: see [I2C devices](I2C-DEVICES.md) | Not needed |
| Battery | None | Volts | Not needed |

What a check is set to stays with the device's name on this computer (`torque-debug-devices`), and goes above 40% with a warning on its box. While a check runs, its slider or dial moves with what the robot was told, and its box says how it went. Nothing is set before Torque Debug goes on the robot, because none of it is in the program: Torque sends each command as it goes.

## What is really plugged in

A sensor's own read hands back zeros when nothing answers, and the SDK raises no error, so being able to read a sensor says nothing. While Torque Debug runs, `watchHub` asks each hub directly:

| Port | How Torque tells | What Debug says |
|---|---|---|
| **I2C** | The hub reads one byte from the address (`LynxI2cReadSingleByteCommand`, then `LynxI2cReadStatusQueryCommand`). Only a device that is there can acknowledge it. A configured device or one already found is asked 5 times a second. Every other address from 0x08 to 0x77 is tried once at the start, then 4 a turn, so a sensor nobody configured shows within about half a minute. | **Connected**, or **Not answering: check its cable**. A bus also says when something answers at an address the configuration does not have. A sensor plugged in after the robot started is set up again when it first answers. |
| **Analog** | The port's voltage, read for every port once a second (`LynxGetADCCommand`). A real Control Hub's empty ports read 0 to 0.001 V. Under 0.02 V for 2 seconds counts as nothing driving the port. | **Reads 0 V: probably not plugged in**, which may also be a sensor truly at 0 V. A port the configuration does not have says when it reads something. |
| **Motors, servos, digital** | They can't say. A motor or servo output has no feedback, and a digital port reads the same with a switch open as with nothing there. | Nothing. |

While Torque Debug is not running nothing can be asked, so the buses say Start live debug to check. A device that is not answering is not read at all, so the Driver Station gets no I2C warning from Torque Debug's own reads.

Measured on a real Control Hub (FTC SDK 12.0) with nothing plugged in: bus 0's IMU answered, and an AndyMark TOF, an Adafruit color sensor and a navX configured on buses 1 to 3 did not. The loop took about 7 ms with this running. A device answering at the right address is not proof it is the right type of device.

## The pipeline: nine gates

Each gate is a test the robot passes before the next one may drive it harder; order matters because every step inherits the one before ("Failing to fully complete one step in the sequence will often affect the next step": [Road Runner tuning](https://rr.brott.dev/docs/v1-0/tuning/)). A wrong ratio "will consistently overshoot or undershoot its target and look exactly like a drifting offset", and a polarity error spins a module out of control before an offset can be measured ([LearnFRC swerve offsets](https://learnfrc.com/blog/frc-swerve-module-offsets-calibration)). The thresholds are Torque's defaults, not sourced values.

| Gate | What happens | Passes when | Typical failure |
|---|---|---|---|
| **G0 Control Hub** | The configuration is read (Set up from the Control Hub, or Live debug's device list). | The devices are read and the configuration's names and ports have not changed since (a hash of them is kept). | Configuration changed: every gate of the affected devices goes stale. |
| **G1 Identify** | Torque proposes each mechanism from Setup (game parts, moving parts, CAD), with the device that moves it and the sensors on that device. | You confirm its type and devices. | Wrong type or device: fix it in Simulate → Setup. |
| **G2 Bind and direction** | Pulse and watch: the actuator runs briefly (0.25 power, 0.4 s; a servo moves) while every input is recorded. | Its own sensor answered, and you said which way is positive. Two signs are stored: the motor's and the encoder's ([Road Runner](https://rr.brott.dev/docs/v1-0/tuning/): they are independent). | Another port moved: the encoder is on another motor's port. Nothing moved: unplugged or inside the deadband. |
| **G3 Units** | The stage chain: counts a sensor turn, sensor turns per mechanism turn, units a mechanism turn (360° or spool circumference × cascade stages); or two volts-to-angle points for an analog sensor. | A known move reads within 2 %. "Use the measured ratio" rescales from the check. | Wrong gearbox in a motor family; sensor on another stage; belt slip. |
| **G4 Zero** | A home switch, a gentle stall against a stop, an absolute sensor, or the start pose. | Three zeroings agree (their spread is shown). | Spread means a loose switch, slip or backlash. |
| **G5 Range** | Jog to each stop; set the limits a little inside. | Both limits set, low below high. | — |
| **G6 Feedforward** | Ramps on the robot, power signed so + is the positive way. Velocity: five powers, steady speed each, fit `power = kS + kV·v`. Position: power raised until it moves up, then lowered until it moves down: `kG = (up + down)/2`, `kS = (up − down)/2`. | Fit R² ≥ 0.95, or both breakaway powers found. | Poor fit: binding or rubbing. |
| **G7 Feedback** | PID gains and a tolerance; the simulated step on the measured feedforward, then a step on the robot with Torque Debug's own loop. A servo with feedback gets an arrival check instead. | It settles within the tolerance and holds (rise 10–90 %, overshoot, settling as MATLAB's stepinfo scores them). | Overshoot: lower kP or add kD. Chatter: tolerance tighter than the sensor's step. |
| **GT Sensor thresholds** | For mechanisms with a colour, distance, touch, limit or magnet sensor: a second of readings without and with a piece (released and pressed). | The two groups do not overlap; the threshold sits between them with a quarter of the gap as hysteresis. | Overlap: move the sensor or change its gain. |
| **G8 Commit** | The values are kept with the setup, with the date and battery voltage, and **Show the constants file** gives a `DeckCalibration` Java class. | Saved. | — |

A gate goes **stale** when what it depended on changes: a device, port or sensor model stales G1, G2 and GT; editing the units stales G3 and every gate after it. A configuration change stales G0. Swapping a Color Sensor V2 for a V3 ("will not be consistent": [REV Color Sensor V3](https://docs.revrobotics.com/rev-crossover-products/sensors/color-sensor.md)) or re-splining a servo horn should be redone the same way.

## Seven templates: the feedback decides the gates

FTC's actuator pool is narrow (8 motors and 8 servos; relays, solenoids, pneumatics and vacuum banned: [FTC Competition Manual 2026-27](https://ftc-resources.firstinspires.org/ftc/game/manual), R501–R506, R801), so what can be calibrated follows the feedback path, not the geometry. Each of the app's 80 mechanism types starts from a template, and its wiring moves it: a claw with an Axon feedback wire is T4, the same claw on a plain servo is T5; a lift with no encoder is T5.

| Template | Feedback | Types | Gates |
|---|---|---|---|
| **T1 Gravity position** | Motor + encoder, gravity-loaded | lift, scissor-lift, lead-screw, rack-pinion, dr4b, tape-measure, forklift, arm, pivot-extension, elbow, four-bar, v4b, capper, shooter-pivot, transfer, cone-righter, hang-hook, winch, self-lift, catapult, custom-pivot | All nine; kG constant for a lift, kG·cos θ for an arm (0 at horizontal) |
| **T2 Free or wrapping position** | Motor or CR servo + encoder, little gravity | linear-slide, turret, base-yaw, spindexer, geneva-indexer, swerve-steer, gantry, scara, delta-arm, custom-slide | All nine; kG = 0; soft limits, or the shortest way round |
| **T3 Velocity** | Encoder speed | flywheel, roller-intake, feeder, conveyor, spinner, spindle, custom-spin, roller-claw | G0–G3, G6–G8 |
| **T4 Servo with feedback** | Axon 4th wire or potentiometer | claw, parallel-gripper, deploy-intake, wrist, wrist-roll, diffy-wrist, hood, mini-turret, linkage-slide, flip-out-arm, kicker, gate, finger, neck, stewart-leg | G0–G5, G7 (arrival), G8; the loop is inside the servo |
| **T5 Blind actuator** | Plain servo, CR servo or motor with no sensor | dropper, drone-launcher, ratchet, ramp, diverter, goal-grabber, bucket, sweeper-arm, knocker-arm, odo-retract, pto-shifter, drop-wheels, steering, hip, knee, ankle, hopper, pole-guide, button-pusher | G0–G2 (you are the sensor), G5, G8 |
| **T6 Threshold sensing** | Colour, distance, switch | passive-gripper, and the GT gate on any mechanism with such a sensor | G0, G1, GT, G8 |
| **T7 Drivetrain and localization** | Drive encoders, pods, Pinpoint, OTOS, IMU | drive-wheel, odometry-pod, camera-mount | The guided check measures them, as [Road Runner](https://rr.brott.dev/docs/v1-0/tuning/) and [Pedro Pathing](https://pedropathing.com/docs/pathing/tuning/localization/pinpoint) tune them |

`piston`, `propeller` and `suction-gripper` are illegal in FTC (R801, R204) and carry a "simulation only" badge.

## From a reading to mechanism units

The configuration XML never records gear ratios, which shaft a sensor rides on, direction or zero, and one motor type tag (`goBILDA5202SeriesMotor`) covers every Yellow Jacket ratio ([FTC Hardware AAR](https://repo1.maven.org/maven2/org/firstinspires/ftc/Hardware/maven-metadata.xml)). The hub also drops XML comments when it saves a configuration, so calibration lives in `project.calibration`, never in the XML.

- **Counts:** `units = sign · raw / cpr / ratio · perTurn − offset`. Counts are rarely round (goBILDA 19.2:1 is 537.7 at the output: [goBILDA 5203](https://www.gobilda.com/5203-series-yellow-jacket-planetary-gear-motor-19-2-1-ratio-24mm-length-8mm-rex-shaft-312-rpm-3-3-5v-encoder/)); a slide's `perTurn` is the spool circumference times its cascade stages (in cascade rigging stage N moves N times as fast; continuous rigging has no multiplier).
- **Volts:** two captured points define the line. The REV potentiometer is non-linear (mid-travel reads about 1.10 V, not 1.65 V); its own curve `V = 445.5·(θ−270)/(θ²−270θ−36450)` is solved for θ. An Axon's span is undocumented ("Docs coming soon"), so it is measured.
- **Absolute output:** a Through Bore's absolute output cannot be read on a hub ([REV](https://docs.revrobotics.com/duo-control/sensors/encoders/through-bore-encoder)); it needs an OctoQuad, or homing. A sensor geared away from 1:1 is no longer absolute: the turn it is on has to be worked out at power-up.

## Live debug

Live debug drives every motor and servo port and reads every encoder, switch, analog input and I2C device while you watch, so cross-effects are measured: run the intake and the indexer's colour sensor sees the piece; lower the slide and its magnet switch reads pressed. Neither Driver Station telemetry (at most one update per 250 ms, superseded updates dropped: [Telemetry javadoc](https://javadoc.io/static/org.firstinspires.ftc/RobotCore/10.3.0/org/firstinspires/ftc/robotcore/external/Telemetry.html)) nor FTC Dashboard (send-time stamps, silent drops past 100 queued packets, a watchdog that never stops the op mode: [FtcDashboard.java](https://github.com/acmerobotics/ftc-dashboard/blob/master/FtcDashboard/src/main/java/com/acmerobotics/dashboard/FtcDashboard.java)) can carry it, so it uses its own op mode and socket.

- **Robot side:** `TorqueDebug.java`, the same file for every robot, put on the robot with **Put Torque Debug on the robot** (Send to robot's upload and build). It finds devices with `hardwareMap.getAll` per class (never the map's iterator, which initializes every device: [HardwareMap javadoc](https://javadoc.io/static/org.firstinspires.ftc/RobotCore/10.3.0/com/qualcomm/robotcore/hardware/HardwareMap.html)), reads one bulk read per hub per loop (MANUAL caching), and reads motor current and I2C sensors, which each cost a transaction of their own, one device a loop in turn ([gm0 bulk reads](https://gm0.org/en/latest/docs/software/tutorials/bulk-reads.html), [gm0 SDK communication](https://gm0.org/en/latest/docs/software/adv-control-system/sdk-communication.html)). Pinpoint is read with its one-call `update()`. It compiles against the real FTC SDK 12.0.0 and the virtual Control Hub.
- **Link:** TCP port 20886, through ADB on the USB cable (forwarded with the other robot ports) or at the hub's address on Wi-Fi. ADB takes the connection on this computer whether or not the hub's port is open yet and then hangs up, so Torque is connected only once the op mode has said something. Robot → Torque: one JSON line of devices, then one line of readings at most every 20 ms, stamped with the hub's clock. Torque → robot: tab-separated commands (`M` motor power, `C` CR servo power, `S` servo position, `E` pulses on/off, `L` latch, `R` zero encoder, `Q` a loop run on the robot, `T` its target, `X` stop, `P` heartbeat, and for the camera `V` exposure, `D` AprilTag reading, `K` lens, `W` which camera).
- **Safety on the robot**, because nothing else can stop a motor: a motor or CR servo power lasts 300 ms unless sent again (Torque repeats it while a slider is held, and the slider springs back to 0 when let go); with nothing heard for 300 ms or the connection closed, every motor and CR servo stops and servos that are not latched go limp (a latched servo keeps holding a piece); a motor over 7 A for 0.4 s is cut until commanded again (a 312 RPM goBILDA stalls at 9.2 A); Driver Station STOP still stops everything, and leaving Calibrate stops Live debug.
- **Panel:** hub by hub and port by port from the robot's active configuration, never from the simulator. A port can be in the configuration with nothing plugged in, and the panel says so. Motors show ticks, ticks/s, RPM and amps; each I2C bus shows whether its device is connected.

## Camera

A webcam cannot be read from outside the Robot Controller app: Android's camera service lists none (`dumpsys media.camera`) and the adb shell user cannot open `/dev/video0`. So a program has to run inside the app, and that is Torque Debug: VisionPortal, with the picture coming as a Driver Station's Camera Stream does. Torque does this by itself, and the tab says nothing about it.

- **Starting.** While the tab shows a camera that is plugged in and in the active configuration, and nothing else has the robot (a Send, a guided check, a scan, Auto-configure, a robot open in Drive), Torque reads the active configuration, asks whether the robot's copy of Torque Debug is this one (`debugCurrent`: the source compared, apart from the name that says when it went on), and starts it. If it is not this one, over USB it builds, once a visit, through the same `debug-install` and crash guard as the Debug tab's button; over Wi-Fi, where nothing could bring the app back from a crash, it never builds by itself, and offers one button, Put the camera program on the robot. Before any build from this tab it connects as a Driver Station to see that the robot is free (`debugIdle`: no other Driver Station, nothing running), because a build can disturb someone driving, and it also builds the team's unbuilt OnBot Java edits, since OnBot Java builds every file together. The first time takes about a minute over USB, most of it the guard watching that the app survives; after that about 6 seconds. A run someone started on the Debug tab is shared and never stopped from here.
- **Leaving.** Leaving the tab stops the program and lets go of the camera 12 seconds later, so a look at another tab does not restart it. The Debug tab showing it, or anything driving an output, keeps it. Over USB the Debug tab starts it the same way, so going straight there works too. Leaving Setup and Calibrate for another page stops it at once. Anything a student asks of the robot meanwhile, such as Scan or Send, takes the robot from it first: `main.cjs` stops a run the tab started rather than refusing.
- **Moving nothing.** Torque Debug writes no output until told: motors get 0, a continuous servo is not written at all until told, and servos go limp. This tab only ever sends `V`, `D`, `K` and `W`. Anything else sent to the run makes it the Debug tab's own (`debug-claim`).
- **Failing.** One line, and it tries again by itself only where that can help: another Driver Station, an op mode already running, the Robot Controller app not answering. Those last as long as they last. A run that ended comes back after 3, 6, 12, 24 and 48 seconds, a failure that may not clear doubles its wait five times, and each then waits for Try again. Nothing it does by itself starts the app, which matters most for a build that crashes it: only Try again does. If the app never says which configuration is active, after 8 answers the tab says it is not answering, offers Try again and asks every 30 seconds. A build that fails names the file, the line and the symbol, and says plainly when it is the team's own file, since OnBot Java builds every file together. That and the crash guard wait for Try again. A camera plugged in but not configured gets Auto-configure.
- **The crash guard.** For 40 seconds after a build over USB nothing else reaches the robot (`debugBusy` in `main.cjs`: Save, Scan, Auto-configure and Activate wait). The app not listening proves nothing, since a Driver Hub can restart it too, so before anything is deleted the guard needs a new crash of the app in `logcat -b crash`, which it only reads. A real crash takes Torque Debug's source and the whole OnBot Java build off, as the crash lives in that build, restarts the app, and says the team's files are safe but need Build Everything. That hub is remembered on this computer (`torque-debug-crashes.json`), so nothing puts it back by itself until someone presses for it, even after a relaunch.
- **Several cameras.** Torque Debug opens the first and `W name` opens another, closing the first: only one is ever open. Frames report which is open as `open`, and what it has with `modes`, `seen` and `range`.
- **SDK versions.** SDK 12.0 made `AprilTagDetection` abstract and moved `id`, `decisionMargin` and `metadata` to `AprilTagSingleDetection` and `AprilTagClusterDetection`. `TorqueDebug.java` reads those three by name, so the one file builds on both. A cluster has no `id`, and shows as a tag group.

## Pitfalls Torque watches for

| Pitfall | What Torque does |
|---|---|
| Hub velocity steps in 20 ticks/s from a 50 ms window and wraps at ±32767 ([road-runner-ftc Encoders.kt](https://raw.githubusercontent.com/acmerobotics/road-runner-ftc/master/RoadRunner/src/main/java/com/acmerobotics/roadrunner/ftc/Encoders.kt); community-sourced) | Speed tolerances default to at least 2 % of top speed; the template note says so. |
| `RUN_TO_POSITION` has no gravity term; PIDF does not survive a power cycle | Step tests run Torque Debug's own loop with kG; the constants file is for the team's loop. |
| Encoder and motor directions are independent | Two signs, both set in G2. |
| Encoders zero at power-up, not op-mode start ([gm0 encoders](https://gm0.org/en/latest/docs/software/tutorials/encoders.html)) | Zero is a gate of its own. |
| Static friction stalls a P-only loop just short of the target | Suggested gains include kS (0.05 until G6 measures it). |
| Colour V3 and the 2 m distance sensor share I2C address 0x52 | Not checked yet: put them on different I2C buses. |
| Servo port pairs share 2 A; an Axon stalls above what the hub supplies ([gm0 servos](https://gm0.org/en/latest/docs/software/adv-control-system/sdk-servos.html)) | Servos hold only while latched or commanded; pulses go off with the watchdog. |

## Not done yet

- The robot-side loop for a step test takes gains in raw counts (Torque converts from mechanism units); the team's generated autonomous does not use these gains yet: the constants file is for the team's own code.
- Burst capture (full-rate samples buffered on the robot) is not used; step tests read the 50 Hz stream.
- OctoQuad, Limelight and Servo Hub devices are not read by Torque Debug yet.
- Calibrate → Camera (`ui/sim-camera.js`) has a simulated webcam that needs no hardware when no real camera is configured or plugged in, a model of the FTC docs' advice on exposure, gain and decimation. What has run on a real webcam and what has not is in [USB-DEVICES.md](USB-DEVICES.md). A Limelight has a status panel and no live view, tested only against stand-ins.
- The virtual Control Hub does not hide true values or add the hub's quirks, so calibration cannot yet be scored against the simulator.
- Custom debug sockets at competitions were not researched: treat Live debug as pit and practice equipment.
