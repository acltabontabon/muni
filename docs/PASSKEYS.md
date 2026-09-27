# Passkeys, accounts and team invitations

*Scan to join. Unlock to return. Capture a thought.*

Muni is **passkey-first**: an account is its opaque id and its passkeys. An email address is an
optional, verified setting. This document covers the design, the security model, the migration
from email-only accounts, and rollout/rollback.

Status: deployed to act.munimuni.app (see §9). Tested with Chromium's virtual authenticator and
a software authenticator; **not yet tested on physical devices or in installed-app mode**, and
**not independently reviewed** (§8, §10).

## 1. Three separate things

| | Proves | Stored as | Granted by |
| --- | --- | --- | --- |
| **Authentication** | control of an account credential: a passkey, or (if the account has one) a verified mailbox | `sessions` (token hash), `webauthn_credentials` (public key), `account_emails` | `/api/auth/passkey/login/verify`, `/api/auth/passkey/signup/verify`, `/api/auth/verify` |
| **Membership** | permission to reach a workspace or sprint | `memberships`, `sprint_participants` | an email invitation accepted for its address, a manager approving a team-QR request, or redeeming a personal link |
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
  an address. `user.name` (what the person's own password manager shows) is the email if the
  account has one, otherwise the chosen name.
- Challenges: random, 5 minutes, one ceremony type, bound to the browser (sign-in, sign-up: a
  short-lived HttpOnly SameSite=Strict cookie) or to the session and account (adding a passkey,
  step-up), and **consumed atomically before verification** — a replayed or concurrent response
  yields at most one session, credential or account.
- Verified server-side: challenge, origin, RP ID hash, ceremony type, user presence and
  verification, algorithm, signature, credential ownership, user handle. Synced (backup-eligible)
  passkeys aren't locked out over counters; single-device keys keep the strict counter check.

## 3. Journeys

### Sign in
One primary action: **Continue with a passkey** (a discoverable-credential prompt — no email or
username to type). Quiet help explains the browser's phone/tablet (QR) option, cancelling, "no
passkey on this device", and switching accounts. Secondary: **New to Muni? Create an account**.
Discreet, temporary: **Used Muni before with email codes? Sign in with email**
(`/signin?method=email` opens it directly). Browsers without WebAuthn get a plain explanation and
keep the email path for older accounts.

Nothing starts a passkey prompt by itself (no autofill/conditional UI, no auto-start after
sign-out), so a passkey on the device can't silently sign the previous account back in; the
browser's own chooser lists every Muni passkey on the device, labelled by name or address.

### Create an account
Name → **Create a passkey**. The account is created only after the registration verifies; no
email is asked for. Duplication can't be detected without an identifier, so creation is an
explicit, separate choice that warns: *"Already have a Muni account? A new one won't include your
teams — continue with your passkey instead."* Then **Keep a way back in**: add a second passkey,
add a recovery email, or "Not now". Abuse control (no mailbox slows it down any more): 30
sign-up ceremonies per network per 10 minutes, **10 new accounts per network per day and 200 in
total per day** (`SIGNUPS_PER_NETWORK_DAILY`, `SIGNUPS_DAILY_LIMIT`), checked *before* the device
creates a passkey so it isn't left with an orphan.

### Existing email-only accounts ("Used Muni before?")
Email → code → (name if missing) → **Add a passkey to your account** (same account id, teams,
thoughts, keys; "Not now" keeps email working). The email path signs in *existing* accounts
only: a code never creates an account, and only after the code is verified does the answer say
no account has that address. Keep this path while any account has an email and no passkey:

```sql
SELECT count(*) FROM account_emails e
 WHERE NOT EXISTS (SELECT 1 FROM webauthn_credentials k WHERE k.account_id = e.account_id);
```

(On 2026-09-27 production had 2 accounts, both email-only.) Even after that reaches zero, the
same code sign-in remains the *recovery* path for accounts that keep an email (§5).

### Optional email (Account → Signing in → Recovery email)
Add / change: address → code to it → confirm (recent sign-in required; the code is bound to the
account that asked; an address on another account is revealed only after its code is verified).
Remove: recent sign-in; refused if the account has no passkey; with one passkey the dialog warns
and suggests a second first. The page states what an address enables: **code sign-in if every
passkey is lost, email invitations to that address, sprint reminders** — and that it is never
needed to sign in. Changing or removing scrubs the old address from the legacy column too.

### Invitations
- **Team QR** (approval): unchanged — anyone with the code asks, a manager approves (seeing the
  name, the verified email if any, account age, "no email on this account").
- **Personal link** (new, `mode = 'direct'`): for one person; single use; 24 h or 7 days; joins
  whoever redeems it first *while signed in*, as `member`. Redemption, membership, sprint seat
  and audit are one transaction keyed on a random redemption id, so racing people/tabs get exactly
  one winner (tested). It stops working if its creator can no longer invite into that scope.
- **Email invitations** (kept): the link still binds to the address. An account *without* an
  address confirms it with a code sent to the invited address, and keeps it as its verified email;
  if the address belongs to another account, the person is told to sign in there instead
  (no second identity). An account with a different address can't accept (asks for an invite link).

### Devices, sessions, sign-out
Add/rename/remove passkeys (removal needs a recent sign-in; the last passkey of an account without
email can't be removed). Sessions list with per-session sign-out and "Sign out everywhere else".
Sign-out revokes the server session, clears local drafts and queue, and takes the encryption key
out of memory in every tab. It **keeps** the device envelope, which can't be opened until the
person signs in again (ENCRYPTION.md §4), so signing back in unlocks without the recovery key.
"Also forget this device" (in the sign-out dialog, and Account → Encryption) removes that too, and
the server's half of it; passkeys stay in the person's password manager. Offline sign-out is
remembered and finished when back online, and — because the session can't be ended yet — also
forgets the device's envelope, with a warning when it's the only way to unlock.

## 4. Security model

- Passkeys are phishing-resistant. **An account with a recovery email is only as strong as that
  inbox**: whoever controls it can sign in with a code and add a passkey (after the recent-sign-in
  check, which the code satisfies). The Settings page says so.
- Step-up (10 minutes) guards adding/removing passkeys, adding/changing/removing the email,
  replacing encryption keys and the recovery key.
- Local storage holds only non-authoritative hints (a "used a passkey here" flag, a pending
  sign-out marker). No device id or fingerprint exists; possession of an invite link proves
  nothing about identity.
- Security events: ids and coarse labels only (never codes, tokens, raw WebAuthn responses,
  invitation tokens or content), 365 days.
- Anonymity is unchanged: names never appear with thoughts or votes; approvers see names (and an
  address only if the account has one), never content.

## 5. Losing access — the honest policy

- **Account with a recovery email:** sign in with a code ("Used Muni before?") and add a new
  passkey.
- **Account access is not content access.** A recovery email gets you back into the account, not
  into encrypted writing. On a device that never had the key, that needs a passkey that unlocks
  (PRF, provisioned earlier), a device that's still unlocked, or the recovery key. The UI says so
  after an email sign-in or when a passkey added then can only sign in.
- **Account with no email and no remaining passkey:** **the account cannot be recovered.** Muni
  has nothing it can use to tell it's you, and there is no support or operator reset — any such
  shortcut would let anyone who can convince the operator take over an account. What remains:
  the team can invite a new account; thoughts already shared stay in their sprints, without a
  name; encrypted content sealed only to the old account's key is gone (the recovery key restores
  content keys on a device you can sign in on, not the account).
- Mitigations in the product: the "Keep a way back in" step after sign-up, a standing notice in
  Settings while an account has fewer than two passkeys and no email, the extra warning when
  removing the email with one passkey, and the server refusing to remove the last way in.

## 6. Data model and migrations

- `0004_passkeys_and_join.sql` (earlier): credentials, challenges, session details, security
  events, join links/requests.
- `0005_passkey_first.sql`:
  - `account_emails(account_id PK, email UNIQUE, verified_at)`, backfilled from every existing
    account (all were verified by code).
  - `accounts` is **not rebuilt**: making `accounts.email` nullable would need a table rebuild, and
    dropping a parent table in D1 runs an implicit `DELETE` whose `ON DELETE CASCADE` actions would
    wipe memberships, sessions and keys (deferring constraints doesn't stop cascade *actions*).
    `accounts.email` becomes a legacy column nothing reads: new accounts store `'@' || id` (unique,
    never a valid address); a changed or removed address is scrubbed the same way. Existing rows
    keep their address there so a rollback still works.
  - `verification_challenges.purpose` (`signin` / `add_email` / `invite`) and `.account_id`.
  - `webauthn_challenges` rebuilt (ephemeral, unreferenced) to add the `signup` ceremony and the
    pending account's handle and name; in-flight ceremonies at deploy time just retry.
  - `join_links.mode` (`approval` / `direct`), `redeemed_by`, `redemption_id`;
    `join_requests.decision_nonce` (fixes a same-millisecond double-decision audit race).
- Verified on legacy-shaped data in a local D1 (accounts, memberships, sessions, keys, sprint
  participants, invitations survive; emails backfilled; `PRAGMA foreign_key_check` clean).

## 7. Which flows still send email

| Flow | Sent to | When |
| --- | --- | --- |
| Sign-in code | an address typed on "Used Muni before?" | every request, account or not (so it doesn't reveal accounts) |
| Confirmation code | an address being added in Settings, or the invited address when accepting an email invitation | on request |
| Team invitation | the address a manager enters in "Invite by email" | when sent |
| Sprint reminders (midpoint, day before) | participants **who have an address** and haven't opted out | scheduled per sprint |

Passkey-only accounts receive nothing. Nothing else sends email. **Removing email later is
feasible**: invitations already work without it (team QR, personal links); reminders could move
to in-app/PWA notifications; the sign-in/confirmation codes exist only for accounts that keep an
address. The real cost is recovery — without email, losing every passkey loses the account — so
removing email entirely means accepting that policy for everyone (or adding another *standard*
recovery factor, not a custom one). Removing `accounts.email` physically needs a careful,
cascade-aware rebuild (§6).

## 8. Tests

Automated (2026-09-27, all passing):

- Worker, in workerd (`pnpm test`, 154): `passkey-first.test.ts` (16: sign-up without email,
  replay/concurrency → one account, reused credential, ceremony checks, caps, codes never create
  accounts, add/verify/change/remove email with step-up and account-bound codes, address on another
  account, last-way-in guards, email invitations confirmed by code, address owned by another
  account, personal links — single use, races, creator authority — no email to approvers, reminders
  skip passkey-only accounts); `passkeys.test.ts` (19); `join.test.ts` (13); `entrance.test.ts`
  (email path for existing accounts only); plus every earlier suite. Mutation checks: disabling the
  last-way-in guard or the code's account binding fails these tests.
- Browser (`web/e2e/passkeys.mjs`, 28, headless Chromium + CDP virtual authenticator over HTTPS;
  desktop 1280×800 and mobile 390×844 emulation): the entrance (one action, no email field,
  nothing auto-starts, help text), creating an account, the recovery nudge with an email, sign-out
  then return, cancel, Settings email removal and last-passkey guard, a synced passkey signing in
  on a second device, draft kept through a session ending, the legacy email → passkey migration,
  an unsupported browser, team QR with approval, personal link (single use), email invitation
  confirmed by code, sign-out/sessions with pre-prefix cookies and offline sign-out. Screenshots in
  `web/e2e-artifacts/passkeys/`.
- Existing browser suites still pass: entrance 34, capture 26, offline 29, encryption 17.

Passkey-unlocked encryption (2026-09-27): worker `unlock.test.ts` (12) and `encryption.test.ts`
(+1, author binding); web `keyring.test.ts` (34), `wrap.test.ts` (5), `passkeys.test.ts` (2); and
`web/e2e/unlock.mjs` (27: with and without the virtual authenticator's PRF — new account writes
without setup, sign out → sign in reads old thoughts and sends new ones with no banner, reload,
cleared storage → one passkey confirmation, cleared storage and cookies → passkey sign-in, no-PRF
cleared storage honestly locked, two tabs, no secrets or PRF output in any request, an older
build's plaintext key migrated). Run against `wrangler dev` over plain `http://localhost`
(WebAuthn allows it); the `__Host-` legacy-cookie check in `passkeys.mjs` needs HTTPS and wasn't
re-run over it.

**Not verified here:** whether real authenticators return PRF at registration or only at
sign-in (both paths are handled), and PRF itself on every platform below — including iOS 18+
Safari with iCloud Keychain, the installed iOS app (separate storage from Safari: it's its own
device and unlocks with the passkey, or asks once), Google Password Manager, Windows Hello,
1Password/Bitwarden, security keys (hmac-secret), and PRF over the cross-device (QR/hybrid) flow;
Safari's 7-day storage eviction (expected: one passkey confirmation). Also: Safari/iOS and macOS iCloud Keychain, Android/Google Password Manager,
Windows Hello, Firefox, third-party password managers, security keys, the browser's real
cross-device (QR/hybrid) flow, installed-PWA mode on iOS/Android (the iOS home-screen app may keep
cookies separate from Safari, so someone who joins in Safari signs in again in the app — with a
passkey that's one tap), camera scanning of the QR. Suggested matrix: {iPhone Safari, iPhone
installed app, Android Chrome, Android installed app, macOS Safari/Chrome, Windows Chrome/Edge,
Firefox} × {create account, sign in, sign in via phone QR, cancel, sign out then switch account,
add email, legacy email → passkey, scan team QR, open personal link, **writing unlocks after sign
out → sign in, unlocks after clearing site data (PRF), add a second passkey and unlock with it on
another device, forget this device**}.

## 9. Rollout and rollback

Rollout (done 2026-09-27 for 0005): take a D1 Time Travel bookmark, `pnpm migrate:remote`
(additive plus the challenge-table rebuild), deploy Worker + web together. Existing sessions stay
valid; email-only accounts keep signing in by code and are offered a passkey.

Rollback options, least to most drastic:

1. **Roll the Worker back** (`wrangler rollback`). Schema stays; the previous Worker reads
   `accounts.email`. Email-only accounts that never changed their address work as before. Accounts
   created with a passkey show a placeholder address and get no working email features; addresses
   added or changed in Settings are invisible to the old Worker until copied back:
   ```sql
   UPDATE accounts SET email = (SELECT e.email FROM account_emails e WHERE e.account_id = accounts.id)
    WHERE id IN (SELECT account_id FROM account_emails);
   ```
   (safe: `account_emails.email` is unique, and scrubbed legacy values are placeholders).
   Personal links and passkey sign-up stop working; nothing is lost.
2. **Restore D1 to the pre-migration bookmark** (`wrangler d1 time-travel restore`): loses every
   write since — only for a broken migration, never for a routine rollback.

## 10. Remaining risks and review requirements

- Recovery-email inboxes remain the weakest entry point for accounts that keep one.
- Passkey-only sign-up is cheap: rate limits, team-QR approval and personal-link single use are
  the controls; watch `account.created` volumes.
- Approvers can approve the wrong person; the UI shows what's verifiable and says a name proves nothing.
- `@simplewebauthn/server` on Workers is upstream-unofficial: re-run the suites on upgrades.
- Needs the real-device matrix and an independent security review.

## Related fixes (earlier the same day)

- Sign-out and "Sign out everywhere else" failing for browsers holding a pre-`__Host-` CSRF
  cookie (the client now reads only `__Host-muni_csrf` over HTTPS; the Worker expires the stale
  cookies; sign-out is idempotent with an honest offline path).
- The box around the moon on the Write page (a `clip-path` narrower than the halo).
