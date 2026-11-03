# Compatibility from V2 on

Torque V2 is 2.4.28, the first full release for Windows, Steam Deck/Linux and Apple Silicon Mac. From V2 on:

- **Forward:** every version updates to every later one, with its own update button.
- **Backward:** going back to an older version from V2 on, which the update screen allows, loses no saved robots or settings.

V2 has shipped and its code cannot change, so the rules below hold every newer version to what V2's own code expects. `tests/compat-v2.test.cjs` checks them against V2's updater and saved-robots code, kept exactly as released in `tests/fixtures/v2.4.28`. Never edit those two files.

## Updates

V2 finds updates the same way forever, so every release keeps to this:

| Rule | Why |
|---|---|
| Versions are plain `X.Y.Z` numbers, always higher than the last | V2 ignores a tag like `v2.5.0-beta`, and compares number by number |
| Main is tagged `vX.Y.Z` and is a full release. Testing is tagged `testing-vX.Y.Z` and is a pre-release | That is how V2 tells the two channels apart |
| File names stay `DeckDriverStation-<version>-Windows.zip`, `-SteamDeck.tar.gz`, `-macOS-arm64.zip`, and `-App-<base>.tar.gz` | V2 downloads them by exact name. The App package is the small update for installs on the same runtime |
| The channel manifest stays at the `main-channel` and `testing-channel` releases, as `channel.json` with `schema: 1` | V2 reads it first. Without it, V2 asks GitHub's API instead, which allows 60 checks an hour |
| The repository keeps redirecting from its old name `SteamDeck-RobotController` | Installs from before the rename still look there |

**Removing a release:** delete the release itself, never only its tag. A release whose tag is deleted disappears from the Releases list but still exists, still counts in the Releases number, and can still be downloaded from its old link. In November 2026, 24 old releases ended up like that.

## Saved data

Saved data stays where V2 looks, in a form V2 reads:

- **Names stay the same.** That covers the files in the data folder (`robots.json`, `update-settings.json`, `controller-settings.json`, `input-source.json`, `controller-calibration.json`, `robot-zoom.json`, `wiring-notes.json`, `configuration-notes.json`, `axon-keys.json` and the others the test lists) and the page's saved settings (`deck-simulation-project-v2`, `deck-ds-settings`, `deck-theme` and the rest).
- **`robots.json` stays `version: 2`.** V2 starts with no robots on any other version, and then overwrites the file the next time it saves.
- **New things are new fields.** A newer version can add fields and must treat a missing one as its default. V2 keeps fields it does not know on every robot it does not edit. A robot edited in V2 comes back without them, so a newer version cannot depend on them being there.
- **A format that has to change moves to a new name and keeps the old one written.** The simulation project did this from `-v1` to `-v2`. Never change what an existing name holds in a way V2 cannot read.

## The robot

Torque Debug, the program Torque puts on the Control Hub, is checked by its source each time. A version that finds a different one, older or newer, puts its own back before using it, so mixed versions never talk to each other.
