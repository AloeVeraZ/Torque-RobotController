# Colours and themes

Torque's look is two choices, made separately for Torque's own screens and for the FTC Driver Station screen. (The font
is a third setting: see [Fonts](#fonts).)

| Choice | What it is |
| --- | --- |
| **Colour** | The palette: the accent that marks the main button, the page you are on and what is picked, and the background, surfaces, lines and words, all tinted to go with it. |
| **Theme** | How the screens are drawn. **Torque** is flat. **DEV**, **FIRST** and **NYC FIRST** draw a moving background of text characters behind every screen. An imported theme brings its pictures, and its own colours, picked as **<Theme name>’s own**. Any colour can go with any theme. |

| For | What it changes |
| --- | --- |
| **App** | Torque's own screens: the bar, Drive (your robots and adding one), Setup, Calibrate, Simulate and Settings. |
| **Driver Station** | The FTC Driver Station screen you drive an FTC robot with: the op mode picker, INIT / START / STOP, telemetry and its own menu and pages. Like the Driver Hub's colour scheme. Every robot uses the same one. |

Torque comes with four colours, **Torque** (green), **Purple**, **Orange** and **Mono** (greys), and four themes, **Torque**,
**DEV**, **FIRST** and **NYC FIRST**. You can make your own colours and import themes.

**DEV**'s background is a picture drawn entirely in text characters, with Torque's τ turning in the middle and a scan line
passing down the screen. It is drawn faintly in the colour's accent so words stay easy to read. If your computer is set
to reduce motion, it holds still.

**FIRST** draws the three shapes of the *FIRST* logo the same way: the triangle in red, the ring in white and the square in
blue, with the logo's grey depth behind them, turning together as one piece. The ring is the logo's: a round white washer with a grey
wall, linked through the triangle and the square, its far half behind them and its near half in front. The shapes are
measured from the logo itself, and each theme's card in Settings is drawn from the same measurements. On a light background the white is
the logo's grey, so it still shows. **NYC FIRST** is the same logo with its ring crowned: seven rays, like the Statue of
Liberty's, rise from the ring's far side between the triangle and the square. In
both, the slow field, the ring spreading from the middle and the scan line are drawn in the colour you picked, and the
three shapes keep their own red, white and blue.

**Everything stays on your computer.** Your own colours are kept in Torque's settings, and importing a theme copies it
into Torque's data folder. Nothing is uploaded, and Torque never fetches a colour or theme from the internet. To share
one with your team, send them its file or folder.

## Choosing

In Torque, open **⋮ → Settings**. From the top:

- **App colour** and **App theme**: for Torque's own screens.
- **Text**: the font (see [Fonts](#fonts)).
- **Driver Station colour** and **Driver Station theme**: for the FTC Driver Station screen. Each list starts with
  **Same as the app**, which is picked at first.

Any colour goes with any theme. While a theme you imported is on, its colour list starts with **<Theme name>’s own**
(for example **Night Shift’s own**): the colours the theme came with. It is picked when you put the theme on. Pick any
other colour to draw it over the theme's pictures instead, or the theme's own to go back to the theme exactly as it came.
When you choose a built-in theme again (Torque, DEV, FIRST or NYC FIRST), the colour you had before the theme comes back. **Same as the app**, in the Driver
Station lists, always follows what the app has, a theme's own colours included.

While you are connected to an FTC robot, the **Theme and colour** button in the Driver Station's bar, beside Network,
picks its theme and colour too, the theme's own colours included. It is the same setting as in Settings.

Every colour and theme has a light look and a dark one. **Light or dark**, at the top of **App colour**, picks
**Match the device**, **Light** or **Dark** for all of Torque, the Driver Station too. In a wide window the **Light or
dark** button in the bar picks the same.

Robots no longer have looks of their own: every robot uses the Driver Station colour and theme. A robot's own theme from
an earlier Torque is dropped when you update. A colour you had picked as a theme in an earlier Torque (Purple, say)
becomes that colour with the **Torque** theme, for the Driver Station too, so it stays as plain as it was. **Blue** and
**Red** are no longer built in: if you had one on, it becomes one of your own colours with the same name and main colour,
still on, so nothing changes.

## Making a colour

Each colour list ends in **+ Add a colour**. It opens a small editor:

- **Name**: shown under the colour, up to 40 characters.
- **Main colour**: the accent. Pick it with the colour well or type its hex code (`#ff5a36`). A code goes on once it is
  whole; a short one (`#f53`) or one without `#` is filled out when you leave the field or press Enter.
- **Background tint**: the hue the background, surfaces and lines lean towards. **Same as the main colour** is ticked at
  first; untick it to pick another.

A new colour starts from the main colour of the one that is on. The dot before each colour's name, in Settings and under
the Driver Station's **Theme and colour** button, is its main colour exactly as it was picked. While the editor is open,
the screens the list is for show the colour, so you can see it in place. **Save** keeps a new colour and puts it on; for
one you are editing, it keeps the changes and leaves it on or off as it was. **Cancel** puts back what was there. Torque
keeps every colour readable: every neutral (the background, surfaces, lines and words) is turned to the tint's hue, and
the main colour is adjusted only as far as it needs to be to stay readable on them, in dark and in light.

Under a colour you made are **Edit**, **Export** and **Remove**. **Export** saves it as a small file to send to your
team. To use one, open **+ Add a colour** in the list you want it in and choose **Import a colour file**. A file whose
colour is already in that list, with the same name and colours, is not added twice. The built-in colours come with every
copy of Torque, so they cannot be exported. **Remove** asks first: Torque keeps no copy of a colour, so export it if you
might want it again.

A colour file is a few lines of JSON:

```json
{
  "format": "torque-colour",
  "version": 1,
  "name": "Sunset",
  "accent": "#ff5a36",
  "tint": "#3355ff"
}
```

| Field | Needed | What it is |
| --- | --- | --- |
| `format` | yes | Always `"torque-colour"`. |
| `version` | yes | Always `1`. |
| `name` | yes | Up to 40 characters. |
| `accent` | yes | The main colour, in hex: `#1a2b3c` or `#abc`. |
| `tint` | no | The background tint, in hex. Leave it out for the same as `accent`. |

## How many

A colour list holds up to **16 colours**, the four built-in ones counted, and a theme list up to **8 themes**, the four
built-in ones counted. The App and Driver Station lists each have their own room. When a list is full, its **+** goes and a line
says so: remove one of yours to add another.

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

In Settings, **How to make a theme** under **App theme** and under **Driver Station theme** opens this section.

Then in Torque, open **⋮ → Settings**. Each list of themes ends in **+ Import a theme**: use the one under **App theme**
for Torque's screens, or the one under **Driver Station theme** for the Driver Station. Pick the theme's **folder** (not
the `theme.json` inside it). Torque checks it, copies it into that list and puts it on, in its own colours. If something
is wrong, it says what to fix under the list and imports nothing.

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

Every FTC robot uses the Driver Station theme picked in Settings or with the **Theme and colour** button in the Driver
Station's bar, beside Network.

## Where themes are kept

Imported themes are files in Torque's data folder, one per theme:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Torque\themes` |
| macOS | `~/Library/Application Support/Torque/themes` |
| Steam Deck and Linux | `~/.config/Torque/themes` |

On a computer that had Torque under its old name, the folder is in `Deck Driver Station` instead of `Torque`. Removing a
theme in Settings deletes its file; anything using it goes back to the default. Colours you made are not files: they are
kept with Torque's other settings, and **Export** saves a copy as a file.

## Fonts

**⋮ → Settings → Text** picks the typeface for all of Torque, the Driver Station included: Inter (Torque's own),
OpenDyslexic, which is made to be easier to read with dyslexia, or the one your computer uses for its menus. Each is
drawn at Inter's size: OpenDyslexic's capitals stand as tall as Inter's and its letters and words sit as close, so a
line takes the same room. The last card, **+ Add a font**, takes a font file of your own:

| | |
| --- | --- |
| Formats | TTF, OTF, WOFF or WOFF2, up to **10 MB**. One file is one font: pick its Regular, and Torque makes the bold. A variable font (one file with every weight) keeps its own weights. |
| Name | Taken from the file name: `Atkinson Hyperlegible-Regular.ttf` shows as *Atkinson Hyperlegible*. |
| Where it goes | Everywhere text is: words, headings and the big readings. |
| Size | Torque draws it at the size that sets a line as long as Inter does (between 80% and 125% of its own size), so no screen changes when the font does. A font still much wider than that gets a little more room in a few narrow places, such as Simulate's run column. |
| Licence | Fonts are licensed like any software. Use one whose licence lets you install it, such as the SIL Open Font License most free fonts use. |

Like themes, a font is copied into Torque's data folder (`fonts` beside `themes`) and never uploaded. **Remove** under it
deletes the copy and puts Inter back.
