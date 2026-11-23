# UX improvement log: Simulation (Setup → Path planning → Run & review)

All work is local and uncommitted on `testing`, per the user's request. I verified it in the real Electron app (Playwright driving `electron.exe` with the BIOBUZZ red example route `examples/biobuzz-red-auto.json` and a fresh project) and with unit tests. The browser preview cannot run physics ("Preview only"), so it was used only for layout.

## Baseline (before changes)

- Unit suite: 261/262 pass. `24 barriers and many pins plan quickly` already failed on a time budget (about 7 s against 5 s), including when run alone.
- `tests/simulation-ui.cjs` (Electron E2E) already fails on the current working tree. Its first check expects the Settings touch-keyboard default to be on. With that check skipped, it stops at `#sim-appearance`, which another session put inside a `<div hidden>`. Neither is related to this work. The E2E suite needs updating to match the current Setup layout.

## Iteration 1: Run & review answers "did it work?"

**Problems seen in the real app (BIOBUZZ red auto):**
- Three unexplained times: the status said "Finished in 10.53 s", Run analysis said "Run time 14.6 s" (it was really time recorded so far and kept growing), and the clock read 0:16.
- Diagnostics reported "1 contact event" while the status said "No zones touched". The count included the robot starting flush against the wall.
- Nothing said where time was lost or what to change, and nothing linked back to the path.
- Run analysis duplicated the Summary block below it.

**Changes:**
- New `ui/sim-report.js`, a pure report builder plus renderer, unit-tested in `tests/sim-report.test.cjs`. From the recorded frames it shows:
  - A verdict.
  - Route time against the autonomous period.
  - End-point error and sensor-estimate drift.
  - Contacts with wall, structure or no-go zones that began after leaving the start pose, tied to the path where each happened.
  - Points.
  - A per-path time bar split into driving, turning in place, stopped for an action or pause, and stopped idle. Clicking a path replays its start.
  - Up to three data-grounded next steps with **Edit path N** buttons.
  - A note that results are simulated estimates.
- The report replaces the duplicate "Run analysis" box. The Summary row "Run time" is renamed "Time recorded".
- Diagnostics' contact count uses the report's start-aware count. "Currently touching" a wall only applies while a route is moving.
- `DeckSimData.create()` gains `seek(seconds)`.

**Found while verifying:** The app's CSP (`style-src 'self'`) ignores `style` attributes, so the bar widths are set through the CSSOM. Time spent standing still to shoot was first reported as "stopped, nothing running"; mechanism commands now count as action time.

**Result on the example route:** "Route finished cleanly in 10.5 s · 19.5 s to spare". Path 6 is the longest leg at 3.0 s, and the robot stands still for 3.7 s of actions (mostly shooting at the ends of paths 1 and 5). The suggestion to run actions while driving points at a feature the app already has (action paths).

## Iteration 2: Path planning shows time and makes Optimize findable

- After edits settle, the planned route is test-driven in the background with the same `evaluate` call Optimize uses (about 1.1 s; it returned exactly the Run time, 10.53 s). The status line shows "Route checks passed · about 10.5 s in simulation", flagged if it is over the autonomous period or the test drive touched something or missed the end point. It waits while a route is being driven, but runs once the route has finished even if the practice clock is still counting.
- Optimize gets a plain-language explanation. Saved Optimize rows are labelled "Last Optimize test drives:", because example files can hold stale results (13.33 s next to a current 10.5 s). The run report suggests Optimize when it has not been run.
- Run & review with no route now says "No route yet…" and shows **Go to Path planning**. Before, Run failed with "Set a starting pose and add route pins first."
- Start pose fields show 2 decimals (`10.11` instead of `10.105999999999993`).

## Iteration 3: Setup honesty

- The "Physical game elements" hint said mechanisms and scoring were not included, which is false: with elements on, step 3's mechanisms pick up and score. It now says what the checkbox does (balls on or off).
- The Custom robot specs start with a **Measure your robot** note. Numbers the CAD did not fill in are an example robot, and simulated speed, timing and collisions come from them.

## Iteration 4: One vocabulary for paths

- The Diagnostics legend described "Yellow / White" markers, but light theme draws them brown and black. It now says "Numbered markers on the field are path end points: red has a clearance or path issue, amber pauses or runs an action, plain only drives."
- UI copy now says path and end point instead of pin: the left run status ("from the last path’s end point"), the "Paused at end of path" telemetry row, the planning banner ("Path 3" instead of "Pin 3", matching the **Edit path N** buttons), the Diagnostics empty states, the plan-error status, and **Clear all paths**. Element ids, Java telemetry and export text are unchanged; tests match those.

## Verification

- Unit tests: 265 tests, 264 pass. The one failure is the pre-existing planner time-budget test.
- `tests/sim-report.test.cjs`: 3/3 pass. It covers per-path splits, ignoring start-pose wall contact, attributing a contact to its path, the time-limit verdict, and unlinked legs when leg and path counts differ.
- Electron probe after iteration 4: same 10.53 s result, new wording in status, Diagnostics and banner, no page errors.
- Electron probes: run report content and layout in light and dark; Edit path jumps to Path planning with that path selected; bar click replays at 3.02 s; planning estimate appears on load and after an edit, including right after a run; no-route guidance and the Go to Path planning button; robot-step note.

## Self-evaluation (0–5, evidence above)

| Category | Before | Now | Notes |
|---|---|---|---|
| Beginner friendliness | 3.0 | 3.8 | Run & review now explains results. Path list editing is still dense. |
| Navigation clarity | 3.5 | 4.0 | Report and no-route links go back to the exact path or step. |
| Visual quality | 3.5 | 3.8 | Report uses the existing tokens. Left column and right panel still repeat telemetry. |
| Workflow efficiency | 3.0 | 3.8 | Time estimate without pressing Run. Edit-path jump. |
| Learnability | 3.0 | 3.6 | Next steps teach cause and effect. Path-modifier legend is still terse. |
| Error prevention | 3.0 | 3.6 | False contact warning removed. Over-time flagged before running. |
| Technical functionality | 5.0 | 5.0 | No engine, planner, export or file-format change. All capabilities kept. |
| Simulation integrity | 4.5 | 5.0 | Every reported number comes from recorded frames or the same physics test drive. Estimates are labelled. |

The 4.5 targets for beginner categories are not yet met. The next iteration is below.

## Next iteration prompt

**Current state:** Run report, planning time estimate, Optimize discoverability, no-route guidance and Setup honesty fixes are in and verified as above.

**Remaining problems:**
1. The path list's colored dots are explained only in the Help tab.
2. Run & review's left column and the Data panel repeat telemetry, and the Play/Stop/Reset row sits beside Run with no explanation of the difference.
3. The E2E suite `tests/simulation-ui.cjs` is broken by earlier Setup changes, so there is no automated end-to-end guard.
4. Planner perf test over budget (pre-existing).

**Constraints:** Keep planner, engine, follower, export formats and saved-project shape unchanged. Keep `#sim-run-status` text (tests match "Finished in … No zones touched").

**Next objective:** Repair `tests/simulation-ui.cjs` for the current Setup layout (hidden `#sim-appearance`, touch-keyboard default) so the whole beginner flow has an end-to-end guard. Then remove the telemetry repeated between Run & review's left column and the Data panel, and explain Play/Pause vs Run.

**Files:** `ui/simulation.js` (pinPanel, refreshDiagnostics, run status), `ui/sim-workspace.css`.

**Acceptance:** Electron probe of the example route shows consistent wording in Paths, Diagnostics, Run status and the report. Unit suite unchanged. E2E selectors untouched.

# Pass 2 (24–25 October): Run & review by intent

Committed on `testing`, not pushed. Other sessions worked in this folder throughout. This pass waited for them, built on their commits (`73b54f7` three Run & review tabs, `bd7e618` Record, `bee8ad7` stage rings, `9d5e9ed` 3D preview), and committed only its own hunks. The video-layout session's uncommitted Run-column changes were left in the working tree as that session left them.

## Iterations

| # | Commit | Problem seen (Electron, BIOBUZZ red example) | Change |
|---|---|---|---|
| 1 | `a4b782d` | Before a run, Data showed an empty timeline and blank graphs; after a run nothing pointed to the next step. | Data became **Results**: a "Ready to test" card before the first run, the report's next-step row (Fix path N, or Export to your robot, plus See each step), and Run opens Results. Robot-at-this-moment and robot-log compare fold away. |
| 2 | `f83d421` | The time bar filled the width with 10.5 s of a 30 s period. Leg breakdowns were only in hover tooltips. Clicking a leg hid the whole report (pre-existing bug). | The bar is drawn on the period's scale with spare time and second ticks. The chosen leg (longest by default) shows its breakdown in words and is marked on the field. The report-hiding bug and a stuck replay slider are fixed. |
| 3 | `1518f78` | Stage tabs said nothing about state. A route that could not run still said "Press Run". | Stage state marks (later turned into rings by `bee8ad7`). A blocked route shows "Fix the route before running it" with Fix path N in Results and the Run column. Route-check text says path/end point instead of pin. |
| 4 | `632dba2` | Export opened with six format buttons and a 60-word note; Send to robot was below them. | **Put it on your robot**: Send to robot (Guided check folded, opens after a successful build), then the one file to save. Other formats, What Run plays and Save this run fold away. |
| 5 | `164f706` | Readiness text sat below the live readout (cut off at 800 px). Three period inputs were always shown. | Readiness under Run, controller help and readout scroll, period lengths fold into one line. What Run plays hides when there is no choice. |
| 6 | `792294b` | Two tips pointed to "Path planning → Paths → Route", which does not exist. | Tips say Route options and carry Open Optimize / Open Space around obstacles, which turns Route options' page on short screens and focuses the setting. |
| 7 | `5b23306` | "Sensor estimate" was jargon in the report. | "Position tracking: the robot's own estimate was 0.2 in off at the end", with the technical meaning as the label's tooltip. |

A first full-match attempt in iteration 5 moved the controller help under Run too. Review showed it squeezed the readout to ~120 px in full-match mode, so the help went back to the scrolling part before committing.

## Measured: what a user sees by default

Rendered controls (buttons, inputs, selects, summaries) and words, closed folds excluded, 1280×800, before any run. Baseline is `bd7e618` loaded without its physics runtime; with physics, the old Data view also shows empty graphs before a run, so its real count is higher.

| View | `bd7e618` | `5b23306` |
|---|---|---|
| Results (was Data) | 5 controls · 124 words | 1 · 43 |
| Export | 20 · 402 | 10 · 131 |
| Diagnostics | 2 · 64 | 2 · 68 |
| Run column | 9 · 49 | 7 · 75 (readiness now in view) |

Navigation (counted from the code paths, not user testing):
- Seeing the report after a run: one view click if Results was not open → none (Run opens Results).
- From a clean run to the robot export: Export tab, then scan six formats → Export to your robot → lands on Send to robot / the one file.
- Fixing a blocked route: Run fails, then find the path in Path planning → Fix path N opens it.
- Following the Optimize tip: two or three clicks to a place the tip misnamed → one click, focused.

## Where everything is now

- **Results:** run report (verdict, facts, next step, time bar, leg breakdown, tips), Replay the run (timeline, graphs, Choose graphs, summary), Robot at this moment (folded), Compare with a robot log (folded).
- **Export:** Send to robot (description and Guided check folded), the main file (OnBot Java / MotionModule / timed) with its note, Before you run it on the robot (with the device-name reminder), Other formats and file options (Route Java, .pp, TeamCode, Pedro Pathing 3, keep updated, Java names), What Run plays (route / OnBot export / Java program, steps, Java editor), Save this run (WPILOG, run video).
- **Diagnostics:** Route checks and Run output, as `73b54f7` left them.
- **Run column:** clock, mode, Run, speed, Record, status, readiness, controller help, live readout, period lengths (folded).

No element id was removed. No engine, planner, follower, exporter or saved-file change. The BIOBUZZ example still finishes in 10.53 s and Lunala in 9.77 s, as before.

## Verification

- Unit suite: 360/360 at `5b23306` (357/357 before this pass). `tests/sim-report.test.cjs` gained the next-step and tip-link tests.
- `tests/simulation-ui.cjs` (Electron E2E): 16/16 after iteration 4 (that run overlapped other sessions' edits to the same files), and 16/16 again at `5b23306`, with the video-layout session's uncommitted Run-column changes in the working tree.
- `tests/robot-setup-app.cjs` (Send to robot + Guided check with the folded check): pass.
- Electron probes for every iteration, with screenshots: clean run, a blocked route (path 6 moved into a structure), a not-optimized plain route, saved examples (Lunala, dual-red), 1366×768 dark, 1024×640, 1024×600 (Route options paged).
- Not done: no real students, no touchscreen (tooltips do not appear on touch), no physical Steam Deck or Mac.

## Remaining opportunities

- Setup → Mechanisms shows about 57 controls. Most change simulated results, so folding them needs care; left for a focused pass.
- The live readout in the Run column and the Results graphs overlap in content.
- Route-check messages are translated from "pin" for display; the planner's own messages could say path/end point directly, but Run parses the pin number from them.
- Tooltips (Position tracking, stage reasons) are not reachable by touch.

# Pass 3 (22 November): Impeccable and Emil Kowalski's design skills

Both skills are installed in `.claude/skills` (`impeccable`, `emil-design-eng`). Torque's own rules (`ui/tokens.css`, AGENTS.md → Design) win wherever a skill disagrees.

## What the skills found

- **Impeccable's detector** (`.claude/skills/impeccable/scripts/impeccable detect`) reported 13 findings on `ui/`. Each one was checked in the running app, and none needed a change:
  - It calls Inter "overused", but the user chose Inter.
  - "Cramped padding" fires on segmented troughs and on column dividers.
  - The path-row "side stripe" is already overridden in `workspace.css`.
  - The `<img>` it calls broken gets its source from the Driver Station's camera.
- **Emil's checklist:** Torque already does most of it. Presses scale to .97, the ease-out curve is custom, and popovers open from their trigger. Nothing uses `transition: all` or `ease-in`. One real gap was found: hover looks stay on a tapped button on a touchscreen.
- **Considered and declined:**
  - Dialog exit transitions. The UI tests run hidden windows, where a transition never finishes, so a closing dialog would stay on top.
  - Fades under reduced motion. Torque turns all motion off there, by choice.

## Changes

| Before | After | Why |
| --- | --- | --- |
| A tapped button kept its hover look until the next tap somewhere else, in Torque and the Driver Station. | `ui/pointer.js` marks the page `data-touch` after a finger. All 105 `:hover` selectors carry `:not(:where([data-touch] *))`, which adds no weight to a selector. A mouse or trackpad move takes the mark off. | Touchscreens, the Steam Deck among them. `@media (hover: hover)` can't tell, because the Deck's trackpads make the main pointer a mouse. |
| The text caret was the text colour. | The caret takes the theme's accent. | The accent marks where you are. Checked in Torque, light and orange themes. |

## Verification

- **New `tests/touch-hover-ui.cjs`:** it sends real touch and mouse input through the DevTools protocol, on Torque's ⋮ button and the Driver Station's. It proves three things:
  - The tapped button still holds `:hover`, and without the mark its hover look would stick.
  - With the mark, the button looks as it did before it was tapped.
  - A mouse move brings the hover look back.
- **Existing checks:**
  - Unit suite: 1103 passed, 25 skipped, 0 failed.
  - `design-audit`: 64 screen and theme combinations pass.
  - `layout-audit` passes, in Inter and in OpenDyslexic.
  - `window-fit-ui` passes.
- **Screenshots:** 50 pairs, before and after. They cover Drive, the menu, the Wi-Fi list, the shortcuts dialog, Settings, Setup → Robot, Calibrate → Electronics and Simulate → Path planning, plus typing in a field. Each was taken at 1280×800 in dark, light, orange and blue themes, and at 1920×1080 in dark and light. The pictures match apart from clocks, live dots and the field animation.
