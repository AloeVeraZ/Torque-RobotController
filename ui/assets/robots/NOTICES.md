# Bundled chassis examples

These are locally prepared visual references from the specific CAD files requested by the
user. No vendor hardware, control software or CAD authoring program is included.

- **goBILDA Strafer kit (the Starter Mecanum):** the team's own assembly of goBILDA's Strafer 3209-0001-0007
  (https://www.gobilda.com/strafer-chassis-kit-104mm-gripforce-mecanum-wheels/) with a REV Control Hub (REV-31-1595),
  a goBILDA Pinpoint (3110-0002-0002) and two goBILDA 4-Bar Odometry Pods (3110-0001-0002) placed on it, exported as
  `104dia wheel test.step` (SHA-256 `29dea1aadddb5b15fe800b185cbfb2e9f9078e6959f57dff5212e35832d36e4b`).
  Source +Y is the front (the hub's USB side and the Pinpoint's X arrow point that way) and +Z stays up. The hub, the
  Pinpoint and each pod are groups of their own, so the app can move them; the four mecanum wheels are animation groups.
- **Its other two wheel sets**, put on the same four axles by `tools/simulation/finish-robot.mjs`; the app shows one set:
  - 140 mm mecanum wheels, from goBILDA's 140 mm Strafer kit: https://www.gobilda.com/content/step_files/3209-0012-0002.zip,
    `3209-0012-0002.step` (zip SHA-256 `5c12e12ab89ec070ece651a9b8d17a8db01f046e52784840c6aba752bc1b4fea`).
  - 96 mm mecanum wheels: https://www.gobilda.com/content/step_files/3213-3606-0002.zip, `3606-0000-0096 assembly.STEP`
    and `3606-0100-0096 assembly.STEP` (zip SHA-256 `a48e182d6c8c0811ef7036dbd84b6467fb99e2260116fef796190849bb26fb3e`).
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

1. Run `tools/simulation/prepare-robot.py <STEP file> <name>` with that Python. For the Strafer kit that is four runs:
   the kit's STEP as `strafer`, the 140 mm kit's as `strafer-140`, and the 96 mm set's two `assembly` STEPs as
   `mecanum-96-a` and `mecanum-96-b`.
2. Each is written to `.cache/simulation-cad/<name>-native.glb`.
3. Run `node tools/simulation/finish-robot.mjs <name>` to build the compressed asset.

`inspect-robot.mjs` can inspect the intermediate assembly names and bounds. Only the curated
named wheel compounds and measured lower-pod height ranges are separated for animation.
