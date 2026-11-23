# Torque

**Drive, set up, simulate and tune your robot, all in one app.** Made for FTC teams, and it works with any robot that has its own website.

![The Starter Mecanum, the robot Torque opens on, driving its demo autonomous in the simulator, at twice the speed](docs/media/robot-run.gif)

[Watch the whole run](docs/media/robot-run-full.mp4), saved from Torque's own video editor.

## Install

**Windows:** open PowerShell, paste this and press Enter.

```powershell
irm https://raw.githubusercontent.com/AloeVeraZ/Torque-RobotController/main/install.ps1 | iex
```

That's it. Torque installs, adds a desktop icon and opens. You don't need an administrator account.

Prefer a normal download? Get it from the [releases page](https://github.com/AloeVeraZ/Torque-RobotController/releases/latest).

**Steam Deck and Linux:** download `DeckDriverStation-SteamDeck.run` from the [releases page](https://github.com/AloeVeraZ/Torque-RobotController/releases/latest) and run it.

**Apple Silicon Mac:** download `DeckDriverStation-macOS-arm64.zip` from the same page and open it.

## What it does

| | |
| --- | --- |
| **[Drive](#drive)** | Control your robot with a gamepad |
| **[Simulate](#simulate)** | Plan an autonomous and test it with no robot |
| **[Calibrate](#calibrate)** | Check your hardware and tune your mechanisms |
| **[Axon servos](docs/AXON.md)** | Program Axon servos, and see how damping changes the way they settle |

## Drive

Connect to your robot and drive it.

![The built-in FTC Driver Station running a TeleOp](docs/media/driver-station.jpg)

- **FTC robots:** a built-in Driver Station lets you pick an op mode, press INIT, START and STOP, read telemetry and use two gamepads. It works with a Control Hub or a Robot Controller phone, over Wi-Fi or USB.
- **Other robots:** ESP32, Raspberry Pi, MotionModule or anything with its own website. Torque opens the robot's own page and passes your gamepad through to it.
- **Saved robots:** save a robot once and reopen it with one tap. A saved FTC robot connects by itself when you join its Wi-Fi.
- **Gamepads:** Xbox, PlayStation, Nintendo, Logitech and Steam Deck controls. A live test screen shows every stick and button, and measures stick drift.
- **Touch friendly:** every screen works by touch, with an optional on-screen keyboard.

**To connect:** join the robot's Wi-Fi with the Wi-Fi button in the bar, then on **Drive**, under **Add a robot**, press **Open on Wi-Fi** for an FTC Control Hub, or **Open on USB** with its USB-C cable plugged in. For any other robot pick **Other robot**, enter its address and press **Open robot**. Next time it is one tap under **Your robots**.

![The controller test screen showing every stick and button](docs/media/controller-test.jpg)

## Simulate

Build your robot, draw a route and watch it run in full physics. No robot, no extra downloads and no internet needed.

![Torque replaying a run, first on the 2D field and then in 3D](docs/media/app-run.gif)

1. **Set up your robot.** Choose its size, drivetrain, motors, sensors and mechanisms such as intakes, shooters and turrets. You can also import your own CAD.

   ![The Starter Mecanum's chassis next to its 3D model: the wheels picked here are the wheels drawn](docs/media/robot-setup.jpg)

2. **Plan a route.** Click to add stops or draw the path. Torque keeps the whole robot clear of obstacles.

   ![A route with numbered stops on the BIOBUZZ field](docs/media/route-planner.jpg)

3. **Run it.** Replay the run on a timeline, graph its speed and heading, and see how many pieces it picked up, shot and scored.

   ![A run in 3D beside its report: the route finished in 21.7 s, and where each second went](docs/media/run-review.jpg)

4. **Make a video.** Film the run with follow, scoring and top-down cameras. Then cut it, add text and save an MP4.

   ![The video editor with a timeline of camera cuts](docs/media/video-editor.jpg)

5. **Send it to your robot.** Export working code, or upload it to your Control Hub over Wi-Fi. A guided check then tests each motor and sensor on the real robot.

**Exports to:** Control Hub OnBot Java, TeamCode, Pedro Pathing 3 and MotionModule.

**Fields:** BIOBUZZ, or a custom field with your own obstacles.

**Prefer a terminal?** The `deck-sim` command plans, runs, optimizes and exports routes too.

[Full simulator guide](docs/SIMULATION.md)

## Calibrate

Tune your robot step by step using real readings from your Control Hub.

![Calibrate's checks for the Starter Mecanum, in order, starting from its Control Hub](docs/media/calibrate-mechanisms.jpg)

- **Live debug:** see every motor, servo and sensor your Control Hub reports, and what's plugged into each port.
- **Set up from the hub:** one button maps your devices into your robot setup.
- **Guided tuning:** Torque checks each mechanism in order: direction, units, zero, range, then control. Each step has to pass before the next one starts, so a bad reading can't throw off later steps.
- **Keep the results:** get your tuned values as a ready-to-use Java file.
- **Program Axon servos:** the Axon Programmer tab sets V1 and V2 Axon servos to servo or continuous rotation mode and changes their settings, through Axon's V2 programmer. [Guide](docs/AXON.md)

![Live debug listing each motor, servo and sensor on the Control Hub](docs/media/calibrate-live.jpg)

[Full calibration guide](docs/CALIBRATION.md) · [Torque and the FTC rules](docs/COMPETITION-RULES.md)

## Make it yours

Pick a theme for Torque and another for the FTC Driver Station in **⋮ → Settings**, and give each robot its own, the way teams colour their Driver Hubs. You can make your own themes with your colours, a background picture and your team's logo, and import them with the **+** at the end of each list. Text works the same way: use Inter, OpenDyslexic or your computer's font, or add a font file of your own. All of it stays on your computer. [How to make a theme](docs/THEMES.md)

## Updating

Open **⋮ → Updates → Check for updates**. Your saved robots and settings are kept.

You can also switch to the **Testing** channel there to try new features early.

## Good to know

- **Torque is not a safety system.** It can't act as a hardware emergency stop, so keep your robot's own stop controls ready.
- **Not for competition.** The Driver Station is an independent build and isn't certified for FTC competition. It isn't made by REV or FIRST.
- **Your robot stays private.** Nothing is hosted in the cloud, and robot passwords aren't saved with your robot addresses.

## More help

- [Quick start](docs/QUICKSTART.md)
- [FTC robots](docs/FTC.md)
- [Controllers](docs/CONTROLLERS.md)
- [Touch controls](docs/TOUCH.md)
- [Programming Axon servos](docs/AXON.md)
- [Website compatibility](docs/COMPATIBILITY.md)
- [Updates](docs/UPDATES.md)
- [Development and how it works](docs/DEVELOPMENT.md)

## License

Torque's own code is [MIT licensed](LICENSE). It builds on Electron, Pedro Pathing, DSIM, Rapier, three.js, OpenJDK and more; see the [credits and third-party notices](THIRD-PARTY-NOTICES.md).

The simulator's physics come from [DSIM](https://github.com/genius0412/dsim) by Dohun Kim, which is licensed for noncommercial use only. That makes complete releases free for noncommercial use, such as team practice.

Not affiliated with or endorsed by FIRST®, REV Robotics, Valve or any project above.
