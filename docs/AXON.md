# Programming Axon servos

Setup & Calibrate → **Axon Programmer**, the tab at the far right. Torque programs Axon servos a team already owns, through Axon's own V2 programmer. It is the [Axon Bridge](#where-this-came-from) app moved into Torque. It does not replace Axon's hardware: a team still buys the servo and the programmer. Torque is not made by or affiliated with Axon Robotics.

> **Not yet tested on real hardware.** No programmer was plugged in while this was built. Everything below has run against a simulated programmer built to the protocol in Axon's official apps. Whether the V2 programmer passes traffic to a V1 servo can only be proven by plugging one in, and Axon's documents say it does not.

## What you need

- An Axon V2 programmer, which Axon calls the Programmer MK2. Axon, goBILDA and ServoCity sell it.
- A USB cable that carries data. USB-C powers the programmer and the servo, so no battery is needed.
- A Windows computer, for now. Torque's releases are Windows only.
- One of these servos: V1 MAX (sold as MAX+), V1 MINI (MINI+), V2 MAX (MAX MK2), V2 MINI (MINI MK2).

Close Axon Software MK2 and Axon Bridge first. They poll the same programmer, and two apps at once corrupt each other's traffic. Torque waits and offers to close them.

Program servos on the bench, with the programmer off the robot.

## The tab

It is laid out like Axon Bridge, in Torque's look, and fits a 1280x800 screen without the page scrolling. Long lists scroll inside their own panel.

| Where | What it does |
|---|---|
| Top | That the V2 programmer is needed, and chips for the programmer, the servo and the voltage and current |
| 1 Servo | V1 MAX, V1 MINI, V2 MINI, V2 MAX. Plug a servo into the top row of pins on the left of the programmer, grey signal wire on the right, and Torque powers the pins, reads it and marks it Plugged in. Reading changes nothing |
| 2 Mode | Servo Mode moves to and holds a position. CR Mode is continuous rotation: the signal sets speed and direction. Now marks the mode it is in |
| 3 Settings | Every setting, with a short note beside it. Point at one for the longer version on the line at the bottom of the panel. A dot marks a change not applied yet. With no servo, it previews that model's factory values, greyed out |
| Plugged-in servo | What the servo and programmer report |
| Read, Defaults, Open, Save | Read again, restore factory settings, and open or save a settings file |
| What happened | What you asked for beside what the servo reports after each write, then the log |
| Bottom | One line saying what is going on and what comes next, and the Apply button |

Nothing reaches the servo before Apply. Torque then reads it back, and the banner says **Confirmed** or **It did not take**.

Switching mode writes Axon's official firmware for that mode, as Axon's own apps do. It takes about a minute. It also resets the servo's settings to Axon's factory values for that mode, because the firmware file carries them, so save a settings file first if you want them back.

## Simple and Advanced

**Simple** is the default. It shows exactly what Axon's own software edits:

| Servo and mode | Settings |
|---|---|
| V1 servo mode | Servo Angle, Neutral, Pulse Range, PWM Power, Damping, Sensitivity, Soft Start, Inversion, Lose PPM, Overload protection and its three levels |
| V1 continuous rotation | PWM Power, ProPTL, Inversion |
| V2 servo mode | Left and Right Range, Neutral, Signal Type, PWM Power, Damping, Sensitivity, Soft Start, Lose PPM, Inversion, Power-on Sound, Model Name, three overload levels |
| V2 continuous rotation | PWM Power, ProPTL, Inversion, Power-on Sound |

Defaults, Open and Save are there too. Settings files are `.svo` for V1 and `.svp` for V2, and Axon's apps open them.

**Advanced** is one button. It adds:

- **Stop band on V2 continuous rotation**, the one setting beyond Axon's app. If a continuous rotation servo creeps when it should be stopped, widen it. If it ignores small commands, narrow it.
- The factory value beside each setting, and a list of what differs from it.
- Everything else the programmer and servo report: USB IDs, status reports, the handshake reply, and every settings byte.
- **Recover**, for a servo that stopped showing up after an interrupted mode switch. It writes the servo and mode picked at the top.
- The USB log. Torque keeps it in its data folder as `axon-usb.log`, which is what to send if a servo misbehaves.

### Why the stop band, and what it rests on

Axon's documents say Sensitivity is the servo's dead-band. Axon's V2 app hides it on its continuous rotation page. Both V2 continuous rotation firmware files have identical code that loads byte 2 of the settings at start, multiplies it by 16, and treats a smaller control error as no error (address `0x0C9B`). So the firmware does honour it. The factory value in that firmware is 100, which is Medium. Torque offers only the same four values Axon's app writes to that byte in servo mode: 150, 100, 50 and 25.

That comes from reading the firmware. How much it changes a real servo has not been measured.

### What could not be confirmed, so is not offered

| Setting | What is known | What Torque does |
|---|---|---|
| SysAmp and MinPower (V2 servo mode, bytes 0 and 7) | The servo-mode firmware uses both in its control code. Axon documents neither, and its app keeps them on a page locked by a license file. Axon Bridge offered them as sliders, and which name goes with which byte rests on its reading of Axon's app. A safe range could not be confirmed, and a wrong value could make the servo oscillate. | Reports them, never writes them |
| Neutral on V2 continuous rotation | That firmware never reads bytes 22-23, so it would do nothing | Not offered |
| Damping on V2 continuous rotation | That firmware loads it, and no use of it was found | Not offered |
| Left and Right Range on V2 continuous rotation | That firmware reads them and scales each side of center by them. What that does on a real servo has not been tested | Not offered |
| Soft Start on V2 continuous rotation | That firmware only checks whether it is zero, and Axon's app never writes zero | Not offered |
| Lose PPM on V2 continuous rotation | That firmware honours only Release or keep going. Factory is Release. Keep going could leave a servo spinning after its signal is lost | Not offered |
| Separate left and right limits on V1 | Axon's V1 app always writes the two bytes the same, and how V1 firmware treats them differently was not established | Not offered |
| Stop band on V1 continuous rotation | That firmware's settings are laid out differently, and it could not be confirmed | Not offered |
| Moving the servo from Torque | Axon's V2 app can send test pulses, but Axon Bridge never used those commands, so nothing has run them | Not included. The pulse the programmer is sending is reported |
| V2 unnamed bytes (3-5, 11, 19, 21, 24-25, 27-31) and V1's unnamed bytes | Some are used by firmware. None has a known meaning | Read and written back unchanged |
| MICRO+ | Axon lists no firmware file for it | Settings may read like other V1 servos, but Torque will not switch its mode |

### Competition rules

These are readings of the 2026-27 manual (Section 12), not rulings. R504 allows servo changes the manufacturer specifies, such as soft limits and continuous rotation. R707 limits which USB devices can be on a robot's control system, so keep the programmer off the robot. Whether a third-party tool counts as "as the manufacturer specifies" is less clear than using Axon's own software, so ask in the FTC Q&A if it matters for your team.

## Firmware

Torque does not ship Axon's firmware, because nothing found says it may be passed on. When a mode switch needs a file, Torque asks, then either downloads it from Axon's own link or lets you choose the file. A downloaded file is kept in Torque's data folder under `axon-firmware`. It must match the SHA-256 of the file listed in `src/axon-servo.cjs`, or it is thrown away. If Axon updates a file, the student is told to choose it by hand or update Torque.

Before anything is erased, Torque checks the file against the servo's hardware ID and name. A failed check says "Nothing was changed".

## How it works

| Piece | What it does |
|---|---|
| `src/axon-usb/AxonUsb.cs` and `.exe` | Raw HID, which Node cannot reach without a native module. Axon Bridge's `Hid.cs` behind a line protocol on stdin and stdout. It exits when stdin closes. Rebuild with `tools/build-axon-usb.cjs`, which uses the C# compiler that ships with Windows |
| `src/axon-servo.cjs` | The protocol, settings maps, servo models, firmware files and flash sequence, moved from `Protocol.cs`, `Params.cs` and `Firmware.cs`. Field meanings live here, and `checkChanges` refuses anything that is not a known field with an allowed value |
| `src/axon-programmer.cjs` | The service in the main process, moved from `Worker.cs`. One loop, one job at a time. USB runs only while the Axon guide is on screen |
| `ui/axon-programmer.js` and `.css` | The tab, drawn in the Setup view as `#rs-step-axon`. It draws what the service reports and sends back only the changes asked for |

A write reads the servo first, changes only the bytes of edited settings, writes, reads back and compares. V2 servos store bytes 0-43 only: their date and factory name are read-only.

Protocol facts are in Axon Bridge's README and `research_notes/Axon servo config from Control Hub/axon_software_static.md`.

### Tests

```bash
ELECTRON_RUN_AS_NODE=1 .cache/runtime-win32-x64-44.8.0/electron.exe --test tests/axon-programmer.test.cjs
```

```bash
DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/axon-programmer-ui.cjs
```

The first moves Axon Bridge's self test across. Where Axon Bridge is installed it also checks Axon's eight real firmware files against the pinned hashes, flashes them on the simulator, and checks that the factory values Torque shows are what they install. The second drives the real app with only USB stubbed by `tests/fixtures/axon-sim.cjs`.

Neither proves real hardware behaves like the simulator. The first time a real programmer is plugged in, read before writing, and keep `axon-usb.log`.

## Where this came from

Axon Bridge is the Windows app this was moved from, kept at `%LOCALAPPDATA%\Programs\Axon Bridge`. Its protocol was read out of Axon's two official apps and its firmware files. Differences from Axon Bridge:

- SysAmp and MinPower are reported, not sliders, and continuous rotation gains the stop band in Advanced.
- Each setting has a short note beside it, as well as Axon Bridge's hint line.
- Once Torque recognises a servo, the other models lock, so the wrong one cannot be picked. Axon Bridge lets you pick it and then warns.
- The Enter and Esc shortcuts are not copied: Enter also picks a value in a list and Esc also closes one, so a student could apply a change by accident. Apply and Discard are buttons.
- Confirmations are Torque's own dialogs, and firmware must match a pinned hash when downloaded.
