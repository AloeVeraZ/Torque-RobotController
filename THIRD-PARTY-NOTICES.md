# Credits and third-party notices

Torque's own code is MIT licensed (see [LICENSE](LICENSE)). It stands on the
work of the people and projects below. Thank you to every one of them for publishing their
work openly so FIRST teams can learn from it and build on it.

Every release bundles the full license text of each component listed here. In an installed
app they are under `app/ui/vendor/licenses/`, `app/sim-runtime/driver/`,
`runtime/java/legal/` (macOS: `Contents/Resources/runtime-java/legal/`), `app/ui/fonts/`
and `app/licenses/`, and Electron's runtime notices are in `runtime/LICENSE` and
`runtime/LICENSES.chromium.html`.

## Simulator

| Component | Author | License | Used for |
| --- | --- | --- | --- |
| [DSIM](https://github.com/genius0412/dsim) (DECODE 2D Simulator), commit `0df84143` | Dohun Kim ([@genius0412](https://github.com/genius0412)) | PolyForm Noncommercial 1.0.0 (source-available, **noncommercial use only**) | Field physics, field drawings and the BIOBUZZ field model |
| [Pedro Pathing](https://github.com/Pedro-Pathing/PedroPathing) 3.0.2, commit `cf4be314` | Pedro Pathing team | BSD 3-Clause | Historical drivetrain adapter math; no follower library is shipped or used |
| [Rapier](https://rapier.rs) 2D 0.19.3 and 3D deterministic 0.20.0 | Dimforge | Apache License 2.0 | Rigid-body physics inside DSIM |
| [three.js](https://threejs.org) 0.186.0 | three.js authors | MIT | 3D field view |
| [Clipper](https://sourceforge.net/projects/jsclipper/) (clipper-lib 6.4.2) | Angus Johnson; JavaScript port by Timo | Boost Software License 1.0 | Obstacle outlines for route planning |
| [dijkstrajs](https://github.com/tcort/dijkstrajs) 1.0.3 | Thomas Cort and contributors | MIT | Shortest routes on the planning graph |
| [occt-import-js](https://github.com/kovacsv/occt-import-js) 0.0.23 | Viktor Kovacs | LGPL-2.1 | Importing your own STEP robot models |
| [Open CASCADE Technology](https://github.com/Open-Cascade-SAS/OCCT) (inside occt-import-js) | Open Cascade SAS | LGPL-2.1 with the OCCT exception | CAD kernel for STEP import |
| [Eclipse Temurin](https://adoptium.net) OpenJDK 21.0.12.1+1 (reduced with jlink) | Eclipse Adoptium, OpenJDK contributors | GPLv2 with the Classpath Exception | Runs the Deck controller and Java team code |
| [Gson](https://github.com/google/gson) 2.11.0 | Google | Apache License 2.0 | Simulator bridge JSON support |

**DSIM's Required Notice:** Copyright 2026 Dohun Kim (https://github.com/genius0412).
DSIM is not open source. Its license lets anyone use, study, change and share it for
noncommercial purposes; commercial use needs the author's permission. Torque
is free and noncommercial. The simulator changes DSIM at build time (see
`tools/simulation/build.cjs`): field outlines for custom footprints, drive current and
braking models, coasting with `FLOAT` motors, and static friction. Those changes are
described in `docs/SIMULATION.md` and are shared under the same license.

**Historical adapter attribution:** the simulator retains drivetrain mixing/saturation
math developed while integrating Pedro Pathing. Its BSD notice is preserved in
`ui/vendor/licenses/PEDRO-LICENSE`. The current planner, Deck controller and FTC hardware
adapter are application code; no Pedro follower, localizer or runtime dependency is included.

**LGPL components:** occt-import-js and Open CASCADE are shipped unmodified as separate files
(`sim-runtime/occt/occt-import-js.js` and `.wasm`), which you may replace with your own build.
Their source is at https://github.com/kovacsv/occt-import-js (tag v0.0.23) and
https://github.com/Open-Cascade-SAS/OCCT.

**Java runtime:** the bundled runtime is Eclipse Temurin, reduced to the modules the simulator
needs. Its source is at https://github.com/adoptium/jdk21u, and its full notices travel with it
in `legal/`.

## FTC SDK compatibility

The simulator compiles your exported team code against small stand-in classes with the same
names and method signatures as the parts of the FIRST Tech Challenge Robot Controller SDK it
uses (`com.qualcomm.robotcore`, `org.firstinspires.ftc`), so the same code runs on the virtual
Control Hub and on a real robot. These stand-ins are written for this project and contain no
SDK code. The FTC SDK itself (BSD 3-Clause Clear, by FIRST) is not included; teams use their
own copy of [FtcRobotController](https://github.com/FIRST-Tech-Challenge/FtcRobotController)
when they build for a real robot.

## App

| Component | Author | License |
| --- | --- | --- |
| [Electron](https://www.electronjs.org) 44.8.0, with Chromium and Node.js | OpenJS Foundation and contributors; The Chromium Authors | MIT; Chromium's BSD-style and third-party licenses (`LICENSES.chromium.html`) |
| Code adapted from Chromium | The Chromium Authors | BSD 3-Clause (`licenses/CHROMIUM-GAMEPAD.txt`) |
| [Inter](https://rsms.me/inter/) | The Inter Project Authors | SIL Open Font License 1.1 |
| [Barlow Condensed](https://github.com/jpt/barlow) | The Barlow Project Authors | SIL Open Font License 1.1 |
| [NSIS](https://nsis.sourceforge.io) (Windows installer, build only) | NSIS contributors | zlib/libpng license |

## What is not included

Public releases contain no CAD or artwork whose terms do not allow redistribution. The official
FIRST field CAD, the goBILDA Strafer and NYC FIRST A301 Swechanum chassis models, and the
BIOBUZZ field mesh are not shipped. Without them the simulator draws fields from DSIM's own
code-drawn layouts and the real physics outlines, and robots as plain footprints. You can still
import your own STEP robot model, which stays on your computer.

Axon's servo firmware is not included either, and nor are the keys to its encrypted files. When a
student switches a servo's mode, Torque asks, then downloads the file from Axon's own link or uses one
the student picks, and opens it with a key file the student imports (docs/AXON.md).

## Trademarks

Torque is an independent, free project. It is not affiliated with, endorsed by or
sponsored by FIRST, FIRST Tech Challenge, RTX, Valve, goBILDA (Servocity), REV Robotics,
Axon Robotics, Qualcomm, Google, the Pedro Pathing team or Dohun Kim. FIRST®, FIRST® Tech Challenge, FTC®,
DECODE™ and the FIRST logo are trademarks of FIRST (For Inspiration and Recognition of Science
and Technology). Steam Deck is a trademark of Valve Corporation. Other names are trademarks of
their owners and are used only to describe compatibility.

If you hold rights in anything here and have a concern, please open an issue at
https://github.com/AloeVeraZ/Torque-RobotController/issues and it will be addressed promptly.
