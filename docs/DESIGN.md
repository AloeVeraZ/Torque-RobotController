# Driver Station presentation

The design follows the user's supplied brief: restrained desktop controls, clear
robot state, useful information density, and one component language across the
launcher, input diagnostics and the built-in FTC station. Fonts are bundled locally
under the SIL Open Font License; the app requires no font CDN or third-party page at
runtime. The look went through three earlier directions at the user's request (a
quiet desktop tool, MotionModule's dark rounded chrome, then BuildLens's shapes);
the current one is the rebuild below, and the earlier sections are kept as the record.

## The rebuild (2026-11-21)

The user said the interface "looks vibe coded" and asked for the whole front end to
be rebuilt, guided by [dribbble.com/tags/web-ui](https://dribbble.com/tags/web-ui)
and by what designers call AI slop. Fifteen critiques and catalogues of those tells
were read (among them the Fountain Institute's signs of a vibe-coded UI, Paralect's
21 patterns, the unslop-ui and avoid-ai-design rule sets, Refero's notes and two
Hacker News threads), and the app-shaped shots under the Dribbble tag were studied:
dashboards that use ink in place of an accent, hairlines in place of cards, small
corners, a display face for numbers, and a map or canvas as the one framed thing.

Measured on the real app before the change (34 screens, light theme): 248 capsule
shapes, 68 boxes inside boxes, 52 tiny tracked-capital labels, 257 runs of text
below 4.5:1 contrast, 80 status dots, blur on every screen's bar, one type family in
7 weights, 17 type sizes and 14 corner radii.

| Across the same 34 screens, light theme | Before | After |
| --- | --- | --- |
| Capsule shapes | 248 | 0 |
| Boxes (a border or fill round a group) | 223 | 47 |
| Boxes inside boxes | 68 | 0 |
| Tiny tracked-capital labels | 52 | 0 |
| Text below 4.5:1 (light / dark) | 257 / 95 | 0 / 0 |
| Shadows on things that do not float | 24 | 0 |
| Status dots | 80 | 1 |
| Blur, decorative gradients, side stripes | 23, 2, 3 | 0 |
| Buttons with an arrow glued on | 9 | 0 |
| Code type on plain words | 15 | 0 |
| Type families and weights | 1 family, 7 weights | 2 families, 4 weights |
| Corner radii in use | 14 | 2, 4, 6, 8, 10, 14 and round |

Middle dots in unit labels ("Length · in") and in one-line summaries were left: they
are a convention the app uses consistently, and several tests read those strings.

### The rules (they head `ui/tokens.css`)

1. **Ink does the work.** Structure is type, space and hairlines. The main action is
   solid ink. Colour is kept for the robot's state (green live or done, amber look
   here, red stop or wrong) and for the two alliances on a field. There is no accent
   hue: blue no longer means "selected" beside a field where blue means an alliance.
2. **One level of boxes.** A group is a title and what follows it, set apart by space
   and a rule. Only a real object is a surface: a model or field view, a device you
   act on, a thing that floats. Lists are rows.
3. **Shape follows the job:** 2 px marks, 4 tags and keys, 6 controls, 10 surfaces,
   14 what floats. Only round things are round (a dot, a knob, the Driver Station's
   action button).
4. **Two faces.** Inter reads; Barlow Condensed (already bundled) is for titles and
   for readings: a clock, a voltage, a pulse width, a count, a port's number, set
   like the print on a hub. Sentence case; no tracked capitals. Settings → Text can
   swap both for OpenDyslexic or a font the user adds, each drawn at Inter's size so a
   line takes the same room: OpenDyslexic at 85% with its gaps closed to Inter's, an
   added font scaled to Inter's width. One still much wider marks the page
   `data-font-wide`, and the few places sized for Inter's words (a narrow column, a
   step rail, the bar's controller words) give way for it. Anywhere else, a label
   wraps before it runs into its neighbour.
5. **Motion explains** a press or an opening in 100 to 180 ms, easing out. Nothing
   bounces, scales on hover or pulses.
6. **Say a thing once.** No arrows on buttons, no numbered-circle chips, no subtitle
   that repeats its heading. State is a word in a small square tag or in its colour.

Neutrals lean slightly green (as the app icon's ink does) and never reach pure black or
white. Every text colour holds 4.5:1 on every ground it sits on, in both themes.
Charts take a five-step series palette (`--series-1` to `--series-5`), checked for
colour-blind separation on both surfaces; state colours are never a series.

### How the stylesheets are built

Six generic stylesheets that overrode one another (`style`, `motion-theme`, `layout`,
`elements`, `touch`, `design-system`: about 110 KB) are gone. In their place:

| File | Layer | What it holds |
| --- | --- | --- |
| `ui/tokens.css` | | the tokens, both themes, and `@layer base, features, system` |
| `ui/base.css` | `base`, `system` | each element's default look; then the shared controls (`.primary`, `.secondary`, `.text-button`, `.segmented`, `.tag`, tick boxes), which no screen can restyle |
| `ui/shell.css` | `system` | the bar, Drive, Settings, the shell's dialogs |
| `ui/workspace.css` | `system` | what Setup, Calibrate and Simulate share (robot bar, step rail, list and pane, sections, notices, charts) and each of their screens |
| `ui/simulation.css`, `sim-workspace.css`, `sim-studio.css`, `axon-programmer.css`, `swyft-programmer.css`, `servo-test.css`, `controller-art.css`, `ftc/ds.css` | `features` | each screen's own layout |

A later layer wins whatever the selector, so a shared control is drawn in one place
and a screen's file only sizes and places it. The feature files were put on the new
scales mechanically (552 type sizes, 209 radii, 41 weights; tracked capitals, glows
and blur removed), each screen was reworked by hand, and then every declaration the
`system` layer always overrides was deleted from the workspace stylesheets (395
declarations and 62 rules), with every element's computed style compared before and
after on 42 screen and theme combinations to show nothing on screen changed.

`tests/design-audit.cjs` measures the rules on the real app, light and dark, and
fails on a capsule, a box in a box, small capitals, a shadow on something that does
not float, blur, a decorative gradient, a side stripe, an arrow on a button, code
type on plain words, a face or weight outside the two families, or faint text.

### Hover and a finger

A finger leaves `:hover` on whatever it last tapped, so a tapped button would keep its
hover look until the next tap somewhere else. `ui/pointer.js` marks the page
`data-touch` while the last pointer was a finger, and every hover look in the
stylesheets carries `:not(:where([data-touch] *))`, which adds nothing to a
selector's weight. The next mouse or trackpad move takes the mark off again.
`@media (hover: hover)` can't do this on a Steam Deck, whose trackpads make the
main pointer a mouse even while the screen is being touched. A new `:hover` rule
takes the same guard. A hover that opens something (the menu's sub-menu) or that
styles a scrollbar does not. `tests/touch-hover-ui.cjs` taps and moves the mouse
through the DevTools input events, the same way a touchscreen and a trackpad send
them.

### Narrow windows

- A rail longer than its window scrolls sideways and keeps the place you are at in
  view (`railFit` in `ui/simulation.js`). Calibrate's nine places fit from 1024 px;
  under about 960 px the last one used to be cut off.
- Two faults that were already there under 900 px are fixed: Simulate's robot and
  route pickers took a 320 px height in the side panel and pushed the run report
  out of sight, and a long pick-list made Calibrate → Electronics scroll sideways
  at phone width.
- Left as it was: between about 700 and 1000 px Simulate keeps its three panes, so
  the field is small. That band needs its own layout.

### How the rebuild was checked

Besides the audits above, the app-driving scripts CI runs on Linux were run against
the rebuilt UI and against the untouched code, with the same outcome for each. Most
of them bind extra loopback addresses (127.0.0.2 and up), which macOS does not have,
so on the Mac they ran through a small preload that maps those addresses onto
127.0.0.1. Five do not pass on a Mac on either version: `controller-session`, and
four that stop at a check a hidden macOS window cannot meet (native fullscreen in
`robot-fullscreen` and `touch-ui`, a slowed heartbeat timer in `ftc-app`, the
updater's download in the full `ui`). With that one check relaxed, `ftc-app`,
`touch-ui` and `ui` pass to the end on both versions, and `robot-fullscreen` passes
its zoom half. Real hardware was not part of it.

## Colour, motion and Drive (2026-11-22)

Looking at the rebuilt app, the user found it right but dull: little colour, nothing moving, and a Drive page with nothing on
it. Three changes answer that without giving up the rules above.

- **One accent, from the theme.** The main action on each screen, the mark under the page you are on, what is picked,
  ticked boxes, sliders and focus rings take the theme's accent (Torque's is green, #31d78c dark and #037f4e light). Other
  colour is still the robot's state and the alliances. Rule 1 in `ui/tokens.css` says so.
- **Motion that explains** (rule 5), from what [NN/g](https://www.nngroup.com/articles/animation-duration/), Fluent and
  Emil Kowalski's animation standards agree on: a press gives under the finger (scale .97, 100 ms); a menu, list or popover
  opens from where it belongs (180 ms); a page fades in and its parts rise in a row at a time (260 ms, 45 ms apart, at
  most eight); the mark under a new tab grows from its middle. Only transform and opacity move, everything eases out,
  nothing bounces, and what repeats all day (typing, keyboard actions) does not animate. Live things breathe: a ring goes
  out from a connected dot every few seconds. Reduced motion stops all of it.
- **Drive is where you connect.** With no robot open, Drive shows your robots (one tap to connect, the likeliest one
  first) and a form to add one. The controllers live in the bar, so Drive does not repeat them. The Wi-Fi list drops
  down from the bar's Wi-Fi button. A running robot stays connected while you look at the list (the toolbar's
  **Robots**).

Settings is now Torque's own settings, across the window's width and scrolling as one page: the app theme, the Driver
Station theme (one for every robot, or one per robot), the font, keeping the screen awake, and About. Each group has its
title and a line on the left and what it sets on the right. Each list ends in **+**: a theme imported there goes into
that list, a font file added there joins the fonts, and what you added carries **Remove**. Keyboard shortcuts and the licenses open from the menu
as well; the menu lost Report a bug (the bar has it) and Competition mode (Torque is not used at an event).

### Themes

`ui/themes.js` holds six built-in themes. Each one turns the app's neutrals to its hue at the same lightness, so every
theme keeps the same contrast, and picks an accent that holds 4.5:1 on its ground in light. A theme goes on through a
constructed stylesheet (the pages' content security policy allows no inline styles) and, for pictures, custom properties
the stylesheets draw with. Imported themes are validated (`fromPackage`: names, hex colours, contrast, picture types and
sizes) and kept as JSON files in the app's data folder. [docs/THEMES.md](THEMES.md) is the guide for making one.
A font added in Settings is checked by loading it, kept as its file in the data folder, and put on with `FontFace`
from its bytes (in the Driver Station too, which gets them with the theme), setting `--font` and `--font-display`.

A bar that sticks while its pane scrolls (Calibrate's "Before you start", Debug's run bar) is clear where it starts and,
once it sticks, fills with the theme's ground (`container-type: scroll-state`, `@container scroll-state(stuck: top)`), so
nothing that scrolls under it shows through its words.

## The mark (2026-11-22)

The icon was a smiling robot head on a mint square: the stock chatbot mascot, the
motif that fills icon marketplaces and reads as generated. It is now **τ**, the symbol
physics uses for torque, with its foot turning the way torque turns a shaft: one
idea, tied to the name, and a T besides. It is drawn on a 64-unit grid with its stems
on whole pixels at 32 px, in the app's ink with its paper colour, and nothing else:
no gradient, no glow, no second colour. On dark grounds (a video's end card) it
turns over: an ink τ on a paper square.

| File | What it is |
| --- | --- |
| `ui/sim-video.js` | `MARK`, the τ's outline, and `squircle`, the rounded square: the one source |
| `tools/icons.cjs` | draws every icon from them in Electron: `npx electron tools/icons.cjs` |
| `ui/icon.svg`, `icon.png`, `icon.ico` | the square filling its canvas (Linux, the window, Windows) |
| `ui/icon.icns` | the square on Apple's grid, 824 of 1024 with a soft shadow; 16 and 32 px as macOS's own `iconutil` writes them |
| `packaging/installer.ico`, `installer-sidebar.bmp` | Setup's icon, the τ on a circle so it is not taken for the app, and its sidebar with the name |

The name stays type: "Torque" in Barlow Condensed, in the bar and beside the icon on
a video's end card.

## Shape, spacing and motion from BuildLens (2026-11-21)

At the user's request the app takes its shapes, spacing, type and motion from their LegoBuilder project
(`app/BuildLens/Design/Theme.swift`). Colours were deliberately left as they were. This look was replaced by the rebuild above the same day; the table is
the record of what it was. (`docs/media/redesign/` now holds the rebuild's before and after: its "before" is this look.)

| What | Value | Was |
| --- | --- | --- |
| Card corner (`--radius`, `--radius-panel`) | 24 px | 14 / 16 px |
| Floating corner: dialogs, pickers (`--radius-sheet`) | 28 px | 18 px |
| Hero corner: the Drive welcome card (`--radius-hero`) | 32 px | 16 px |
| Tile and field corner (`--radius-control`) | 12 px | 10 px |
| Nested detail corner (`--radius-detail`) | 8 px | 7 px |
| Buttons, chips, pick-one rows, toasts (`--radius-pill`) | capsule | 10 px |
| Header icon buttons, controller numbers | circle | 10 / 8 px |
| Nested shapes | outer radius less the gap (the op-mode bar: 24 − 4 = 20) | fixed |
| Gap between cards (`--gap-card`) | 12 px | 16 px |
| Padding inside a card (`--pad-card`) | 20 px (16 px under 1100 px wide) | 18–20 px |
| Group labels | 11 px, bold, uppercase, .07em tracking | 12 px sentence case |
| Titles | h1 800, h2/h3 700 | 700 / 600 |
| Typeface | SF Rounded on a Mac, Inter elsewhere | SF Pro / Inter |
| Press | scale .97 and 80% opacity on every button | scale .98 on some |
| Disabled | 40% opacity | 45% |
| Press spring (`--ease-press`, 300 ms) | response .24, damping .8 | 160 ms ease |
| Step spring (`--ease-step`, 480 ms) | response .42, damping .86 | none |
| Opening | dialogs, menus and pickers grow from 94% and fade in; toasts rise 12 px; a page fades in | instant |

Reduce Motion keeps the dimming on press and drops the scaling, the springs and every opening animation.

## Controller setup (2.4.8)

The user requested [Hardware Tester's standard controller layout](https://hardwaretester.com/gamepad).
The new original SVG follows that arrangement: upright triggers above detached
bumpers, left stick high/right stick low, separate four-way D-pad and face-button
lobes, and small center buttons. It replaces the earlier shaded Steam Deck and
console illustrations. One diagram represents the standard Gamepad API mapping
on every device; the title still shows the known product or Generic controller.

Trigger fill rises with its actual analog value, each key highlights from its
standard button index, and both sticks have live XY position plots plus numeric
axis readouts. No calibration or robot bindings are changed by this screen.
Input-mode help expands on demand (automatically when no pad is assigned), and
the action footer stays visible when help or driver details are expanded.

## Audit and resolution, by severity

1. **Normal and critical states shared the same red FTC canvas.** Neutral surfaces
   now reserve red for faults/stop controls, amber for waiting or warning, green
   for a connection or live input, and blue for ordinary actions.
2. **The FTC stop control was only a symbol.** Its existing button now includes a
   visible STOP caption and retains its accessible label. It remains an op-mode
   software stop, not a hardware emergency-stop replacement.
3. **Active mode selection faded while the robot ran.** The selected mode remains
   fully readable while editing stays disabled by the existing state logic.
4. **Separate themes made the app and FTC view feel unrelated.** Both use
   `ui/tokens.css` for surfaces, typography, status colors, spacing and focus.
5. **Setup headings consumed handheld space.** A plain Settings heading and
   compact section titles make the connection form's primary action visible at
   LCD and laptop sizes.
6. **Panels, borders and corners varied across screens.** One 6–8 px component
   system covers forms, lists, menus, network picking and dialogs.
7. **Hints and labels had inconsistent, sometimes tiny type.** Most form/body
   copy uses 12–14 px; dense diagnostic indices remain secondary to live values.
8. **Oversized empty-state decorations competed with setup.** Removed the dotted
   background and decorative gradients; retained the user's robot icon.
9. **Buttons used inconsistent text glyphs for navigation.** A small original SVG
   icon family now covers navigation, network, refresh, update and menu actions.
10. **Keyboard and narrow-window context was incomplete.** Escape dismisses menus
    and the network picker, active navigation exposes its state, the Wi-Fi button
    names its connection when compact, and reduced-motion settings are respected.
11. **Pages ran past a laptop's window.** On a maximized 1280 × 718 window,
    Settings, Calibrate's tabs and parts of Setup scrolled as one page, cutting
    off main actions such as Open robot. Every screen now fits from 861 × 560:
    the header rows stay, and lists, panes and columns scroll on their own. A
    Setup step too tall for a short window scrolls inside its view instead of
    being cut off. Tile names wrap to two lines, and the robot picker widens to
    show its summary. `tests/window-fit-ui.cjs` checks every screen at
    1280 × 718, 1280 × 800 and 1024 × 600.

## Boundaries

- Website robots keep their original UI, telemetry and controls. The shell does
  not fabricate robot-enabled state, voltage, charts or camera feeds.
- The FTC view styles existing Robocol status, configuration, modes, real voltage,
  messages, telemetry and camera frames. Its packets, timers and command handlers
  are unchanged. A presentation attribute exposes its existing state to CSS.
- Both controller slots, default built-in assignment, manual swapping, robot input
  pause during setup, model naming and Steam Deck-only help remain intact.
- Touch targets for primary controls stay at least 40–44 px. Driving controls and
  connection state stay visible on landscape handhelds; narrow windows stack.
- Bundled fonts and local SVG/CSS work without internet access. Transitions only
  affect control colors; there are no continuous decorative animations.

## Review sizes and evidence

Native Electron checks cover 1280×800, 1366×768, 1920×1080, 3840×2160 and portrait
390×844 for the shell, with controller/FTC checks at the relevant sizes. They
exercise the real local UDP simulator rather than painting telemetry into DOM
fixtures. CI retains screenshots as the `driver-station-ui-checks` artifact.

Physical Steam Deck/macOS execution, Bluetooth pairing and real robot motion
remain separate device checks.
