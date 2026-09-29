# Privacy claims checklist

Every public statement about privacy, and what backs it. The explanation has one home:
`web/src/routes/Privacy.tsx` (act.munimuni.app/privacy, reached from Account & settings, About and the
sign-in). Elsewhere the app only states what matters at a decision point, in a line, and links there:
the close-collection confirmation (`web/src/lib/lifecycle.ts`), opening collection and the encryption
switch in sprint setup (`web/src/routes/SprintSetup.tsx`), the downloads line on Outcomes, and the note
on a sprint set up without encryption (`EncryptionLine` in `web/src/ui/keys.tsx`). Recovery and key-change
instructions in Account (`web/src/ui/security.tsx`, `keys.tsx`) are instructions, not claims. The
marketing site's section is `site/index.html`; release notes (`CHANGELOG.md`) repeat only claims listed
here. Change a claim and its evidence together; if the evidence goes away, the claim goes too.

Kinds of evidence:

- **Test** — enforced by an automated test (named).
- **Code** — true by construction; checked by reading the code (named), no dedicated test.
- **Config** — depends on deployment settings, not code. Re-check after any config change.
- **Provider** — stated by a provider's documentation, not observed by us.
- **Commitment** — a policy the operator keeps. Nothing technical enforces it.

Last checked 2026-09-29, against `main` at 1.0.0-rc.1.

## Visibility and authorship

| Claim | Kind | Evidence |
| --- | --- | --- |
| While collecting, nobody else — facilitator and owners included — can see a thought, a count, or a sign that someone wrote | Test | `privacy.test.ts` “seals entries during collection, even for the facilitator” (listing, themes, exports → 409; `entry_count` null; no socket hint) |
| Only the sprint's facilitator can close collection, with confirmation | Test | `privacy.test.ts` “lets only the sprint’s facilitator close collection”; `lifecycle.test.ts` (confirm required) |
| You can edit/delete until close; after close nobody can, including you | Test | `entries.test.ts` “lets only the author edit or delete, and only while collecting”; no other route writes `entries` text (`grep "UPDATE entries"`) |
| After close, the sprint's participants see all thoughts at once, in random order, with category/impact/might-help/period | Test + Code | `privacy.test.ts` “shared representations…” (random `reveal_order`); `SHARED_SELECT` in `routes/entries.ts` |
| Shared thoughts carry no name, email, timestamp, or linking id (screen, stage, exports, socket) — in an encrypted sprint, not in the envelope either | Test | `privacy.test.ts` “shared representations carry no authorship anywhere”; `encryption.test.ts` (revealed responses and their envelopes contain no account id) |
| Owners who aren't participants can't read a sprint's thoughts | Test | `boundaries.test.ts` “an owner who doesn’t facilitate…” (entries, themes, raw export → 403) |
| No way in Muni to look up who wrote a thought | Test | `privacy.test.ts` “offers no author lookup route” |
| Raw download is facilitator-only; participants get a summary; files carry no authors, times or individual votes (vote totals and experiment owners' names, as on screen) | Test + Code | `privacy.test.ts` (raw export 403 for members; no emails or dates in files); `routes/exports.ts`, `lib/e2ee/local-export.ts` (owners and totals only) |
| Votes are private; totals only after a round closes | Test | `privacy.test.ts` “keeps votes private…”; `voting.test.ts` |
| What's added to a discussion appears without names, on release | Test | `meeting.test.ts` “collects context privately and reveals it under the theme only on release” |
| Check-in answers are private until shared: your own to you, a count (not who) to the facilitator, nothing to anyone else — in responses and in live hints | Test | `checkins.test.ts` “keeps answers private until shared…”, “tells only the facilitator and your own tabs that you answered” |
| Shared check-in results are counts and lines, with no account, time or order of answering; answers after sharing are refused | Test | `checkins.test.ts` “shares counts and lines without anything that identifies who…” |
| An answer counts once and belongs to its check-in, never to whatever topic is on screen | Test | `checkins.test.ts` “ties an answer to its check-in…” (primary key; cross-sprint 404) |
| Nobody is called on to speak | Code | No speaking round exists (`room.ts`); `meeting.test.ts` “marks who is here…” (no `speaking` or readiness in the snapshot) |
| Where names do appear: members, participants, attendance, experiment owners | Code | `routes/meeting.ts` `snapshot()`; `routes/sprints.ts` `detail()` |
| Your character is your face beside your name in the retro, and on nothing anonymous (thoughts, votes, answers, additions, exports); whether your own pages wear its world is yours alone | Test | `avatars.test.ts` “shows as a face next to its person’s name in the retro, and nowhere else”; only `buildMe` and the meeting's attendance select `avatar_id` |
| Reopening keeps what people saw visible | Code | `routes/sprints.ts` `preparing>collecting` (confirmation message) |
| Authorship can still be inferred (wording, small teams, lone votes, a lone check-in answer, the moment something is added, reopen) | — | Stated limitation; the Privacy page names these; see security review §4 |

## Operator, providers, logs

| Claim | Kind | Evidence |
| --- | --- | --- |
| The database records who wrote each thought; the operator or Cloudflare can link thoughts to accounts, and can read the content of sprints set up without encryption | Code | `entries.author_account_id`, `votes.account_id`, `context_additions.author_account_id`, `checkin_responses.account_id` (migrations); `sprints.encryption IS NULL` for sprints set up without encryption |
| Operator accesses data only for running/securing Muni, abuse, or a user's request | Commitment | Not enforced; **no record of operator access is kept** — the page says so |
| Owners can't read sprints they aren't in or learn authorship | Test | as above (boundaries, no author lookup) |
| Cloudflare hosts app, database, live connection; request logs ≤ 7 days with URL, headers (IP, browser) | Provider + Config | Workers Logs docs (3 days Free / 7 Paid; invocation logs include request metadata and headers); `observability` on at sampling 1 in the production config. Not inspected on the live dashboard |
| URLs contain only ids, never text or email addresses | Code + Test | Tokens in fragments/bodies (`boundaries.test.ts` “keeps invitation tokens out of URLs…”); no client route puts an email or text in a query string |
| Muni's own logging records failures only: path, method, short error; no text or email | Test | `privacy.test.ts` “writes no entry text or email address to the log” (spies on `console.*` across a full flow, including a provoked 500) |
| Resend receives the address and an invitation (workspace, inviter name, link) or a reminder (sprint name, link); never a thought | Code + Config | `lib/email.ts` templates (the only two); `EMAIL_PROVIDER=resend` in the production config |
| munimuni.app is on GitHub Pages behind Cloudflare, with Google Fonts | Config | `.github/workflows/pages.yml`; live response headers (`server: cloudflare`, `x-github-request-id`); `site/index.html` font link |
| No analytics, ads, session recording or error reporting; the app can't load code from or send data to other sites | Code + Config | No such dependency (`web/package.json`); CSP in `web/public/_headers` (`script-src 'self'; connect-src 'self'`), confirmed on the live app shell |
| No IP address or user agent stored with an account; sessions and unlockable devices keep only a rough label (“Safari on iPhone”) | Code + Test | `sessions.client_label` (`lib/auth.ts`), `device_unlocks.label` (`routes/keys.ts`); no IP or user-agent columns; rate-limit buckets hold SHA-256 hashes (`boundaries.test.ts` “stores no plaintext address or network…”) |
| We don't sell personal data; contributions not used for advertising; emails not added to marketing lists | Commitment | No advertising or marketing integration exists in code; the only emails are the two templates |

## AI

| Claim | Kind | Evidence |
| --- | --- | --- |
| Muni has no AI features; no thought is sent to an AI provider | Code + Config | No AI provider, model or inference code in `worker/` or `web/`; CSP `connect-src 'self'` |
| Muni doesn't train AI models on contributions | Code | No training pipeline or data export for training exists |

## Encryption

| Claim | Kind | Evidence |
| --- | --- | --- |
| HTTPS in transit | Config | Custom domain on Cloudflare; HSTS in `_headers` (live) |
| Stored data encrypted at rest with AES-256, Cloudflare-managed keys | Provider | D1 and Durable Objects data-security docs |
| Sprints set up without encryption aren't encrypted at the application level; the server can read their thoughts, and each says so. Every other sprint: see *Encryption (encrypted sprints)* below | Code | `sprints.encryption` is null for them; `lib/sealed.ts` accepts plaintext only there; `EncryptionLine` in `ui/keys.tsx` |
| Email addresses (only accounts invited by email) stored readable; session tokens only as hashes | Code | `account_emails.email` plain; `sessions.token_hash` (`lib/auth.ts`); `accounts.account_ref` holds the account's own id (unique; nothing reads it), never an address |
| Passkeys are the only way in: no email sign-in, codes, password or recovery email | Code + Test | No such route; a session authenticates only with `auth_method = 'passkey'` (`lib/auth.ts`); `passkeys-only.test.ts` (sign-up with only a name; an address never signs in); `web/e2e/entrance.mjs`, `passkeys.mjs` |

## Device

| Claim | Kind | Evidence |
| --- | --- | --- |
| "Keep drafts on this device" is off by default, per account, per browser | Test | `web/src/lib/prefs.test.ts`; `e2e/offline.mjs` |
| Off: drafts and queue live only in the tab | Code | `memoryStore()` in `lib/local/store.ts` |
| On: draft, queue, sprint names/retro times, name and workspaces stored in IndexedDB | Code | `deviceStore()`; `ContextSprint`, `Identity` types |
| Session never in browser storage; HttpOnly cookie | Code + Test | `lib/auth.ts` `cookie()`; `boundaries.test.ts` cookie attributes |
| No one else's thoughts on the device; service worker never caches `/api` | Code + Test | `sw.ts`; `e2e/offline.mjs` (another account never sees the first's queue) |
| Sign out / Clear local data remove this account's records, warn about unsent work, delete nothing on the server | Code + Test | `LeaveDialog` in `ui/menus.tsx`; `prefs.test.ts` sign-out cleanup |
| Offline copies can't be erased remotely | — | Stated limitation |

## Retention

| Claim | Kind | Evidence |
| --- | --- | --- |
| About 90 days after finishing (7–3,650, set by owners), raw content is deleted; outcomes 730 days (30–3,650); sprint name and dates remain | Test | `retention.test.ts`; `jobs.ts` `retention()` (daily sweep, so "about") |
| Unfinished sprints aren't purged | Code | `retention()` only selects `completed`/`archived` — **open policy decision** |
| A thought deleted while collecting is removed from the live database (backups keep it ≤ 30 days) | Code | `DELETE FROM entries` in `routes/entries.ts` |
| Account and email kept while the account exists; deleting it removes them, unseen contributions and sole workspaces, and unlinks the rest | Test | `departure.test.ts` (no row names the account afterwards); `lib/departure.ts` |
| Members can leave a workspace; what they submitted stays, without their name | Test | `departure.test.ts` |
| The facilitator sees how many have voted while a vote is open — never who or for what; nobody else sees it | Test | `socket.test.ts` “tells the facilitator how many have voted”; `voting.ts` `roundView` |
| The retro shows who's connected (faces beside names), and nothing about what they're doing | Test | `socket.test.ts` “who is connected”; `meeting.ts` attendance `connected` |
| A person's character appears beside their name in the retro and on nothing anonymous | Test | `avatars.test.ts` |
| Passkey challenges deleted ~1 day after expiry; sessions 30 days, deleted 7 days after ending; hashed limiter rows 24 h; email queue payload cleared when sent | Test + Code | `jobs.ts` `retention()`; `boundaries.test.ts` “keeps a queued email until it’s sent…” |
| Admin action log kept indefinitely (no text) | Code | `audit_events` never deleted — **open policy decision** |
| Backups ≤ 30 days, logs ≤ 7 days | Provider + Config | D1 Time Travel docs (7 Free / 30 Paid); Workers Logs docs. The hosted service's plan (Free or Paid) isn't recorded, so the page states the upper bounds |

## Unresolved (prevents stronger wording)

- No personal data export, and no way to delete a workspace others are still in.
- No purge for sprints that are never finished; `audit_events` kept forever.
- Operator access to the database isn't logged by Muni; any claim of audited access needs that first.
- The Cloudflare plan (Free/Paid) decides the log and backup windows; record it to state exact numbers.
- Log redaction of cookies in Workers Logs hasn't been observed on the live dashboard.

## Encryption (encrypted sprints)

| Claim | Kind | Evidence |
| --- | --- | --- |
| Sprints are encrypted by default; the facilitator can turn it off at setup | Code | `SprintSetup.tsx` (`encrypt: true`); `web/e2e/encryption.mjs` “Encryption is on by default” |
| Thoughts, what's added in the retro, check-in lines, themes, notes, experiments, recap, opening question and vote-reset reasons are encrypted in the browser before upload | Test | `worker/test/encryption.test.ts` (plaintext refused for each; envelopes stored); `web/e2e/encryption.mjs` (captured request bodies contain no text, including a check-in line and an addition) |
| Muni's servers don't hold keys that open that content | Test + Code | `encryption.test.ts` scans every D1 table and the room's storage for the synthetic text, private keys and sprint secrets; the Worker imports no content cryptography (`grep -rn noble worker/src` is empty; `lib/sealed.ts` only checks envelope format) |
| The server refuses plaintext for encrypted sprints | Test | `encryption.test.ts` (`encryption_required`), `lib/sealed.ts` |
| A revealed thought's envelope names no author, and two thoughts by one person share nothing that links them | Test | `crypto.test.ts` “say nothing about who wrote them…”; `encryption.test.ts` (an envelope that names anyone is refused by the Worker, and by the database's triggers) |
| A thought is never sent in plaintext on a guess: queued thoughts go unsealed only for a sprint known to be set up without encryption | Test | `outbox.test.ts` (“without a sealer…”, “sends nothing for a thought it can’t seal…”) |
| While collecting, the revealing key is held only by the facilitator's devices; other participants can't decrypt early | Test | `encryption.test.ts` “…follow the sealing policy through reveal” (no wraps for participants; early wraps refused) |
| The facilitator isn't given thoughts before close — server rule, not cryptography | Test | `privacy.test.ts` (sealing tests); stated as a limitation on the page |
| A passkey that only signs in doesn't unlock content on a device that didn't have it (nor a device bound before it existed); a passkey that unlocks, or the recovery key, does | Test | `encryption.test.ts` “recovery…”; `unlock.test.ts` release rule; `web/e2e/encryption.mjs` new-device steps |
| Signing in with a passkey (PRF) unlocks your writing; its PRF output never reaches Muni | Test | `keyring.test.ts`, `passkeys.test.ts` (web), `unlock.test.ts` (PRF results refused, D1 scan); `web/e2e/unlock.mjs` (captured bodies, PRF output compared) |
| Signing out keeps this device able to unlock only after signing in again; no plaintext key is stored | Test | `keyring.test.ts` (signing out and back in on a configured device), “what stays on the device”; `web/e2e/unlock.mjs` |
| “Forget this device” removes what lets this browser reopen your key (the device envelope and the server's share); signing out keeps it, openable only after signing in again | Test + Code | `keyring.test.ts` “what stays on the device”; `ui/menus.tsx` `LeaveDialog forget`; docs/ENCRYPTION.md §4 |
| The key is held by the server only locked: per passkey (PRF wrap), by an optional recovery key, and per device by a share that opens nothing alone | Code + Test | `routes/keys.ts` (stores `p1.` wraps, the recovery blob and `device_unlocks` shares it can't open); `unlock.test.ts` D1 scan |
| Muni can't recover a lost key | Code | Server holds only wraps it can't open (recovery blob, passkey wraps) and device shares that open nothing alone (`routes/keys.ts`) |
| Devices won't share a key with a teammate whose key changed until confirmed | Test | `keyring.test.ts` “pins teammates’ keys on first use…” |
| Encrypted sprints' exports and recap drafts are made in the browser | Test | `encryption.test.ts` (export, server recap → 409); `lib/e2ee/local-export.ts` |
| What stays readable: names, goal, dates, people, categories, authorship, timing, counts | Code | `docs/ENCRYPTION.md` §2; `routes/*` store these as plain columns |
| Depends on the genuine app being delivered; not audited | — | Stated limitation |
