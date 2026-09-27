# Muni — architecture and privacy model

Muni (from the Filipino *muni-muni*, to reflect) is a sprint-retrospective app built around one
loop: capture observations while they are fresh → reveal the sprint's themes → choose worthwhile
conversations → invite everyone to contribute → agree on a few experiments → revisit them next
sprint.

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
cron */15 ──▶ Worker: due jobs (email, reminders, AI drafts) and a daily retention sweep
```

| path | what |
| --- | --- |
| `worker/src/index.ts` | entry: configuration check, client-revision gate, routes, error mapping, cron |
| `worker/src/routes/` | one module per area: auth and invitations, workspaces, sprints, entries, themes, voting, meeting, commitments, exports, AI, demo |
| `worker/src/room.ts` | `MeetingRoom`: phase, topic, timer deadline, controller, attendance, speaking round, version |
| `worker/src/lib/` | sessions/CSRF/authorization, D1 helpers, email adapter, AI adapter, rate limits, config |
| `worker/src/jobs.ts` | durable jobs in D1, reminders, AI drafting, retention |
| `worker/src/contract.ts` | the typed API contract, imported by the web app |
| `worker/migrations/` | additive SQL migrations |
| `web/` | React 19 + Vite + Tailwind 4 client, an installable PWA |
| `web/src/lib/local/` | the device store and send queue for offline capture |
| `web/src/sw.ts` | service worker: app shell only, never `/api` |

**Division of state.** D1 is authoritative for everything durable (accounts, sessions,
workspaces, sprints, entries, themes, votes, notes, experiments, jobs). The room object is
authoritative only for live coordination and socket fan-out. Nothing is writable in both.
Cross-boundary steps persist to D1 first, then tell the room; the room's `/start` is idempotent
and reading the meeting re-initialises a missing session, so a failed call is recoverable.

**Live updates are hints.** A socket message names the resource that changed and a version; the
client then fetches a fresh, authorized snapshot over HTTP. A broadcast therefore can't carry
anything a recipient may not see, and reconnecting is just fetching again. Sockets use the
Hibernation API, so an idle room costs nothing.

**Concurrency without cross-store transactions.** D1 is single-writer, so each race is one
conditional statement: a submission is `INSERT … SELECT … WHERE status = 'collecting'` against the
batch that closes collection; a vote is `INSERT … WHERE (my votes) < budget`; an invitation is
`UPDATE … WHERE accepted_at IS NULL` (one change wins); lifecycle transitions are
`UPDATE … WHERE status = ?`. Facilitator commands are serialised by the room and carry the version
they observed (`expected_version`); a stale one is refused.

**No always-on loops.** Jobs are D1 rows. They run right after being queued (bounded, via
`waitUntil`) and from the 15-minute cron, with bounded retries, backoff and a `failed` state.
Reminders are scheduled per sprint at their instant. Countdowns are rendered from a stored
deadline; nothing ticks on the server.

## Data model

Opaque UUIDs everywhere; instants are integer milliseconds. Columns marked *private* exist only
for authorization and are never selected into a shared response type.

```
accounts (email, display_name, name_set_at)      sessions (sha256(token), csrf, expiry, revoked)
workspaces (retention windows)                   memberships (workspace, account, role, revoked_at)
invitations (sha256(token), email, expiry)       verification_challenges (sha256(code:id), attempts)
sprints (lifecycle, schedule, settings)          sprint_participants (is_facilitator, reminder opt-out)
entries (body, category, …, author_account_id ← private, reveal_order)
themes, theme_entries                            ai_jobs (input snapshot), ai_proposals
vote_rounds, votes (account_id ← private)        context_additions (author_account_id ← private)
discussion_notes, experiments, recaps            jobs, audit_events (ids only), rate_events (hashed keys)
```

## The privacy boundary

The promise made in the product (the full wording is the Privacy & data page, `web/src/routes/Privacy.tsx`;
[`privacy-claims.md`](privacy-claims.md) maps each claim to its evidence):

> Your identity is verified to access this sprint. Your entries and votes are shown without your
> identity to teammates and facilitators. The service operator may technically be able to
> associate activity with accounts. Your wording can still reveal who you are.

This is application-level anonymity. It is implemented as follows.

1. **Ownership is a private column.** `entries.author_account_id`, `votes.account_id` and
   `context_additions.author_account_id` exist so the server can authorise private editing and
   enforce vote budgets. They are never selected into a shared response.
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
7. **AI sees text and opaque IDs only**, and only for sprints where it was enabled before
   collection started. Outputs are proposals tied to an input snapshot hash; originals are never
   replaced. The production configuration here ships with AI turned off.
8. **Logs carry no content.** The app logs failures with the path and a short error only. The
   platform's request logs record method, URL and (redacted) headers; URLs carry resource IDs,
   never invitation tokens, codes or text.
9. **The speaking rotation is named, feedback is not.** The speaking card shows a display name
   because it invites someone to speak; it never links them to an entry.
10. **Audit without content.** Audit events record who changed a phase, regrouped or closed
    collection, with resource IDs only.

**Known limits** (stated in the product, not hidden): the operator, with database or backup
access, can join `author_account_id` to accounts — the mitigation is operational, not
cryptographic. New sprints' content is encrypted client-side (docs/ENCRYPTION.md), which removes
the operator's stored ability to read it but not to see authorship or to ship a malicious
frontend; legacy sprints stay plaintext. Small teams and distinctive writing can
identify an author. Email verification proves control of a mailbox, not that a mailbox belongs
to one person. Exports and AI requests are copies retention can't retract.

## Authentication and authorization

- **Sign-in is passkey-first** (WebAuthn via `@simplewebauthn/server`): one "Continue with a
  passkey" action, accounts created with a passkey and no email, RP ID = the app's own host,
  exact origins from configuration, user verification required, single-use challenges consumed
  atomically before verification. An email address is an optional, verified setting
  (`account_emails`): code sign-in for recovery and for accounts from before passkeys, email
  invitations, reminders. Codes (10 minutes, 5 attempts, single use, hashed, purpose- and
  account-bound) never create accounts; request answers are identical whether or not an account
  exists. Sensitive changes need a sign-in within 10 minutes. Details: [PASSKEYS.md](PASSKEYS.md).
- **Sessions** are a random token in an HttpOnly, Secure, SameSite=Lax cookie (`__Host-` prefixed
  over HTTPS), stored as its SHA-256, with a 30-day expiry and server-side revocation. Mutations
  need the per-session CSRF token in a header plus an allowed `Origin`; the live socket needs an
  allowed `Origin` too. No CORS headers are sent.
- **Invitations** are single-use, expire after 14 days, and bind to the invited address. The token
  travels in the link's fragment and in request bodies, never in a URL the server sees.
- **Invite QR codes / shared links** let a signed-in person *ask* to join; an owner or the sprint's
  facilitator approves each request. **Personal links** work once and join their first signed-in
  user directly. Both grant only the `member` role, expire and can be turned off; only token
  hashes are stored. Accounts without an address confirm an emailed invitation's address by code.
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

A daily sweep deletes a finished sprint's raw content (entries, themes, votes, notes, AI drafts,
unpublished recaps) after the workspace's window (90 days by default) and its outcomes
(experiments, published recaps) after a longer one (730 days). Verification codes, rate-limit
rows, sessions and finished jobs expire on short schedules. Not yet covered: sprints that are
never finished, account deletion, leaving a workspace as a member, workspace deletion. Deleted
rows remain in the database's point-in-time recovery window (7 days on the Workers Free plan, 30 on
Paid).

## Configuration and safety rails

Configuration is Worker vars and secrets, validated once per isolate. A production deployment
refuses insecure settings instead of degrading: a non-HTTPS `PUBLIC_ORIGIN`, the console email
inbox, the fake AI provider, demo seeding. Without an email provider, sign-in answers
`setup_required`; there is no development login bypass. `worker/wrangler.jsonc` is for local
development and tests only; a production deployment uses its own rendered config
(see [`DEPLOYMENT.md`](DEPLOYMENT.md)). Clients send their build revision; one older than
`MIN_CLIENT_REVISION` is asked to reload rather than sending payloads the server no longer accepts.

## Capacity (estimates, not measurements)

For ten participants, ~100 entries and one hour-long live retro per sprint, one team uses well under
1% of the Workers Free daily allowances. The first limit a busy day reaches is D1 row reads (each
live snapshot reads several tables); the Worker then answers `503 quota` and the client says nothing
was saved. Exports are bounded (≤ 2,000 entries).
