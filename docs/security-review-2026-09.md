# Security and privacy review, September 2026

A point-in-time review of what Muni can honestly promise about contributions, identity and email
addresses. For security reviewers and for anyone checking a public claim.

## Scope and method

- **Covered:** the backend (`worker/`) and the client and PWA (`web/`) as of release 1.0.0-rc.2,
  live on act.munimuni.app. Findings were first written against rc.1 and re-checked against the code
  on 2026-10-01; differences are corrected below.
- **Method:** reading the code, plus automated tests that go through the public HTTP API and the
  WebSocket (Vitest in the Workers runtime with real D1 and Durable Objects), browser unit tests, and
  Chromium e2e runs. Real devices were tried on 2026-09-29 ([passkeys.md](passkeys.md#tests)).
- **Not covered:** the Cloudflare, email-provider, GitHub and domain accounts (see
  [Unverified](#unverified-manual-checks)), and any independent audit of the encryption design.
- **Result:** no path was found by which a participant, facilitator or owner can read another
  person's sealed entry, or learn who wrote a revealed entry, through the API, the socket, exports
  or an encrypted envelope.

Terms: *authentication* is proving control of a passkey; *authorization* is what an account may
reach (membership, sprint participation, role); *confidentiality* is who can read content;
*author privacy* is who can connect content to a person.

## Architecture in brief

The system shape and data model are in [architecture.md](architecture.md); encryption is in
[encryption.md](encryption.md); sign-in is in [passkeys.md](passkeys.md). What matters for this review:

- **Sessions.** A 32-byte random token in an HttpOnly, Secure, SameSite=Lax, host-only cookie
  (`__Host-` prefixed over HTTPS). The database keeps only its SHA-256. Sessions last 30 days
  (absolute, no idle timeout), and logout revokes them. Only sessions created by a passkey
  authenticate.
- **CSRF.** A per-session token, sent as a readable cookie and returned in `x-csrf-token` on every
  non-GET request, compared in constant time. Every mutation also gets an Origin and
  Sec-Fetch-Site check. The Worker sets no CORS headers, so other origins cannot read responses.
- **Authorization.** Checked on the server for every request, with roles always read from D1.
  `requireMember` needs a live membership. `loadSprintCtx` needs workspace membership plus sprint
  participation or ownership, and answers 404 to non-members. Content routes additionally need
  `requireParticipant` or `requireFacilitator`. Nothing the client sends (user id, role, workspace
  id) is trusted.
- **What a client never receives:** author ids, entry timestamps, voter ids, or other people's
  entries during collection. Shared entries come from one allow-listed SELECT (`SHARED_SELECT`) and
  get a random `reveal_order` at close.
- **Where sensitive data lives (D1).** Email addresses in `account_emails.email` (only accounts that
  accepted an emailed invitation), `invitations.email` and unsent email job payloads. Contributions
  in `entries`, `context_additions` and `checkin_responses`, with private `author_account_id` and
  `created_at`; in an encrypted sprint (the default) the text is an envelope the server cannot open.
  Votes in `votes(account_id)`, private; only totals of closed rounds leave the server. Keys are
  public keys plus wraps and device shares the server cannot open. Durable Object storage holds
  meeting state and attendance, never content.
- **Email.** Sent through Resend or Brevo. An invitation contains the recipient, workspace name,
  inviter's display name and a link; a reminder contains the sprint name and a link. Never entry
  content.
- **Logging.** The app logs failures only (`request failed` with error code, path, method and the
  first 300 characters of the error). Workers Logs (`observability`, sampling 1.0) also records
  every invocation with its URL and headers; `cookie` and token-like values are redacted by
  heuristic. Invitation tokens stay out of URLs (see row 4 below).
- **Third parties.** No analytics, session replay, ad trackers or AI provider. The app self-hosts
  its fonts and loads nothing from other origins. The marketing site loads Google Fonts.
- **Browser storage.** No session token is ever kept in browser storage. Storage keys and what each
  holds are listed in [passkeys.md](passkeys.md#security-model). The service worker precaches the
  app shell and never intercepts `/api`.
- **Platform (Cloudflare, per its docs).** D1 and Durable Object data is encrypted at rest (AES-256)
  and in transit (TLS). D1 Time Travel restores up to 7 days (Free) or 30 days (Paid). Workers Logs
  keep 3 days (Free) or 7 days (Paid).

These protections cover disks and wires. They do not stop the running Worker, anyone holding
account or API credentials, or Cloudflare from reading what is stored readable: accounts, email
addresses, metadata, authorship, and the content of sprints set up without encryption. Sprint
content is encrypted on participants' devices by default, but **Muni is not zero-knowledge**: the
service knows who wrote what, and it serves the code that does the encrypting.

## Threats and controls

Each row is a way things could go wrong around the core guarantee, the control in place, and the
test that checks it (in `worker/test/` unless it says otherwise).

| # | Threat | Control | Checked by |
|---|---|---|---|
| 1 | Bringing people in beyond one's role (any member can set up and facilitate a sprint) | Workspace-wide invitations, links, join requests and pending invitations with addresses are owner-only (`lib/grants.ts`). A sprint's facilitator can invite into that sprint only, while it is unfinished. Grants are re-checked when used, so an invitation stops working once its sender may no longer invite there. | `grants.test.ts`, `boundaries.test.ts` |
| 2 | Learning whose address is whose through an invitation reply | Only owners learn that an address belongs to a member. A non-owner's invitation is always created and emailed. | `grants.test.ts` |
| 3 | Invitation email as a spam channel that exhausts the provider's quota | Per account per day: 20 invitation emails, 10 new workspaces, 20 new sprints. Per workspace: 60 invitations an hour, and 3 reminder emails a day per active member. Per deployment: `EMAIL_DAILY_LIMIT` emails a day (80 by default), after which emails fail in the queue. Signed-out `POST`s to `/api/auth`, `/api/join` and `/api/invitations` also hit an edge limit of 60 a minute per address (`EDGE_LIMIT`) before D1 is touched. | `grants.test.ts`, `limits.test.ts` |
| 4 | Invitation tokens in logged URLs or kept email jobs | Tokens travel in JSON bodies and URL fragments (`/invite#…`, `/join#…`), never in a path. An email job's payload is emptied once it is sent or given up on. | `boundaries.test.ts` |
| 5 | An encrypted thought naming its author | A thought's envelope names only its sprint and record. The author's copy of the key is a sealed box that does not reveal its recipient. The Worker stores only that format, and database triggers refuse the older format that carried an author (migration `0012`; see [encryption.md](encryption.md)). | `encryption.test.ts`, `web/src/lib/e2ee/crypto.test.ts` |
| 6 | The offline send queue sending plaintext on a guess | A queued thought goes unsealed only when its sprint is known to be unencrypted. The service worker holds no keys and sends only those. When encryption cannot be checked, the thought waits. | `web/src/lib/local/outbox.test.ts` |
| 7 | The "can't be shown" placeholder saved over real words | A request carrying the placeholder is refused before it is sent. Forms follow the server's value while untouched or showing the placeholder. | `web/src/lib/e2ee/keyring.test.ts` |
| 8 | Drafts on a shared device | Keeping drafts is each account's own choice. Sign-out and "Clear local data" remove only that account's records. Unsent retro words belong to the signed-in account and go with it. | `web/src/lib/prefs.test.ts`, `retro-drafts.test.ts`, `web/e2e/offline.mjs` |
| 9 | Sign-out leaving data behind | One sign-out dialog everywhere. It names unsent thoughts and drafts, ends the session on the server first and keeps everything if that fails, then clears local data, last-visited ids and reveal flags. | `web/src/lib/prefs.test.ts`, `web/e2e/offline.mjs` |
| 10 | Another workspace's ids in a route, command or note | Every id is checked against the sprint and workspace in the path, including themes in `mark_discussed`, `set_topic` and notes. | `boundaries.test.ts` |
| 11 | Live roles after a facilitator handover | The room moves facilitator-only hints to the new facilitator's open sockets at once. A socket that read the old facilitator cannot become it again; the handover is kept in room storage, so this survives eviction. | `socket.test.ts`, `meeting.test.ts` |
| 12 | A refused command still changing data (stale version, another facilitator in control) | The room checks the version and who controls the stage before anything in D1 changes. Multi-field edits are validated whole, then written in one batch. | `meeting.test.ts`, `lifecycle.test.ts` |
| 13 | A workspace left without an owner | Demotion requires another owner in the same statement. Account deletion and removals repeat the guards of the checks before them, so a join or handover landing in between changes nothing. | `departure.test.ts` |
| 14 | A re-invited ex-owner regaining ownership | A membership that comes back is always `member`. | `boundaries.test.ts` |
| 15 | A WebSocket opened from another site (cookies go with cross-origin handshakes) | The upgrade requires an Origin matching `PUBLIC_ORIGIN`. | `boundaries.test.ts` |
| 16 | Cookies planted by a sibling origin (session fixation, login CSRF) | Over HTTPS the cookies are `__Host-muni_session` and `__Host-muni_csrf` (Secure, Path=/, no Domain). | `boundaries.test.ts` |
| 17 | An arbitrary account named as an experiment's owner | The owner must be a participant in the sprint. | `boundaries.test.ts` |
| 18 | Personal data in the rate limiter | Buckets are SHA-256 hashes of the network address (pseudonymous: an IPv4 hash can be reversed by brute force) or of an account id, kept 24 hours. | `boundaries.test.ts` |
| 19 | Malformed input crashing a route | One JSON-body reader for every route (`null`, a list or malformed JSON gives 400). Id lists, dates and meeting commands are shape-checked before anything is stored. | `validation.test.ts` |
| 20 | Data left behind after leaving or deletion | A person who leaves, is removed or deletes their account is taken out of every live room's records. A retro's room record goes with its purged content and its sockets close. Invitations are deleted 30 days after use, withdrawal or expiry. | `departure.test.ts`, `retention.test.ts` |
| 21 | Silent truncation of what a list shows | Caps are enforced where data is written (60 participants, 200 thoughts per person and 12,000 per sprint, 40 themes, 100 retro additions per person), so reads return everything. | `limits.test.ts` |
| 22 | A crashing job retried forever ahead of reminders | A job still running after 10 minutes counts as a failed attempt. Out of attempts, it is marked failed. | `jobs.test.ts` |

Also covered by the test suites: sealed collection (including for the facilitator), no author
fields in REST, themes or exports, private votes, author-only editing, the close-versus-submit race,
concurrent single-use invitations and join links, replayed passkey responses, CSRF and origin
checks, member revocation closing sockets, and offline idempotency and account mismatch
(`web/e2e/offline.mjs`).

**Dependencies (re-run 2026-10-01).** `pnpm audit --prod` (worker) and `npm audit --omit=dev` (web)
find no known vulnerabilities. `pnpm audit` including dev dependencies reports 11 findings (3 low,
5 moderate, 3 high), all in `wrangler` and `miniflare`, which are local and test tooling that never
ships.

## Remaining gaps

### Documented behaviour and product decisions

- **Sprint creation grants sprint invitations.** Any member can set up and facilitate a sprint, and
  so invite people into that sprint (never the workspace as a whole; see row 1). An invitation into a
  sprint also makes the person a workspace member.
- **Workspace-wide experiments.** Every member sees all experiments, including those from sprints
  they were not in.
- **Logout and open sockets.** Logging out, or "Sign out everywhere else", does not close that
  session's open live socket. The socket only receives hints, and every request re-checks the
  session. Removing a member or participant does close sockets.
- **Inference in small groups.** Content and counts can still point to a person: vote totals, entry
  counts per theme, a lone check-in answer, the moment the facilitator's view shows an addition just
  after someone was seen typing, the difference between the first and second reveal after collection
  is reopened, and writing style.
- **Sessions and sign-up.** Sessions have no idle timeout. Passkey sign-up needs no identifier, so
  it is cheap; per-network and daily caps, team-QR approval and single-use links are the controls. An
  emailed invitation admits whoever accepts it first, so a forwarded one is handed on (the email
  says so).
- **CSP.** The app's policy allows `style-src 'unsafe-inline'`.
- **Small races.** Per-person caps on thoughts and themes are checked just before writing, so two
  simultaneous requests can pass one over (nothing is lost). A meeting command's D1 changes are not
  one transaction, calls to the room are best effort, and a Worker that dies mid-command leaves the
  stage held for up to 15 seconds.

### Retention

No policy was invented where none exists.

- **Unfinished sprints are never purged.** Draft, collecting, preparing, ready and live sprints keep
  their content until someone finishes or deletes them. Only draft sprints can be deleted.
- **Leaving and deleting.** Members can leave a workspace and delete their account (recent passkey
  sign-in required; see [architecture.md](architecture.md)). There is no way to delete a workspace
  that others are in. Entries of removed and departed members stay in the sprint, anonymously.
- **Audit events.** `audit_events` (account ids and actions, no content) are deleted after 400
  days. *Corrected:* the original review said they were never deleted.
- **Sprint rows and outcomes.** Sprint rows (name, goal, dates) remain after a purge. Experiments
  and published recaps remain until the outcome window (730 days by default).
- **Backups and copies.** D1 Time Travel keeps restorable history for 7 or 30 days after any
  deletion, and Workers Logs keep 3 or 7 days of request metadata. The email provider sets its own
  retention for sent messages. Exports are copies Muni cannot recall.
- **Offline copies cannot be erased remotely.** They stay until the device reconnects and learns of
  the change, or the person clears them. Safari may evict site storage after weeks without use.

### Unverified: manual checks

- **Cloudflare:** account MFA, who holds account roles, the scope of `CLOUDFLARE_API_TOKEN` (it
  should cover only Workers Scripts, D1 and Routes on this account), Workers Logs access, and
  whether the plan is Free or Paid (this sets the retention windows above).
- **Email provider (Resend):** account MFA, an API key limited to sending, domain DKIM and SPF, and
  the provider's log retention.
- **GitHub and domain:** 2FA and branch protection for `acltabontabon/muni` and the Pages site;
  registrar lock and DNSSEC for `munimuni.app`; no wildcard DNS (a dangling `*.munimuni.app` record
  would be same-site).
- **Log redaction:** whether Workers Logs shows `cookie` and `set-cookie` redacted for this Worker.
  Cloudflare's docs say so, but it was not observed on a live deployment.
- **Browsers:** not yet observed are Safari's storage eviction over weeks, the installed iOS
  home-screen app, and hardware security keys.
- **Encryption:** the design and implementation have not been independently reviewed.
- **Environment separation:** production uses its own D1 id; local development and tests use
  Miniflare state. There is no preview environment. Never point a development config at the
  production id.

## Privacy claims checked

What each claim rests on, and the qualification it needs. The public wording and its checklist are
in [privacy-claims.md](privacy-claims.md).

| Claim | Evidence | Qualification |
|---|---|---|
| Only workspace members can reach a workspace, and only a sprint's participants can read its content. | `requireMember`, `loadSprintCtx`, `requireParticipant`; cross-workspace and sprint-scope tests | Owners can open a sprint's settings but not its content unless they participate. |
| During collection only you see your thoughts, the facilitator included. | `sealed()`; the shared list returns 409 while collecting; no count, no hint | Muni's servers store them: unreadable in an encrypted sprint (the default), readable by the operator in an unencrypted one. |
| After collection closes, entries show without names, timestamps or per-person labels, in random order. | `SHARED_SELECT` allow-list, `reveal_order`; tests of REST, themes, exports and socket | Wording, small teams and context can still identify you. |
| Votes are private; only totals of a closed round are shown. | `votes` is never selected per person | Small totals can be revealing. |
| Owners and facilitators cannot see who wrote what. | No route joins entries to accounts | The operator could, with database or backup access. The guarantee is application-level. |
| Your email address, if you have one, is shown only to you, to owners, and to whoever decides your join request. | `buildMe`; `members.email` and pending invitations are owner-only; the join-request list (owner or the sprint's facilitator) | It goes to the email provider to deliver invitations and reminders. It never signs anyone in. |
| An invitation link works once, within 14 days, for whoever accepts it first while signed in. | Conditional update, `expires_at` | Forwarding the email hands the invitation on. |
| Drafts stay on this device only if you choose, for your account only. | `keepLocalFor`, memory store otherwise; unit and e2e tests | Anyone using this browser profile can read them, and they cannot be erased remotely. |
| Data is encrypted at rest and in transit. | Cloudflare D1 and Durable Objects (AES-256), TLS | Keys are managed by the provider; this does not stop the service reading what it stores readable. |
| Sprint content is encrypted on participants' devices by default. | `e1` envelopes made in the browser; the server refuses plaintext for encrypted sprints; `encryption.test.ts`, `web/e2e/encryption.mjs` | Not independently reviewed. Authorship and metadata stay visible to the service, and it depends on the app delivered being genuine. Unencrypted sprints are not covered and say so. |
| Finished sprints' raw content is deleted after the workspace's window (90 days by default). | `retention()` cron | Finished sprints only. Backups and logs lag by up to 30 or 7 days. Exports cannot be recalled. |
