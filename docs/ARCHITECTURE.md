# Muni — architecture and privacy model

Muni (from the Filipino *muni-muni*, to reflect) is a sprint-retrospective app built around one
loop: capture thoughts while they are fresh → reveal them together, without names → look back at
last time's experiments → choose what to talk about → talk → agree on one to three experiments →
revisit them next sprint.

This note describes the implementation in this repository and, above all, where the privacy
boundary sits. The security review in [`security-review-2026-09.md`](security-review-2026-09.md)
records what was verified against it and what is still open.

## Shape

One Cloudflare Worker, one D1 database, one Durable Object class, one cron trigger. There is no
other supported backend and no container packaging.

```
browser ──HTTPS──▶ Worker (TypeScript, Hono)  /api/*  ──▶ D1 (SQLite): every durable record
   │               static assets (the built web/) are     └─▶ MeetingRoom Durable Object, one per sprint:
   │               served by the platform, not the Worker      live meeting state + WebSocket fan-out
   └──WebSocket /api/sprints/:id/ws ──▶ Worker (auth) ──▶ MeetingRoom (hints only, no content)
cron */15 ──▶ Worker: due jobs (email, reminders) and a daily retention sweep
```

| path | what |
| --- | --- |
| `worker/src/index.ts` | entry: configuration check, client-revision gate, routes, error mapping, cron |
| `worker/src/routes/` | one module per area: auth and invitations, passkeys, keys (encryption keys and wraps), email preferences, workspaces, join links and requests, sprints, entries, themes, voting, meeting, check-ins, commitments (experiments and recaps), exports, demo (development only) |
| `worker/src/room.ts` | `MeetingRoom`: step, topic, timer deadline, controller, attendance, version; hints to everyone, or only to facilitators and an account's own tabs |
| `worker/src/lib/` | sessions/CSRF/authorization, who may bring people in (`grants.ts`), caps enforced where data is written (`limits.ts`), accounts, avatars, departure (leaving and deleting), encryption envelope checks (`sealed.ts`), hints to the room (`live.ts`), D1 helpers, errors, email adapter, rate limits, config, small utilities |
| `worker/src/jobs.ts` | durable jobs in D1, reminders, retention |
| `worker/src/contract.ts` | the typed API contract, imported by the web app |
| `worker/migrations/` | SQL migrations, applied in order (additive within a major, [RELEASING.md](RELEASING.md) §2) |
| `web/` | React 19 + Vite + Tailwind 4 client, an installable PWA |
| `web/src/lib/local/` | the device store and send queue for offline capture |
| `web/src/sw.ts` | service worker: app shell (plus a chosen world's fonts), never `/api` |

**Division of state.** D1 is authoritative for everything durable (accounts, sessions,
workspaces, sprints, entries, themes, votes, notes, experiments, jobs). The room object is
authoritative only for live coordination and socket fan-out. Nothing is writable in both.
Cross-boundary steps persist to D1 first, then tell the room; the room's `/start` is idempotent
and reading the meeting re-initialises a missing session, so a failed call is recoverable.

**Live updates are hints.** A socket message names the resource that changed and a version; the
client then fetches a fresh, authorized snapshot over HTTP. A broadcast therefore can't carry
anything a recipient may not see, and reconnecting is just fetching again. Hints that only change
the facilitator's view — someone arriving or leaving, an answer or an addition coming in — go only
to the facilitator's sockets and the person's own tabs (a vote goes to the voter's own tabs, and to
the facilitator's only when their count of voters moves); the room follows a handover of
facilitation on the sockets already open, and the previous facilitator stops controlling the stage. Clients gather hints for a moment and read each part once, in order,
dropping an answer older than one already shown. Sockets use the Hibernation API, so an idle room
costs nothing.

**Concurrency without cross-store transactions.** D1 is single-writer, so each race is one
conditional statement: a submission is `INSERT … SELECT … WHERE status = 'collecting'` against the
batch that closes collection; a vote is `INSERT … WHERE (my votes) < budget`; an invitation is
`UPDATE … WHERE accepted_at IS NULL` (one change wins); lifecycle transitions are
`UPDATE … WHERE status = ?`; demoting an owner requires another owner in the same statement.
Facilitator commands carry the version they observed (`expected_version`). The room checks that
version and who is controlling the stage *before* anything in D1 changes (`/claim`), so a refused
command changes nothing; multi-field edits are validated whole, then written in one batch.

**No always-on loops.** Jobs are D1 rows. They run right after being queued (bounded, via
`waitUntil`) and from the 15-minute cron, with bounded retries, backoff and a `failed` state.
Reminders are scheduled per sprint at their instant. Countdowns are rendered from a stored
deadline; nothing ticks on the server.

## Data model

Opaque UUIDs everywhere; instants are integer milliseconds. Columns marked *private* exist only
for authorization and are never selected into a shared response type.

```
accounts (display_name, name_set_at, avatar)     sessions (sha256(token), csrf, expiry, revoked)
account_emails (account, email)                  webauthn_credentials (public key), webauthn_challenges
account_keys (public key, recovery blob)         passkey_key_wraps, device_unlocks (share, label)
security_events (the account's own history)      sprint_keys (version, public key), sprint_key_wraps
workspaces (retention windows)                   memberships (workspace, account, role, revoked_at)
invitations (sha256(token), email, expiry)       join_links, join_requests
sprints (lifecycle, schedule, settings)          sprint_participants (is_facilitator, reminder opt-out)
entries (body, category, …, author_account_id ← private, reveal_order)
themes, theme_entries
vote_rounds, votes (account_id ← private)        context_additions (author_account_id ← private)
checkins, checkin_responses (account_id ← private)
discussion_notes, experiments, recaps            jobs, audit_events (ids only), rate_events (hashed keys)
dev_mail (local development only)
```

## The privacy boundary

The promise made in the product, as the Privacy & data page (`web/src/routes/Privacy.tsx`) puts it
in short ([`privacy-claims.md`](privacy-claims.md) maps each claim to its evidence):

> Until collection closes, only you can read your thoughts — not your team, not the facilitator, not
> workspace owners. Then everyone in the sprint sees them together, in random order, without names.
>
> Muni does keep a private record of who wrote each thought, so only you can edit yours. It’s never
> shown to your team, but your wording can still give you away.

This is application-level anonymity. It is implemented as follows.

1. **Ownership is a private column.** `entries.author_account_id`, `votes.account_id`,
   `context_additions.author_account_id` and `checkin_responses.account_id` exist so the server can
   authorise private editing, let an answer be changed and never counted twice, and enforce vote
   budgets. They are never selected into a shared response.
2. **Allow-listed response types.** Shared representations (`SharedEntry`, `ThemeView`,
   `StageSnapshot`, exports) are built from explicit SELECT lists with no author, timestamp,
   alias or network field. There is no "with author" variant.
3. **No reveal endpoint.** Workspace ownership grants settings and membership administration, not
   an author lookup. There is no "who wrote this" feature, by design.
4. **Sealed collection.** While a sprint is collecting, the only entry listing is the caller's
   own. Facilitators and owners get no listing, count or live hint until collection is closed —
   an explicit, confirmed action. At close every entry gets a random `reveal_order`, and shared
   listings sort by it, so ordering can't leak submission time.
5. **No per-person status.** No typing indicators, no "someone just submitted", no per-person
   counts. Collection is summarised only after close, as a total.
6. **Votes stay private.** Totals appear only after a round closes; nobody sees who voted.
7. **People do the interpreting.** Muni has no AI or model inference: the facilitator groups
   thoughts and names themes, the team talks, and outcomes are what the facilitator records. No
   content is sent to an AI provider.
8. **Logs carry no content.** The app logs failures with the path, method and a short error only. The
   platform's request logs record method, URL and (redacted) headers; URLs carry resource IDs,
   never invitation tokens or text.
9. **Check-ins are sealed until shared.** An answer is visible to its author; the facilitator gets
   a count while it's open, nobody else anything; the live hint for an answer goes only to the
   facilitator's sockets and the author's own other tabs. Shared results are counts per answer and
   the lines, in a drawn order, with no account, time or order of answering. Muni never picks
   someone to speak.
10. **Audit without content.** Audit events record who changed a phase, regrouped or closed
    collection, with resource IDs only.

**Known limits** (stated in the product, not hidden): the operator, with database or backup
access, can join `author_account_id` to accounts — the mitigation is operational, not
cryptographic. Sprint content is encrypted client-side by default (docs/ENCRYPTION.md), which
removes the operator's stored ability to read it but not to see authorship or to ship a malicious
frontend; a sprint set up without encryption is stored as plaintext. An encrypted thought's envelope
names no author, so what teammates receive after reveal can't be tied to anyone. Small teams and
distinctive writing can identify an author. Exports are copies retention can't retract.

## Authentication and authorization

- **Passkeys are the only way in** (WebAuthn via `@simplewebauthn/server`): one "Continue with a
  passkey" action, accounts created with a passkey and a name, RP ID = the app's own host, exact
  origins from configuration, user verification required, single-use challenges consumed
  atomically before verification. There is no email sign-in, password or recovery email; only
  sessions made by a passkey authenticate. An address, if an account has one (`account_emails`,
  from an accepted emailed invitation), is only where invitations and reminders go. Sensitive
  changes need a passkey confirmation within 10 minutes. Details: [PASSKEYS.md](PASSKEYS.md).
- **Sessions** are a random token in an HttpOnly, Secure, SameSite=Lax cookie (`__Host-` prefixed
  over HTTPS), stored as its SHA-256, with a 30-day expiry and server-side revocation. Mutations
  need the per-session CSRF token in a header plus an allowed `Origin`; the live socket needs an
  allowed `Origin` too. No CORS headers are sent.
- **Emailed invitations** are single-use links that expire after 14 days; whoever accepts first,
  signed in with a passkey, joins. The token travels in the link's fragment and in request
  bodies, never in a URL the server sees.
- **Invite QR codes / shared links** let a signed-in person *ask* to join; **personal links** work
  once and join their first signed-in user directly. Both grant only the `member` role, expire and
  can be turned off; only token hashes are stored.
- **Who may bring people in** (`lib/grants.ts`): everything workspace-wide — invitations without a
  sprint, workspace codes and links, deciding requests to join the workspace, and the list of
  pending invitations with their addresses — is the owners'. A sprint's facilitator can invite
  people into that sprint, by email or its own code, and decide requests to join it, while it's
  unfinished. A non-owner never learns whether an address belongs to a member. A grant is checked
  again when it's used: an invitation stops working once its sender may no longer invite into its
  scope.
- **Every request is authorized from D1**: an active membership for workspace routes; for sprint
  routes, membership plus participation (owners can see a sprint's settings, not its content).
  Nothing the client sends (user id, role, workspace) is trusted. Revoking a membership or a
  participant fails their next request and closes their live sockets.

## Offline capture (web)

Every save goes through a queue (`web/src/lib/local/outbox.ts`) with a client submission id as
the idempotency key, so a lost response or a second tab never creates a duplicate. Before sending,
the queue checks the signed-in account; the server refuses a thought written under another account
(`account_mismatch`), a closed sprint (`collection_closed`) or a revoked member. Drafts and the
queue are stored per account — in IndexedDB only for a person who turned on "Keep drafts on this
device", otherwise in memory for the tab. The service worker caches the app shell only; no API
response, session token or other person's entry is stored on the device. Sign-out ends the session
on the server first, names unsent work, then removes that account's local records.

## Retention

A daily sweep deletes a finished sprint's raw content (entries, themes, votes, notes,
unpublished recaps, and the room's stored state) after the workspace's window (90 days by default)
and its outcomes (experiments, published recaps) after a longer one (730 days, never shorter than
the content window). Passkey challenges, rate-limit rows, sessions and finished jobs expire on short
schedules; invitations go 30 days after they were accepted, withdrawn or expired; the log of administrative actions after 400 days. Not yet covered: sprints that are
never finished, and deleting a workspace others are still in. Deleted rows remain in the database's point-in-time recovery window (7 days on the Workers Free plan, 30 on
Paid).

## Leaving and deleting an account

A member can leave a workspace; the last owner (while others remain) and the facilitator of an
unfinished sprint others are in must hand on first, because the team depends on them — and in an
encrypted sprint that's collecting, the facilitator holds its only key. Someone alone in a
workspace leaves by deleting it. Leaving is the same as being removed: access ends, unfinished
sprints drop them, and what they submitted stays.

Deleting an account (after a recent passkey sign-in) follows one rule: what the team has seen stays
with the team, what nobody has seen goes. Entries not yet revealed, votes in open rounds, unshared
check-in answers and unreleased additions are deleted; revealed rows are kept with the author
column replaced by a fresh random value per row, so they can't be grouped as one person's.
Workspace history keeps its events under a "gone" actor (shown as "Someone", not Muni) and records
`account.deleted`. Workspaces with no other member go too, and the person is taken out of every
live room they were in. Every statement carries the same guard as the check before it, so a join
or handover that lands in between leaves everything as it was (409 `not_free`). `lib/departure.ts` holds the
statements; `test/departure.test.ts` checks that no row names the account afterwards.

## Configuration and safety rails

Configuration is Worker vars and secrets, validated once per isolate. A production deployment
refuses insecure settings instead of degrading: a non-HTTPS `PUBLIC_ORIGIN`, the console email
inbox, demo seeding. Without an email provider, queued invitation and reminder emails fail with
`setup_required` in the job queue and aren't delivered; the inviter still gets the link to copy.
The only way in without a passkey is the development-only `POST /api/dev/session` (used by the
tests and demos), refused in production and wherever `ALLOW_DEMO_SEED` is off. `worker/wrangler.jsonc` is for local
development and tests only; a production deployment uses its own rendered config
(see [`DEPLOYMENT.md`](DEPLOYMENT.md)). Clients send their build revision; one older than
`MIN_CLIENT_REVISION` is asked to reload rather than sending payloads the server doesn't accept.

## Capacity (estimates, not measurements)

For ten participants, ~100 entries and one hour-long live retro per sprint, one team uses well under
1% of the Workers Free daily allowances. The first limit a busy day reaches is D1 row reads (each
live snapshot reads several tables); the Worker then answers `503 quota`, and says a write may not
have been saved. Caps are enforced where data is written (`lib/limits.ts`), so every read returns
everything there is: 60 participants per sprint, 200 thoughts per person and 12,000 per sprint,
40 themes, 100 retro additions per person. Each account can send 20 invitation emails, create
10 workspaces and create 20 sprints a day; a workspace sends at most 3 reminder emails a day per
active member (a reminder reaches each participant once per sprint and moment, so a team never
gets near it); and the deployment sends at most `EMAIL_DAILY_LIMIT` emails a day (80 by default).
