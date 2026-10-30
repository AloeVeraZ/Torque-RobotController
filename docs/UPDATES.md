# App updates and branches

Open **⋮ → Updates**. The larger popup shows the installed version, saved channel, and two channel
buttons: Main (stable) and Testing (experimental). The update source is fixed to
this project; there is no editable repository field. Older saved repository
overrides are ignored.
Entering Testing requires accepting an experimental-features warning. The choice
is saved outside the installation and survives restarts and updates. **Check for updates** reads GitHub Releases over HTTPS. Testing builds
use prereleases such as `testing-v2.4.3`; stable builds use tags such as `v2.4.2` and channel `main`.
The app can return to an older Main version.

**Releases for some devices only.** A testing release can be built for only some platforms
(see Publishing below; testing is currently Windows only). A release reaches a device only
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

**Checking without GitHub's API limit.** Unauthenticated GitHub API calls are limited to 60
per hour for each network, shared by every device and tool on it. Each publish therefore also
uploads `channel.json` to a fixed `testing-channel` / `main-channel` prerelease, with the
new release's assets, sizes and SHA-256 digests first, followed by up to five earlier releases
of the channel (so a device a partial release skips can still find its newest download). **Check for updates** reads that file as
an ordinary download, which the API limit does not apply to. Only if it is missing does the app
call the API, sending the saved ETag so an unchanged list costs nothing. If GitHub still refuses,
the app uses the last saved list, or says when the limit resets.

**Update size.** Each release built for every platform also publishes a small
`DeckDriverStation-<version>-App-<base>.tar.gz` holding only the app code (about 7 MB).
It fits every platform, so a release built for only some platforms leaves it out: updaters up
to 2.4.22 would otherwise install it on the devices the release skips. Newer updaters use an
App package only beside their own platform's full download.
`<base>` fingerprints what an installed copy keeps when only the code changes: the Electron
version and the launchers. An install whose `app/build.json` base matches downloads just
that package; anything else (an Electron upgrade, installs from before 2.4.18) downloads the
full package for its platform. The dialog shows the exact size GitHub lists for the chosen
asset before you download, and the progress counts against that size. A code-only update is
rebuilt locally from this install's own runtime and then installed exactly like a full one.

**Icons.** Windows shortcuts point at a versioned `icons\deck-<version>.ico`, and the update
helper repoints Desktop, Start menu and pinned taskbar shortcuts and refreshes the shell icon
cache. Linux refreshes the menu icon copy and desktop entries; macOS refreshes the bundle icon
and re-registers the app with LaunchServices.

Windows keeps previous versioned icon files so cached, pinned and OneDrive-synced
shortcuts can still resolve them. Each updated shortcut also gets an explicit shell
refresh notification.

**Download update** checks the GitHub asset SHA-256 digest (or its exact matching
`.sha256` file), size, and repository/release URL. Failed downloads are discarded.
After verification, the same action automatically extracts a new copy, validates its app name/version/runtime,
and starts a helper that waits for this app to exit. The helper keeps the previous
app under the update's staging folder, replaces the installed files, and restarts.
Saved robots, browser sessions, and operating-system Wi-Fi profiles remain outside
the replaced installation. Helpers write `install.log` in the staging folder.
Opening Updates closes the active robot page and transport.

Desktop in-app installation requires an installed/packaged app; development
checkouts are protected from replacement. Apple Silicon updates are ad-hoc signed locally, like the initial installation.

## Publishing later

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

After the user authorizes publication:

1. Push the approved branches. Set GitHub's default branch to testing while work
   continues there. Do not merge into main without explicit instruction.
2. Bump the `package.json` version. Testing packages keep `updateChannel: "testing"`.
3. Run the **Publish app update (manual)** workflow on testing. It tests, builds the
   platforms for that branch, and publishes their assets plus checksums (as a prerelease
   on testing) only after every build succeeds. Testing builds only the platforms in
   `package.json` `testingReleaseTargets` and main those in `mainReleaseTargets`
   (`steamdeck`, `windows`, `macos-arm64`; every platform when the key is missing), both
   currently `["windows"]`. A partial release is titled, for example,
   *Torque testing-v2.4.23 (Windows x64 only)*, its notes say which devices it
   is for, and it has no App package. Before publishing, `tools/release-targets.cjs` checks
   that each built platform has its download and checksum and that no other platform's files
   are there. It never runs on a normal branch push; pushing the tag `testing-v<version>`
   (on testing) or `v<version>` (on main) also starts it, so no GitHub sign-in is needed.
   The tag must point at a commit already on that branch, and the workflow and
   `package.json` are read from the tagged commit.
   An already published version/tag must not be reused.
4. Main publication requires an explicitly approved promotion and changing the
   packaged update channel to main. Testing builds keep their testing channel.

GitHub branch changes alone are not installable releases. The updater never runs
`git pull` against an installed app or pretends an unpublished commit is an update.
API contract: [GitHub Releases documentation](https://docs.github.com/en/rest/releases/releases).
