# Programming Axon servos

Setup & Calibrate → **Axon Programmer**, the tab at the far right. Torque programs Axon servos a team already owns, through Axon's own V2 programmer. It is the [Axon Bridge](#where-this-came-from) app moved into Torque. It does not replace Axon's hardware: a team still buys the servo and the programmer. Torque is not made by or affiliated with Axon Robotics.

> **Not yet tested on real hardware.** No programmer was plugged in while this was built. Everything below has run against a simulated programmer built to the protocol in Axon's official apps. Whether the V2 programmer passes traffic to a V1 servo can only be proven by plugging one in, and Axon's documents say it does not.

## What you need

- An Axon V2 programmer, which Axon calls the Programmer MK2. Axon, goBILDA and ServoCity sell it.
- A USB cable that carries data. USB-C powers the programmer and the servo, so no battery is needed.
- A Windows computer, for now. Torque runs on Steam Deck, Linux and Mac too, but the small program that reaches the programmer over USB is built for Windows, so there this tab says it cannot reach it.
- One of these servos: V1 MAX (sold as MAX+), V1 MINI (MINI+), V2 MAX (MAX MK2), V2 MINI (MINI MK2).

Close Axon Software MK2 and Axon Bridge first. They poll the same programmer, and two apps at once corrupt each other's traffic. Torque waits and offers to close them.

Program servos on the bench, with the programmer off the robot.

## The tab

It is laid out like Axon Bridge, in Torque's look, and fits a 1280x800 screen without the page scrolling. Long lists scroll inside their own panel.

| Where | What it does |
|---|---|
| Top | Chips for the programmer, the servo and the voltage and current |
| 1 Servo | V1 MAX, V1 MINI, V2 MINI, V2 MAX. Plug a servo into the top row of pins on the left of the programmer, grey signal wire on the right, and Torque powers the pins, reads it and marks it Plugged in. Reading changes nothing |
| 2 Mode | Servo Mode moves to and holds a position. CR Mode is continuous rotation: the signal sets speed and direction. Now marks the mode it is in |
| 3 Settings | Simple shows the basics every student needs: how far the servo turns, its center, how hard it pushes and which way it goes. Advanced shows every setting. Point at one for the longer version on the line at the bottom of the panel. A dot marks a change not applied yet. With no servo, it previews that model's factory values, greyed out |
| Test | Beside Settings: moves the servo. A list of moves with a graph in Servo Mode, a speed slider in CR Mode. See below |
| Plugged-in servo | Its name, mode and power. Advanced adds all that the servo and programmer report |
| Read, Defaults, Open, Save | Read again and restore factory settings. Advanced adds opening or saving a settings file |
| What happened | What you asked for beside what the servo reports after each write, then the log |
| Bottom | One line saying what is going on and what comes next, and the Apply button |

Nothing reaches the servo before Apply. Torque then reads it back, and the banner says **Confirmed** or **It did not take**.

Switching mode writes Axon's official firmware for that mode, as Axon's own apps do. It takes about a minute. It also resets the servo's settings to Axon's factory values for that mode, because the firmware file carries them, so save a settings file first if you want them back.

### Axon's software

Not needed. Torque works through the V2 programmer by itself, for reading, changing, saving and restoring settings, and Test. If Axon's own program is on the computer anyway (`Axon_Servo_Programming_Software*.exe` for V1, `Axon_Software_MK2*.exe` for V2, in Downloads, Desktop or Documents), a mode switch with no key file offers to open it. Torque only looks for the file, opens it when asked, and reads nothing out of it.

**Axon's keys.** Axon's firmware files are encrypted with Axon's own keys, and Torque includes neither the keys nor the firmware. Settings, reading, saving and defaults all work without them. Switching mode asks for a key file once (**Import key file**, a JSON file with `v1` and `v2`, each 32 hexadecimal digits), and it stays beside this computer's settings as `axon-keys.json`, never in a release or this repository. A copy of your own file in your Documents folder named `Torque Axon keys.json` is found with no prompt, so it follows you to your other computers if Documents syncs. Without one, Axon's own app can switch modes. Firmware comes from Axon's own link, or a file you already have.

**Test.** The switch above Settings opens Test, which really moves the servo through the V2 programmer's pulse (`0xAC`). Nothing is written to its settings.

- **Servo Mode:** a start position and up to five moves (so the column never scrolls), each a position from 0 to 1 (what a program sends, 0.50 the center) and a hold time, plus a load and a tolerance. Start test sends each position in turn, and the graph fills in as it goes. Stop or Space ends it and turns the pulse off. The position sent and the programmer's current and voltage, read about every 2 ms, are measured. The servo's curve, its overshoot, undershoot and settling are a model, because no programmer reports where a servo is (MK2 servos have an analog position wire, but the programmer does not read it). The model uses the servo's own Damping, PWM Power and Sensitivity, including changes not applied yet. Damping brakes against speed, PWM Power caps the motor, and Sensitivity is a band where the error counts as none, which is how the firmware uses them. How big each effect is on a real servo is an assumption: the factory Damping is critically damped with no load, and the bands keep the firmware's ratios (V2 150, 100, 50, 25; V1 16, 32, 48, 64) at a guessed size in degrees. Degrees use about 360° over 500-2500 µs at full range for MK2 (Axon's figure).
- **CR Mode:** a slider from full speed one way to full speed the other, with Stop, and Space stops it too. MK2 continuous rotation stops at 1500 µs and is at full speed at 1050 and 1950 µs. The pulse eases toward the slider at 600 µs a second. If the voltage dips under 4.1 V, Torque holds the speed back. Stop, or leaving the view or the tab, stops it.
- **From a laptop's USB port**, moving a servo can pull more than the port gives (seen 2026-11-04 with a MINI MK2): a 100 µs step dipped the programmer to about 3.6 V for 15 ms. Bigger moves dipped it to 3 V, and some reset the programmer, which then comes back on USB by itself. A test stops cleanly under 3.4 V and says why. Holding still draws about 0.17 A, and spinning at 1600 µs about 0.24 A.
- **The V1 programmer** echoes `0xAC`, `0xAF` and `0xB0` back unchanged and drives nothing, and Axon's V1 app has no test either, so a V1 servo has Settings only: there is no Test switch for it.

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

Torque does not ship Axon's firmware, because nothing found says it may be passed on. Torque downloads all eight files from Axon's own links in the background when the tab opens, and again when a mode switch starts if one is missing, so a student only presses Switch mode. Only if the download fails does Torque ask, offering to try again or to choose the file. A downloaded file is kept in Torque's data folder under `axon-firmware`. It must match the SHA-256 of the file listed in `src/axon-servo.cjs`, or it is thrown away. If Axon updates a file, the student is told to choose it by hand or update Torque.

Before anything is erased, Torque checks the file against the servo's hardware ID and name. A failed check says "Nothing was changed".

## How it works

| Piece | What it does |
|---|---|
| `src/axon-usb/AxonUsb.cs` and `.exe` | Raw HID, which Node cannot reach without a native module. Axon Bridge's `Hid.cs` behind a line protocol on stdin and stdout. It exits when stdin closes. Rebuild with `tools/build-axon-usb.cjs`, which uses the C# compiler that ships with Windows |
| `src/axon-servo.cjs` | The protocol, settings maps, servo models, firmware files and flash sequence, moved from `Protocol.cs`, `Params.cs` and `Firmware.cs`. Field meanings live here, and `checkChanges` refuses anything that is not a known field with an allowed value |
| `src/axon-programmer.cjs` | The service in the main process, moved from `Worker.cs`. One loop, one job at a time. USB runs only while the Axon guide is on screen |
| `ui/axon-programmer.js` and `.css` | The tab, drawn in the Setup view as `#rs-step-axon`. It draws what the service reports and sends back only the changes asked for |

A write reads the servo first, changes only the bytes of edited settings, writes, reads back and compares. V2 servos store bytes 0-43 only: their date and factory name are read-only.

### The V1 programmer, as seen on real hardware (2026-11-04)

Recorded from Axon's own V1 app and repeated through Torque's helper with a V1 MAX on the V1 programmer:

- Each `0x8A` gets exactly one reply about 33 ms later: `04 01 00 01 <type> …` names the servo, `04 01 FA 00 01` says there is none. Polled every 300 ms, a servo keeps answering indefinitely.
- A request sent within about 30 ms of the last reply is refused (`04 01 02 …`). A refused read or write makes the servo stop answering until it restarts. That is why it once looked as if a V1 servo only answered right after being plugged in. Torque leaves 60 ms after every reply.
- The servo can be restarted with no unplugging: `04 90 00` (update mode), `04 80` (bootloader info), `04 83 16 FF 55 AA` (bootloader exit, which starts the servo's own program), `04 90 01`. It answers again within about half a second. Torque does this when the servo stops answering, at start, and before retrying a refused read or write.
- Axon's app writes a setting as: read 59 bytes at 0, read 36 at 59, write both chunks, each acknowledged with an echo.

### A V1 servo on the V2 programmer (2026-11-04)

A V1 servo's own program never answers the V2 programmer (`04 FA` to every `0x8A`), and Axon's MK2 app cannot see one either. Its bootloader does answer. With the pulse off, `0x80` gets `04 01 00 01 80 56 30 2E 33 08 01` (V0.3, hardware 08 01, as on the V1 programmer), and `0x83` starts the servo again. So on the V2 programmer, when nothing answers `0x8A`, Torque asks the bootloader every 5 seconds. Asking restarts the servo, so it never asks while a servo answers normally or during a test. What that allows:

- **Found:** shown as a V1 servo on the V2 programmer. Nothing past "V0.3, hardware 08 01" is readable: the `0x80` reply is zeros after it, and the `0x81` answer is a rolling counter, not a serial number. The exit alone leaves the servo in its bootloader (it neither spins nor holds, even across a power cycle) until a normal `0x8A` arrives, so Torque sends one after every check.
- **Mode, measured:** Torque holds the pulse at 1650 µs and then 1350 µs for about a second each and reads the current. Continuous rotation keeps spinning (about 0.2 A both ways on a V1 MAX), and servo mode moves a few degrees and holds (under 0.08 A). When the two directions disagree, the mode is shown as unknown. A load on the horn can blur this, so the page says to keep it free. The mode is measured again just before a switch, and Torque refuses to write the mode the servo is already in.
- **Never send `0x81` outside a real update:** it starts an update session, and the servo then waits in its bootloader for firmware until some is written.
- **Model:** the V1 MAX+ and MINI+ have the same hardware ID (08 01 in both firmware files), so the student picks which. The mode switch confirmation says to check, since each needs its own firmware.
- **Mode switch:** works. The firmware goes through the bootloader as usual (hardware ID checked, the name check skipped). The check afterwards is that the bootloader answers again, and Torque then shows the mode it wrote. Tested on a V1 MAX: servo mode, a test move, CR, a spin.
- **Test:** works, through the V2 programmer's pulse, in the mode Torque wrote or the one picked. V1 continuous rotation is taken as full speed at 1000 and 2000 µs, which is not measured.
- **Settings:** not possible. The bootloader has no read. Writing would mean reflashing firmware with a settings block inside, without being able to read what is there, so Torque does not offer it. The page says to use the V1 programmer.

### A MK2 servo on the V1 programmer (2026-11-04)

The same in reverse. The MK2 servo's own program does not answer the V1 programmer (`04 01 FA`). In the V1 programmer's update mode (`04 90 00`) its bootloader does: `0x80` answers "V0.3" with hardware 08 22, which is both MK2 models. Torque asks only after the V1 programmer's own servo check and restart found nothing. The V1 programmer has no pulse, so the mode cannot be measured (unknown until Torque writes one), and there is no Test. A switch writes the picked MK2 model's firmware through the bootloader (V2 exit framing). The confirmation names the model and says Torque cannot tell the current mode. Tested on a MINI MK2: detected, and CR firmware written and acknowledged. Reading the mode back on the V2 programmer afterwards was not done, because the V2 programmer was not on USB.

Reading a MK2 servo through the V1 programmer was tried and is not possible. A `0x8A` with the MK2's `22` marker in every position, and with every link value the V1 programmer's `0x90` accepts (00 to FF; the programmer stores it and its "no servo" reply echoes it), always gets "no servo". The V1 programmer echoes command numbers it does not know (`0x84` to `0x8F`, `0xAC`, `0xAF`, `0xB0`) straight back without passing them on, and the bootloader refuses `0xCD` (read). So the model, mode and settings of a MK2 servo can only be read on the V2 programmer.

### Checks before writing firmware

- **The mode it is already in:** when Torque knows the mode (read, measured, or written by Torque), picking that mode says "This is already in servo mode". Switch mode then asks "currently in servo mode, are you sure you want to write it again?", and writes only on "Write it again".
- **A programmer that cannot identify the servo** (a V1 servo on the V2 programmer, a MK2 servo on the V1 programmer): after the switch is confirmed, a second dialog, "Check the servo first", says Torque cannot verify which servo it is. The student must press "Yes, it is a <model>" before anything is written.

### Every model gets its own firmware

Each of the four models has its own file per mode (`Axon_Max_*`, `Axon_Mini_*`, `Axon_MAX_MK2_*`, `Axon_MINI_MK2_*`), and each file names its model in its header (SA81BHMW, SA33, MAXMK2, MINIMK2). Before anything is sent, Torque checks the file names the model picked, on every path. A servo that reports its name is also checked against the file, and the hardware ID always is.

### The V2 programmer, as seen on real hardware (2026-11-04)

With a MINI MK2 on the V2 programmer:

- A servo answers `0x8A` with `04 01 22 22 8A 34 <mode> 22 08` (`31` continuous rotation, `11` servo mode). Byte 2 is `22`, not `00`. Torque used to accept only `00`, so it said no servo while Axon's app showed one. No servo is `04 FA 00 22 8A`.
- Axon's MK2 app sends only `0x91`, `0xAF` and `0x8A` while idle. It never sends a pulse (`0xAC`).
- If the programmer sends a pulse, a servo drives to it. Just after a switch to servo mode, the current can be more than USB gives, and the programmer drops off USB or locks up until it is replugged. Torque now keeps the V2 pulse off all the time. With no pulse the servo sits limp and draws nothing, and CR→servo→CR switches finish with no replug.

A V1 and a V2 programmer can be plugged in together. The app runs one service per programmer (`AxonService` with `only`), each with its own USB helper, and the tab shows a switcher at the top to pick which servo it is working on. Settings, Apply, mode switches and Test go to the one picked. A servo plugged into the other programmer while the picked one has none brings that one up. Switching away while a CR servo spins stops it. A single service without `only` (the tests' simulator) still asks for one programmer to be unplugged.

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
