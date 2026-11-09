# Mechanism library: changelog

## 2026-11-06

### Catalog
- New reference library: 247 canonical records in `ui/sim-mech-library-data.js`. They were researched in five batches and merged, and 7 duplicates were folded into their canonical records during review.
  - By category: BIOBUZZ 20, intakes and claws 25, lifts and slides 22, arms and linkages 26, shooters and scoring 28, moving pieces inside 23, hang and endgame 11, drive and odometry 37, sensors and cameras 35, other robots 20.
  - By kind: 111 mechanisms, 31 subassemblies, 24 components, 19 sensors, 22 control setups (software), 21 robot architectures, 19 concepts.
  - 183 records move on the model through an existing joint type. The other 64 are reference only (sensors, software, concepts, some architectures).
- Each record has id, name, aliases, category, tags, entry kind, family, an optional parent, joint type and preset, short and detailed explanation, uses, pros, cons, failure modes, DOF, actuation, motion in/out, parameters with units and estimate flags, seasons, legality status with the rules checked, references (405 in total), image provenance with kind, difficulty, confidence, status and verified date.
- BIOBUZZ entries are game presets of the generic mechanisms (each has a `parent`). They were checked against the TU08 manual, and the rule summary is in `biobuzz-rules.json`.
- Legality: 84 records are rule-checked against named rules, 155 are not-verified, and 8 are not-allowed. Those 8 are all hanging from ARENA elements, which BIOBUZZ G415 prohibits. No note claims a design is legal.
- Images: 91 records have a labeled image: 45 mechanism photos, 26 photos of one part it uses (each says which part), 8 CAD renders, 6 schematics and 6 illustrations. The other 156 show the app's drawing rather than a misleading photo.

### App
- `ui/sim-mech-library.js`: the schema, `validate()` (required fields, units, choice parameters, legality wording, date, seasons, DOF, parents, duplicate names), `words()` for search, and `photos()` for the photo cache.
- Add a mechanism picker (`ui/sim-mechanism-list.js`):
  - Library cards with a kind chip and an image-kind label.
  - A detail panel: overview, how it works, configure, engineering notes, references, and Add to robot.
  - Search over aliases, plus filters for kind, difficulty, what drives it, season and has-a-photo.
  - Reference-only records cannot be added. A record that is more than one joint says it adds one joint, and that joint is named for itself (for example "Hip").
- Add to robot uses the existing joint path. It applies the record's preset (named positions, travel, speed). The record's own actuation (motor, servo, continuous servo, linear servo) replaces the type's usual one. Part names are kept short.
- References open in the browser through a new `open-reference` IPC (`src/main.cjs`, `src/preload.cjs`). It only opens pages the library itself cites.
- Photos are cached the same way as Configure Robot's (`ui/ftc/device-art.js` merge; `src/device-photos.cjs` prefetch skips mechanism photos).
- `tools/preview.cjs` serves the new files.

### Tests
- `tests/mech-library.test.cjs`: every record passes the schema, the stricter rules each catch their case, spinning parts' presets are in degrees, and each alias belongs to one record.
- `tests/mech-library-ui.cjs` (new UI test): a card and its chip, the panel sections, Add to robot with the preset, alias search, filters, and reference-only records.
- `tests/sim-wiring.test.cjs`: an Expansion Hub port picked for a sensor gives the robot an Expansion Hub (code audit AUD-1).
