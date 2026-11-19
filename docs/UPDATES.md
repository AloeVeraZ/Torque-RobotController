# App updates and branches

The **update icon** beside the bug report checks GitHub when Torque starts (and every few hours) on the channel this
install follows. It stays neutral; hovering turns it **green** (up to date) or **yellow** (an update is published) and
shows the installed version and channel. A yellow dot marks a new version until **Not now** dismisses it. Clicking it,
or **⋮ → Updates**, opens App updates, checked at once: **Download and install** updates and restarts Torque.
Open **⋮ → Updates**. The larger popup shows the installed version, saved channel, and two channel
buttons: Main (stable) and Testing (experimental). The update source is fixed to
this project; there is no editable repository field. Older saved repository
overrides are ignored.
Entering Testing requires accepting an experimental-features warning. The choice
is saved outside the installation and survives restarts and updates. **Check for updates** reads GitHub Releases over HTTPS.
**Main** installs take main releases (tags such as `v2.4.35`). **Testing** installs take the newest of testing
pre-releases (`testing-v2.4.36`) and main releases, so whatever was pushed last to either branch reaches them.
The app can return to an older Main version.

**Releases for some devices only.** A testing release can be built for only some platforms
(see Publishing below; releases currently build all three). A release reaches a device only
when it has that device's full download. If the newest release in the channel has none, the
check offers the newest earlier release that does, if it is still newer than the installed
version, and otherwise says, for example, *Testing 2.4.23 has no download for Steam Deck / Linux
yet (it was built for Windows only). Nothing was downloaded; you’re still on 2.4.22.* This is
an ordinary result, not an error, and Windows updates as usual. Versions 2.4.22 and earlier
instead show *Could not check for updates: Release 2.4.23 has no
DeckDriverStation-2.4.23-SteamDeck.tar.gz download yet.*; they also download nothing and stay
on their version.

An empty repository or missing channel releases says **No testing releases have
been published yet**. Errors and unpublished releases never say “up to date.”
Private repositories need a distribution solution with authentication; this
personal app uses public release downloads and stores no GitHub access tokens.

**Checking and GitHub's API limit.** The check asks GitHub's releases API. Unauthenticated calls are limited to 60
per hour for each network, so the app sends the ETag of its last answer (an unchanged list costs nothing). If GitHub
still refuses, the app uses the last saved list, or says when the limit resets. There is no channel manifest any more:
the Releases page holds only real releases.

**One download per platform is also the update.** Each release publishes exactly three files, and the updater
installs from the same one a person would download:

| System | File | How the app installs it |
|---|---|---|
| Windows x64 | `DeckDriverStation-<version>-Windows-Setup.exe` | Once the app exits, the helper moves `app` and `runtime` aside, runs the installer silently (`/S /D=<install folder>`) into the same folder, checks it installed `<version>`, keeps locally prepared CAD, and restarts. Any failure puts the old copy back. |
| Apple Silicon | `DeckDriverStation-<version>-macOS-arm64.zip` | Unzipped, signed ad hoc and swapped in place of the installed bundle, then reopened. |
| Steam Deck / Linux | `DeckDriverStation-<version>-SteamDeck.run` | The package inside the installer is checked against the SHA-256 written in the installer itself, unpacked, and swapped in like before. |

Releases from before V2 (2.4.34) had separate update packages (`Windows.zip`, `SteamDeck.tar.gz`, App packages); the
updater still uses them if a release has them.

**Icons.** Windows shortcuts point at a versioned `icons\deck-<version>.ico`, and the update
helper repoints Desktop, Start menu and pinned taskbar shortcuts and refreshes the shell icon
cache. Linux refreshes the menu icon copy and desktop entries; macOS refreshes the bundle icon
and re-registers the app with LaunchServices.

Windows keeps previous versioned icon files so cached, pinned and OneDrive-synced
shortcuts can still resolve them. Each updated shortcut also gets an explicit shell
refresh notification.

**Download update** checks the GitHub asset SHA-256 digest (or its exact matching
`.sha256` file), size, and repository/release URL. Failed downloads are discarded.
After verification, the same action prepares the update for this system (see the table above) and starts a helper
that waits for this app to exit. The helper keeps the previous app under the update's staging folder, installs the
new one, and restarts. Saved robots, browser sessions, and operating-system Wi-Fi profiles remain outside
the replaced installation. Helpers write `install.log` in the staging folder.
Opening Updates closes the active robot page and transport.

Desktop in-app installation requires an installed/packaged app; development
checkouts are protected from replacement. Apple Silicon updates are ad-hoc signed locally, like the initial installation.

## Publishing later

Every release from V2 (2.4.28) on keeps to [Compatibility from V2 on](COMPATIBILITY.md): V2 must update to it, and going back to V2 must keep saved robots and settings. tests/compat-v2.test.cjs checks it.

The remote is `https://github.com/AloeVeraZ/Torque-RobotController.git`.
The repository used to be `AloeVeraZ/SteamDeck-RobotController`. Installs from before the rename only accept
download URLs with the old name, so the channel manifests keep it and GitHub redirects them. Never create a new
repository with the old name: that would end the redirects and strand those installs.
Main and Testing are published branches; Main publishes stable releases (v2.4.22 and later). New work
continues on Testing until promotion is requested. Initial install commands always
read `main/install.sh` or `main/install.ps1` and resolve the newest stable release,
so users can reuse the same command for future versions. No separate download
website or laptop server is involved. After installation, users can choose Testing
from **⋮ → Updates**, accept its warning, and return to Main whenever needed.

Publishing is a push. **A push to `testing` or `main` publishes that commit when `package.json`'s version has no
release on that branch yet** (`.github/workflows/release.yml`):

1. Raise `version` in `package.json` (a push that does not raise it builds nothing and says so).
2. Push to `testing`: it tests, builds all three systems for the testing channel and publishes the pre-release
   `testing-v<version>`, replacing earlier testing pre-releases. Testing installs offer it in the app.
3. Push (or fast-forward) to `main`: it publishes `v<version>` for the main channel as the release, and removes every
   release with a lower version, testing ones included. Every install, Main and Testing, offers it in the app.

Each build gets its branch's update channel (`tools/package.py --channel`), whatever `package.json` says.
`tools/release-targets.cjs` checks every system built and keeps one file per system. Nothing is deleted before the new
release is published, and never a release with a higher version.

GitHub branch changes alone are not installable releases. The updater never runs
`git pull` against an installed app or pretends an unpublished commit is an update.
API contract: [GitHub Releases documentation](https://docs.github.com/en/rest/releases/releases).
