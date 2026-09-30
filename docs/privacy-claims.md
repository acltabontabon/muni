# Privacy claims

Every public statement Muni makes about privacy, and what backs it. For maintainers: change a claim and its evidence together, and remove a claim if its evidence goes away.

The full explanation has one home, the Privacy page (`web/src/routes/Privacy.tsx`, at `/privacy`). Elsewhere the app states only what matters at a decision point: the close-collection confirmation (`web/src/lib/lifecycle.ts`), opening collection and the encryption switch in sprint setup (`web/src/routes/SprintSetup.tsx`), the downloads line in the recap (`web/src/routes/Outcomes.tsx`), and the note on a sprint set up without encryption (`EncryptionLine` in `web/src/ui/keys.tsx`, which links to the Privacy page). Recovery and key-change instructions in Account (`web/src/ui/security.tsx`, `keys.tsx`) are instructions, not claims. The marketing site section is in `site/index.html`. Release notes (`CHANGELOG.md`) repeat only claims listed here.

Last checked 2026-10-01, against `main` at 1.0.0-rc.2.

**Kinds of evidence**

- **Test**: enforced by a named automated test.
- **Code**: true by construction; checked by reading the named code.
- **Config**: depends on deployment settings. Re-check after any config change.
- **Provider**: stated by a provider's documentation, not observed by us.
- **Commitment**: a policy the operator keeps. Nothing technical enforces it.

Test names below are in quotes; most are in `worker/test/` (server) or `web/src/lib/` (client).

## Visibility and authorship

| Claim | Kind | Evidence |
| --- | --- | --- |
| While collecting, nobody else (facilitator and owners included) can see a thought, a count, or a sign that someone wrote | Test | `privacy.test.ts` "seals entries during collection, even for the facilitator" (listing, themes, exports return 409; `entry_count` null; no socket hint) |
| Only the sprint's facilitator can close collection, with confirmation | Test | `privacy.test.ts` "lets only the sprint's facilitator close collection"; `lifecycle.test.ts` (confirmation required) |
| You can edit or delete a thought until close; after close nobody can, including you | Test | `entries.test.ts` "lets only the author edit or delete, and only while collecting"; no other route writes `entries` text |
| After close, participants see all thoughts at once, in random order, with category, impact, might-help and period | Test + Code | `privacy.test.ts` "shared representations…" (random `reveal_order`); `SHARED_SELECT` in `routes/entries.ts` |
| Shared thoughts carry no name, email, timestamp or linking id (screen, stage, exports, socket); in an encrypted sprint, not in the envelope either | Test | `privacy.test.ts` "shared representations carry no authorship anywhere"; `encryption.test.ts` (revealed responses and envelopes contain no account id) |
| Owners who are not participants cannot read a sprint's thoughts | Test | `boundaries.test.ts` "an owner who doesn't facilitate…" (entries, themes, raw export return 403) |
| Muni has no way to look up who wrote a thought | Test | `privacy.test.ts` "offers no author lookup route" |
| Raw download is facilitator-only; participants get a summary; files carry no authors, times or individual votes (only vote totals and experiment owners' names, as on screen) | Test + Code | `privacy.test.ts` (raw export 403 for members; no emails or dates in files); `routes/exports.ts`, `lib/e2ee/local-export.ts` |
| Votes are private; totals appear only after a round closes | Test | `privacy.test.ts` "keeps votes private…"; `voting.test.ts` |
| The facilitator sees how many have voted while a vote is open, never who or for what; nobody else sees it | Test | `socket.test.ts` "tells the facilitator how many have voted" |
| What is added to a discussion appears without names, on release | Test | `meeting.test.ts` "collects context privately and reveals it under the theme only on release" |
| Check-in answers are private until shared: your own to you, a count (not who) to the facilitator, nothing to anyone else, in responses and live hints | Test | `checkins.test.ts` "keeps answers private until shared…", "tells only the facilitator and your own tabs that you answered" |
| Shared check-in results are counts and lines with no account, time or order of answering; answers after sharing are refused | Test | `checkins.test.ts` "shares counts and lines without anything that identifies who…" |
| An answer counts once and belongs to its check-in, never to whatever topic is on screen | Test | `checkins.test.ts` "ties an answer to its check-in…" |
| Nobody is called on to speak | Code | No speaking round exists (`room.ts`); `meeting.test.ts` "marks who is here…" (no speaking or readiness in the snapshot) |
| The facilitator's stage shows who has the retro open (faces beside names) and nothing about what they are doing; nobody else's view says who is connected | Test | `socket.test.ts` "shows the facilitator, live, who has the retro open…", "…only the facilitator sees who's connected" |
| Names appear only for members, participants, attendance and experiment owners | Code | `routes/meeting.ts` `snapshot()`; `routes/sprints.ts` `detail()` |
| Pending invitations and their addresses are shown only to workspace owners; nobody else can learn whether an address belongs to a member | Test | `grants.test.ts` "is for owners…", "tells nobody but owners whether an address is a member's" |
| Your character is your face beside your name in the retro and on nothing anonymous (thoughts, votes, answers, additions, exports); whether your own pages wear its world is yours alone | Test | `avatars.test.ts` "shows as a face next to its person's name in the retro, and nowhere else"; only `buildMe` and the meeting's attendance select `avatar_id` |
| Reopening keeps what people already saw visible | Code | `routes/sprints.ts` `preparing>collecting` (confirmation message) |
| Authorship can still be inferred (wording, small teams, lone votes, a lone check-in answer, the moment something is added, reopening) | none | Stated limitation. The Privacy page names these |

## Operator, providers, logs

| Claim | Kind | Evidence |
| --- | --- | --- |
| The database records who wrote each thought. The operator or Cloudflare can link thoughts to accounts, and can read the content of sprints set up without encryption | Code | `entries.author_account_id`, `votes.account_id`, `context_additions.author_account_id`, `checkin_responses.account_id` (migrations); `sprints.encryption IS NULL` for sprints set up without encryption |
| The operator accesses data only to run or secure Muni, handle abuse, or act on a user's request | Commitment | Not enforced. **Muni keeps no record of operator access**, and the Privacy page says so |
| Cloudflare hosts the app, database and live connection. Request logs are kept up to 7 days with URL and headers (IP, browser) | Provider + Config | Workers Logs docs (3 days Free, 7 Paid); `observability` enabled at sampling rate 1 in `worker/wrangler*.jsonc`. Not inspected on the live dashboard |
| URLs contain only ids, never text or email addresses | Code + Test | Tokens travel in fragments and bodies (`boundaries.test.ts` "keeps invitation tokens out of URLs…"); no client route puts an email or text in a query string |
| Muni's own logging records failures only (path, method, short error), with no text or email | Test | `privacy.test.ts` "writes no entry text or email address to the log" (spies on `console.*` across a full flow, including a provoked 500) |
| The email provider receives the address and an invitation (workspace, inviter name, link) or a reminder (sprint name, link); never a thought | Code + Config | `lib/email.ts` templates (the only two); the hosted service uses Resend (`EMAIL_PROVIDER` in the production config; Brevo is also supported) |
| munimuni.app is on GitHub Pages behind Cloudflare, with Google Fonts | Config | `.github/workflows/pages.yml`; live response headers (`server: cloudflare`, `x-github-request-id`); font link in `site/index.html` |
| No analytics, ads, session recording or error reporting; the app cannot load code from or send data to other sites | Code + Config | No such dependency (`web/package.json`); CSP in `web/public/_headers` (`script-src 'self'; connect-src 'self'`), confirmed on the live app shell |
| No IP address or user agent is stored with an account. Sessions and unlockable devices keep only a rough label ("Safari on iPhone"). Rate-limit buckets hold SHA-256 hashes | Code + Test | `sessions.client_label` (`lib/auth.ts`), `device_unlocks.label` (`routes/keys.ts`); no IP or user-agent columns; `boundaries.test.ts` "stores no plaintext address or network…" |
| Muni does not sell personal data, use contributions for advertising, or add emails to marketing lists | Commitment | No advertising or marketing integration exists in code; the only emails are the two templates |
| Muni has no AI features; no thought is sent to an AI provider; Muni does not train models on contributions | Code + Config | No AI provider, model, inference or training code in `worker/` or `web/`; CSP `connect-src 'self'` |

## Sign-in and stored data

| Claim | Kind | Evidence |
| --- | --- | --- |
| Passkeys are the only way in: no email sign-in, codes, password or recovery email | Code + Test | No such route; a session authenticates only with `auth_method = 'passkey'` (`lib/auth.ts`); `passkeys-only.test.ts` (sign-up with only a name; an address never signs in); `web/e2e/entrance.mjs`, `passkeys.mjs` |
| Email addresses (only for accounts invited by email) are stored readable; session tokens only as hashes | Code | `account_emails.email` is plain; `sessions.token_hash` (`lib/auth.ts`); `accounts.account_ref` holds the account's own id, never an address |
| HTTPS in transit | Config | Custom domain on Cloudflare; HSTS in `web/public/_headers` (live) |
| Stored data is encrypted at rest with AES-256, using Cloudflare-managed keys | Provider | D1 and Durable Objects data-security docs |

## Encrypted sprints

Design and formats: [encryption.md](encryption.md).

| Claim | Kind | Evidence |
| --- | --- | --- |
| Sprints are encrypted by default; the facilitator can turn it off at setup | Code | `SprintSetup.tsx` (`encrypt: true`); `web/e2e/encryption.mjs` "Encryption is on by default" |
| Sprints set up without encryption are not encrypted at the application level. The server can read their thoughts, and each says so | Code | `sprints.encryption` is null for them; `lib/sealed.ts` accepts plaintext only there; `EncryptionLine` in `ui/keys.tsx` |
| In an encrypted sprint, thoughts, additions, check-in lines, themes, notes, experiments, recap, opening question and vote-reset reasons are encrypted in the browser before upload | Test | `encryption.test.ts` (plaintext refused for each; envelopes stored); `web/e2e/encryption.mjs` (captured request bodies contain no text, including a check-in line and an addition) |
| The server refuses plaintext for encrypted sprints | Test | `encryption.test.ts` (`encryption_required`); `lib/sealed.ts` |
| Muni's servers hold no key that opens that content | Test + Code | `encryption.test.ts` scans every D1 table and the room's storage for synthetic text, private keys and sprint secrets; the Worker imports no content cryptography (`grep -rn noble worker/src` is empty; `lib/sealed.ts` only checks envelope format) |
| A revealed thought's envelope names no author, and two thoughts by one person share nothing that links them | Test | `crypto.test.ts` "say nothing about who wrote them…"; `encryption.test.ts` (an envelope that names anyone is refused by the Worker and by database triggers) |
| A thought is never sent in plaintext on a guess: queued thoughts go unsealed only for a sprint known to be set up without encryption | Test | `outbox.test.ts` "without a sealer…", "sends nothing for a thought it can't seal…" |
| While collecting, only the facilitator's devices hold the revealing key; other participants cannot decrypt early | Test | `encryption.test.ts` "…follow the sealing policy through reveal" (no wraps for participants; early wraps refused) |
| The facilitator is not given thoughts before close. This is a server rule, not cryptography | Test | `privacy.test.ts` (sealing tests); stated as a limitation on the Privacy page |
| Signing in with a passkey (PRF) unlocks your writing; its PRF output never reaches Muni | Test | `keyring.test.ts`, `web/src/lib/passkeys.test.ts`, `unlock.test.ts` (PRF results refused, D1 scan); `web/e2e/unlock.mjs` (captured bodies) |
| A passkey that only signs in does not unlock content on a device that did not have it, nor on a device bound before it existed. A passkey that unlocks, or the recovery key, does | Test | `encryption.test.ts` "recovery…"; `unlock.test.ts` release rule; `web/e2e/encryption.mjs` new-device steps |
| The server holds the account key only locked: per passkey (PRF wrap), by an optional recovery key, and per device by a share that opens nothing alone. Muni cannot recover a lost key | Code + Test | `routes/keys.ts` (stores `p1.` wraps, the recovery blob and `device_unlocks` shares); `unlock.test.ts` D1 scan |
| Signing out leaves the device able to unlock only after signing in again; no plaintext key is stored | Test | `keyring.test.ts` (signing out and back in; "what stays on the device"); `web/e2e/unlock.mjs` |
| "Forget this device" also removes the device envelope and the server's share; signing out keeps them | Test + Code | `keyring.test.ts` "what stays on the device"; `LeaveDialog forget` in `ui/menus.tsx`; [encryption.md](encryption.md) section 4 |
| Devices will not share a key with a teammate whose key changed until confirmed | Test | `keyring.test.ts` "pins teammates' keys on first use…" |
| Exports and recap drafts for encrypted sprints are made in the browser | Test + Code | `encryption.test.ts` (server export returns 409; a recap saved without its text returns 400); `routes/commitments.ts`; `lib/e2ee/local-export.ts` |
| Names, goal, dates, people, categories, authorship, timing and counts stay readable | Code | [encryption.md](encryption.md) section 2; `routes/*` store these as plain columns |
| Muni's encryption depends on the genuine app being delivered, and is not independently audited | none | Stated limitation |

## On this device

| Claim | Kind | Evidence |
| --- | --- | --- |
| "Keep drafts on this device" is off by default, per account, per browser | Test | `web/src/lib/prefs.test.ts`; `e2e/offline.mjs` |
| Off: drafts and the queue live only in the tab | Code | `memoryStore()` in `lib/local/store.ts` |
| On: draft, queue, sprint names, retro times, name and workspaces are stored in IndexedDB | Code | `deviceStore()`; `ContextSprint`, `Identity` types |
| The session is never in browser storage; it is an HttpOnly cookie | Code + Test | `lib/auth.ts` `cookie()`; `boundaries.test.ts` cookie attributes |
| No one else's thoughts are on the device; the service worker never caches `/api` | Code + Test | `sw.ts`; `e2e/offline.mjs` (another account never sees the first's queue) |
| Sign out and Clear local data remove this account's records, warn about unsent work, and delete nothing on the server | Code + Test | `LeaveDialog` in `ui/menus.tsx`; `prefs.test.ts` sign-out cleanup |
| Offline copies cannot be erased remotely | none | Stated limitation |

## Retention and deletion

| Claim | Kind | Evidence |
| --- | --- | --- |
| About 90 days after finishing (owners can set 7 to 3,650), raw content is deleted; outcomes are kept 730 days (30 to 3,650); the sprint's name and dates remain | Test | `retention.test.ts`; `jobs.ts` `retention()` (a daily sweep, hence "about") |
| Unfinished sprints are never purged, neither content nor outcomes | Test | `retention.test.ts` "never deletes the outcomes of a sprint that isn't finished…"; `retention()` selects only `completed` and `archived` sprints. **Open policy decision** |
| A thought deleted while collecting is removed from the live database; backups keep it up to 30 days | Code | `DELETE FROM entries` in `routes/entries.ts` |
| An account and its email are kept while the account exists. Deleting it removes them, unseen contributions and sole workspaces, and unlinks the rest | Test | `departure.test.ts` (no row names the account afterwards; "leaves no room with anything that names them…"); `lib/departure.ts` |
| Members can leave a workspace; what they submitted stays, without their name | Test | `departure.test.ts` |
| Passkey challenges are deleted about a day after expiry; sessions last 30 days and are deleted 7 days after ending; rate-limit rows last 24 hours; an email job's payload is cleared when sent; invitations (with their address) are deleted 30 days after use, withdrawal or expiry; security history is kept 365 days; a retro's room record goes with its content | Test + Code | `jobs.ts` `retention()`; `SESSION_TTL_DAYS` default in `lib/config.ts`; `boundaries.test.ts` "keeps a queued email until it's sent…"; `retention.test.ts` "keeps an invitation's address for 30 days…", "takes the room's record of the retro with the content" |
| The admin action log is kept 400 days and holds no text | Test | `AUDIT_RETENTION_DAYS` and `pruneAudit` in `jobs.ts`; `retention.test.ts` |
| Backups are kept up to 30 days, logs up to 7 | Provider + Config | D1 Time Travel docs (7 Free, 30 Paid); Workers Logs docs. The hosted plan is not recorded, so the Privacy page states the upper bounds |

## Unresolved

These prevent stronger wording.

- There is no personal data export, and no way to delete a workspace others are still in.
- Sprints that are never finished are never purged.
- Muni does not log operator access to the database. Any claim of audited access needs that first.
- The Cloudflare plan (Free or Paid) decides the log and backup windows. Record it to state exact numbers.
- Workers Logs' redaction of cookies has not been observed on the live dashboard.
