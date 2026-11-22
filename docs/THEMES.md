# Themes

A theme changes how Torque looks: its colours and, if you like, a background picture and a logo. There are two kinds, and
each changes different screens. (The font is its own setting: see [Fonts](#fonts).)

| Kind | What it changes |
| --- | --- |
| **App theme** | Torque's own screens: the bar, Drive (your robots and adding one), Setup, Calibrate, Simulate and Settings. |
| **Driver Station theme** | The FTC Driver Station screen you drive an FTC robot with: the op mode picker, INIT / START / STOP, telemetry and its own menu and pages. Like the Driver Hub's colour scheme. |

Torque comes with six themes of each kind (Torque, Blue, Orange, Purple, Red and Mono). You can also make your own and
import it.

**Everything stays on your computer.** Importing a theme copies it into Torque's data folder. Nothing is uploaded, and
Torque never fetches a theme from the internet. To share a theme with your team, send them its folder.

## Choosing a theme

In Torque, open **⋮ → Settings**:

- **App theme**: pick one for Torque's own screens.
- **Driver Station theme**: pick the one every FTC robot uses, or **Same as the app**.
- **For one robot**: give a saved FTC robot a theme of its own. Torque puts it on whenever you connect to that robot on
  its Wi-Fi, so each robot can look different, the way teams colour their Driver Hubs.

While you are connected to an FTC robot you can also pick its theme from the Driver Station itself: **⋮ → Settings →
Colour scheme**, the same place the Driver Hub keeps it.

Light and dark still come from the theme button in the bar. Every theme has both.

## Making a theme

A theme is a folder with a `theme.json` file and, if you want them, its pictures:

```
night-shift/
  theme.json
  background.jpg
  logo.png
  logo-light.png
```

Two complete examples you can copy and change live in this repository:

- [`docs/themes/night-shift`](themes/night-shift): a Driver Station theme with a background picture and a team logo
  (white for dark, ink for light).
- [`docs/themes/field-day`](themes/field-day): an app theme with a background picture.

Then in Torque, open **⋮ → Settings**. Each list of themes ends in **+ Import a theme**: use the one under **App theme**
for Torque's screens, or the one under **Driver Station theme** for the Driver Station. Pick the theme's **folder** (not
the `theme.json` inside it). Torque checks it, copies it into that list and puts it on. If something is wrong, it says
what to fix under the list and imports nothing.

To change a theme after importing it, edit its folder, import it again, and use **Remove** under the old copy.

### theme.json

```json
{
  "format": "torque-theme",
  "version": 1,
  "name": "Night Shift",
  "for": "station",
  "author": "Team 9999",
  "colours": {
    "dark":  { "accent": "#ffa94d", "background": "#0b0f1a", "surface": "#121828", "text": "#eef1f8", "muted": "#a8b0c4", "line": "#222b40" },
    "light": { "accent": "#b2560a", "background": "#f3f5fa", "surface": "#fcfdff", "text": "#121726", "muted": "#4a5268", "line": "#d9deea" }
  },
  "background": { "image": "background.jpg", "position": "center", "opacity": 0.45 },
  "logo": { "dark": "logo.png", "light": "logo-light.png" }
}
```

| Field | Needed | What it is |
| --- | --- | --- |
| `format` | yes | Always `"torque-theme"`. |
| `version` | yes | Always `1`. |
| `name` | yes | Up to 40 characters. Shown under the theme in Settings. |
| `for` | no | `"app"` or `"station"`: the kind you made it as, for people reading the file. The **+** you import it with decides which list it goes in, so one theme can be both. |
| `author` | no | Your team or name, up to 60 characters. |
| `colours.dark`, `colours.light` | yes | One set of colours for each. Colours are hex: `#1a2b3c` or `#abc`. |
| `background` | no | A picture behind the screen. See [Pictures](#pictures). |
| `logo` | no | A logo beside the name: one file, or one for dark and one for light. See [Pictures](#pictures). |

### Colours

Each of `dark` and `light` takes these. Only `accent`, `background` and `text` are needed; Torque works out the rest from
them, and from any of the others you give.

| Colour | Needed | What it paints |
| --- | --- | --- |
| `accent` | yes | The main button on each screen, the mark under the page you are on, what is picked, ticked boxes, sliders and focus rings. |
| `background` | yes | The ground behind everything. |
| `text` | yes | Words and strong lines. |
| `surface` | no | Panels, cards and dialogs that sit on the ground. |
| `muted` | no | Quieter words: hints, second lines, labels. |
| `line` | no | Hairlines between rows and around fields. |

Torque keeps every theme readable. It refuses a theme where, in either mode:

- `text` on `background` or on `surface` is below **4.5:1** contrast,
- `muted` on `surface` is below **4.5:1**,
- `accent` on `background` is below **3:1**, or
- the words on an accent button (black or white, whichever reads better) are below **4.5:1** on `accent`.

A contrast checker such as [WebAIM's](https://webaim.org/resources/contrastchecker/) shows these numbers while you pick.

Colours that mean something stay the same in every theme: green for live and connected, amber for "look here", red for
stop and errors, and the red and blue alliances on a field. A theme cannot change them, so a robot's state always reads
the same way.

### Pictures

Pictures go in the theme's folder, beside `theme.json`, and are named in it by their file name only (`"background.jpg"`,
not a path). PNG, JPEG, GIF and WebP work. Each picture can be up to **8 MB**, and a theme's pictures up to **20 MB**
together.

**Background** (`"background": { "image": ..., "position": ..., "opacity": ... }`)

| | |
| --- | --- |
| Where it shows | An app theme: behind Drive's robot list. A Driver Station theme: behind the whole Driver Station screen. |
| Size | **1920 × 1080** (16:9). At least 1280 × 720. |
| Scaling | It covers the screen: scaled until there is no gap, then cropped. A Steam Deck (1280 × 800, 16:10) crops a little off the sides; a phone-shaped window crops a lot. Keep what matters near the middle, or set `position`. |
| `position` | Which part stays in view when it is cropped: `"center"` (the default), `"top"`, `"bottom"`, `"left"`, `"right"`, two of them (`"top left"`), or two percentages (`"50% 30%"`). |
| `opacity` | 0 to 1 (default **0.3**). The picture is faded over the theme's `background` colour by this much, so words stay readable. Busy photos want 0.1 to 0.2; quiet patterns can go to 0.5. |
| Animated GIFs | They play, always. Keep the movement slow and small; nobody can drive with a strobe behind STOP. |

**Logo** (`"logo": "logo.png"`, or `"logo": { "dark": "logo.png", "light": "logo-light.png" }`)

| | |
| --- | --- |
| Where it shows | An app theme: in the bar, before the name Torque. A Driver Station theme: before the Driver Station's name at the top left. |
| Size | **96 px tall**, up to **288 px wide** (shown at 24 px tall, so it stays sharp on high-resolution screens). |
| Format | PNG or WebP with a **transparent** background. |
| Dark and light | One file is shown in both modes, so it has to read on both grounds. A white logo disappears on a light bar: give it a second file in dark ink as `"light"`. |

## App themes

An app theme changes Torque's own screens. Its background picture sits behind Drive's robot list, where
you start; Setup, Calibrate and Simulate take only its colours, so their drawings and 3D views stay clear. Its logo goes in
the bar.

## Driver Station themes

A Driver Station theme changes the FTC Driver Station screen, and nothing else. Its picture fills the
screen behind the op mode controls and telemetry, and its logo goes before the Driver Station's name. INIT, START and STOP
keep their own green and red.

A Driver Station theme can be the default for every FTC robot or belong to one robot (**Settings → For one robot**, or
the Driver Station's **⋮ → Settings → Colour scheme**). A robot is one saved robot: its address on its Wi-Fi.

## Where themes are kept

Imported themes are files in Torque's data folder, one per theme:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Torque\themes` |
| macOS | `~/Library/Application Support/Torque/themes` |
| Steam Deck and Linux | `~/.config/Torque/themes` |

On a computer that had Torque under its old name, the folder is in `Deck Driver Station` instead of `Torque`. Removing a
theme in Settings deletes its file; anything using it goes back to the default.

## Fonts

**⋮ → Settings → Text** picks the typeface for all of Torque, the Driver Station included: Inter (Torque's own), or the
one your computer uses for its menus. The last card, **+ Add a font**, takes a font file of your own:

| | |
| --- | --- |
| Formats | TTF, OTF, WOFF or WOFF2, up to **10 MB**. One file is one font: pick its Regular, and Torque makes the bold. A variable font (one file with every weight) keeps its own weights. |
| Name | Taken from the file name: `Atkinson Hyperlegible-Regular.ttf` shows as *Atkinson Hyperlegible*. |
| Where it goes | Everywhere text is: words, headings and the big readings. |
| Licence | Fonts are licensed like any software. Use one whose licence lets you install it, such as the SIL Open Font License most free fonts use. |

Like themes, a font is copied into Torque's data folder (`fonts` beside `themes`) and never uploaded. **Remove** under it
deletes the copy and puts Inter back.
