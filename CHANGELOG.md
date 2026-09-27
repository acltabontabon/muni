# Changelog

What’s new in Muni, for the people who use it. Versions follow [semantic versioning](https://semver.org);
what counts as a breaking change for Muni is described in [docs/RELEASING.md](docs/RELEASING.md).
This file is also what the app shows under About → What’s new, and what each GitHub release says.

<!--
Maintainers: write user-facing notes under Unreleased as changes land — what people can now do, what got
easier, what was fixed, and anything they must do after updating. Leave out refactors, dependencies,
file names and commit hashes. Format: scripts/changelog.mjs. Process: docs/RELEASING.md.
-->

## [Unreleased]

## [1.0.0-rc.1] - 2026-09-28

Muni is a calm place to keep what happens during a sprint and bring it to the retrospective. Write a
thought while it’s fresh; when collection closes, everyone’s thoughts arrive together, without names,
and the retro becomes a conversation about what to change.

This is the release candidate for Muni 1.0. Everything below works today; it becomes 1.0.0 once
signing in and unlocking have been confirmed on real phones and computers, not only in test browsers.

### Highlights

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

### Good to know

- Passkeys are the only way to sign in. Add a second one in Account & settings: if you lose every
  passkey, Muni can’t restore the account.
- Muni keeps a private record of who wrote each thought, so only you can edit yours; your team never
  sees it. The [Privacy](https://act.munimuni.app/privacy) page explains what is kept and who can see it.
- Muni is in English and has been tested mostly in Chromium browsers; Safari, iOS and Firefox less so.
- Deleting your account, or leaving a workspace yourself, isn’t possible in the app yet — write to the
  address on the Privacy page.

[Unreleased]: https://github.com/acltabontabon/muni/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/acltabontabon/muni/releases/tag/v1.0.0-rc.1
