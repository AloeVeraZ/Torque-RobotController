# Driver Station presentation

The design follows the user's supplied brief: restrained desktop controls, clear
robot state, useful information density, and one component language across the
launcher, input diagnostics and the built-in FTC station. Inspiration:
[Linear](https://linear.app), [Foxglove](https://foxglove.dev),
[Fluent 2](https://fluent2.microsoft.design), and [shadcn/ui](https://ui.shadcn.com).
The current presentation follows the user's subsequent request to match
[MotionModule](https://github.com/AloeVeraZ/MotionModule): warm near-black surfaces,
steel-blue accents, floating rounded chrome, pill controls, Inter text and Barlow
Condensed headings. Fonts are bundled locally under the SIL Open Font License;
the app requires no font CDN or third-party page at runtime.

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
