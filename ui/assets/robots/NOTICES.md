# Bundled chassis examples

These are locally prepared visual references from the specific CAD files requested by the
user. No vendor hardware, control software or CAD authoring program is included.

- **goBILDA Strafer 3209-0001-0007 (104 mm GripForce):** CAD supplied by goBILDA at
  https://www.gobilda.com/strafer-chassis-kit-104mm-gripforce-mecanum-wheels/ .
  Original STEP SHA-256: `4f617af5259bc311f0b1ae5a62eb08db5f05554e8ee257e1e61beeaaa0c73deb`.
  Source +Y becomes front and +Z stays up. The four complete named mecanum wheel assemblies
  are separate visual animation groups; the rest is a single static body.
- **Electronics on the Strafer:** the vendors' own STEP files, placed on the chassis by
  `tools/simulation/finish-robot.mjs` (each meshed by `tools/simulation/prepare-part.py`):
  - REV Control Hub, https://www.revrobotics.com/content/cad/REV-31-1595.STEP
    (SHA-256 `49f7e6052dfff89e0b7b984c111cdce2ff378133d1442694fc2b6398e9be72b8`).
  - REV Slim Battery, https://www.revrobotics.com/content/cad/REV-31-1302.STEP
    (SHA-256 `561422cad03c45d1d0de698b027d9dbb5b896be6011388a708e5954204263bde`).
  - goBILDA Pinpoint, https://www.gobilda.com/content/step_files/3110-0002-0001.zip, `3110-0002-0001.step`
    (SHA-256 `950e48b2e2799d528fe6de5beba8b81fe77c3a0017fc936dcfdbc2291df68f68`).
  - goBILDA 4-Bar Odometry Pod, https://www.gobilda.com/content/step_files/3110-0001-0002.zip,
    `3110-0001-0002 (0°) (FOR Ø96mm DRIVE WHEELS).step`
    (SHA-256 `0e7726b446e201dfab8c1527f045343813bff307376cca568b1ea95503f9dbbe`).
- **NYC FIRST A301 Swechanum:** full current chassis from the Google Drive CAD link in
  https://github.com/NYC-FIRST/SystemcoreTesting/tree/Revlib4-testing/CAD%20Models/A301%20Chassis%20Swechanum .
  Repository reference at preparation: `88917ef6ba8232be8615e69f05e2d537ca54213d`.
  File: `Chassis elec on side plates.step`, Drive ID `1NnRjIZPXAU0Skc-vQ3X827iI926KhYZ8`.
  Original STEP SHA-256: `12b4faa90bb6c012cac9e4c7e0de99e7291e4020786f1eefa0197bcfe36d88d6`.
  The chassis is inverted at the user's request: source +Y becomes front and -Z becomes up,
  placing the powered swerve wheels below the passive mecanum frame. Four measured wheel
  compounds and their lower holders animate; this does not reproduce a particular motor API.

Source CAD attribution and ownership remain with the original authors. No additional CAD
license or redistribution permission is asserted by this repository. These assets were
prepared for the user's local driver station; nothing was published.

Preparation uses Open CASCADE through `cadquery-ocp-novtk 7.9.3.1.1` and meshoptimizer 0.25.0
(MIT). The app does not ship those native preparation tools. Generated geometry is simplified
for rendering and stored as gzip-compressed GLB. Model geometry and animation are visual
only: route clearance and contacts use the confirmed footprint and drivetrain physics.

User imports never receive these curated groups: they are merged into one rigid body.

All simulator engine notices remain in `ui/vendor/licenses/` and `sim-runtime/`.

## Rebuilding locally

Cache the exact STEP sources above under `.cache/simulation-cad/`. Use a local Python
environment with `cadquery-ocp-novtk==7.9.3.1.1`; it is required only for preparation, not app
installation or operation. Install `tools/simulation/cad-deps-package.json` with its lockfile
into `.cache/cad-build-deps`. Then, for each `strafer` / `swechanum`:

1. Run `tools/simulation/prepare-robot.py <STEP file> <name>` with that Python. For the Strafer, also cache the
   electronics STEPs above under `.cache/simulation-cad/parts/` and run `tools/simulation/prepare-part.py <STEP file>
   <control-hub|slim-battery|pinpoint|odometry-pod>` for each.
2. Cache its native GLB as `.cache/simulation-cad/<name>-native.glb`.
3. Run `node tools/simulation/finish-robot.mjs <name>` to build the compressed asset.

`inspect-robot.mjs` can inspect the intermediate assembly names and bounds. Only the curated
named wheel compounds and measured lower-pod height ranges are separated for animation.
