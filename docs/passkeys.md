# Passkeys, accounts and invitations

How people sign in to Muni, how they join teams, and what happens when they lose a passkey. For
contributors and security reviewers. The crypto design is in [encryption.md](encryption.md).

Passkeys are the only way in. An account is an opaque id plus its passkeys. There is no email
sign-in, password or recovery email. An account may have an email address, but only as the place
invitations and sprint reminders go.

Status: live on act.munimuni.app. Tested on real devices on 2026-09-29 ([Tests](#tests)). Not
independently reviewed.

## Authentication, membership and content access

Three separate questions, three separate mechanisms.

| | Proves | Granted by |
| --- | --- | --- |
| Authentication | Control of one of the account's passkeys | A session from `/api/auth/passkey/login/verify`, `/signup/verify` or `/reauth/verify` (stored in `sessions` with `auth_method = 'passkey'`) |
| Membership | Permission to reach a workspace or sprint | An accepted invitation, an approved team-QR request or a redeemed personal link (`memberships`, `sprint_participants`). Always needs a signed-in account first. |
| Content access | The decryption keys | A passkey's PRF output, this device's envelope, the recovery key, or teammates' devices ([encryption.md](encryption.md)) |

Signing in grants no membership. Membership grants no keys.

### Passkeys and encryption

A passkey's signature proves who you are. It is never a key. Separately, each ceremony asks the
passkey for its WebAuthn PRF output (input: SHA-256 of `muni:prf:account-key:v1`). If the passkey
and browser return one, the browser derives a wrapping key and unwraps the account's encryption key
while signing in.

The PRF output never leaves the browser. Requests carry no extension results, and the server
rejects any that do (`prf_not_allowed`). A passkey unlocks only after it has been provisioned from a
device where the key is already open; a passkey added from a locked device signs in but does not
unlock. Only an actual PRF result counts: general passkey support says nothing about PRF.

## Relying party and ceremonies

- **Relying party.** The RP ID is `act.munimuni.app`, the app's own host, and the only allowed
  origin is `https://act.munimuni.app`. Production refuses any other RP ID or extra origins
  (`worker/src/lib/config.ts`), so a parent-domain passkey can never work on sibling hosts such as
  munimuni.app. Nothing comes from request headers. The installed PWA runs on the same origin.
  Moving the app to another host means re-adding passkeys.
- **Library.** `@simplewebauthn/server` 14.0.3 and `@simplewebauthn/browser` 14. Upstream treats
  Workers as unofficially supported, so the tests run the full server flow in workerd.
- **Credentials.** Discoverable (`residentKey: required`), user verification required, attestation
  `none`, algorithms Ed25519, ES256 and RS256. At most 20 passkeys per account. The WebAuthn user
  handle is 32 random bytes per account, never the account id or an address. `user.name` is the
  name the person chose.
- **Challenges.** Random, single-use, valid for 5 minutes, tied to one ceremony type. Sign-in and
  sign-up challenges are bound to the browser by a short-lived HttpOnly, SameSite=Strict cookie.
  Adding a passkey and confirming identity are bound to the session and account. The challenge is
  spent atomically before verification, so a replayed or concurrent response yields at most one
  session, credential or account.
- **Verified server-side.** Challenge, origin, RP ID hash, ceremony type, user presence and
  verification, algorithm, signature, credential ownership and user handle. Synced
  (backup-eligible) passkeys skip the signature-counter check, because they often report 0. Single-device
  keys keep it.

## Abuse limits

| Limit | Value |
| --- | --- |
| Sign-in options / verify, per network | 120 / 60 per 10 minutes |
| Sign-up options, per network | 30 per 10 minutes |
| New accounts, per network / in total | 10 / 200 per day (`SIGNUPS_PER_NETWORK_DAILY`, `SIGNUPS_DAILY_LIMIT`) |
| Adding a passkey, per account | 20 per hour |
| Edge limit, signed-out `POST`s to `/api/auth`, `/api/join`, `/api/invitations` | 60 per minute per address (`EDGE_LIMIT`), answered before D1 is touched |

Sign-up checks the daily caps before the device creates a passkey, so a refused sign-up leaves no
orphan passkey. Only accounts actually created count against them.

## Journeys

### Sign in

The sign-in panel shows, in order: **Welcome back.**, **Continue with a passkey** (a
discoverable-credential prompt with nothing to type), **New to Muni? Create an account**, and a
**Need help signing in?** disclosure. The help covers what a passkey is, using a phone or tablet
through the browser's QR option, cancelling, several accounts on one device, losing a passkey and
supported browsers. Error guidance appears only when something goes wrong. Browsers without
WebAuthn get an explanation and no other way in.

Nothing starts a passkey prompt on its own (no autofill or conditional UI), so a passkey on the
device cannot silently sign the previous account back in.

### Create an account

The person enters a name and chooses **Create with a passkey**. The account exists only after the
registration verifies. Without an identifier, duplicates cannot be detected, so creating an
account is an explicit choice ("Have an account? Sign in"). The next step offers a second passkey,
or "Not now".

### Email address

An account gets an address only when it accepts an emailed invitation and has none yet. Muni keeps
the invited address unless another account already has it. The address cannot be added by hand,
never signs anyone in, and can be removed in Account → Notifications (`DELETE /api/me/email`),
which only stops the mail.

### Joining a team

Every route needs a signed-in account whose name is already set. Who may invite is defined in
`worker/src/lib/grants.ts`: workspace owners for the workspace, and a sprint's facilitator for that
sprint while it is unfinished. Joiners always get the `member` role.

| Route | How it works |
| --- | --- |
| Team QR (`mode = 'approval'`) | Anyone with the code sends a request. An approver sees the requester's name, address (if any), account age, whether they were a member before, and whether it matches a pending email invitation. Requests expire after 14 days. One team QR is active per scope. The link lasts 24 hours, 7 days (default) or 30 days and takes 10, 30 (default) or 100 requests. |
| Personal link (`mode = 'direct'`) | For one person, single use, valid 24 hours (default) or 7 days. The first signed-in account to redeem it joins. The claim, membership, sprint seat and audit record are one transaction, so racing tabs yield one winner. It stops working if its creator may no longer invite into that scope. |
| Emailed invitation | Muni emails a single-use link valid for 14 days. The first signed-in account to accept it joins. |

Links carry their token in the URL fragment (`/join#…`, `/invite#…`), so it never reaches a server
log or Referer header. Only the token's hash is stored. A link admits nobody by itself: scanning a
team QR asks to join, and a screenshot of the code is worth a request, not a membership.

### Devices, sessions and sign-out

- Passkeys can be added, renamed and removed. Adding or removing needs a recent sign-in (see
  [Security model](#security-model)). The last passkey cannot be removed.
- Sessions are listed with their coarse label (for example "Safari on iPhone"), with per-session
  sign-out and "Sign out everywhere else".
- Sign-out revokes the server session, clears local drafts and the send queue, and removes the
  encryption key from memory in every tab. It keeps the device envelope, which cannot be opened
  until the person signs in again, so signing back in unlocks without the recovery key.
- "Also forget this device" (in the sign-out dialog and in Account → Encryption) removes the
  envelope and the server's half of it. Passkeys stay in the person's password manager.
- Sign-out while offline is remembered and completed when the device is back online. Because the
  session cannot be ended yet, it also forgets the device's envelope and warns when that was the
  only way to unlock.

## Security model

- Only sessions created by a passkey authenticate (`sessions.auth_method = 'passkey'`, checked on
  every request). No inbox, password or support process can sign anyone in or add a passkey.
- Adding or removing a passkey, replacing encryption keys, setting the recovery key and deleting the
  account need a **recent sign-in**: the session must have proved control of one of the account's
  passkeys within the last 10 minutes (`RECENT_AUTH_MS`). `/reauth/verify` refreshes it and rotates the
  session.
- Local storage holds preferences and hints, never authority: `muni.prefs` (theme, last workspace
  and sprint, which accounts keep drafts, chosen world, a "used a passkey here" hint), a pending
  sign-out marker and `muni.auth-gen`, a counter that tells other tabs the account changed.
- IndexedDB holds, per account, what reopens the encryption key on this device (`muni-unlock`,
  useless without the server's half in `device_unlocks`), pinned teammates' keys (`muni-keys`) and,
  only for accounts that keep drafts, drafts and the send queue (`muni-device`). Nothing
  fingerprints the device.
- Security events (`security_events`) record ids and coarse labels only, never tokens, raw WebAuthn
  responses, invitation tokens or content. They are deleted after 365 days.
- Names never appear with thoughts or votes. Approvers see names, and an address only if the
  account has one, never content.
- Session lifetime, cookies, CSRF and authorization are covered in
  [architecture.md](architecture.md#authentication-and-authorization).

## Losing access

- **A passkey saved in a password manager** (iCloud Keychain, Google Password Manager, 1Password
  and similar) is on the person's other devices. Signing in there works as usual.
- **Account access is not content access.** A passkey that only signs in does not open encrypted
  writing. On a device that never had the key, unlocking needs a passkey that unlocks (PRF,
  provisioned earlier), a device that is still unlocked, or the recovery key.
- **With no passkey left, the account cannot be recovered.** There is no support or operator reset,
  because any such shortcut would let anyone who persuades the operator take over an account. The
  team can invite a new account. Thoughts already shared stay in their sprints, without a name.
  Content sealed only to the old account's key is lost; the recovery key restores content keys on a
  device the person can sign in on, not the account.
- Mitigations: the second-passkey step after sign-up, a standing notice in Account while an
  account has one passkey, the sign-in help, and the server refusing to remove the last passkey.
- A workspace owner can take over facilitating a stranded, unfinished sprint (**More → Take over
  facilitating…**), after which the lost account can be removed. A workspace whose only owner loses
  every passkey cannot be administered, so keep a second owner.

## Email

Nothing signs in by email. The server sends only:

- **Invitations**, to the address an owner (or a sprint's facilitator, for that sprint) types into
  "Invite by email". Limits: 20 a day per account, 60 an hour per workspace, and `EMAIL_DAILY_LIMIT`
  a day in total (80 by default).
- **Sprint reminders** (midpoint, day before) to participants who have an address and have not opted
  out.

## Data model

Tables: `webauthn_credentials` (public keys), `webauthn_challenges`, `sessions`,
`security_events`, `join_links`, `join_requests`, `account_emails`, `passkey_key_wraps`,
`device_unlocks`. `accounts.account_ref` is a unique copy of the account's own id; nothing reads
it. Schema and relationships: [architecture.md](architecture.md). Migrations are in
`worker/migrations`.

## Tests

- **Worker** (workerd, `pnpm test`): every test account signs up and signs in through a software
  authenticator. Passkey coverage is in `passkeys-only.test.ts`, `passkeys.test.ts`,
  `unlock.test.ts` and `join.test.ts`.
- **Browser** (headless Chromium with a virtual authenticator), in `web/e2e/`: `entrance.mjs`
  (the sign-in panel), `passkeys.mjs` (onboarding, second passkey, joining, sessions, offline
  sign-out), `unlock.mjs` and `encryption.mjs` (with and without PRF).
- **Real devices, 2026-09-29, by the maintainer:** iPhone Safari, Android Chrome, Windows Hello,
  Firefox, 1Password and Bitwarden, a company-managed Chrome, a lost phone, and signing in on a new
  laptop. Not covered: the installed iOS home-screen app and hardware security keys.

For a future pass, the matrix is {iPhone Safari, iPhone installed app, Android Chrome, macOS
Safari and Chrome, Windows Chrome and Edge, Firefox} × {create account, sign in, sign in via phone
QR, cancel, sign out then switch account, add a second passkey, scan team QR, open personal and
emailed links, writing unlocks after sign-out and sign-in}.

## Remaining risks

- Losing every passkey loses the account (see [Losing access](#losing-access)).
- Passkey sign-up is cheap. Rate limits, team-QR approval and single-use links are the controls;
  watch `account.created` volumes.
- An emailed invitation admits whoever opens it first, as a personal link does. Forwarding hands it
  on, and the email says so.
- Approvers can approve the wrong person. The UI shows what is verifiable and says a name proves
  nothing.
- `@simplewebauthn/server` on Workers is unofficial upstream: re-run the suites on upgrades.
- Untested on real devices: the installed iOS home-screen app and hardware security keys.
- No independent security review yet.
