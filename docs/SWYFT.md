# SWYFT Programmer

Calibrate's SWYFT Programmer (a tool beside Debug) programs SWYFT servos through SWYFT's USB servo programmer. It offers everything SWYFT's own
app (SWYFT Servo Programmer V2, 2.0.0) offers, laid out like the Axon Programmer tab (see [AXON.md](AXON.md)).

## The tab

- **Always there:** with no programmer plugged in, the whole tab stays as a preview of SWYFT's defaults, greyed and out
  of reach (`inert`), and the bar at the bottom says what to plug in. The Axon Programmer tab does the same.
- **Top:** the state of the programmer (with its COM port) and of the servo, in words, and a Simple | Advanced switch.
- **Servo:** Speed, Balance, Torque, Slim and Nano: SWYFT's programmable servos. (SWYFT's continuous-rotation-only
  Speed is left out: SWYFT says it is not programmable.) The programmer cannot tell SWYFT servos apart: no reply names
  a model. The student picks one, it is remembered, and it only changes what is shown, never what is written.
- **Mode:** Servo Mode or Continuous rotation. In SWYFT servos continuous rotation is a setting, not firmware: both
  travel sides at 255. SWYFT says it is full speed either way only.
- **Settings:** Simple is four settings: Travel, Direction, Max power (as a percentage) and Stall protection. Advanced is
  rows, and adds Min, Middle and Max
  signal, Ramp mode, Dead zone, and the P, I, D and Integral speed coefficients, with SWYFT's default beside each.
  With no servo plugged in, the rows preview SWYFT's defaults, disabled.
- **Side:** what the servo reports, Read, Defaults (fills in SWYFT's recommended settings; nothing is written until
  Apply), What happened (a table of what was asked and what the servo now reports), and in Advanced: differences from
  SWYFT's defaults, the servo's raw reply, the programmer's USB details and the serial log.
- **Bar:** one line saying what is going on and what comes next, Discard and Apply.

## How it works

- `src/swyft-servo.cjs`: the protocol, read out of SWYFT's app (its .NET code) on 2026-11-13 and checked against a
  real SWYFT Speed servo. 115200 baud, 8 data bits, no parity, 2 stop bits, one wire: the programmer (a CP2102,
  USB 10C4:EA60) joins TX and RX onto the servo's signal wire, so every byte sent comes back as an echo first.
  A frame is 20 bytes: `55`, 17 bytes, a checksum (low byte of the sum of bytes 1-17), `AA`.
  - Read: all zeros between the markers. The reply carries the settings with bit 3 of byte 3 set.
  - Write: the settings with bit 1 of byte 3 set. The servo acknowledges with bit 2 of byte 3 set.
  - Bytes: 1 P, 2 I, 3 flags (bit 0 reverse, 4 stall protection, 5 ramp), 4 left travel, 5 dead zone,
    6 integral speed, 7-8 D, 9-10 min signal, 11-12 max signal, 13-14 max power, 15 right travel,
    16-17 middle signal (16-bit values little-endian).
  - Travel in degrees, as SWYFT's app shows it: side = round((degrees × 19 + 420) / 50), the same both sides.
    270° is 111, 320° is 130. One side step is about 2.6°, so the slider steps through the angles a servo can hold.
- `src/swyft-programmer.cjs`: the service, the same shape as the Axon one. The port is open only while the tab shows.
  It polls the servo with a read every 1.2 s (how a servo plugged in or pulled out shows; two missed reads and it is
  gone), runs one job at a time, and pauses while SWYFT's own app is open (it holds the same port). A write is: read,
  merge the changes, check every value against SWYFT's limits, write, wait for the acknowledgement, read back and
  compare. Only CP210x ports (Silicon Labs' VID) are opened; other USB serial ports are listed, never sent anything.
- `src/swyft-serial/SwyftSerial.exe`: the small Windows helper that opens the COM port, built from `SwyftSerial.cs` by
  `tools/build-swyft-serial.cjs` with the C# compiler that ships with Windows. It lists only USB serial ports, which
  leaves out a laptop's built-in Intel AMT port: SWYFT's own app can connect to that one by mistake and then times out.
- Every frame is logged to `swyft-serial.log` in Torque's data folder.

Differences from SWYFT's app: it waits 80 ms after sending, throws away what arrived, then waits 600 ms. Torque keeps
every byte and skips the echo by matching it, so a fast reply cannot be thrown away with the echo. Torque also reads the
servo back after every write.

## What is not confirmed

- Writing: confirmed on a real SWYFT Speed servo on 2026-11-13 (servo mode at 270°). The servo echoes the write, then
  acknowledges with the settings and byte 3 = write | ack | its flags (`0x37` there), then answers reads as usual.
- Moving the servo: SWYFT's programmer has no pulse output. Servo pulses drawn out of its serial data (921600 baud,
  0xFF high, 0x00 low) were tried on 2026-11-13: a real Speed servo did not move, even when it was powered up into them.
  So the tab has no Test; moving a SWYFT servo needs a real pulse source (a Control Hub servo port, say).
- Linux and macOS: the helper is Windows only.

## Tests

```
ELECTRON_RUN_AS_NODE=1 .cache/runtime-win32-x64-44.8.0/electron.exe --test tests/swyft-programmer.test.cjs
DECK_ELECTRON=path/to/electron DECK_PLAYWRIGHT=path/to/playwright node tests/swyft-programmer-ui.cjs
```

The simulated programmer and servo are `tests/fixtures/swyft-sim.cjs`. Its settings are what the real Speed servo held.
