# Passkeys and QR team invitations

*Scan to join. Unlock to return. Capture a thought.*

Status: implemented and tested locally (below). **Not deployed.** Needs review before production
rollout, and real-device testing that this change could not do.

## 1. Three separate things

| | Proves | Stored as | Granted by |
| --- | --- | --- | --- |
| **Authentication** | control of an account credential: a mailbox (email code) or a passkey | `sessions` (token hash), `webauthn_credentials` (public key) | `/api/auth/verify`, `/api/auth/passkey/login/verify` |
| **Membership** | permission to reach a workspace or sprint | `memberships`, `sprint_participants` | accepting an email invitation for your address, or a manager approving a join request |
| **Content access** | possession of decryption keys | the device's IndexedDB; the server holds only public keys and wraps | the person's own devices and recovery key; teammates' devices (existing flow, [ENCRYPTION.md](ENCRYPTION.md)) |

A sign-in never grants membership. Membership never grants keys. A passkey is not a key for
content: nothing is derived from it, and no WebAuthn extension (PRF, largeBlob) is used.

## 2. What existed before (reviewed)

- **Email sign-in** (`worker/src/routes/auth.ts`): six-digit code, hashed, 10 minutes, 5 attempts,
  single use, resend cooldown, per-address/per-network/daily limits; sign-in and sign-up are one
  step (a verified address without an account gets one). Sessions: random token in a `__Host-`
  HttpOnly Secure SameSite=Lax cookie, SHA-256 at rest, 30-day absolute expiry, revocation, a
  per-session CSRF token in a readable cookie echoed in a header, Origin/Sec-Fetch-Site checks.
- **Invitations**: email-bound, single use, 14 days, token in the URL fragment and request bodies.
- **Authorization**: every request re-reads membership and participation from D1.
- **Encryption**: account X25519 key per person, recovery key, sprint keys sealed to participants
  by teammates' devices; email sign-in never unlocks content (tested).
- **PWA**: service worker caches the shell only, never `/api`; no bearer tokens in storage.
- **Platform**: Cloudflare Worker (Hono) + D1 + a Durable Object per sprint for live hints.

## 3. Design

### Passkeys (WebAuthn)

- Library: **`@simplewebauthn/server` 14.0.3** / **`@simplewebauthn/browser` 14.0.0** (current
  major; MIT). Cloudflare Workers is listed upstream as "periodically tested but unofficially
  supported", so the whole server flow is exercised inside workerd by the test suite
  (`worker/test/passkeys.test.ts`), with `nodejs_compat`.
- **Relying party**: RP ID = `PUBLIC_ORIGIN`'s host (`act.munimuni.app` in the hosted deployment);
  allowed origins = exactly `PUBLIC_ORIGIN`. Production refuses any other RP ID (no parent-domain
  broadening — `munimuni.app`, previews and other subdomains can't use or be offered these
  passkeys) and refuses extra origins. Development may list extra exact origins
  (`WEBAUTHN_EXTRA_ORIGINS`, e.g. the Vite server). Nothing is derived from request headers.
- **Credentials**: discoverable (`residentKey: required`), `userVerification: required`,
  attestation `none` (no device or maker information requested or stored), algorithms Ed25519,
  ES256, RS256. Up to 20 per account, each with a user-chosen label.
- **User handle**: 32 random bytes per account (`accounts.webauthn_user_id`), opaque — not the
  account id, not the email. `user.name` is the email address so the person's own password
  manager can tell accounts apart; it is never used to find an account.
- **Challenges** (`webauthn_challenges`): random 32 bytes, 5-minute expiry, one ceremony type.
  Sign-in challenges are bound to the requesting browser by a short-lived HttpOnly, SameSite=Strict
  cookie (hash stored); registration and step-up challenges are bound to the session and account.
  Each is **consumed with a conditional `UPDATE` before the response is verified**, so replayed or
  concurrently reused responses produce at most one session or credential (tested with parallel
  requests).
- **Verification** (library + our checks): challenge, origin, RP ID hash, ceremony type, user
  presence, user verification, algorithm, signature against the stored key, credential ownership,
  and the user handle (when present) against the credential's account.
- **Counters and backup flags**: backup-eligible (synced) passkeys are copies by design and usually
  report a counter of 0; for them the counter is not enforced — a regression is recorded as a
  security event, not a lockout. Single-device credentials (security keys) keep the library's
  strict counter check (a regression there can signal a clone). Backup state is updated on use.
- **Enrollment**: only a signed-in session with a sign-in in the last 10 minutes can add a passkey
  (`reauth_required` otherwise). Confirming uses a passkey (for accounts with one) or a code to
  the account's own address (`reauth: true` refuses other addresses before spending the code).
  A passkey is never attached because a request names an email address.
- **New accounts still need email verification.** Passkeys are offered after that, so they reduce
  later email use; the product did not become email-free.

### Returning

- The entrance keeps email first; "Continue with a passkey" is the second option. A browser that
  used a passkey before shows the passkey first with "Use email instead" (a hint in local prefs,
  never proof of anything). Conditional UI (`autocomplete="username webauthn"`) is a progressive
  enhancement; the button and email always work. Browsers without WebAuthn see email only.
- Cross-device sign-in (the browser's own QR / hybrid transport) is left entirely to the browser.
- Cancellation, "no passkey here", timeouts: calm copy that points to email (`describePasskeyError`).
  A passkey the server no longer knows gets a plain message and a WebAuthn `unknownCredential`
  signal where supported.
- Sessions: unchanged 30-day absolute lifetime, rotated on every sign-in and step-up, revocable
  per session or all-but-this-one. No passkey ceremony per page load or per thought.

### Invitations

- **Individual (email)**: unchanged semantics, now with an explicit `role = 'member'` column and a
  "Copy invite link" for the inviter (still only works for the invited address).
- **Shared invite QR / link** (`join_links`): an ordinary `https://<app>/join#<token>` URL,
  256-bit token, only its SHA-256 stored, token in the fragment (never in server logs or Referer —
  tested), sent to the API only in request bodies. Created by owners/active facilitators (a sprint
  link: that sprint's facilitator). Expiry 24 h / 7 d / 30 d; request cap 10/30/100; turn off or
  replace at any time; one active link per scope (Muni can't re-show a link it only keeps a hash
  of, so showing a new QR replaces the old one).
- **A link admits nobody.** A signed-in, named person creates a join request (idempotent: one open
  request per person per workspace). An authorized manager approves or declines; approval is one
  D1 transaction that only adds anyone if that very decision won, so concurrent approvals/declines
  and double clicks resolve to exactly one outcome. The role is always `member` (schema CHECK);
  a previously removed owner returns as a member. Requests expire after 14 days undecided;
  turning a link off stops new requests but leaves existing ones for a person to decide.
- **Manager context**: the name the person chose *and* their verified email address (every
  account's address was confirmed by code), account age, whether they were in the workspace
  before, whether an email invitation to that address is pending. The approver is told to
  recognise or verify the person; the requester is told the approver sees their name and email.
- **Unauthenticated preview**: only "valid" and whether a sprint is included. After sign-in: the
  workspace name and the person's own standing. Never members or content.
- **Waiting**: bounded status checks (5 s backing off to 60 s, pausing after 30 minutes, resuming
  on focus or "Check now"); the manager's open QR dialog checks similarly. No new real-time channel
  (the sprint room is for participants only).
- **Explicit account choice**: invitation and join pages ask "I already use Muni" (passkey or
  code) vs "I'm new to Muni". If "I already use Muni" ends up creating a new account, the person
  is told before joining and can use a different address. The server still never reveals whether
  an account exists before a code is verified.

### Account security area (Account → Signing in / Signed-in sessions / Security activity)

Add, rename and remove passkeys; the email-code fallback and the honest security model; sessions
with method, coarse label ("Safari on iPhone", "Muni app on Android"), start and last activity;
sign out one session or all others; recent security events. Removing a passkey and ending
sessions are separate (removal can optionally end *other* sessions that used that passkey).
Email codes can't be turned off, so removing the last passkey never removes the last way in.

## 4. Security model, honestly

- **Passkeys are phishing-resistant; the account is not**, because email codes remain a way in.
  Anyone who controls the mailbox can sign in and add their own passkey (after the recent-sign-in
  check, which a fresh code satisfies). The account page says so.
- **Step-up (10 minutes)** protects against a borrowed unlocked device or a stolen cookie adding a
  passkey, removing one, replacing encryption keys or changing the recovery key.
- **Security events** (`security_events`) record ids and coarse labels only; never codes,
  tokens, raw WebAuthn responses, invitation tokens or content. Kept 365 days.
- **Rate limits**: sign-in options 120/10 min and verify 60/10 min per network; registration
  20/hour and step-up 30/10 min per account; join previews 60/10 min per network; join requests
  20/hour per account plus each link's cap; link creation 30/day per workspace.
- **CSRF**: every authenticated mutation keeps the header token + Origin check; unauthenticated
  ceremony endpoints check Origin/Sec-Fetch-Site and use the SameSite=Strict binding cookie.
- **Headers**: `Permissions-Policy` now names `publickey-credentials-create=(self)` and
  `publickey-credentials-get=(self)`.

## 5. Encrypted content boundaries

Passkey registration and sign-in upload no content keys, add no operator key, derive nothing from
passkey signatures, and give a new device nothing it couldn't get from an email sign-in (tested:
`GET /api/me/keys` returns the same public key and recovery blob either way; the private key
appears nowhere in D1). Approval into an encrypted sprint adds a participant and **zero** key
wraps (tested); keys reach them only through the existing, reviewed late-participant sharing from
teammates' devices. The "You're in" screen and the existing key notices say a device may still
need its encryption key. Replacing keys or the recovery key now needs a recent sign-in. Invite
QR payloads carry no keys.

## 6. Configuration and migration

- `worker/migrations/0004_passkeys_and_join.sql` — additive: new columns with defaults
  (`accounts.webauthn_user_id`, `sessions.auth_method/authenticated_at/credential_ref/client_label`,
  `invitations.role`) and new tables. Existing sessions are backfilled (`authenticated_at =
  created_at`, method `email`); sessions an older Worker writes after the migration still work
  (tested). No existing row is otherwise changed; no user is migrated.
- Production: `WEBAUTHN_RP_ID` is rendered from `MUNI_DOMAIN` by `scripts/production-config.mjs`
  (must equal `PUBLIC_ORIGIN`'s host, or the Worker refuses to start). No new secrets.
- Development: `WEBAUTHN_EXTRA_ORIGINS=http://localhost:5173` in `wrangler.jsonc` for the Vite server.

## 7. Tests

Automated (all passing on 2026-09-27):

- `worker/test/passkeys.test.ts` (19) and `worker/test/join.test.ts` (13), in workerd with a
  software authenticator (`worker/test/authenticator.ts`): existing-account enrollment without
  duplication; invited new-account enrollment; sign-in and session rotation; wrong origin
  (marketing, preview, foreign), wrong RP ID, wrong ceremony type, missing UV/UP, bad signature,
  foreign user handle, malformed bodies; expired, replayed and concurrent challenges; browser
  binding; registration against the wrong session/account; credential moving between accounts;
  synced counters (0 and regressing) vs security-key counters; removed passkeys; recent-auth for
  add/remove/key replacement/recovery; per-session and all-other revocation, including pre-change
  sessions; idempotent logout; legacy cookie expiry; production RP configuration; link token
  never stored; minimal previews; request idempotency under concurrency; caps, expiry, turning
  off; approval idempotency and approve/decline races; unauthorized approval (member, requester,
  outsider, other workspace, other sprint's facilitator); role escalation attempts; removal and
  return; encrypted-sprint approval grants no keys; email invitation mismatch and replay.
  Mutation checks: disabling user verification or the browser binding makes these tests fail.
- `web/e2e/passkeys.mjs` (25 checks), headless Chromium against `wrangler dev --local-protocol
  https` with the CDP **virtual authenticator** — screenshots in `web/e2e-artifacts/passkeys/`.
  Covers the flows end to end in the real UI, including draft preservation through a session
  ending and a passkey sign-in, and the QR join flow across a desktop manager and a mobile joiner.

**Not verified here (needs real devices before rollout):** Safari/iOS and macOS iCloud Keychain,
Android/Google Password Manager, Windows Hello, Firefox, third-party password managers, hardware
security keys, the browser's cross-device (QR/hybrid) sign-in, conditional-UI autofill actually
selecting a passkey, installed-PWA mode on iOS/Android (which may keep a separate cookie jar from
the browser, so someone who joins in the browser signs in again in the app — a passkey makes that
one tap), and camera scanning of the invite QR. The virtual authenticator proves protocol
behaviour, not device compatibility.

Suggested manual matrix: {iPhone Safari, iPhone installed app, Android Chrome, Android installed
app, macOS Safari, macOS Chrome, Windows Chrome/Edge, Firefox} × {add passkey after email sign-in,
sign in with the button, sign in via autofill, sign in from another device via the browser's QR,
cancel, remove passkey then try it, scan invite QR with the camera, approve from desktop}.

## 8. Rollout and rollback

1. Review this change (security review of `worker/src/routes/passkeys.ts`, `join.ts`,
   `lib/auth.ts`; UX review of the entrance and join pages).
2. Deploy to a staging Worker on its own host with its own D1; run `web/e2e/passkeys.mjs` there
   and the manual matrix above.
3. Production: `pnpm migrate:remote` (additive), then deploy Worker + web together. Email sign-in
   keeps working throughout; nobody is migrated or forced to add a passkey; existing sessions stay
   valid (no forced sign-out this time).
4. Watch `security_events` volumes (`signin.passkey`, `passkey.counter_anomaly`) and 4xx rates on
   `/api/auth/passkey/*`.

**Rollback**: roll back the Worker and web together to the previous version. The new tables and
columns are ignored by the old code (additive), sessions and memberships keep working, and email
sign-in is untouched. Passkeys and open join requests simply stop being usable until re-deployed;
nothing needs deleting. Don't roll back the migration itself (D1 has no down-migrations here, and
none is needed). If only the frontend must go back, the old client keeps working against the new
Worker (all new endpoints are additive).

## 9. Remaining risks and review requirements

- Email remains the weakest entry point (see §4). A future option could let people require a
  passkey and disable codes — deliberately out of scope here.
- `@simplewebauthn/server` on Workers is upstream-"unofficial"; covered by our tests, but a
  library upgrade must re-run them.
- Shared links are bearer secrets until turned off; approval is the control. Managers can approve
  the wrong person; the UI shows verified context but can't prove who is holding the phone.
- The join token stays in the joining browser's history (fragment) — same as email invitations.
- Workspace names are shown to any signed-in person holding a live link.
- Needs independent security review and the real-device matrix before rollout.

## Related fixes in this change

- **Sign-out and "Sign out everywhere else" failing in production**: browsers that signed in
  before the `__Host-` cookie prefix (2026-09-27) kept the old readable `muni_csrf`, which is
  listed before the new cookie; the client's regex took the first match, so every change got a
  stale-CSRF 403 and the sign-out dialog misreported it as "couldn't reach Muni". Fixed on both
  sides: the client reads only `__Host-muni_csrf` over HTTPS, and the Worker expires leftover
  unprefixed cookies on its next response (which also heals already-cached old clients after one
  request). Sign-out is now idempotent server-side, reports real errors, and offers "Sign out on
  this device" when Muni can't be reached — remembered so refresh/other tabs stay signed out, and
  finished against the server when the device is back online. The session list reloads from the
  server after every change.
- **A box around the moon** on the Write page: the moon's halo (`box-shadow`, reaching 0.48 × the
  art height) was clipped by a `clip-path` extending only one disc-width (0.26 ×), slicing the
  glow in straight lines. The clip now extends past the halo and cuts only along the horizon.
