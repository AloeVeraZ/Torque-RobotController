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

### Naming a servo on the other generation's programmer (2026-11-10)

Asked for: a V1 servo on the V2 programmer named as the model it is, the way the V1 programmer names it, and the same for a MK2 servo on the V1 programmer. What real hardware allows, tried with a V1 MAX (SA81BHMW, continuous rotation firmware V020108) on each programmer, reads only:

- **On the V1 programmer** the model comes from the servo's settings, not from its status. `0x8A` answers `04 01 00 01 01 04 02 01 08` (a V1 servo, continuous rotation, firmware V020108), which is the same for a MAX+ and a MINI+. The name is bytes 0x40 to 0x47 of the settings block: `0xCD` at 59 for 36 bytes answers `04 01 00 3B 24 24 20 00 00 00 53 41 38 31 42 48 4D 57`, "SA81BHMW", which is the V1 MAX. A MINI+ says "SA33".
- **On the V2 programmer** that read cannot be made. `0x8A` always answers `04 FA 00 22 8A` (no servo), with every variation of its address and length bytes tried. `0xCD` is refused by the programmer itself within 2 ms (`04 CD 02 <address> <length>`), because it only passes a read on after a servo answered its `0x8A`. Only the bootloader answers (`04 01 00 01 80 56 30 2E 33 08 01`), and that is the same for both V1 models. So the generation is known there and the model is not.
- **Nothing the V2 programmer can measure tells a MAX+ from a MINI+ either.** Axon's continuous rotation firmware for the two has the same settings but for the name, the date and the inversion flag, and the programmer measures current and voltage only. Torque does not guess: a wrong guess would offer the wrong firmware.
- **Never send `0x90` to the V2 programmer.** On the V1 programmer it is the update-mode switch. The V2 programmer takes it as "store the bytes that follow as my identity", the ten bytes its `0x91` handshake reports (`22 00 FF 01 BB 07 D8 07 10 0D` on this one). It answers after 26 ms where its own commands take 2 ms, which is the time a flash write takes, so the change probably outlives a power cycle (not checked: the programmer was not unplugged). Trying it as a way to make the V2 programmer talk like a V1 one left this programmer answering its handshake with `01` and zeros, which Torque and Axon's app both refuse. It was put back with `04 90 22 00 01 FF 07 BB 07 D8 0D 10` (the four words after the first two bytes go in high byte first) and reads back as before. No value of that byte, 00 to FF, made the servo answer. `Programmer.v1UpdateMode` now does nothing unless the programmer is a V1 one.
- **A MK2 servo on the V1 programmer** was not tried again: no MK2 servo was plugged in. What is above under "A MK2 servo on the V1 programmer" still stands: its bootloader says hardware 08 22, which is both MK2 models, and nothing else answers.

**What Torque does instead: it carries the name across.** The app runs one service per programmer in one process. The service that reads a servo's name on its own programmer remembers it. When that servo stops answering there, and a servo of the same generation then shows up through its bootloader on the other programmer within a minute, that service takes it to be the same servo: the tab names it ("V1 MAX", "Read on the V1 programmer"), shows its name, and asks nothing. For a MK2 servo moved to the V1 programmer the mode read on the V2 programmer comes along too, since the V1 programmer cannot measure it. This is the usual reason a V1 servo is on the V2 programmer at all: only the V2 programmer can run Test.

- It is an inference, and the tab says so. The other model can still be picked, and a firmware write still asks "Check the servo first", now saying how Torque came to that model.
- A servo that was already on the other programmer while the first one still answered is never given its name. With a servo plugged into each programmer from the start, the one on the other generation's programmer is still asked about: nothing links the two.
- Pulling a servo off the V1 programmer can drop that programmer off USB for a moment ("USB write failed (error 1167)", seen on the first real move, 2026-11-10). What it read is kept through that: the programmer going away counts as the servo going away.
- A servo found on the other programmer after a gap is looked at afresh, so pulling one servo off it and plugging the moved one in works however quickly it is done. With no name to take, it keeps the name it had only if the gap was under 12 seconds (a missed check, not a swap).
- The name is saved beside the USB log as `axon-carried.json`, so it is still there after the programmer drops off USB or Torque restarts. It is dropped once the servo has been gone for 12 seconds, or when a servo answers there normally. Torque cannot see a swap made while it was closed.
- Tested with simulated programmers (unit tests and the tab in the real app). On real hardware: the first real move (V1 MAX read on the V1 programmer at 05:38:26, gone at 05:39:04, a V1 servo on the V2 programmer at 05:39:19) happened before the USB-drop fix and was not carried at the time; its entry was then written to `axon-carried.json` by hand from the USB log, and the real app on the real V2 programmer showed that servo as "V1 MAX · Read on the V1 programmer". **A move with the fixed code has not been watched on real hardware.**

### Telling a MAX+ from a MINI+ on the V2 programmer (2026-11-10)

A V1 servo tells the V1 programmer its name. It tells the V2 programmer nothing: its bootloader answers there, and says exactly the same for a MAX+ and a MINI+ (`04 01 00 01 80 56 30 2E 33 08 01`, seen from both). That translation lives in the programmer's own firmware, which is Axon's and which Torque cannot change. So on the V2 programmer the generation is read with nothing moving, and the model and mode are not readable at all.

**What Torque does, in order.**

1. It reads what can be read without moving anything: that a servo is there, and that it is a V1 one.
2. If its name and mode were read on the V1 programmer and carried over, that is the answer and nothing more happens.
3. Otherwise a pop-up asks, once for each servo found: "Which V1 servo is this?" with **Move it and identify** and **Pick it myself**. It says the servo will move and how, and that anything attached that must not move means picking by hand. Torque never moves a servo before that button is pressed. Identify stays on the banner for later.

For a MK2 servo on the V1 programmer the pop-up only offers picking: that programmer has no pulse and reports no current, so it cannot move a servo or measure one. Asked for again and checked again on the real V1 programmer with a MINI MK2 on it (2026-11-10, evening): status is `04 01 FA 00 01` (no servo); the status report, pulse and servo power commands (`0xAF`, `0xAC`, `0xB0`) come straight back unchanged, so nothing is measured and no pulse leaves the programmer; a settings read is refused (`04 CD 02`); and the bootloader says `04 01 00 01 02 56 30 2E 33 08 22`, version V0.3 and hardware 08 22, which Axon's firmware files give for both MK2 models. So there is no movement test to offer there, as there is on the V2 programmer. Whether a MAX MK2's bootloader says anything different has not been seen: none has been plugged in.

**How Identify moves it, and why that much.** First the two crawl points: the pulse steps out from centre 5 µs at a time, a continuous rotation servo does nothing inside its stop zone and starts to crawl at its edge, and the pulse goes back to centre the moment it does. Up, then down. That alone tells the mode. Then the two nudges: from centre straight to 80 µs past each crawl point for 350 ms, reading the current over the last 100 ms, and back. Up, then down, so the servo ends about where it began. About four seconds in all. How many degrees that is was not measured.

| Read as raw current counts (one is about 1.3 mA) | V1 MAX | V1 MINI |
|---|---|---|
| At the crawl point, each way | 48 | 48 |
| 60 µs past it, both ways added, six checks each | 204 to 218 | 249 to 263 |
| 80 µs past it, both ways added, six checks each | 238 to 247 | 309 to 320 |

At the crawl point the two read the same, because the same firmware starts both at the same drive, so the crawl alone cannot tell the model; the nudge can. 60 µs left too small a gap, so it is 80. Torque says MAX+ at 265 or less, MINI+ at 292 or more, and nothing in between.

Both crawl points are found before either nudge. A first version nudged straight after finding each one, and a crawl point found just after a nudge came out 5 to 20 µs late, which moved the readings by different amounts for each servo: its figures (MAX 222 to 231, MINI 317 to 325) did not hold, and the real MINI then read 287 in the finished app, inside the band where nothing is said.

What this rests on, and does not:

- One MAX and one MINI, both used servos, one USB port, one day. The crawl point still moved by 5 to 10 µs between checks, and the readings a little with it. A stiff or worn servo, a load on the horn, or a different supply could land on the wrong side. So the result is offered ("Looks like this one"), the other model can be picked, and a firmware write still asks "Check the servo first" and says the model was measured, not read.
- Continuous rotation only. A servo in servo mode follows each step and settles, so there is no crawl: Torque then says servo mode and does not say the model. In servo mode the first pulse also sends the servo to its centre from wherever it was, which can be a large move. No V1 servo in servo mode was on hand to try any of this.
- Tried before this and dropped: holding 1650 µs and then 1350 µs for a second each (it told the models apart, 0.42 to 0.48 A against 0.58 to 0.62 A, but it was a visible spin); doing any of it automatically when a servo is found; and looking for a reading that needs no movement (switching servo power off and on with `0xB0` shows the idle floor throughout, and status bytes 11-12 and 17-18 are the programmer's own joystick).

**Plugging and unplugging, seen quickly on both programmers.**

- *V2 programmer.* Bytes 7 and 8 of its status report read `03 FF` while a servo's own program is running on its pins and `04 16` to `04 18` otherwise: with nothing plugged in, and also for a moment while a servo restarts (seen 2026-11-10; Axon's app does not use these bytes and what they measure is not known). So they only decide when Torque asks the bootloader. While a V1 servo is shown and they read empty, Torque asks at once with one short wait: no answer and the servo is gone, in about a second. An answer means it was only restarting; after three such answers in a row Torque goes back to its usual 5 second pace until the reading changes. The pins filling asks at once too, and three more times under a second apart while a servo just plugged in is still starting. A MK2 servo there answers every poll, so it is seen gone within one (0.4 s).
- *V1 programmer.* It has no such reading. Its own V1 servo is asked every poll: two missed answers and the page is told it is gone (under a second), and the restart that brings back a servo that had only stopped answering comes on the poll after. A MK2 servo it only sees through the bootloader is asked every 5 seconds with one retry while it is shown, so it shows as gone within about 7 seconds; with nothing shown the pins are asked every 2 seconds, so one plugged in is found within about 2. (Asking a shown MK2 servo every 2 seconds was tried: each ask restarts the servo, and the real V1 programmer then dropped off USB every few seconds, errors 995 and 1167. It still drops now and then at the slower pace, and comes back by itself.)
- *Any servo found after one was declared gone is a new servo*: asked about again, with nothing picked or measured for the last one left over.

**Awkward moments, and what happens** (unit tests with simulated programmers; the first three also seen with real servos):

| What happens | What Torque does |
|---|---|
| The servo is pulled out while the "Which servo is this?" pop-up is up | The pop-up closes with it |
| The servo is pulled out during Identify | The movement finds nothing, the bootloader is asked at once, and the servo is shown as gone, with no error left on screen |
| One servo is swapped for another, however quickly | The new one is asked about; the first one's model, mode and picks are gone |
| The programmer drops off USB (as the real ones do when a servo is pulled: errors 1167 and 995) during Identify or at rest | The job ends, the programmer reconnects by itself, and the servo is found and asked about again |
| The pins read empty but the servo still answers | It stays shown; three early asks, then the usual pace |
| Identify is pressed with no servo there | Refused, nothing is sent |

Not covered: a servo pulled out while Test is spinning it or during a firmware write (a write that fails says to use Recover), and anything with a V1 servo in servo mode.

### Every Axon model, and what identifies it

Axon's range is three V1 servos (MAX+, MINI+, MICRO+) and two MK2 servos (MAX MK2, MINI MK2). No MICRO MK2 exists in Axon's documents. The generation comes from the status reply (byte 7: `01` V1, `22` MK2) or the bootloader's hardware ID. The model only ever comes from the factory name in the settings block, read on the servo's own programmer.

| Model | Factory name | Bootloader hardware ID | How it is known |
|---|---|---|---|
| V1 MAX (MAX+) | `SA81BHMW` | 08 01 | Read from two real servos, one on each programmer (2026-11-10), and Axon's firmware files |
| V1 MINI (MINI+) | `SA33` | 08 01 | The name from Axon's firmware files; a real one seen on the V2 programmer only (2026-11-10: bootloader 08 01, measured current). Not yet read on the V1 programmer |
| V1 MICRO (MICRO+) | unknown | unknown | Nothing: Axon publishes no firmware for it and none has been read |
| V2 MAX (MAX MK2) | `MAXMK2` | 08 22 | Axon's firmware files only. No MAX MK2 has been plugged in |
| V2 MINI (MINI MK2) | `MINIMK2` | 08 22 | Read from a real servo on the V2 programmer, and its bootloader on the V1 programmer (2026-11-04) |

A servo whose name is none of these is not matched to a near one. The tab says "A V1 servo named "…" is ready", the log gives the name and the raw status bytes, its settings can still be changed with its generation's layout, and its mode cannot be switched. A servo that only answers through a bootloader with a hardware ID other than 08 01 or 08 22 is shown as unknown with the raw bootloader reply. A V1 status type of `02` is one Axon's V1 app knows but has no settings page for; which product it is was never established.

| Servo on programmer | Generation | Model | Mode |
|---|---|---|---|
| V1 on V1 | read | read (name) | read |
| MK2 on V2 | read | read (name) | read |
| V1 on V2 | read (bootloader) | not readable: carried over if the servo was read on the V1 programmer; otherwise measured from its current in continuous rotation (MAX+ or MINI+); otherwise picked | carried over, otherwise measured |
| MK2 on V1 | read (bootloader) | not readable: carried over if the servo was read on the V2 programmer (seen working on a real MINI MK2, 2026-11-10), otherwise picked | carried over, otherwise unknown |

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
