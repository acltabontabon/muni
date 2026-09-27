# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
Maintainers: add user-facing notes under Unreleased as changes land, under Added, Changed, Deprecated,
Removed, Fixed or Security (in that order, only the ones you need). Say what people can now do, what
got easier or what was fixed, and anything they must do after updating. Leave out refactors,
dependencies, file names and commit hashes. A bullet can lead with a **bold phrase**: the app shows
those as highlights. The app's About → What's new and each GitHub release are built from this file
(scripts/changelog.mjs checks its format). What counts as a breaking change: docs/RELEASING.md.
-->

## [Unreleased]

### Changed

- **Your character's room, with the sprint in it.** The sprint's name, where it is and the
  facilitator's next step are now part of each room, drawn in its own manner: a café's table card,
  a folio's index, a line of stations, a scoreboard, a book's contents, a track list, a programme,
  a plaque on the balcony. The room no longer names the sprint twice.
- **Calmer on phones.** On a small screen the rooms drop their boxes and put the writing straight
  on the page, and the sprint's stages read down as a list where they'd otherwise be squeezed.

## [1.0.0-rc.2] - 2026-09-28

### Changed

- **One page for each sprint.** Writing, the closed state, the retro and the outcomes all happen on
  the sprint's own page, for everyone in it. *Write* opens the sprint that's collecting for you; the
  workspace's list is for finding a sprint and opening it. Old outcomes links still work.
- **Where things are, at a glance.** The top of every sprint says where it is and what's next —
  thoughts, then the retro (with its planned date, which never changes anything by itself), then
  the outcomes — instead of five steps.
- **Facilitators: the next step, in one place.** Open collection, close it whenever you're ready
  (no need to wait for the retro date), then start the retro — themes are optional, and there's no
  separate “mark ready” step. Each change says what it will do for everyone before it happens.
  Collection can be reopened until the retro starts.

### Fixed

- Pressing a button twice (or closing collection from two tabs) no longer tries to change a sprint
  twice.
- Reopening collection brings back reminder emails that were still to come.

- A recap filled in from the retro no longer adds a full stop after a theme title or success signal
  that already ends with one, a question mark or an exclamation mark (“Who owns staging?” stays as
  written).

## [1.0.0-rc.1] - 2026-09-28

### Added

- **Write while it’s fresh.** Keep a thought the moment something happens, helps or gets in the way —
  a line is enough. Add a category or a little context if you like, and edit it until collection closes.
- **Everyone’s thoughts at once, without names.** Nobody on the team, facilitator included, reads
  anything until collection closes. Then every thought appears together, in random order, with no names.
- **A retro with a shape.** The facilitator gathers thoughts into themes, everyone votes privately on
  what to discuss first, and the live session moves topic by topic on a shared screen while each person
  follows along on their own device.
- **Experiments that come back.** Agree on one to three changes to try. They open the next sprint’s
  retro, so the team sees what actually happened.
- **Encrypted on your team’s devices.** New sprints are encrypted before anything leaves the browser,
  and Muni’s servers don’t hold the keys to read them. You sign in with a passkey — no passwords.
- **A page that feels like yours.** Choose one of eight characters to give your writing page a calm
  room of its own. Only you see it.

[unreleased]: https://github.com/acltabontabon/muni/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/acltabontabon/muni/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/acltabontabon/muni/releases/tag/v1.0.0-rc.1
