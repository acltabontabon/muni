# Muni — security and privacy review (September 2026)

What Muni can honestly promise about contributions, identity and email addresses, based on the
code in `worker/` (the backend) and `web/` (the client and PWA). Everything below was checked in
code and, where noted, by tests that go through the public HTTP API.

**Status:** describes 1.0.0-rc.1, live on act.munimuni.app. Every control in §2 is part of it.

Terms used here:

- **Authentication**: who you are. You prove you control one of your account's passkeys.
- **Authorization**: what you can reach. That depends on workspace membership, sprint participation and your role.
- **Confidentiality**: who can read the content.
- **Author privacy**: who can connect a piece of content to a person.
- **Retention**: how long copies remain.

## 1. Architecture and data flow

```
browser (act.munimuni.app) ──HTTPS──▶ Cloudflare Worker (Hono, /api/*) ──▶ D1 (SQLite): all durable data
        │  static assets served by the platform (no Worker run)      └──▶ MeetingRoom Durable Object per sprint:
        │  service worker: app shell only, never /api                     live step/topic/timer/attendance + socket fan-out
        └──WebSocket /api/sprints/:id/ws ──▶ Worker (auth) ──▶ MeetingRoom (hints: resource name + version, no content)
Worker ──▶ Resend or Brevo (email: recipient, subject, text with a link) · cron */15: jobs, reminders, retention
munimuni.app: static marketing site on GitHub Pages, no cookies from the app, no service worker
```

**Authentication and sessions** (`worker/src/lib/auth.ts`, `routes/passkeys.ts`):
- Passkeys are the only way in (WebAuthn, user verification required, RP ID = the app's own host). Challenges are random, expire after 5 minutes and are consumed atomically before verification, so a replayed response yields at most one session. There is no email sign-in, password or recovery email, and only sessions made by a passkey authenticate. Details: [`PASSKEYS.md`](PASSKEYS.md).
- The session is a 32-byte random token in an HttpOnly, Secure, SameSite=Lax, host-only cookie (`__Host-` prefixed over HTTPS). The database stores only its SHA-256. Sessions last 30 days (absolute), and logout revokes them.
- The CSRF token is stored per session on the server. It is sent as a readable cookie and must come back in the `x-csrf-token` header, checked in constant time, on every non-GET request. Every mutation also gets an Origin / Sec-Fetch-Site check.
- The Worker adds no CORS headers, so other origins can't read its responses.

**Authorization** is checked on the server for every request:
- `requireMember` checks for a live membership row.
- `loadSprintCtx` requires you to be a member of the sprint's workspace and either a sprint participant or an owner. Non-members get 404.
- Content routes additionally require `requireParticipant` (participants only, owners included) or `requireFacilitator`.
- Roles are always read from D1. Nothing the client sends (user id, role, workspace id) is trusted. The one client-supplied `author_account_id` is only compared with the session and refused if it differs.

**Where data lives (D1):**

| Data | Where it's stored |
|---|---|
| Email addresses | `account_emails.email` (only accounts that accepted an emailed invitation), `invitations.email`, email job payloads until the email is sent |
| Contributions | `entries` (body, impact, might_help, `author_account_id` PRIVATE, `created_at` PRIVATE), `context_additions` and `checkin_responses` (same pattern). In an encrypted sprint (the default) the text is an envelope the server can't open. |
| Keys | Public keys, and wraps and device shares the server can't open ([`ENCRYPTION.md`](ENCRYPTION.md)) |
| Votes | `votes(account_id)` PRIVATE. Only totals of closed rounds leave the server. |
| Themes, notes, experiments, recaps | Their own tables |
| Audit events | Store resource ids only |
| Durable Object storage | Meeting state and attendance. No content. |

**What is never sent to a client:** author ids, entry timestamps, voter ids, or other people's
entries during collection. Shared entries are built from one SELECT list (`SHARED_SELECT`), and
at close they get a random `reveal_order`.

**Logging:**
- The app logs only `request failed {path, method, error≤300 chars}`.
- Workers Logs (`observability`, sampling 1.0) also records an invocation log for every request, including the request URL and headers. Headers such as `cookie` and values that look like tokens are redacted heuristically.
- There is no analytics, session replay or third-party script in the app or on the marketing site. The marketing site loads Google Fonts.

**Email:**
- Email goes to Resend (or Brevo). An invitation contains the recipient, the workspace name, the inviter's display name and a link; a reminder the sprint name and a link. Never any entry content.
- Muni has no AI features: nothing is sent to an AI provider.

**Browser (`web/src/lib/local/*`, `sw.ts`):**
- Drafts, unsent thoughts, minimal sprint context and the last identity are kept per account.
- Drafts and the send queue go to IndexedDB (`muni-device`) only for accounts that chose "Keep drafts on this device"; otherwise they're kept in tab memory. Every account that unlocks encrypted writing on a device also keeps, in IndexedDB, what reopens its key there (`muni-unlock`, useless without the server's half) and its pinned teammates' keys (`muni-keys`).
- The service worker precaches the app shell and never intercepts `/api`.
- No session token is ever kept in browser storage.

**Platform protections (Cloudflare, per current docs):**
- D1 and Durable Object data are encrypted at rest with AES-256 (D1 uses GCM; Durable Objects use LUKS), and in transit with TLS.
- D1 Time Travel can restore to any point in the last **7 days (Free) / 30 days (Paid)**.
- Workers Logs are kept for **3 days (Free) / 7 days (Paid)**.

These protect disks and wires. They don't stop the running Worker, anyone holding account or API
credentials, or Cloudflare itself from reading what is stored readable: accounts, email addresses,
metadata, authorship, and the content of sprints set up without encryption. Sprint content is
encrypted on participants' devices by default ([`ENCRYPTION.md`](ENCRYPTION.md)), but **Muni is not
zero-knowledge**: the service knows who wrote what, and it serves the code that does the
encrypting.

## 2. What could go wrong, and the control in place

No path was found by which one participant, a facilitator or an owner can read another person's
sealed entry, or learn who wrote a revealed entry, through the API, the socket, exports or an
encrypted envelope. Each row is a way that could go wrong around that core, the control 1.0.0-rc.1
has for it, and where it's checked.

| # | Risk | Control | Checked by |
|---|---|---|---|
| 1 | **Bringing people in beyond one's role.** Any member can set up a sprint and facilitate it. | Everything workspace-wide — invitations without a sprint, workspace codes and links, deciding requests to join the workspace, and the pending invitations with their addresses — is for owners (`lib/grants.ts`). A sprint's facilitator can invite into that sprint only, while it's unfinished. A grant is checked again when it's used: an invitation stops working once its sender may no longer invite there. | `grants.test.ts`, `boundaries.test.ts` |
| 2 | **Learning whose address is whose.** An invitation's reply could say an address is already a member's. | Only owners get that answer. A non-owner's sprint invitation is always created and emailed, whether or not the address is a member's. | `grants.test.ts` “tells nobody but owners…” |
| 3 | **Invitation email as a spam channel,** using up the provider's daily quota so real invitations and reminders fail. | Per account: 20 invitation emails, 10 new workspaces and 20 new sprints a day, across workspaces; per workspace, 60 invitations an hour and 3 reminder emails a day per active member; per deployment, at most `EMAIL_DAILY_LIMIT` emails a day (80 by default), past which an email fails in the queue, saying so. | `grants.test.ts` (the three limits), `limits.test.ts` (sprints, reminders) |
| 4 | **Invitation tokens outside their hash,** in logged URLs or kept email jobs. | Tokens travel in JSON bodies and in link fragments (`/invite#…`), never in a path; an email job's payload is emptied once it's sent or given up on. | `boundaries.test.ts` |
| 5 | **An encrypted thought naming its author.** Every participant receives revealed thoughts. | A thought's envelope names only its sprint and record; the author's copy of its key is a sealed box, which doesn't reveal its recipient. The Worker stores a thought envelope only with exactly those fields, and database triggers refuse the format that carried an author ([`ENCRYPTION.md`](ENCRYPTION.md) §5). | `crypto.test.ts`, `encryption.test.ts` |
| 6 | **Plaintext sent on a guess** by the offline send queue. | A queued thought goes unsealed only when its sprint is known to be set up without encryption; the service worker, which holds no keys, sends only those; when encryption can't be checked, the thought waits. | `outbox.test.ts` |
| 7 | **The "can't be shown" note saved over real words** by a form filled before the device could open them. | Any request carrying the note is refused before it's sent, sealed or not; forms follow the server's value while untouched or showing the note. | `keyring.test.ts` |
| 8 | **Drafts on a shared device.** | Keeping drafts is each account's own choice; sign-out and "Clear local data" remove only that account's records; unsent words written during a retro belong to the signed-in account and go when it does. | `prefs.test.ts`, `retro-drafts.test.ts`, `e2e/offline.mjs` |
| 9 | **Sign-out leaving things behind** (the invitation page included). | One sign-out dialog everywhere: it names unsent thoughts and drafts, ends the session on the server first and keeps everything if that fails, then clears local data, the last-visited ids and the reveal flags. | `prefs.test.ts`, `e2e/offline.mjs` |
| 10 | **Another workspace's ids** in a route, a command or a note. | Every id is checked against the sprint and workspace in the path (themes in `mark_discussed`, `set_topic` and notes included). | `boundaries.test.ts` |
| 11 | **Live roles after a handover.** Sockets open before it kept the old roles. | The room moves what only the facilitator hears to the new facilitator's open sockets at once; a socket whose request read the old facilitator can't become it again (the handover is kept in the room's storage, so this holds after the room is evicted). The old facilitator stops controlling the stage. | `socket.test.ts`, `meeting.test.ts` |
| 12 | **A refused command still changing things** (a stale version, or another facilitator controlling). | The room checks the version and who controls the stage before anything in D1 changes; multi-field edits are validated whole, then written in one batch. | `meeting.test.ts`, `lifecycle.test.ts` |
| 13 | **A workspace left without an owner.** | Demoting requires another owner in the same statement; account deletion and removals carry the same guards as the checks before them, so a join or handover landing in between changes nothing. | `departure.test.ts` |
| 14 | **A re-invited ex-owner regaining ownership.** | A membership that comes back is always `member`. | `boundaries.test.ts` |
| 15 | **A socket opened from another site.** Cookies go with cross-origin socket handshakes. | The upgrade requires an Origin that matches `PUBLIC_ORIGIN`. | `boundaries.test.ts` |
| 16 | **Cookies planted by a sibling origin** (session fixation, login CSRF). | Over HTTPS the cookies are `__Host-muni_session` and `__Host-muni_csrf` (Secure, Path=/, no Domain). | `boundaries.test.ts` |
| 17 | **An arbitrary account named as an experiment's owner.** | The owner must be a participant in the sprint. | `boundaries.test.ts` |
| 18 | **Personal data in the rate limiter.** | Buckets are SHA-256 hashes (pseudonymous: an IPv4 hash can be reversed by brute force), kept 24 hours. | `boundaries.test.ts` |
| 19 | **Malformed input crashing a route.** | One JSON-body reader for every route (`null`, a list or malformed JSON is a 400); id lists, dates and meeting commands are shape-checked before anything is stored. | `validation.test.ts` |
| 20 | **Data left behind.** | A person who leaves, is removed or deletes their account is taken out of every live room's records; a retro's room record goes with its purged content, and its open sockets are closed; invitations go 30 days after they were used, withdrawn or expired; outcomes of unfinished sprints are never purged. | `departure.test.ts`, `retention.test.ts` |
| 21 | **Silent truncation** of what a list shows. | Caps are enforced where data is written (60 participants, 200 thoughts a person and 12,000 a sprint, 40 themes, 100 retro additions a person), so every read returns everything there is. | `limits.test.ts` |
| 22 | **A job that keeps crashing,** retried forever ahead of reminders. | A job still running after 10 minutes counts as a failed attempt; out of attempts, it's marked failed. | `jobs.test.ts` |

## 3. Tests

`worker`'s tests pass (Vitest in the Workers runtime, real D1 and Durable Objects, over HTTP).
`test/boundaries.test.ts` covers:

- **Sprint scope.** A facilitator of sprint A can't join B. Neither can a member who creates their own sprint. B's facilitator can add people; a finished sprint takes nobody.
- **Owner who isn't a participant.** They get 403 on entries, themes and raw export after reveal.
- **Cross-workspace IDs.** Ten sprint routes and four workspace routes, plus theme edits, member removal, role change and invitations, all tried with another workspace's IDs.
- **Theme scoping.** Another workspace's theme is refused in `mark_discussed`, `set_topic` and notes.
- **Experiment owners.** A non-participant can't be named.
- **Membership changes.** A re-invited ex-owner comes back as a member. The last owner can't be demoted. Removing someone from a sprint closes their live socket, and reconnecting is refused.
- **Socket origin.** Missing, sibling (`munimuni.app`) and foreign origins are refused.
- **Invitation tokens.** They are absent from URLs, job payloads and the database, and no route takes one in its path.
- **Queued email.** Its payload is dropped after sending.
- **Rate limits.** Limiter rows contain no addresses or IPs.
- **Cookies.** Production cookie names and attributes are checked.
- **Room recovery.** A participant never becomes controller.

Other suites cover:
- who may bring people in, the email-address oracle, and the invitation, workspace and email limits (`grants.test.ts`)
- hints only the facilitator should get, and handovers on open sockets (`socket.test.ts`)
- malformed bodies, ids, dates and commands (`validation.test.ts`)
- caps where data is written, and whole lists (`limits.test.ts`)
- a job that keeps crashing (`jobs.test.ts`), and the database round trips on each screen's path (`roundtrips.test.ts`)
- an encrypted thought naming nobody, and the database refusing one that would (`encryption.test.ts`)
- sealed collection, including for the facilitator
- no author fields in REST, themes or exports
- private votes
- author-only editing
- the close-versus-submit race
- concurrent single-use invitations
- replayed passkey responses, and expired or replayed invitations
- CSRF and origin checks
- member revocation closing sockets
- offline idempotency, account mismatch and revoked members
- retention purges

`web`:
- Unit tests pass, including `prefs.test.ts` for the per-account choice and sign-out cleanup. Typecheck and lint are clean.
- `e2e/offline.mjs` passes in Chromium with the real service worker, against a local Worker. It covers:
  - offline submit and reopen
  - a lost response
  - two tabs
  - collection closed before sync
  - session expiry
  - **another account on the device never sees or sends the first account's queue**
  - storage full
  - no Background Sync
  - tab-only mode
  - held-back updates
  - live reconnect
  - installability
- The invitation flow was checked by hand in the browser: fragment link, preview, sign in with a passkey, join. The API request URL carried no token.

**Dependencies** (at review):
- `pnpm audit --prod` (worker) and `npm audit` (web): no known vulnerabilities.
- `pnpm audit` including dev dependencies: 1 high in `sharp`, which comes in through `wrangler/miniflare`. It is local and test tooling only and is not shipped.

## 4. Remaining gaps, unverified controls, manual steps

**Documented behaviour and product decisions:**
- **Sprint creation grants sprint invitations.** Any member can set up a sprint and facilitate it, and so invite people into *that* sprint (never the workspace as a whole; see §2 row 1). An invitation into a sprint also makes the person a member of its workspace.
- **Workspace-wide experiments.** Every member sees all experiments, including those from sprints they weren't in.
- **Logout and open sockets.** Logging out, or "sign out everywhere else", doesn't close that session's open live socket. It only receives hints, and every request re-checks the session. Membership and participant removal do close sockets.
- **Inference in small groups.** Content and counts can still point to a person:
  - vote totals
  - entry counts per theme
  - a lone check-in answer
  - the moment the facilitator's view shows an addition, just after someone was seen typing
  - the difference between the first and second reveal after collection is reopened
  - writing style
- **Sessions and sign-up.** Sessions last 30 days (absolute) with no idle timeout. Passkey sign-up needs no identifier, so it's cheap: per-network and daily caps, team-QR approval and single-use links are the controls. An emailed invitation admits whoever accepts it first, so a forwarded one is handed on (the email says so).
- **CSP.** It allows `style-src 'unsafe-inline'`.
- **Small races that remain.** The per-person caps on thoughts and themes are checked just before
  writing, so two requests at once can pass one over (nothing is lost: reads return everything). A
  meeting command's D1 changes aren't one transaction, calls to the room are best effort, and a
  Worker that dies mid-command leaves the stage held for up to 15 seconds.

**Retention decisions that don't exist yet** (no policy was invented):
- **Unfinished sprints are never purged.** Draft, collecting, preparing, ready and live sprints keep their content until someone finishes or deletes them. Only draft sprints can be deleted.
- **Account deletion and leaving.** Members can leave a workspace and delete their account (recent passkey sign-in required); see `docs/ARCHITECTURE.md` → Leaving. There's no way to delete a workspace others are in. Removed and departed members' entries stay in the sprint, anonymously.
- `audit_events` (account ids and actions, no content) are never deleted.
- Sprint rows (name, goal, dates) remain after a purge. Experiments and published recaps remain until the outcome window (730 days by default).
- **Backups.** D1 Time Travel keeps restorable history for 7 or 30 days after any deletion. Workers Logs keep 3 or 7 days of request metadata. The email provider's retention of sent messages is set by that provider. Exports are copies Muni can't recall.
- **Offline copies can't be erased remotely.** Copies kept on a disconnected device stay until it reconnects and learns about the change, or until the person clears them. Safari may evict site storage after weeks without use.

**Unverified; to check by hand:**
- **Cloudflare:**
  - account MFA
  - who holds account roles
  - the `CLOUDFLARE_API_TOKEN` scope. It should be limited to Workers Scripts, D1 and Routes on this account, not Global.
  - Workers Logs access
  - whether the plan is Free or Paid (this changes the retention windows above)
- **Email provider (Resend):** account MFA, an API key limited to sending, domain DKIM/SPF, and their log retention.
- **GitHub and domain:** GitHub 2FA and branch protection for `acltabontabon/muni` and the Pages site. Registrar lock and DNSSEC for `munimuni.app`. No wildcard DNS; a dangling `*.munimuni.app` record would be same-site.
- **Log redaction.** Whether Workers Logs shows redacted `cookie` and `set-cookie` headers for this Worker. The Tail docs say so, but this wasn't observed on a live deployment.
- **Browsers.** Passkeys and the app were checked on physical phones and desktop browsers on 2026-09-29 ([`PASSKEYS.md`](PASSKEYS.md) §8). Not yet observed: Safari's storage eviction over weeks, the installed iOS home-screen app, and hardware security keys.
- **Encryption.** The design and implementation ([`ENCRYPTION.md`](ENCRYPTION.md)) have not been independently reviewed.
- **Environment separation.** Production uses its own D1 id. Local dev and tests use Miniflare state. There is no preview environment. Never point a dev config at the production id.

## 5. Privacy claims

| Proposed claim | Supporting implementation | Verified | Necessary qualification |
|---|---|---|---|
| Only people in a workspace can reach it; only a sprint's participants can read its content. | `requireMember`, `loadSprintCtx`, `requireParticipant` | Tests (cross-workspace, sprint scope) | Owners can open a sprint's settings but not its content unless they are participants. |
| During collection, only you can see your thoughts, and that includes the facilitator. | `sealed()`; the shared list returns 409 while collecting; no count and no hint | Tests | Muni's servers store them: unreadable in an encrypted sprint (the default), readable by the operator in a sprint set up without encryption. |
| After collection closes, entries are shown without names, timestamps or any per-person label, in random order. | `SHARED_SELECT` allow-list, `reveal_order` | Tests (REST, themes, exports, socket) | Wording, small teams and context can still identify you. |
| Votes are private; only totals of a closed round are shown. | `votes` never selected per person | Tests | Small totals can be revealing. |
| Owners and facilitators have no way to see who wrote what. | No route joins entries to accounts | Test (no author lookup route) | The operator could, with database or backup access. This is application-level, not cryptographic. |
| Your email address, if your account has one, is shown only to you and to workspace owners, who also see the addresses of pending invitations. | `buildMe`, `members.email` owner-only, pending invitations owner-only | Tests (`grants.test.ts`) | It goes to the email provider to deliver invitations and reminders. It never signs anyone in. |
| An invitation link works once, within 14 days, for whoever accepts it first while signed in with a passkey. | Conditional update, `expires_at` | Tests | Forwarding the email hands the invitation on. |
| Drafts stay on this device only if you choose, for your account only. | Per-account `keepLocalFor`, memory store otherwise | Unit and e2e tests | Anyone using this browser profile can read them. They can't be erased remotely. |
| Encrypted at rest and in transit. | Cloudflare D1 and Durable Objects (AES-256), TLS | Cloudflare docs | Provider-managed keys. This does not keep the service from reading what it stores readable. |
| Sprint content is encrypted on participants' devices by default. | `e1` envelopes made in the browser; the server refuses plaintext for encrypted sprints | Tests (`encryption.test.ts`, `e2e/encryption.mjs`) | Not independently reviewed. Authorship and metadata stay visible to the service, and it depends on the app delivered being genuine. A sprint set up without encryption isn't covered, and says so. |
| Finished sprints' raw content is deleted after the workspace's window (90 days by default). | `retention()` cron | Tests | Only finished sprints. Backups and logs lag by up to 30 or 7 days. Exports can't be recalled. |

## 6. Suggested wording (verified behaviour only)

**Short (product and marketing):**
> Until collection closes, only you can see your thoughts, and that includes the facilitator.
> Afterwards they're shown to your sprint without your name, in random order. Muni's servers do
> know who wrote what (that's how only you can edit yours), so this is privacy from your team,
> not from the service. Your wording can still give you away.

**Security line:**
> You sign in with a passkey; there's no password or email sign-in. Sprints are encrypted on your
> team's devices by default, and everything is encrypted in transit and at rest by our hosting
> provider (Cloudflare). Muni still knows who wrote each thought.

**Retention line:**
> When a sprint finishes, its raw thoughts are deleted after your workspace's retention window
> (90 days by default). Backups and logs catch up within 30 days. Anything exported can't be
> recalled.

**Avoid:** "anonymous" without a qualifier, "no one can ever see", "zero-knowledge", "audited",
"deleted immediately", and "encrypted" without saying who holds the keys.
