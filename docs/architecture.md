# Architecture

How Muni is built, and where its privacy boundary sits. Read this before changing anything that
stores, reads or broadcasts what people write. [`privacy-claims.md`](privacy-claims.md) maps each
product claim to its evidence; [`security-review-2026-09.md`](security-review-2026-09.md) records
what was reviewed and what is still open.

## System shape

One Cloudflare Worker (TypeScript, Hono), one D1 database, one Durable Object class and one cron
trigger. There is no other backend.

```
browser ── HTTPS /api/* ─────▶ Worker ──▶ D1 (SQLite): every durable record
   │                             │
   └── WebSocket /api/sprints/:id/ws ──▶ MeetingRoom Durable Object (one per sprint)
                                          live meeting state and socket fan-out

cron */15 ──▶ Worker: due jobs (emails, reminders) and a daily retention sweep
```

The platform serves the built web app as static assets; only `/api/*` runs the Worker first.

| Path | Contents |
| --- | --- |
| `worker/src/index.ts` | Entry: config check, client-revision gate, routes, error mapping, cron |
| `worker/src/routes/` | One module per area (auth, passkeys, keys, workspaces, join, sprints, entries, themes, voting, meeting, check-ins, commitments, exports, email preferences, dev-only demo) |
| `worker/src/lib/` | Sessions and authorization, write-time caps (`limits.ts`), who may invite (`grants.ts`), leaving and deleting (`departure.ts`), envelope checks (`sealed.ts`), room hints (`live.ts`), rate limits, email, config |
| `worker/src/room.ts` | `MeetingRoom` |
| `worker/src/jobs.ts` | Durable jobs, reminders, retention |
| `worker/src/contract.ts` | Typed API contract, imported by the web app |
| `worker/migrations/` | SQL migrations, applied in order ([releasing.md](releasing.md)) |
| `web/` | React 19, Vite, Tailwind 4; an installable PWA |
| `web/src/lib/local/` | Device store and send queue for offline capture |
| `web/src/sw.ts` | Service worker: caches the app shell, never `/api` |

### State

D1 holds everything durable. The room object holds only live coordination: step, topic, timer
deadline, who controls the stage, attendance and a version. Nothing is written in both. A step that
touches both saves to D1 first, then tells the room, so a failed room call is recoverable.

### Live updates are hints

A socket message names a resource and a version. The client then fetches a fresh, authorized
snapshot over HTTP, so a broadcast never carries content and reconnecting is just fetching again.
Hints that matter only to the facilitator (someone arriving, an answer coming in) go to the
facilitator's sockets and the person's own tabs. Sockets use the Hibernation API, so an idle room
costs nothing.

### Concurrency

D1 has a single writer, so each race is one conditional statement. A submission inserts only while
the sprint is still collecting, a vote only while the voter is under budget, an invitation is
accepted by `UPDATE … WHERE accepted_at IS NULL`, and a lifecycle change by `UPDATE … WHERE status = ?`.
Facilitator commands carry the version they saw (`expected_version`). The room checks that version
and who controls the stage before anything changes in D1, so a refused command changes nothing.

### Jobs

Jobs are D1 rows. They run right after being queued (bounded, via `waitUntil`) and from the cron,
with bounded retries and a `failed` state. Countdowns render from a stored deadline; nothing ticks
on the server.

## Data model

IDs are opaque UUIDs and instants are integer milliseconds.

| Area | Tables |
| --- | --- |
| Accounts and sign-in | `accounts`, `account_emails`, `sessions`, `webauthn_credentials`, `webauthn_challenges`, `security_events` |
| Keys | `account_keys`, `passkey_key_wraps`, `device_unlocks`, `sprint_keys`, `sprint_key_wraps` |
| Teams | `workspaces`, `memberships`, `invitations`, `join_links`, `join_requests` |
| Sprint | `sprints`, `sprint_participants`, `entries`, `themes`, `theme_entries`, `vote_rounds`, `votes`, `context_additions`, `checkins`, `checkin_responses`, `discussion_notes`, `experiments`, `recaps` |
| Operations | `jobs`, `audit_events`, `rate_events`, `dev_mail` (local development only) |

Four columns exist only so the server can authorize and deduplicate. They are never selected into
a shared response:

- `entries.author_account_id`
- `votes.account_id`
- `context_additions.author_account_id`
- `checkin_responses.account_id`

## The privacy boundary

The product promises that, until collection closes, only you can read your thoughts. Then everyone
in the sprint sees them together, in random order, without names. Muni keeps a private record of who
wrote each thought so only the author can edit it.

This is application-level anonymity. These rules hold it in place:

1. **Allow-listed shared types.** `SharedEntry`, `ThemeView`, the stage snapshot and exports come
   from explicit column lists with no author, timestamp or network field. No variant includes an
   author.
2. **No reveal endpoint.** Workspace owners administer settings and membership. Nobody, owners
   included, can look up who wrote a thought.
3. **Sealed collection.** While a sprint is collecting, the only entry listing is the caller's own.
   Facilitators and owners get no listing, count or live hint until collection is closed, which is
   an explicit, confirmed action. Closing gives each entry a random `reveal_order`, and shared
   listings sort by it, so order cannot leak submission time.
4. **No per-person status.** No typing indicators, no "someone just submitted", no per-person
   counts. After close, collection is summarised as one total.
5. **Private votes and check-ins.** Vote totals appear only after a round closes. A check-in answer
   is visible to its author; the facilitator sees a count while it is open; shared results are
   counts and lines in a drawn order, with no account or time.
6. **No AI.** Facilitators group thoughts and name themes; no content goes to any model or provider.
7. **Content-free logs.** The app logs failures with path, method and a short error. Audit events
   record who changed a phase or closed collection, with resource IDs only.

The privacy tests (`worker/test/privacy.test.ts`, `boundaries.test.ts`) enforce these rules.

**Limits, stated in the product.** An operator with database access can join `author_account_id` to
accounts; the mitigation is operational, not cryptographic. Encryption removes the operator's
stored ability to read content, but not to see authorship or to ship a malicious frontend, and a
sprint set up without encryption is stored as plaintext. Small teams and distinctive writing can
identify an author. Exports are copies that retention cannot retract. Details:
[encryption.md](encryption.md).

## Authentication and authorization

- **Passkeys are the only sign-in.** There is no password, email sign-in or recovery email. An
  account's email address, if it has one, is only where invitations and reminders go. Sensitive
  changes need a passkey confirmation within 10 minutes. See [passkeys.md](passkeys.md).
- **Sessions.** A random token in an HttpOnly, SameSite=Lax cookie (`__Host-` prefixed over HTTPS),
  stored as its SHA-256, expiring after 30 days (`SESSION_TTL_DAYS`) and revocable on the server.
  Mutations need the per-session CSRF token in the `x-csrf-token` header and an allowed `Origin`.
  The live socket also needs an allowed `Origin`. No CORS headers are sent.
- **Joining.** Emailed invitations are single-use and expire after 14 days. Invite links let a
  signed-in person request to join, or join directly, as a `member`. Only token hashes are stored.
- **Who may invite** (`lib/grants.ts`). Workspace-wide invitations, links and join requests belong
  to owners. A sprint's facilitator can invite people into that unfinished sprint and decide its
  requests. A grant is checked again when used.
- **Every request is authorized from D1.** Workspace routes need an active membership; sprint
  routes need membership and participation. Owners see a sprint's settings, not its content.
  Nothing the client sends (user, role, workspace) is trusted. Revoking a member fails their next
  request and closes their sockets.

## Offline capture

Every save goes through a queue (`web/src/lib/local/outbox.ts`) keyed by a client-generated
submission ID, so a lost response or a second tab cannot create a duplicate. The server refuses a
thought written under another account (`account_mismatch`), for a closed sprint
(`collection_closed`) or by a revoked member.

Drafts and the queue are stored per account: in IndexedDB only when the person turns on "Keep
drafts on this device", otherwise in memory for the tab. The service worker caches the app shell
only. No API response, session token or other person's entry is stored on the device. Sign-out ends
the session on the server, names any unsent work, then removes that account's local records.

## Retention

A daily sweep (`retention()` in `worker/src/jobs.ts`) deletes, for finished sprints:

- **Raw content** (entries, themes, votes, notes, unpublished recaps, the room's stored state) after
  the workspace's content window, 90 days by default.
- **Outcomes** (experiments, published recaps) after a longer window, 730 days by default and never
  shorter than the content window.

It also expires operational data: sessions, finished jobs, rate-limit rows and passkey challenges
on short schedules; invitations 30 days after they were accepted, withdrawn or expired; the audit
log after 400 days.

Sprints that are never finished are not purged, and a workspace others still belong to cannot be
deleted. Deleted rows stay in D1 Time Travel for 7 days on the Workers Free plan and 30 on Paid.

## Leaving and deleting an account

A member can leave a workspace. The last owner (while others remain) and the facilitator of an
unfinished sprint that others are in must hand on first; in an encrypted sprint that is collecting,
the facilitator holds its only key. Someone alone in a workspace leaves by deleting it. Leaving
equals being removed: access ends, unfinished sprints drop the person, and what they submitted stays.

Deleting an account requires a recent passkey sign-in. The rule is: what the team has seen stays,
what nobody has seen goes.

- Unrevealed entries, votes in open rounds, unshared check-in answers and unreleased additions are
  deleted.
- Revealed rows stay, with the author column replaced by a fresh random value per row, so they
  cannot be grouped as one person's.
- Workspace history keeps its events under a "gone" actor and records `account.deleted`.
- Workspaces with no other member are deleted, and the person is removed from every live room.

Each statement repeats the guard of the check before it, so a join or handover that lands in
between changes nothing (409 `not_free`). The statements live in `worker/src/lib/departure.ts`;
`worker/test/departure.test.ts` checks that no row names the account afterwards.

## Configuration and safety rails

Configuration is Worker vars and secrets, validated once per isolate (`worker/src/lib/config.ts`).
A production deployment refuses insecure settings instead of degrading: a non-HTTPS
`PUBLIC_ORIGIN`, `EMAIL_PROVIDER=console`, `ALLOW_DEMO_SEED`. Without an email provider, queued
emails fail with `setup_required` and the inviter still gets the link to copy.

`POST /api/dev/session` is the only way in without a passkey. It is for tests and demos, and it is
refused in production and wherever `ALLOW_DEMO_SEED` is off.

`worker/wrangler.jsonc` is for local development and tests only. Production uses its own rendered
config ([deployment.md](deployment.md)).

Clients send their build revision as `x-muni-client`. A revision below `MIN_CLIENT_REVISION`
(`worker/src/index.ts`) gets a 426 `upgrade_required` and is asked to reload.

## Limits

Caps are enforced where data is written (`worker/src/lib/limits.ts`), so every read returns
everything stored:

- 60 participants per sprint, 200 thoughts per person, 40 themes, 100 retro additions per person.
- Per account per day: 20 invitation emails, 10 workspaces, 20 sprints.
- Reminder emails: 3 per active member per day per workspace.
- Deployment-wide: `EMAIL_DAILY_LIMIT` emails a day (80 by default).

When the platform's free allowance runs out, the Worker answers `503 quota`
and says a write may not have been saved.
