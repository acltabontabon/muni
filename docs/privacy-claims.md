# Privacy claims checklist

Every public statement about privacy, and what backs it. The public wording lives in
`web/src/routes/Privacy.tsx` (the full page, act.munimuni.app/privacy), `site/index.html` (the
munimuni.app section), `web/src/ui/entrance.tsx` (sign-in), `web/src/ui/capture.tsx` (composer),
`web/src/routes/SprintHome.tsx` and `web/src/routes/Account.tsx`. Change a claim and its evidence
together; if the evidence goes away, the claim goes too.

Kinds of evidence:

- **Test** — enforced by an automated test (named).
- **Code** — true by construction; checked by reading the code (named), no dedicated test.
- **Config** — depends on deployment settings, not code. Re-check after any config change.
- **Provider** — stated by a provider's documentation, not observed by us.
- **Commitment** — a policy the operator keeps. Nothing technical enforces it.

Last checked 2026-09-28, against `main` plus the encryption changes (docs/ENCRYPTION.md).

## Visibility and authorship

| Claim | Kind | Evidence |
| --- | --- | --- |
| While collecting, nobody else — facilitator and owners included — can see a thought, a count, or a sign that someone wrote | Test | `privacy.test.ts` “seals entries during collection, even for the facilitator” (listing, themes, exports → 409; `entry_count` null; no socket hint) |
| Only the sprint's facilitator can close collection, with confirmation | Test | `privacy.test.ts` “lets only the sprint’s facilitator close collection”; `lifecycle.test.ts` (confirm required) |
| You can edit/delete until close; after close nobody can, including you | Test | `entries.test.ts` “lets only the author edit or delete, and only while collecting”; no other route writes `entries` text (`grep "UPDATE entries"`) |
| After close, the sprint's participants see all thoughts at once, in random order, with category/impact/might-help/period | Test + Code | `privacy.test.ts` “shared representations…” (random `reveal_order`); `SHARED_SELECT` in `routes/entries.ts` |
| Shared thoughts carry no name, email, timestamp, or linking id (screen, stage, exports, socket) | Test | `privacy.test.ts` “shared representations carry no authorship anywhere” |
| Owners who aren't participants can't read a sprint's thoughts | Test | `boundaries.test.ts` “an owner who doesn’t facilitate…” (entries, themes, raw export → 403) |
| No way in Muni to look up who wrote a thought | Test | `privacy.test.ts` “offers no author lookup route” |
| Raw download is facilitator-only; participants get a summary; files carry no names | Test | `privacy.test.ts` (raw export 403 for members; no emails/names/dates in files) |
| Votes are private; totals only after a round closes | Test | `privacy.test.ts` “keeps votes private…”; `voting.test.ts` |
| Added context appears without names, on release | Test | `meeting.test.ts` “collects context privately and reveals it under the theme only on release” |
| Where names do appear: members, participants, attendance, speaking, experiment owners; facilitator sees passes | Code | `routes/meeting.ts` `snapshot()` (`ready` only for facilitator/self); `routes/sprints.ts` `detail()` |
| Your character (avatar) and its theme are visible only to you: never in anything a teammate sees, never attached to a thought, vote, export, the live socket or the AI input | Test | `avatars.test.ts` “only ever reaches its owner” (deep scan of every shared route, socket and AI snapshot for avatar keys and the eight ids); only `buildMe` selects the columns |
| Reopening keeps what people saw visible | Code | `routes/sprints.ts` `preparing>collecting` (confirmation message) |
| Authorship can still be inferred (wording, small teams, lone votes, reopen) | — | Stated limitation; see security review §4 |

## Operator, providers, logs

| Claim | Kind | Evidence |
| --- | --- | --- |
| The database records who wrote each thought; the operator or Cloudflare can link thoughts to accounts, and can read the content of sprints from before encryption | Code | `entries.author_account_id`, `votes.account_id`, `context_additions.author_account_id` (migrations); `sprints.encryption IS NULL` for legacy sprints |
| Operator accesses data only for running/securing Muni, abuse, or a user's request | Commitment | Not enforced; **no record of operator access is kept** — the page says so |
| Owners can't read sprints they aren't in or learn authorship | Test | as above (boundaries, no author lookup) |
| Cloudflare hosts app, database, live connection; request logs ≤ 7 days with URL, headers (IP, browser) | Provider + Config | Workers Logs docs (3 days Free / 7 Paid; invocation logs include request metadata and headers); `observability` on at sampling 1 in the production config. Not inspected on the live dashboard |
| URLs contain only ids, never text or email addresses | Code + Test | Tokens in fragments/bodies (`boundaries.test.ts` “keeps invitation tokens out of URLs…”); no client route puts an email or text in a query string |
| Muni's own logging records failures only: path, method, short error; no text or email | Test | `privacy.test.ts` “writes no entry text or email address to the log” (spies on `console.*` across a full flow, including a provoked 500) |
| Resend receives the address and a code / invitation (workspace, inviter name, link) / reminder (sprint name, link); never a thought | Code + Config | `lib/email.ts` templates (the only three); `EMAIL_PROVIDER=resend` in the production config |
| munimuni.app is on GitHub Pages behind Cloudflare, with Google Fonts | Config | `.github/workflows/pages.yml`; live response headers (`server: cloudflare`, `x-github-request-id`); `site/index.html` font link |
| No analytics, ads, session recording or error reporting; the app can't load code from or send data to other sites | Code + Config | No such dependency (`web/package.json`); CSP in `web/public/_headers` (`script-src 'self'; connect-src 'self'`), confirmed on the live app shell |
| No IP address or device details stored with an account | Code | `sessions` table has no IP/user-agent columns; rate-limit buckets hold SHA-256 hashes (`boundaries.test.ts` “stores no plaintext address or network…”) |
| We don't sell personal data; contributions not used for advertising; emails not added to marketing lists | Commitment | No advertising or marketing integration exists in code; the only emails are the three templates |

## AI

| Claim | Kind | Evidence |
| --- | --- | --- |
| The hosted Muni has no AI service switched on; no thought goes to an AI provider | Config | `AI_PROVIDER=none` in the rendered production config (gitignored). With `none`, `POST /ai/grouping` is refused and `ai_processing` can't be set (`routes/ai.ts`, `routes/sprints.ts`). Not observable from outside: `/healthz` isn't routed to the Worker in production |
| Muni doesn't train AI models on contributions | Code | No training pipeline or data export for training exists |
| If AI were offered: facilitator opts in before collection; text + category/impact/might-help only, after close, no names/emails/authorship | Test | `lifecycle.test.ts` “never widens AI processing after collection has started”; `privacy.test.ts` “sends the AI provider text and opaque ids only”; `ai.test.ts` |
| This page will say so before AI is offered here | Commitment | — |

## Encryption

| Claim | Kind | Evidence |
| --- | --- | --- |
| HTTPS in transit | Config | Custom domain on Cloudflare; HSTS in `_headers` (live) |
| Stored data encrypted at rest with AES-256, Cloudflare-managed keys | Provider | D1 and Durable Objects data-security docs |
| Not end-to-end encrypted; no application-level encryption; the server can read thoughts | Code | No encryption of `entries.body` or any column in the Worker |
| Email addresses stored readable; codes and session tokens only as hashes | Code | `accounts.email` plain; `verification_challenges.code_hash`, `sessions.token_hash` (`lib/auth.ts`, `routes/auth.ts`) |

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
| Account and email kept while the account exists; no self-service deletion or leaving | Code | No such route — **missing control** |
| Codes deleted ~1 day after expiry; sessions 30 days, deleted 7 days after ending; hashed limiter rows 24 h; email queue payload cleared when sent | Test + Code | `jobs.ts` `retention()`; `boundaries.test.ts` “keeps a queued email until it’s sent…” |
| Admin action log kept indefinitely (no text) | Code | `audit_events` never deleted — **open policy decision** |
| Backups ≤ 30 days, logs ≤ 7 days | Provider + Config | D1 Time Travel docs (7 Free / 30 Paid); Workers Logs docs. The pilot's plan (Free or Paid) isn't recorded, so the page states the upper bounds |

## Unresolved (prevents stronger wording)

- No account deletion, member self-removal, workspace deletion, or personal data export.
- No purge for sprints that are never finished; `audit_events` kept forever.
- Operator access to the database isn't logged by Muni; any claim of audited access needs that first.
- If AI is ever enabled here: the capture screen doesn't show a sprint's AI setting (only the sprint
  page does). Show it at the point of writing before offering AI, then update the page.
- The Cloudflare plan (Free/Paid) decides the log and backup windows; record it to state exact numbers.
- Log redaction of cookies in Workers Logs hasn't been observed on the live dashboard.

## Encryption (new sprints)

| Claim | Kind | Evidence |
| --- | --- | --- |
| New sprints are encrypted by default | Code | `SprintSetup.tsx` (`encrypt: true`); `web/e2e/encryption.mjs` “Encryption is on by default” |
| Thoughts, context, themes, notes, experiments, recap, opening question and vote-reset reasons are encrypted in the browser before upload | Test | `worker/test/encryption.test.ts` (plaintext refused for each; envelopes stored); `web/e2e/encryption.mjs` (captured request bodies contain no text) |
| Muni's servers don't hold keys that open that content | Test + Code | `encryption.test.ts` scans every D1 table and the room's storage for the synthetic text, private keys and sprint secrets; the Worker imports no content cryptography (`grep -rn noble worker/src` is empty; `lib/sealed.ts` only checks envelope format) |
| The server refuses plaintext for encrypted sprints | Test | `encryption.test.ts` (`encryption_required`), `lib/sealed.ts` |
| While collecting, the revealing key is held only by the facilitator's devices; other participants can't decrypt early | Test | `encryption.test.ts` “…follow the sealing policy through reveal” (no wraps for participants; early wraps refused) |
| The facilitator isn't given thoughts before close — server rule, not cryptography | Test | `privacy.test.ts` (unchanged sealing tests); stated as a limitation on the page |
| Email sign-in alone doesn't unlock content; the recovery key does | Test | `encryption.test.ts` “recovery…”; `web/e2e/encryption.mjs` new-device steps |
| Muni can't recover a lost key | Code | Server holds only the recovery-wrapped blob (`routes/keys.ts`); no other copy |
| Devices won't share a key with a teammate whose key changed until confirmed | Test | `keyring.test.ts` “pins teammates’ keys on first use…” |
| Encrypted sprints never use AI; exports and recap drafts are made in the browser | Test | `encryption.test.ts` (AI grouping, export, server recap → 409); `lib/e2ee/local-export.ts` |
| What stays readable: names, goal, dates, people, categories, authorship, timing, counts | Code | `docs/ENCRYPTION.md` §2; `routes/*` store these as plain columns |
| Depends on the genuine app being delivered; not audited | — | Stated limitation |
