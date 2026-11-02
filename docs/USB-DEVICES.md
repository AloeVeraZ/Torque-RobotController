# USB devices on a Control Hub

What Torque does with what is plugged into a Control Hub's USB ports. The research behind it, with sources, is in `research_notes/Control Hub USB devices/`. Rule numbers are from the 2026-27 Competition Manual, version TU07. **They are Torque's readings of the manual, not rulings.** Whether something unplugged before inspection counts as "connected" is one of the open questions: ask the [FIRST Q&A](https://ftc-qa.firstinspires.org/) if it matters.

## Which port does what

| Port | What it is for | How sure |
|---|---|---|
| Blue USB 3.0 | Cameras, a Limelight, a splitter, an Expansion Hub. FIRST says to use this one | High. Seen on FTC-zWL4; no schematic was available |
| USB 2.0 | The same devices, but a static shock here can knock out the robot's Wi-Fi, so Torque warns and says to move it. FIRST gives that reason | High. The port and the Wi-Fi share a splitter inside the hub |
| USB-C | The computer. **Not a camera**, on this hub | Fairly sure. FIRST's page says a UVC camera can go here, but this hub's device tree forces the port to device mode. A camera through an adapter has not been tried |
| Mini-USB (USB-B) | Nothing to plug devices into. It only ever talks to a host, for firmware. It cannot power or start a camera or a sensor | Certain: its chip has no host ability, so no software changes this |

## What the rules allow

- **Allowed (R707, R708):** single-lens webcams, a Limelight 3A (one per hub), a USB splitter powered as R611 says, and one Expansion Hub.
- **Allowed, but only with the video stream (R708):** a webcam's microphone and buttons cannot be used.
- **Prohibited outright (R702):** Limelight 3G, Luxonis OAK, OpenMV. **Banned (R708):** stereo and depth cameras.
- **Not on USB (R707):** microcontrollers, serial adapters, LiDAR, network adapters, Wi-Fi or Bluetooth dongles, flash drives, keyboards, gamepads (they go in the Driver Hub), phones, and the Axon programmer (it goes in the computer).

The full table, first match wins, is `ui/ftc/usb-kinds.js`, from `usb-rules.md` section 4.

## What each tab does

**Setup** shows them beside the hubs: each by its name, with its port and whether it is in the active configuration. Over Wi-Fi there is no read of the ports, so it is what the robot's own Scan found, and it says so.

**Configure** has them under the hubs on the right, one row each with its name, its state and remove. **Auto-configure** (`autoPlan`, `autoApply` and `autoWrite` in `ui/sim-config-editor.js`, `autoConfigure` in `ui/simulation.js`) adds every webcam plugged in, named Webcam, then Webcam 2, and honouring names already there; a Limelight that answers; hubs a scan found on the RS485 cable that the file lacks; and the hub's own IMU on bus 0, as Configure Robot's Scan adds it, when a scan says which chip the hub has and the file does not have it. It first reads the file again, unless the draft has unsaved edits, and it refuses while the active configuration is only a guess; it stops unless the hub's ports were read over the cable or a scan answers now, and over Wi-Fi it always scans. What is new is judged against the file on the robot, not the draft. USB devices alone go in by text (`withUsbAdded`), so nothing else in the file changes, a name such as `arm.motor` or a comment included. Hubs and an IMU take the file written afresh as Save writes it, which keeps the portal's name, the names already there and the wiring notes, and drops other comments. Over Wi-Fi the robot sends no comments, so Torque keeps the notes it read over the cable (`notesThrough`, `configuration-notes.json`) and puts them back; notes this computer has never seen cannot come back. It writes through the same path as Save, which restarts the robot, waits for a scan the Robot Controller itself answers, then goes to Calibrate → Camera. With nothing new it writes nothing and does not restart the robot. A draft's unsaved edits are asked about once: they go too, stay a draft on top of what was written, or nothing happens. It takes nothing out: a hub or camera in the file that is not there stays until a team removes it.

Devices with no way in from USB are named with the rule and not added. A row's `route` in `usb-kinds.js` says where it does work: a HuskyLens or an OctoQuad on I2C, with a button to that bus in Configure and the device ready to pick; a Servo Hub on the RS485 cable; an Axon programmer on the computer, with a button to its tab.

**Calibrate → Electronics** (`ui/sim-usb-devices.js`) lists what is on each port, with anything behind a splitter under that splitter. Each device has its name, what it can do on the robot, whether it is allowed with the rule, any warning, how often it has dropped since the hub started, and what to do. Technical facts are behind a closed section. Cameras and Limelights get one line pointing to the Camera tab. It updates by itself and has no Refresh.

**Calibrate → Debug** (`createLive` there) has the same devices above the motors and servos, each with what it is doing now: a webcam streaming and its frame rate, a Limelight's status, what the rules say about the rest. One camera is open at a time, and any other says so.

**Calibrate → Camera** (`ui/sim-camera.js`) shows the camera's picture by itself: see [Camera](CALIBRATION.md#camera). It adds, for the camera picked:

- **Checks**, read from the camera's USB descriptors without touching the camera: port, speed, serial number, sizes and formats, controls, lens data and drops. One line under the picture says only what needs doing, or All good, and the rest is under Details. Controls a camera does not advertise disappear from the tab, and so does Automatic exposure once a camera says it has none. A control being advertised does not prove it works.
- **Measure this lens**, for a camera FTC has no lens data for. See below.
- **A Limelight**, as its own name in the row. Its status (temperature, CPU, memory, frame rate, pipeline) and which calibration it runs on replace the picture, with the steps for calibrating it on its own page.

**Configure** lists a Limelight that answers with an Add button, which writes `<EthernetDevice name="limelight" serialNumber="<Scan key>" port="-1" ipAddress="<its own address>" />` under `<Robot>` when you press Save. A USB network device that does not answer as a Limelight gets a warning and no Add, because Scan offers any USB network device as if it were one. A camera with no serial number shows by its product name, with the key the robot uses for it under Technical facts; two identical ones are told apart by the port in that key. A camera whose serial number has `&` or an apostrophe in it gets no Add, because the robot takes a configuration in a form that cannot carry those.

**The scans Torque runs by itself**, when something is plugged in, start nothing on the robot. A press during one waits for it and then happens. If the Robot Controller app is not answering they stop after five tries and say so, until what a scan can see changes or the app starts listening. Pressing Scan or Check again may still start the app, because that is the student asking.

## Measuring a lens with one tag

Hold a tag square to the camera at a distance you measured with a tape, and Torque averages the range the camera reports for 3 seconds. Range is proportional to focal length, so:

```
fx = fy = fxCurrent × measured / reported        cx = width / 2        cy = height / 2
```

`fxCurrent` is what the readings were worked out with: the numbers Torque Debug says it is using, or the SDK's silent guess of 578.272 for a camera it has no data for. If the tag was more than 15° off square or off centre, the reading moved, or `measured / reported` is outside 0.5 to 2, nothing is stored.

This is a **single-point estimate that takes the centre of the lens to be the middle of the picture**. It is good enough to fix distance. FIRST's full method, with 3DF Zephyr or OpenCV, is the better one. Torque does not write to `/sdcard/FIRST/webcamcalibrations`, because SDK 12.0's source never reads it.

The numbers go to:

- **The project**, per camera and size, in `calibration.lens`.
- **The camera, from the next start.** Torque sends `K fx fy cx cy` when a run starts or the numbers change, and Torque Debug opens its camera again, because AprilTag takes these numbers only as it is built. Frames report `lens`, so Torque can tell they took.
- **The constants file** Calibrate → Mechanisms makes (`DeckCalibration.java`), as `LENS_<camera>_<size>_FX` and so on.
- **Your code**, by hand: `.setLensIntrinsics(fx, fy, cx, cy)` on `new AprilTagProcessor.Builder()`, shown ready to copy.

Torque's exported autonomous has no vision code, so it has nothing to pass them to. Torque Debug always opens 640x480, so that is the size measured. The size list in the checks only changes which size the lens check talks about, for your own code.

## What has been checked, and on what

**On a real Control Hub** (FTC-zWL4, Hub OS 1.1.6, RC 12.0, with a generic `a108:2240` webcam in the blue port, over USB-C):

- Reading the ports, the camera's descriptors and the drops, over ADB. The tabs were drawn from those answers.
- **The Camera tab, with nothing pressed, on 2026-11-01.** Torque Debug built on the hub (about 25 s, then the crash guard's 40 s) and a real picture reached the tab. Over the Camera Stream it comes at 960x720, scaled up from the camera's 640x480, about 5 pictures a second. VisionPortal reports 9 to 19 frames a second while the picture is being sent, and up to 25 when it is not. Coming back to the tab did not rebuild, and the picture took about 6 seconds. Another look at a tab kept it; leaving let go after 12 seconds and it opened again straight away, so the camera is released. The hub rebooted under it once, cause unknown, and the picture came back by itself.
- Rotate. Exposure, which this camera really follows: 1 ms is dark and 100 ms bright. It has modes Manual and AperturePriority, which Torque shows as Automatic. Its descriptors list no gain control, though the SDK's GainControl still reports a range of 1 to 10, and Torque offers none.

**Only against stand-ins:**

- **A Limelight, all of it.** None has been plugged in here. Its status fields come from the SDK's `LLStatus`, and which calibration is active is worked out from what its documentation says its endpoints return. `hwType`'s values are unpublished, so Torque never says whether a unit is a 3A or a 3G unless it says so outright. Check the label on yours. The `<EthernetDevice>` Torque writes matches a real team's file, but has not been tried on a real hub from Torque.
- **AprilTags on a real camera.** No tag was in view on the real hub, so reading one, `Find the best settings` and everything below that needs a tag have only run on the virtual hub. The fields are read by name, which was checked against the real SDK 12.0 classes from the hub's own jar with no camera.
- **Measuring a lens**, against the simulated webcam, `tools/ftc-sim.cjs` and stubbed frames. The simulated webcam's lens (fx=822) is made up so that it reads short until measured. So `K`, Torque Debug opening its camera again, has not run on a real hub.
- **Two cameras.** Only one has been plugged in, so `W` has only opened the one already open, and been refused a name it does not have, on a real hub. Picking another has run on the virtual hub and against stubs.
- **Over Wi-Fi.** The real hub has only been run over USB-C. There is no crash guard on Wi-Fi, so Torque Debug goes on over Wi-Fi only when someone presses for it.
- **The rest of the path, end to end,** on the virtual Control Hub in `tests/camera-virtual-hub-ui.cjs`: the real app, the real main process and the real link, with the real `javac` against stand-ins (`tools/simulation/java`) whose 121 public members match the classes in a real hub's `onbotjava-classes.jar`. It gives the very errors a real hub gave for the old source. Its op mode is `startDebugServer` in `tools/ftc-sim.cjs`, in Node, not the Java.
- **Everything not allowed**, Expansion Hub on USB and splitters: from their documented IDs, not from a device.

**Not done:** the student naming which of an Arducam OV9281 or a goBILDA 3122-0004-0001 they have (Torque only says the two can share a USB ID), a flash drive's size and format, and Torque Debug opening another size or format. See `findings.md` section 10 for what is still open.
