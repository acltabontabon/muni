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

### Added

- **Owners can take over a stranded sprint.** If a sprint’s facilitator can’t carry on — they’ve
  lost their passkey, say — a workspace owner can choose **More → Take over facilitating…** on the
  sprint’s page and run it from there. It says first what that means: the owner joins the sprint if
  needed, and in an encrypted sprint that’s still collecting, a new key starts for what’s written
  next, while thoughts already written stay sealed to the old facilitator’s key. Removing someone
  who facilitates now points to this, and a workspace with a single owner suggests adding another.

### Changed

- **A retro without themes is a full retro.** Starting the retro gathers any thoughts not in a theme
  into one topic of their own — *Everything else*, or *Everything we wrote* when there are no themes
  — so they get what every topic gets: notes the room keeps, questions on phones, additions without
  names, and ideas that carry into Agree. The start dialog says what will happen.
- **Choosing only when there’s a choice.** With fewer than two topics, the retro goes straight from
  looking back to talking, and the steps are numbered to match.
- **Votes stay private on the shared screen.** The stage no longer shows voting buttons, even to the
  facilitator; everyone, facilitator included, votes and answers from their own device. The stage
  links to that page for the facilitator, and the sprint’s page offers it while the retro runs.
- **Flagging a theme means something.** A flagged theme is talked about first, whatever the vote.
  The sorting table no longer asks for a summary or draft experiment the retro never showed.
- **The opening question is shown.** A sprint’s opening question now appears on the retro’s first
  step while people arrive.
- Clearer words where the retro starts and ends: the stage opens for the facilitator, everyone else
  sees *Join the retro* on the sprint’s page, and ending it shows every screen that it’s done.

### Fixed

- Thoughts still sending, or waiting to send, sat against their edge in some rooms (Himig, Kape,
  Guhit, Bola, Pahina, Porma, Biyahe); they’re inset and tinted the same way everywhere now.
- Offline, a thought waiting to send no longer retries every second; it waits longer each time, and
  sends as soon as the connection is back.
- *Send to another sprint instead* no longer clears the draft you were writing in that sprint, and
  can’t send a thought twice when pressed twice.
- Turning *Keep drafts on this device* on or off no longer loses a draft written beside a waiting
  thought.
- A page that fails to draw now says so and offers a reload, instead of going blank; a malformed
  link to an About or Privacy section no longer breaks the page.
- On a phone, the retro’s stage keeps its way to vote and add privately.
- Server errors are no longer reported as “usage limit”, and every unexpected error is logged.
- A slow email provider can no longer cause an invitation or reminder to be sent twice.
- Moving many thoughts into a theme at once no longer risks hitting the database’s per-request limit.
- Limits on thoughts, experiments, sign-in attempts and emails now hold even when several requests
  arrive at once.

### Security

- Sign-in, sign-up, joining and invitation requests from one address are rate-limited at
  Cloudflare’s edge, before they reach the database, so a flood can’t use up the database’s daily
  allowance.
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

[unreleased]: https://github.com/acltabontabon/muni/compare/v1.0.0-rc.1...HEAD
[1.0.0-rc.1]: https://github.com/acltabontabon/muni/releases/tag/v1.0.0-rc.1
