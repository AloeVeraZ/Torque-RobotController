# Repository workflow

- Work and commit on `testing`. Keep `main` at its approved baseline until the user explicitly requests promotion to main.
- Do not push code, tags, releases, or branches until the user authorizes a push. Creating the empty GitHub repository is authorized.
- The current 2.4.21 simulation release must work on Windows x64, Steam Deck/Linux and Apple Silicon, with responsive Steam Deck LCD/OLED layouts. Intel Mac and Android are unsupported.
- After publishing 2.4.21 to testing, future prompts default to local development on this laptop's Windows driver station. Hold GitHub pushes/releases and Apple/Linux work until the user requests them; this release's push authorization does not carry forward to future prompts.
- The robot supplies its own web controls. Keep connection setup in Settings and app updates in the three-dot menu.

# Design

- The rules of the UI's look are at the top of `ui/tokens.css`; read them before changing a screen. Colour means the robot's state or an alliance, the main action is solid ink, and there is no accent hue.
- `ui/base.css` draws every shared control (`.primary`, `.secondary`, `.text-button`, `.segmented`, `.tag`, `.notice`, fields, tick boxes, sliders). A screen's stylesheet sizes and places them; it never gives them a look of its own.
- Stylesheets are layered (`base`, `features`, `system`, declared in `ui/tokens.css`): a screen's own file goes in `features`; `ui/shell.css` and `ui/workspace.css` are `system` and win over it.
- A new part is a title and rows before it is a box: one level of boxes, no capsules, no tracked capitals, no arrows on buttons, no badge that is not a state, no helper line that repeats its label. Numbers that matter are set in the display face (`.reading`).
- The mark is τ (`MARK` in `ui/sim-video.js`); every icon and the installer's pictures are drawn from it by `npx electron tools/icons.cjs`. Never hand-edit `ui/icon.*` or `packaging/installer*`.
- After changing the UI, run `tests/design-audit.cjs` (it measures these rules on the real app in both themes) with `tests/layout-audit.cjs` and `tests/window-fit-ui.cjs`.

