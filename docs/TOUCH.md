# Touchscreen navigation and robot gamepads

Use the screen to navigate the dashboard and robot web UI. The built-in handheld
controller defaults to Controller 1 for the connected robot; an external USB/Bluetooth
controller can occupy Controller 2. Gamepad discovery, live testing and manual swapping
remain available by tapping either controller card. The dashboard's own Gamepad API
enumeration is empty, so those inputs are reserved for robot content. Live diagnostics
use a separate raw-input report, including while Settings is open.

## Tap and type

- Dashboard and bundled FTC controls have at least 44px targets. The fullscreen exit
  is 48px. Wi-Fi, saved-robot lists, dialogs, op-mode lists and telemetry support touch
  scrolling. Mouse and physical keyboard use remain available.
- Tap a text field to open the app's keyboard. On detected Steam Deck/Windows handhelds
  this also works when a compositor reports a screen tap as a mouse click. Other devices
  use actual touch/pen events and browser-reported touch capabilities, independent of OS.
- **⋮ → Virtual keyboard** turns
  this on (it is off by default). Off, neither the app nor robot pages open the app's
  keyboard or suppress the system one, so **Steam + X** or the Windows touch keyboard can
  be used instead. The choice is saved on this device.
- Every number field in the simulator has a touch slider below it, so values can be set
  without typing; the box still accepts exact values.
- The keyboard includes numbers, letters, Shift, Symbols, common URL punctuation,
  caret arrows, Backspace, Space, Enter and Done. It provides a Latin/ASCII layout;
  a physical or system input method can provide other languages.
- Settings fields scroll above the keyboard, including Wi-Fi and HTTP-auth dialogs.
  Password fields remain masked. The keyboard surface never reads or displays the
  target field's contents and does not persist credentials.
- Robot text fields use a separate sandboxed keyboard view. Its only typing capability
  accepts single printable characters or fixed editing keys for the currently selected
  robot view. Robot content cannot invoke that typing capability or the app settings API.
  The robot retains its own HTML, form behavior and control design.
- Robot gamepad outputs stay neutral while that keyboard is open. After Done/Enter,
  center sticks and release buttons before driving resumes. Opening Settings or a
  controller test also holds robot inputs neutral.

## Handheld input mode

Choose a **Gamepad** Steam Input template with both sticks as joysticks. In Steam Deck
Desktop Mode, keep Steam running and hold Menu to select Gamepad Mode, then press A.
Use the touchscreen for pointer actions. Windows/Linux handheld utilities need their
Gamepad mode rather than desktop mouse emulation. These OS-generated mouse/keyboard
events cannot be reliably distinguished from a real mouse/keyboard inside the app.
See [Steam Input gamepad emulation](https://partner.steamgames.com/doc/features/steam_controller/steam_input_gamepad_emulation_bestpractices).

The same touch-aware UI and controller-role separation apply on supported Windows,
Linux and Apple Silicon builds. Detection uses real input capabilities; it does not
assume an unannounced Apple handheld model or invent built-in controls when no gamepad
is exposed. Steam Deck LCD remains the primary 1280×800 layout.

## Validation

`tests/touch-ui.cjs` uses native Electron with real Chromium touch dispatch: tap menus,
swipe Wi-Fi lists, enter an address without a physical keyboard, type a masked Wi-Fi
password with Shift/Symbols, and edit/submit a robot password with the isolated keyboard.
It also interrupts robot typing with an HTTP authentication challenge, checks that the
native surface clears away, then completes the app's sign-in dialog with on-screen keys.
It checks target sizes, field visibility, handheld mouse-emulated taps, gamepad pause
and neutral-release behavior, live diagnostics, fullscreen, built-in C1/external C2,
and an empty dashboard gamepad enumeration. Networking and controllers are fixtures;
no physical network switches or robot hardware are used. Linux CI runs with Openbox
for normal desktop fullscreen behavior. Physical touchscreen panels and OS controller
emulation remain device checks.
