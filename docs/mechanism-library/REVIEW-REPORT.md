# Mechanism library: review report

## How it was reviewed
- The developer (main session) set the schema, merged the catalog and applied fixes. A code agent built the picker.
- Five research agents each wrote one batch of records.
- Reviewers were separate agents in fresh contexts. None of them wrote any of the work they reviewed, and none saw the developer's reasoning. They checked the data and the code directly.
  - **Code audit (round 0), `review-0-code-audit.json`:** 14 issues (AUD-1..14) in this session's earlier code changes. Status of each is in `issues.json`.
  - **Catalog review (round 1), `review-1-catalog.json`:** 43 issues (REV-1..43). There were no blockers. The 19 majors were mostly duplicate canonical records, plus over-strong legality wording, image-kind mislabels and two wrong rule citations.
  - **Round 2, `review-2.json`:** confirmed 39 of the 41 round-1 fixes in the data. It found 14 new issues, including one MAJOR (R2-1: spinning-part presets in the wrong units). **Verdict: REJECT.**
  - **Round 3, `review-3.json`:** confirmed REV-9, REV-21 and the round-2 fixes. It found 6 minor issues, all fixed afterwards. **Verdict: APPROVE.**
- Every change made in response is listed in `review-fix-log.txt`, and the merge normalizations are in `merge-log.txt`.

## Tests executed
These are the latest runs on this machine.

| Command | Result |
|---|---|
| `electron --test --test-concurrency=1 tests/*.test.cjs` | 953 / 953 pass. This ran before the round-3 code changes, and the library unit tests were re-run after them. |
| `electron --test tests/mech-library.test.cjs tests/pinout.test.cjs tests/preview-assets.test.cjs tests/mech-catalog.test.cjs` | All pass after the round-3 changes. |
| `tests/mech-library-ui.cjs`, `tests/mechanisms-ui.cjs`, `tests/cad-tab-ui.cjs` | All passed, and were re-run after the round-3 changes. The final results are in the session summary. |
| `tests/simulation-ui.cjs` | Full Simulate regression; see the session summary for the final result. |

## What is verified
- **Schema:** every record passes `validate()`.
  - Unique ids, valid categories and existing parents.
  - Units on every parameter.
  - No legality note claims a design is legal, and rule-checked records name their rules.
  - Spinning-part presets are in degrees.
  - No alias belongs to two records.
- **BIOBUZZ records:** checked against the TU08 manual by the researcher, and again by the round-1 and round-3 reviewers.
  - Ball sizes, HIVE, CELL, FLOWER, GARDEN and LOADING ZONE.
  - Rules G405, G407–G411, G415–G418, R102, R105, R301, R303, R501–R503, R506 and R707/R708.
  - No record recommends tipping the HIVE other than by launching, grabbing FLOWERs, removing NECTAR from FLOWERs, putting NECTAR into a FLOWER before the last 60 s, or catching elements falling from a tipped HIVE (G409).
- **Links:** the round-1 reviewer loaded 110 non-Wikipedia reference URLs. All loaded except one Thrifty Bot page, which was rate-limited.
- **Security (code review):**
  - Record text is escaped before it is shown.
  - `open-reference` opens only exact URLs the bundled data cites, and only from the app's own window.
  - Photo cache keys cannot collide.

## What remains uncertain
- **R303 wording (R3-6):** the exact TU08 R303 example list was not readable by the tools. Records that had claimed R303 "lists" a part were softened to a neutral note marked not-verified, and should be re-checked against the manual.
- **Wikimedia images (REV-32):** 7 Wikimedia images (hexapod, delta robot, self-balancing, walking linkage, slip ring, strain wave and differential) could not be loaded by the reviewer because of HTTP 429, so their licences were not checked here. All are Commons files except one.
- **Defaults:** parameter defaults marked `estimate: true` are generic starting values, not measurements.
- **Motor swaps (R3-2):** a record that swaps a servo type to a DC motor (motor-wrist, four-bar) gets a 312 rpm motor with no reduction, so its speed is unrealistic until the team sets its gearing.
- **Spec scope (Parts F–H) is not done in this round.** The existing engine already has:
  - a closed-loop solver for four-bars, slider-cranks and parallel links;
  - CAD joint finding with manual override;
  - "Your own" pivot, slide and spin with route actions.

  Still missing:
  - per-mechanism parametric editors (a link-length four-bar designer, slide stage sequencing UI);
  - the full custom-mechanism authoring workflow (templates, export and import, motion sequences);
  - linkage-solver configuration driven from the catalog.

  Records are added as one joint of their type with a preset, and the team builds the rest with the existing joint tools.
- **Escape key:** Escape closes the whole picker rather than stepping back from the detail panel.
