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

## [1.0.0-rc.2] - 2026-09-30

### Added

- **The first evening: a guide for new people.** A new account starts with a short prologue on what
  a sprint in Muni is, then a firefly settles beside the one control to use next — from creating the
  team to starting the first retro — with a line on what it’s for. Its stars light as the team’s
  first sprint goes by (account menu → **The first evening**), and when the first retro is done they
  come together as Muni’s mark. *Later* and *Hide the guide* are always there; accounts from before
  this update don’t see it.
- **A cue for the facilitator.** The stage shows the facilitator — only on their own screen, never
  when presenting — a line to say and the one thing to do next, from last time’s experiments to
  ending the retro. A first retro can be run from it alone; *Hide lines to say* keeps just the next
  step.
- **Owners can take over a stranded sprint.** If a facilitator can’t carry on, a workspace owner can
  choose **More → Take over facilitating…** on the sprint’s page. It says first what that means,
  including for an encrypted sprint that’s still collecting.

### Changed

- **Votes that make you choose.** A retro never gives more votes than half its topics (at least one):
  three topics give one vote each, six give three. **Vote again** now asks first, and the talk then
  starts over from the top of the new order.
- **A calmer stage.** A topic’s thoughts come before what the room said about them; the facilitator’s
  margin is the clock, the notes and one line to ask the room; the steps’ map shows only on a team’s
  first retro. Votes and answers happen only on people’s own devices — never on the shared screen.
- **A retro without themes is a full retro.** Thoughts left out of a theme become a topic of their
  own, with notes, questions and ideas like any other. With fewer than two topics the retro skips
  Choose, and a flagged theme is always talked about first.
- **Everyone counted the same way.** The rail, the vote’s “of how many” and the recap count the same
  people, and the recap shows only who came.
- A lighter Agree: adding an experiment asks for the change first, then how you’ll know it helped and
  who owns it.
- The opening question shows while people arrive, *Invite people* sits on the sprint’s page when a
  facilitator is alone, and the retro’s start and end are worded plainly on every screen.
- Setting up a sprint on a phone keeps its buttons compact, instead of covering a quarter of the
  screen.

### Fixed

- The retro fits a phone or tablet: the top bar no longer runs off the side, the cue steps aside while
  you type, and long names and pasted links wrap everywhere instead of pushing the screen sideways.
- The cue’s “out of time” now arrives with the clock, even after presenting and coming back.
- A phone’s topic number matches the stage’s, and quick taps while voting can no longer show a stale
  vote.
- A facilitator who closes collection mid-sentence keeps their words, like everyone else.
- *My thoughts* can’t get stuck on a category filter, and a finished sprint’s page no longer loads
  every thought hidden in its folds until you open them.
- Double taps no longer act twice: on the themes page, saving your name, removing a passkey or turning
  off a link.
- In Kape’s room on a phone, the sprint’s three stops no longer squeeze out of view.
- The sprint’s time zone always shows the one it’s in, and *Cancel* on a new sprint stays in Muni.
- Saving a recovery key as a file works in Safari.
- The guide’s firefly no longer covers the control it points at, and a join request that can’t be
  found offers a way back.
- The update notice can be put off for later, and messages no longer sit on top of it or under an
  iPhone’s home bar.
- Offline, thoughts waiting to send retry more gently and send as soon as the connection is back;
  drafts survive *Send to another sprint instead* and turning *Keep drafts on this device* on or off.
- Thoughts still sending sit inset in every room, and a page that fails to draw offers a reload
  instead of going blank.
- Server errors are no longer reported as “usage limit”; invitations and reminders can’t be sent
  twice; limits hold when many requests arrive at once.

### Security

- Sign-in, sign-up, joining and invitation requests from one address are rate-limited at
  Cloudflare’s edge, before they reach the database.
- The log of administrative actions (which holds no text) is now deleted after 400 days.

## [1.0.0-rc.1] - 2026-09-29

### Added

- **Write while it’s fresh.** Keep a thought the moment something happens, helps or gets in the way —
  a line is enough, on a laptop or a phone. Add a category or a little context if you like, and edit
  it until collection closes.
- **One page for each sprint.** Writing, the closed state, the retro and the outcomes all happen on
  the sprint’s own page, for everyone in it. Its top says where the sprint is and what’s next —
  thoughts, then the retro on its planned date, then what the team will try.
- **Facilitators: the next step, in one place.** Open collection, close it whenever you’re ready, then
  start the retro — grouping thoughts into themes is optional. Each change says what it will do for
  everyone before it happens, and collection can be reopened until the retro starts.
- **Everyone’s thoughts at once, without names.** Nobody on the team, facilitator included, reads
  anything until collection closes. Then every thought appears together on the sprint’s page, in
  random order and with no names, so everyone can read them before the retro.
- **A retro in four steps.** Look back (did last time’s experiments help?), choose (what matters
  most?), talk (one topic at a time) and agree (what will we try?), on a shared screen while each
  person follows on their own phone. The first step shows the whole retro at a glance. Choosing says
  why it matters — the talk has time for about three topics, so the votes pick which come first —
  and the facilitator sees how many have voted, never who. In the talk, the topics lie along a
  horizon with the sun on the one being discussed, on the stage and every phone; the facilitator
  writes what the room will remember, and ideas to try, right on the screen. If it helps, thoughts
  are gathered into themes first, on a sorting table that needs no explaining. A paused retro says
  so on every screen.
- **See who’s here.** Faces in the retro light up as people open it on any screen — their
  character, or their initials — and while the room gathers, the stage says, once, when someone arrives.
- **A way in for everyone, without having to speak.** When it helps, the facilitator asks how a
  topic showed up — *I felt this*, *Not in my work*, *I’d need context* — or whether an idea would
  help. One tap answers, a line is optional, and answers stay private until the facilitator shares
  them: counts and lines, never names, with a concern kept visible beside the rest. Anyone can also
  add an example, another view or a question to the topic from their phone, shared without their
  name when the facilitator brings it in. Nothing waits for everyone, and nobody is called on.
- **Experiments that come back.** Agree on one to three changes to try — start from an idea from the
  talk in one tap; wording that reads like a hope gets a suggestion, never a wall. Each owner says
  yes on their phone, and the experiments open the next sprint’s retro, so the team sees what
  actually happened.
- **A recap worth coming back to.** Once the retro ends, the sprint’s page is its recap: who came,
  what the team will try and who owns it, what each topic left behind, and the facilitator’s own
  words — the same page for everyone, easy to scan on a phone.
- **Encrypted on your team’s devices.** Sprints are encrypted by default, before anything leaves the
  browser, and Muni’s servers don’t hold the keys to read them; a facilitator can set one up without
  encryption, and it says so. You sign in with a passkey — no passwords.
- **A page that feels like yours.** Choose one of eight characters: it gives your own pages a calm
  room of their own, and it’s your face in the retro, beside your name.
- **Owners decide who joins.** Workspace owners invite people and say yes to requests to join; a
  sprint's facilitator can invite people straight into their own sprint.
- **Leave whenever you like.** Leave a workspace from its People page, or delete your account from
  Account. Anything the team relies on — ownership, a sprint you facilitate — is handed on first, and
  Muni says what that is. Deleting your account takes with it what nobody has seen yet; what the team
  saw stays, tied to no one.

[unreleased]: https://github.com/acltabontabon/muni/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/acltabontabon/muni/compare/v1.0.0-rc.1...v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/acltabontabon/muni/releases/tag/v1.0.0-rc.1
