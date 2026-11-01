# Calibrate: live hardware debug and gated mechanism calibration

Calibrate (the third view in the header) turns a robot configuration into tuned mechanisms. It rests on one rule from the research behind it: **a mechanism can only be calibrated against something that measures what it did.** A motor's encoder counts its speed or position, an Axon's feedback wire or an absolute encoder tells a servo's angle, a limit switch marks zero. Where nothing measures a part, there is nothing to tune: only where its positions are.

The view has the saved-setup bar on top (pick, make, open and save setups) and two tabs:

- **Electronics**: **Live debug**, Send to robot and the guided check, with what the Control Hub reports on the right: what is connected to each port and every motor, servo and sensor. Those stay hidden until the hub has been read over USB-C, and ports cannot be changed here because they come from the hub.
- **Mechanisms**: the gated flow. It shows nothing until the Control Hub's devices are read.

Axon servos have their own tab, Axon Programmer, at the far right of the same row of steps. See [Programming Axon servos](AXON.md).

Code: `ui/sim-tune.js` (templates, gates, unit transforms, fits; pure and unit-tested in `tests/sim-tune.test.cjs`), `ui/sim-debug.js` (the Live debug panel), the calibrate section of `ui/simulation.js` (the flow), `src/onbot/TorqueDebug.java` (the robot side), `runDebug` in `src/robot-link.cjs` (the link). `tests/robot-setup-app.cjs` part C runs the whole chain against the simulated hub's stand-in (`startDebugServer` in `tools/ftc-sim.cjs`).

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
- **Link:** TCP port 20886, through ADB on the USB cable (forwarded with the other robot ports) or at the hub's address on Wi-Fi. Robot → Torque: one JSON line of devices, then one line of readings at most every 20 ms, stamped with the hub's clock. Torque → robot: tab-separated commands (`M` motor power, `C` CR servo power, `S` servo position, `E` pulses on/off, `L` latch, `R` zero encoder, `Q` a loop run on the robot, `T` its target, `X` stop, `P` heartbeat).
- **Safety on the robot**, because nothing else can stop a motor: a motor or CR servo power lasts 300 ms unless sent again (Torque repeats it while a slider is held, and the slider springs back to 0 when let go); with nothing heard for 300 ms or the connection closed, every motor and CR servo stops and servos that are not latched go limp (a latched servo keeps holding a piece); a motor over 7 A for 0.4 s is cut until commanded again (a 312 RPM goBILDA stalls at 9.2 A); Driver Station STOP still stops everything, and leaving Calibrate stops Live debug.
- **Panel:** hub by hub and port by port from the robot's active configuration, never from the simulator. A port can be in the configuration with nothing plugged in, and the panel says so. Motors show ticks, ticks/s, RPM and amps; each I2C bus shows whether its device is connected.

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
- Calibrate → Camera (`ui/sim-camera.js`) shows the first webcam in the configuration through Torque Debug's VisionPortal, and has a simulated webcam that needs no hardware. The simulation is a model of the FTC docs' advice on exposure, gain and decimation, and the real path has only run against `tools/ftc-sim.cjs`, never a real webcam. A Limelight is listed by Scan but has no live view.
- The virtual Control Hub does not hide true values or add the hub's quirks, so calibration cannot yet be scored against the simulator.
- Custom debug sockets at competitions were not researched: treat Live debug as pit and practice equipment.
