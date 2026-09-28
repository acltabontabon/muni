# Passkeys, accounts and team invitations

*Scan to join. Unlock to return. Capture a thought.*

Muni signs in with **passkeys only**: an account is its opaque id and its passkeys. There is no
email sign-in, no password and no recovery email (removed on 2026-09-27, migration 0008). An email
address, if an account has one, is only where invitations and reminders are sent. This document
covers the design, the security model, the removal of email sign-in, and rollout/rollback.

Status: deployed to act.munimuni.app (see §9). Tested with Chromium's virtual authenticator and
a software authenticator, and on physical devices by the maintainer on 2026-09-29 (iPhone Safari, Android Chrome, Windows Hello, Firefox, 1Password and Bitwarden, and a company-managed Chrome), including recovery after a lost phone and on a new laptop. **Not
independently reviewed** (§8, §10).

## 1. Three separate things

| | Proves | Stored as | Granted by |
| --- | --- | --- | --- |
| **Authentication** | control of one of the account's passkeys | `sessions` (token hash, `auth_method = 'passkey'`), `webauthn_credentials` (public key) | `/api/auth/passkey/login/verify`, `/api/auth/passkey/signup/verify` (and `/reauth/verify`, which rotates a session) |
| **Membership** | permission to reach a workspace or sprint | `memberships`, `sprint_participants` | accepting an emailed invitation link, a manager approving a team-QR request, or redeeming a personal link — always signed in with a passkey |
| **Content access** | possession of decryption keys | in memory only; the server holds public keys and wraps it can't open; the device holds an envelope it can't open alone | a passkey's PRF output (in the browser), this device's envelope after signing in, or the recovery key; teammates' devices ([ENCRYPTION.md](ENCRYPTION.md) §4) |

Signing in never grants membership. An invitation is permission to join, never a sign-in: every
invitation path needs a signed-in account first. Membership never grants keys.

**Passkeys and encryption (since 2026-09-27).** A passkey's *signature* proves who you are; it is
never a key. Separately, every ceremony asks the passkey for its PRF output (WebAuthn `prf`
extension, input SHA-256(`muni:prf:account-key:v1`)). Where the passkey and browser return one,
the browser derives a wrapping key from it and unwraps the account's encryption key in the same
step as signing in. The PRF output stays in the browser: requests carry no extension results, and
the server refuses any that do (`prf_not_allowed`). A passkey only unlocks once it's been
provisioned from a device where the key is already open (automatically, the next time it's used
there); adding a passkey from a locked device gives it sign-in only. General passkey support says
nothing about PRF: only an actual result counts.

## 2. Relying party

- **RP ID = `act.munimuni.app`**, the app's own host; allowed origin = exactly
  `https://act.munimuni.app`. The installed PWA runs on that same origin (manifest `scope: "/"`,
  `start_url: "/?source=installed"`), so passkeys work there too. The marketing site
  (munimuni.app) never needs passkeys, and a parent-domain RP ID would let every subdomain use
  them — so production refuses anything but the app host (`lib/config.ts`). Nothing comes from
  request headers. Moving the app to another host would mean re-adding passkeys there.
- Library: `@simplewebauthn/server` 14.0.3 / `@simplewebauthn/browser` 14.0.0 (MIT). Workers is
  "periodically tested, unofficially supported" upstream, so the whole server flow runs inside
  workerd in our tests.
- Credentials: discoverable (`residentKey: required`), `userVerification: required`, attestation
  `none`, Ed25519/ES256/RS256. User handle: 32 random bytes per account, never the account id or
  an address. `user.name` (what the person's own password manager shows) is the chosen name.
- Challenges: random, 5 minutes, one ceremony type, bound to the browser (sign-in, sign-up: a
  short-lived HttpOnly SameSite=Strict cookie) or to the session and account (adding a passkey,
  step-up), and **consumed atomically before verification** — a replayed or concurrent response
  yields at most one session, credential or account.
- Verified server-side: challenge, origin, RP ID hash, ceremony type, user presence and
  verification, algorithm, signature, credential ownership, user handle. Synced (backup-eligible)
  passkeys aren't locked out over counters; single-device keys keep the strict counter check.

## 3. Journeys

### Sign in
The panel holds, in this order: **Welcome back.**, **Continue with a passkey** (a
discoverable-credential prompt — nothing to type), **New to Muni? Create an account**, and a quiet
**Need help signing in?** disclosure. The help covers what a passkey is, the browser's phone/tablet
(QR) option, cancelling, several accounts on one device, losing a passkey (synced passkeys reach
other devices; there is no email or support reset) and supported browsers. Error guidance appears
only when something goes wrong (cancelled, unknown passkey, offline, rate-limited). Browsers
without WebAuthn get a plain explanation and no other way in. Old `/signin?method=email` links open
this same sign-in.

Nothing starts a passkey prompt by itself (no autofill/conditional UI, no auto-start after
sign-out), so a passkey on the device can't silently sign the previous account back in; the
browser's own chooser lists every Muni passkey on the device, labelled by name.

### Create an account
Name → **Create with a passkey**. The account is created only after the registration verifies.
Duplication can't be detected without an identifier, so creation is an explicit, separate choice
("Have an account? Sign in"). Then one step: **add a second passkey**, or "Not now" — the passkey
is the only way in. Abuse control: 30 sign-up ceremonies per network per 10 minutes, **10 new
accounts per network per day and 200 in total per day** (`SIGNUPS_PER_NETWORK_DAILY`,
`SIGNUPS_DAILY_LIMIT`), checked *before* the device creates a passkey so it isn't left with an
orphan.

### Email (for mail only)
An account has an address only if it accepted an emailed invitation: the invited address is kept
(unless another account already has it) so later invitations and sprint reminders reach it. It
never signs anyone in, can't be added by hand, and can be removed in Account → Notifications,
which only stops that mail.

### Invitations
- **Team QR** (approval): anyone with the code asks, a manager approves (seeing the name, the
  address if the account has one, account age, "no email on this account").
- **Personal link** (`mode = 'direct'`): for one person; single use; 24 h or 7 days; joins
  whoever redeems it first *while signed in*, as `member`. Redemption, membership, sprint seat
  and audit are one transaction keyed on a random redemption id, so racing people/tabs get exactly
  one winner (tested). It stops working if its creator can no longer invite into that scope.
- **Emailed invitation**: Muni emails a link; it works once and expires in 14 days, and whoever
  accepts it first while signed in with a passkey joins — like a personal link that happens to
  travel by email. There is no address confirmation code any more.

### Devices, sessions, sign-out
Add/rename/remove passkeys (removal needs a recent sign-in; an account's last passkey can't be
removed). Sessions list with per-session sign-out and "Sign out everywhere else". Sign-out revokes
the server session, clears local drafts and queue, and takes the encryption key out of memory in
every tab. It **keeps** the device envelope, which can't be opened until the person signs in again
(ENCRYPTION.md §4), so signing back in unlocks without the recovery key. "Also forget this device"
(in the sign-out dialog, and Account → Encryption) removes that too, and the server's half of it;
passkeys stay in the person's password manager. Offline sign-out is remembered and finished when
back online, and — because the session can't be ended yet — also forgets the device's envelope,
with a warning when it's the only way to unlock.

## 4. Security model

- Passkeys are phishing-resistant, and they're the only way in: no inbox, password or support
  process can sign anyone in or add a passkey.
- Sessions are accepted only if they were made by a passkey (`sessions.auth_method = 'passkey'`,
  checked on every request), so a leftover session from an email code — all were revoked by
  migration 0008 — could never authenticate.
- Step-up (10 minutes, confirmed with one of the account's own passkeys) guards adding/removing
  passkeys, replacing encryption keys and the recovery key.
- Local storage holds only non-authoritative hints (a "used a passkey here" flag, a pending
  sign-out marker). No device id or fingerprint exists; possession of an invite link proves
  nothing about identity.
- Security events: ids and coarse labels only (never tokens, raw WebAuthn responses, invitation
  tokens or content), 365 days.
- Anonymity is unchanged: names never appear with thoughts or votes; approvers see names (and an
  address only if the account has one), never content.

## 5. Losing access — the honest policy

- **A passkey saved in a password manager** (iCloud Keychain, Google Password Manager, 1Password…)
  is on the person's other devices: signing in there works as usual.
- **Account access is not content access.** A passkey that only signs in gets you into the
  account, not into encrypted writing. On a device that never had the key, that needs a passkey
  that unlocks (PRF, provisioned earlier), a device that's still unlocked, or the recovery key.
- **No remaining passkey: the account cannot be recovered.** Muni has nothing else that shows it's
  you, and there is no support or operator reset — any such shortcut would let anyone who can
  convince the operator take over an account. What remains: the team can invite a new account;
  thoughts already shared stay in their sprints, without a name; encrypted content sealed only to
  the old account's key is gone (the recovery key restores content keys on a device you can sign
  in on, not the account).
- Mitigations in the product: the second-passkey step after sign-up, a standing notice in
  Settings while an account has one passkey, the sign-in help, and the server refusing to remove
  the last passkey.

## 6. Data model and migrations

- `0004_passkeys_and_join.sql`: credentials, challenges, session details, security events, join
  links/requests.
- `0005_passkey_first.sql`: `account_emails(account_id PK, email UNIQUE, verified_at)`; join-link
  modes; the challenge table rebuilt for sign-up.
- `0008_passkeys_only.sql` (email sign-in removed):
  - Accounts without a passkey — they can no longer sign in — are deleted with everything that is
    theirs, and so are workspaces left with no one who can sign in. Rows that reference them
    without a foreign key (thoughts, votes, context, experiment owners, invitations, links, keys'
    creators, audit and security events, jobs, AI usage) are removed or cleared explicitly, so
    nothing is orphaned. On 2026-09-27 that was the operator's two early test accounts (email
    only) and their own workspace.
  - Every session not made by a passkey is ended; `verification_challenges` (the codes) is dropped.
  - `accounts.email` becomes `accounts.legacy_key`, holding the account's own id. It can't be
    dropped (SQLite refuses to drop a `UNIQUE` column) and `accounts` can't be rebuilt: in D1,
    dropping a parent table runs an implicit `DELETE` whose `ON DELETE CASCADE` actions wipe the
    child rows, `PRAGMA defer_foreign_keys` doesn't stop cascade *actions*, and
    `PRAGMA legacy_alter_table` is ignored (all three tested on a local D1, 2026-09-27). Renaming
    the column keeps every child row. Nothing reads it; it holds no address.
- Rehearsed on a copy of production (`wrangler d1 export` → local D1 → migrations): 3 accounts, 2
  workspaces, 2 sprints and 5 thoughts kept, all passkey accounts; no orphans in any
  account-, workspace- or sprint-referencing column; `PRAGMA foreign_key_check` clean.

## 7. Which flows send email

| Flow | Sent to | When |
| --- | --- | --- |
| Team invitation | the address a manager enters in "Invite by email" | when sent |
| Sprint reminders (midpoint, day before) | participants **who have an address** and haven't opted out | scheduled per sprint |

Nothing else sends email, and no email signs anyone in.

## 8. Tests

Automated (2026-09-27, all passing):

- Worker, in workerd (`pnpm test`, 157). Every test account signs up and signs in with a passkey
  (the harness's software authenticator). `passkeys-only.test.ts` (14): sign-up with only a name,
  replay/concurrency → one account, reused credential, ceremony checks, caps; **the email endpoints
  (`request-code`, `verify`, email re-auth, `me/email/request|verify`, `invitations/confirm`) answer
  404 and set no session cookie; the codes table is gone; a session with a non-passkey method
  doesn't authenticate**; an address never signs in and removing it only stops mail; the last
  passkey can't be removed even with an address; emailed invitations keep the invited address
  unless another account has it; personal links; reminders skip accounts without an address.
  `passkeys.test.ts` (19), `unlock.test.ts` (12: device shares only to a passkey that existed when
  the device was bound), `join.test.ts` (13), and every other suite.
- Browser, headless Chromium + CDP virtual authenticator: `web/e2e/entrance.mjs` (30: the panel's
  hierarchy and restraint, reading width, keyboard order and visible focus, the help disclosure,
  phone layout with the primary action in reach, loading, cancel and retry, unknown passkey,
  create → sign out → sign in → `next`, old `?method=email` links, the email API gone, reduced
  motion, unsupported browser, offline); `web/e2e/passkeys.mjs` (30, over HTTPS: onboarding,
  second-passkey offer, last-passkey guard, a synced passkey on a second device, draft kept through
  a session ending, team QR, personal link, emailed invitation, sessions with pre-prefix cookies,
  offline sign-out); `unlock.mjs`, `encryption.mjs` (the new-device step now uses a synced
  passkey without PRF, which signs in but doesn't unlock), `capture`, `offline`, `worlds`, `voice`.

**On physical devices (2026-09-29, by the maintainer):** iPhone Safari, Android Chrome, Windows Hello, Firefox, 1Password and Bitwarden, and a company-managed Chrome, plus recovery: a lost phone,
and signing in on a new laptop. Not covered by that pass: the installed iOS home-screen app and
hardware security keys. The matrix used as a guide: {iPhone Safari, iPhone installed app, Android Chrome, macOS Safari/Chrome,
Windows Chrome/Edge, Firefox} × {create account, sign in, sign in via phone QR, cancel, sign out
then switch account, add a second passkey, scan team QR, open personal and emailed links,
writing unlocks after sign out → sign in}.

## 9. Rollout and rollback

Rollout (0008): take a D1 Time Travel bookmark, `pnpm migrate:remote`, deploy Worker + web together.
Passkey sessions stay valid; email-code sessions end.

Rollback options, least to most drastic:

1. **Roll the Worker back** (`wrangler rollback`) — only as far as a Worker that reads
   `legacy_key`: earlier Workers read `accounts.email`, which no longer exists, and would fail.
   Prefer a forward fix.
2. **Restore D1 to the pre-migration bookmark** (`wrangler d1 time-travel restore`) together with
   the previous Worker: loses every write since, and brings back the deleted test accounts.

## 10. Remaining risks and review requirements

- Losing every passkey loses the account, for everyone; the product says so plainly and pushes a
  second passkey.
- Passkey-only sign-up is cheap: rate limits, team-QR approval and single-use links are the
  controls; watch `account.created` volumes.
- An emailed invitation admits whoever opens it first, like a personal link: forwarding it hands
  it on (the email says so).
- Approvers can approve the wrong person; the UI shows what's verifiable and says a name proves nothing.
- `@simplewebauthn/server` on Workers is upstream-unofficial: re-run the suites on upgrades.
- Needs the real-device matrix and an independent security review.
