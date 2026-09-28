# Muni — security and privacy review (2026-09-27)

What Muni can honestly promise about contributions, identity and email addresses, based on the
code in `worker/` (the backend) and `web/` (the client and PWA). Everything below was checked in
code and, where noted, by tests that go through the public HTTP API.

**Status:** describes 1.0.0-rc.1, live on act.munimuni.app. Every fix in §3 is part of it.

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
- IndexedDB is used only for accounts that chose "Keep drafts on this device". Otherwise they are kept in tab memory.
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

## 2. Findings, most severe first

No path was found by which one participant, a facilitator or an owner can read another person's
sealed entry, or learn who wrote a revealed entry, through the API, the socket or exports. The
findings below are the confirmed weaknesses around that core. All are fixed except where noted
in §4.

| # | Severity | Finding | Affected | Realistic impact |
|---|---|---|---|---|
| 1 | Medium | **Sprint scope bypass through invitations.** Any member can create a sprint and name themselves facilitator, which gives them invite rights. The invite endpoint then accepted any `sprint_id` in the workspace, and for existing members it added them straight in, including to completed sprints. | `routes/workspaces.ts` invite | Joins any sprint in the workspace and reads its revealed entries, themes, notes and exports. Entries stay anonymous, but sprint-level confidentiality is lost. |
| 2 | Medium | **Invitation tokens outside their hash.** (a) The raw token was in API URLs (`/api/invitations/<token>[/accept]`), and every request is logged with its URL (Workers Logs, sampling 1.0, 3–7 days; redaction is heuristic). (b) The queued email job stored the full message, including the only copy of the raw token and the recipient's address, for 30 days after sending (90 days if it failed). | `routes/auth.ts`, `jobs.ts` | Someone with log or D1 read access could see live tokens, and an invitation admits whoever accepts it first while signed in, so a leaked token is a way into the workspace. Email addresses were also kept longer than needed. |
| 3 | Medium | **"Keep drafts on this device" was a device-wide switch.** Person B's drafts and queue went to IndexedDB because person A had opted in. Turning it off deleted every account's database, including other people's unsent thoughts, without naming them. | `LocalProvider.tsx`, `prefs.ts`, `auth.tsx` | On a shared device, sensitive drafts persisted without the writer's choice, or were silently destroyed. |
| 4 | Medium | **Invitation-page sign-out skipped local cleanup.** It didn't clear the account's drafts, queue or cached identity, and didn't name unsent work. The cached identity could then open Muni offline as the previous person. | `routes/Invite.tsx` | The next person on the device could see the previous person's unsent drafts. |
| 5 | Low–Med | **Cross-workspace write.** The `mark_discussed` meeting command accepted a theme id from any sprint. | `routes/meeting.ts` | A facilitator could create or flip another workspace's discussion row. This is integrity only; no content was returned. |
| 6 | Low | **Re-invited ex-owner regained ownership.** Accepting an invitation revived a revoked membership with its old role. | `routes/auth.ts` accept | A removed owner comes back as owner. |
| 7 | Low | **No Origin check on the WebSocket upgrade.** Browsers send cookies on cross-origin socket handshakes, and SameSite=Lax treats `munimuni.app` as same-site. | `routes/meeting.ts` `/ws` | A same-site page could open a live socket as the user. Sockets carry content-free hints only. |
| 8 | Low | **No `__Host-` prefix on cookies.** A sibling origin (`munimuni.app` or any `*.munimuni.app`) could plant a session cookie (session fixation or login CSRF). | `lib/auth.ts` | Requires control of a sibling site. The victim could end up writing into the attacker's account. |
| 9 | Low | **Unchecked experiment owner.** Nominating an owner accepted any account id. | `routes/commitments.ts` PATCH | Reveals the display name of an arbitrary account (cross-workspace). |
| 10 | Low | **Plaintext keys in the limiter.** Rate-limit buckets stored plaintext identifiers, including IP addresses, for 24 h. | `lib/ratelimit.ts` | Unnecessary personal data at rest. |
| 11 | Low | **Composer and sign-out edge cases.** The composer autosave re-ran whenever the local store changed, so "Clear local data" could write the on-screen draft back. Typed text survived an account switch in the same tab. The leave dialog counted queued thoughts but not drafts. Sign-out cleared local data even when the server logout failed. | `ui/capture.tsx`, `App.tsx`, `ui/menus.tsx` | Text could reappear after clearing, or be saved under the next account. People could lose drafts without being told. |
| 12 | Low | **Two role-handling bugs.** A participant's read that re-initialised a missing room made them the stage "controller". The last owner could demote themselves. | `routes/sprints.ts`, `routes/workspaces.ts` | Functional and admin problems, no data exposure. |

## 3. Fixes and evidence

| # | Fix |
|---|---|
| 1 | `sprint_id` on an invitation requires the caller to be **that sprint's facilitator**, and the sprint must be unfinished. This matches `POST /sprints/:id/participants`. Owners who don't facilitate a sprint can't add people to it from the invite dialog. |
| 2 | Tokens travel in JSON bodies: `POST /api/invitations/preview` and `POST /api/invitations/accept` take `{token}`; no API route has a token in its path. Email links use the fragment (`/invite#<token>`), which browsers never send to a server; the page `/invite/:token` also opens. Email job payloads become `{}` once sent or given up on. |
| 3 | The choice is per account (`keepLocalFor`). Turning it off removes only your records and deletes the database once nobody keeps drafts on the device. Other tabs follow the change. |
| 4 | The invitation page uses the same sign-out dialog. It names unsent thoughts **and drafts**, signs out on the server first, keeps everything if that fails, then clears local data, the last-visited ids and the reveal flags. |
| 5 | The theme must belong to the sprint. |
| 6 | A revived membership always comes back as `member`. |
| 7 | The upgrade requires an Origin header that matches `PUBLIC_ORIGIN`. |
| 8 | Over HTTPS the cookies are `__Host-muni_session` and `__Host-muni_csrf` (Secure, Path=/, no Domain). The client and service worker read either name. |
| 9 | The owner must be a participant in the sprint. |
| 10 | Buckets are SHA-256 hashes. This is pseudonymisation: an IPv4 hash can be reversed by brute force. |
| 11 | Autosave runs on edits only. The composer remounts after a clear, and the app remounts when the account changes. |
| 12 | Only a facilitator becomes controller. The last owner can't be demoted. |

**Tests.**

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

**Not changed (documented behaviour or product decisions):**
- **Sprint creation grants invite rights.** Any member can create a sprint, facilitate it and therefore invite people to the workspace.
- **What facilitators see:**
  - pending invitation emails
  - which address belongs to a member (the `already_member` reply)
- **Workspace-wide experiments.** Every member sees all experiments, including those from sprints they weren't in.
- **Logout and open sockets.** Logging out, or "sign out everywhere else", doesn't close that session's open live socket. It only receives hints, and every request re-checks the session. Membership and participant removal do close sockets.
- **Inference in small groups.** Content and counts can still point to a person:
  - vote totals
  - entry counts per theme
  - a lone check-in answer
  - the moment a "meeting changed" hint follows someone adding context in a co-located room
  - the difference between the first and second reveal after collection is reopened
  - writing style
- **Sessions and sign-up.** Sessions last 30 days (absolute) with no idle timeout. Passkey sign-up needs no identifier, so it's cheap: per-network and daily caps, team-QR approval and single-use links are the controls. An emailed invitation admits whoever accepts it first, so a forwarded one is handed on (the email says so).
- **CSP.** It allows `style-src 'unsafe-inline'`.

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
| Your email address, if your account has one, is shown only to you and to workspace owners. Facilitators see addresses of pending invitations. | `buildMe`, `members.email` owner-only, pending invitations for inviters | Code review | It goes to the email provider to deliver invitations and reminders. It never signs anyone in. |
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
