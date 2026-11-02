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

**Calibrate → USB devices** (`ui/sim-usb-devices.js`) lists what is on each port, with anything behind a splitter under that splitter. Each device has its name, what it can do on the robot, whether it is allowed with the rule, any warning, how often it has dropped since the hub started, and what to do. Technical facts are behind a closed section. Cameras and Limelights get one line pointing to the Camera tab. It updates by itself and has no Refresh.

**Calibrate → Camera** (`ui/sim-camera.js`) adds, for the camera picked:

- **Checks**, read from the camera's USB descriptors without touching the camera: port, speed, serial number, sizes and formats, controls, lens data and drops. Controls a camera does not advertise disappear from the tab. A control being advertised does not prove it works.
- **Measure this lens**, for a camera FTC has no lens data for. See below.
- **A Limelight**, as its own entry in the list. Its status (temperature, CPU, memory, frame rate, pipeline) and which calibration it runs on replace the picture, with the steps for calibrating it on its own page.

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
- **The next live debug.** Torque sends `K fx fy cx cy` when a run starts or the numbers change, and Torque Debug opens its camera again, because AprilTag takes these numbers only as it is built. Frames report `lens`, so Torque can tell they took. A Torque Debug from before this has no such field, and Torque says to put it on the robot again. It never does that by itself.
- **The constants file** Calibrate → Mechanisms makes (`DeckCalibration.java`), as `LENS_<camera>_<size>_FX` and so on.
- **Your code**, by hand: `.setLensIntrinsics(fx, fy, cx, cy)` on `new AprilTagProcessor.Builder()`, shown ready to copy.

Torque's exported autonomous has no vision code, so it has nothing to pass them to. Torque Debug always opens 640x480, so that is the size measured. The size list in the checks only changes which size the lens check talks about, for your own code.

## What has been checked, and on what

**On a real Control Hub** (FTC-zWL4, Hub OS 1.1.6, RC 12.0, with a generic `a108:2240` webcam in the blue port): reading the ports, the camera's descriptors and the drops, over ADB. The tabs were drawn from those answers.

**Only against stand-ins:**

- **A Limelight, all of it.** None has been plugged in here. Its status fields come from the SDK's `LLStatus`, and which calibration is active is worked out from what its documentation says its endpoints return. `hwType`'s values are unpublished, so Torque never says whether a unit is a 3A or a 3G unless it says so outright. Check the label on yours. The `<EthernetDevice>` Torque writes matches a real team's file, but has not been tried on a real hub from Torque.
- **Measuring a lens**, against the simulated webcam, `tools/ftc-sim.cjs` and stubbed frames. The simulated webcam's lens (fx=822) is made up so that it reads short until measured.
- **Torque Debug opening its camera again.** It compiles against stand-ins for the SDK. It has not run on a robot, and Torque Debug's camera has never met a real webcam at all.
- **Everything not allowed**, Expansion Hub on USB and splitters: from their documented IDs, not from a device.

**Not done:** the student naming which of an Arducam OV9281 or a goBILDA 3122-0004-0001 they have (Torque only says the two can share a USB ID), a flash drive's size and format, and Torque Debug opening another size or format. See `findings.md` section 10 for what is still open.
