# Repository workflow

- Work and commit on `testing`. Keep `main` at its approved baseline until the user explicitly requests promotion to main.
- Do not push code, tags, releases, or branches until the user authorizes a push. Creating the empty GitHub repository is authorized.
- The current 2.4.21 simulation release must work on Windows x64, Steam Deck/Linux and Apple Silicon, with responsive Steam Deck LCD/OLED layouts. Intel Mac and Android are unsupported.
- After publishing 2.4.21 to testing, future prompts default to local development on this laptop's Windows driver station. Hold GitHub pushes/releases and Apple/Linux work until the user requests them; this release's push authorization does not carry forward to future prompts.
- The robot supplies its own web controls. Connection setup (saved robots, a new robot's address, finding it) lives on Drive, and the Wi-Fi list under the bar's Wi-Fi button. Settings is Torque's own settings (themes, text, driving, about). App updates stay in the three-dot menu.

# Design

- The rules of the UI's look are at the top of `ui/tokens.css`; read them before changing a screen. The colour's accent (Settings → App colour, `ui/themes.js`) marks the main action, where you are and what is picked; other colour means the robot's state or an alliance. Motion uses the shared keyframes and durations in `tokens.css` and stops under reduced motion.
- Colours and themes: a colour (Settings → App colour, Driver Station colour) sets the palette; a theme (Torque, DEV, or one imported from a folder) sets how the screens are drawn. Draw with the theme tokens (`--accent`, `--bg`, `--surface`, `--text`, `--muted`, `--line`), never a fixed colour, so every colour and theme and `docs/THEMES.md` keep working.
- `ui/base.css` draws every shared control (`.primary`, `.secondary`, `.text-button`, `.segmented`, `.tag`, `.notice`, fields, tick boxes, sliders). A screen's stylesheet sizes and places them; it never gives them a look of its own.
- Stylesheets are layered (`base`, `features`, `system`, declared in `ui/tokens.css`): a screen's own file goes in `features`; `ui/shell.css` and `ui/workspace.css` are `system` and win over it.
- A new part is a title and rows before it is a box: one level of boxes, no capsules, no tracked capitals, no arrows on buttons, no badge that is not a state, no helper line that repeats its label. Numbers that matter are set in the display face (`.reading`).
- The mark is τ (`MARK` in `ui/sim-video.js`); every icon and the installer's pictures are drawn from it by `npx electron tools/icons.cjs`. Never hand-edit `ui/icon.*` or `packaging/installer*`.
- A bar that sticks while its pane scrolls is clear where it starts and fills with the theme's ground once it sticks (`container-type: scroll-state` in `ui/workspace.css`), so nothing shows through its words.
- On-screen words read like a person wrote them: plain full sentences that say what to do, buttons and places named exactly as they appear (Setup → Mechanisms), "Torque" and never "Deck". Cut a line that only repeats its label. Words copied from the real FTC Driver Station stay as they are.
- Settings → Text can put OpenDyslexic or a user's own font on every screen, each drawn at Inter's size so no screen changes with the font. A label still wraps before it runs into its neighbour, and a place sized for Inter's words gives way under `:root[data-font-wide]` (a user's font that stays much wider).
- After changing the UI, run `tests/design-audit.cjs` (it measures these rules on the real app in both themes) with `tests/layout-audit.cjs` and `tests/window-fit-ui.cjs`. Run `tests/layout-audit.cjs` again with `DECK_TEST_FONT=dyslexic`.

