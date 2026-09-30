# Encryption in Muni

How Muni encrypts sprint content in the browser, which keys exist, and what stays readable. For security reviewers and contributors. The design has tests (section 7) but **has not been independently audited**.

Sprints are encrypted by default (`sprints.encryption = 'e1'`). A facilitator can turn encryption off when setting up a sprint; that sprint is stored as plaintext on Muni's servers and says so wherever it appears. Accounts, passkeys and sign-in are in [passkeys.md](passkeys.md); the rest of the system is in [architecture.md](architecture.md).

## What is protected

**Goal.** Someone with access to Muni's D1 database, Durable Object storage, backups or logs cannot read the content of an encrypted sprint. The server never holds a key that opens it. Content is encrypted in a participant's browser before upload and decrypted only in participants' browsers.

**Assumptions.**

- The frontend served from `act.munimuni.app` is genuine. Whoever controls that code (the operator, a compromised deploy pipeline or Cloudflare account) can capture plaintext or keys, substitute public keys or add recipients. Muni does **not** resist an actively malicious operator. It removes the operator's *stored* and *routine* ability to read content.
- The server stores and forwards public keys, wrapped keys and envelopes honestly. If it does not, the result is denial of service or a detectable key substitution, not plaintext disclosure (except through the frontend, above).
- Participants' devices are not compromised. Muni does not defend against malicious extensions, screenshots, or participants sharing what they read.

**Not protected.**

- Metadata (section 2). The server records which account submitted each record. Encryption hides *what* was written, not *who* wrote it.
- Other participants never learn who wrote a thought: revealed thoughts carry no author, neither in the API response nor in the envelope. Wording and small teams can still give an author away.

## What is encrypted

In an encrypted sprint, each field below is an envelope (section 5). The server refuses plaintext for these fields.

| Content | Stored in | Form |
| --- | --- | --- |
| Thought text, impact, what might help | `entries.body` (`impact`, `might_help` are NULL) | One thought envelope. An edit makes a new envelope with a fresh content key |
| Additions to a discussion | `context_additions.body` | Field envelope |
| A line with a check-in answer | `checkin_responses.note` | Field envelope |
| The idea a check-in asked about (a copy) | `checkins.subject` | Field envelope (copied from the discussion note `could_try`) |
| Theme title, summary, question, draft experiment, order reason | `themes.*` | Field envelopes |
| Discussion notes | `discussion_notes.*` | Field envelopes |
| Experiment change, success signal, outcome note; the copied theme title | `experiments.*` | Field envelopes |
| Recap | `recaps.body` | Field envelope. Drafted on the facilitator's device and saved as sent; the server never drafts one |
| Opening question | `sprints.opening_question` | Field envelope |
| Vote-reset reason typed by the facilitator | `vote_rounds.cancel_reason` | Field envelope (system reasons stay plain) |
| Agenda reasons | Durable Object `meeting.agenda[].reason` | Opaque envelope |
| Exports (.md, .csv, raw) | Worker | Refused (409 `encrypted_export`). Built in the browser from decrypted data |
| Drafts and unsent thoughts | Browser only | Plaintext in the browser; sealed when sent |
| Live socket messages | n/a | Hints only (`{type, resource, version}`), no content |
| Logs | `console.error` | Path, method and error text. Never field values |

**Stays readable.** Workspace and sprint names, sprint goal, dates, retro time and timezone, participants and facilitator, each thought's category and period, authorship and timestamps (server-side only; shared views and envelopes never show them), theme membership and counts, vote rounds and totals, check-in answer choices and counts, the kind an addition says it is, experiment owner, review date and status, audit events, email addresses, key fingerprints, and which key versions each person holds. The setup screen tells facilitators that the name and goal are not encrypted.

## Collection and reveal

Each thought is encrypted with a fresh content key, sealed twice: to the sprint's public key and to the author's account key. While collection is open, the sprint secret is sealed only to the facilitator; the server refuses wraps of that version to anyone else. Closing collection is the reveal: the facilitator's browser seals the secret to every participant, stored in the same batch as the status change.

This means:

- Other participants cannot decrypt anyone's thoughts before the reveal, even with the ciphertext.
- Authors can read and edit their own thoughts at any time, and need not be online at the reveal.
- The server holds no key.

**The facilitator's limit.** The facilitator's devices hold a key that could open thoughts early. The server does not give them the ciphertext before close (tested), but that is server enforcement, not cryptography. A facilitator colluding with the operator could read early.

**Facilitator key loss.** If the facilitator loses every device and the recovery key before closing, the sprint cannot be revealed. Authors can still read their own thoughts. The team starts a new sprint. Muni accepts this rather than add key escrow.

**Key versions.** A sprint has numbered key versions (`sprint_keys`).

- **Reopen.** The facilitator's device creates a new version, sealed only to them. Thoughts written after reopening use it; closing again reveals it. What was revealed stays readable.
- **Late participants.** They receive every revealed version from any teammate's device that holds it.
- **Facilitator change.** The key moves with the role. The old facilitator's device seals every version it holds to the new one, only to a key it has pinned (a changed key must be confirmed first). While collecting, the server refuses the change without a wrap of the sealed version for the new facilitator, and in one batch writes the role, the new wraps and the removal of others' copies of that version.
- **Owner takeover.** When a facilitator cannot act, an owner can take over. While collecting, the sealed version belongs to the old facilitator, so a new version starts, sealed to the new one. Thoughts already written under the old version stay sealed until the old facilitator opens Muni again; the takeover preview counts them.
- **Rescheduling.** No key effect.

## Keys

- **Account key.** An X25519 key pair, the root of everything a person can read; sprint secrets are sealed to it. The browser generates it the first time an account needs one, with no setup step, and only when the server confirms the account has none. A missing key on a device never means the account is new. The public key is published (`account_keys`). The private key is held only in memory. Nothing is derived from an email address, a passkey signature or credential id, the account id or a session token.
- **Passkey unlock (PRF).** Every passkey ceremony asks for the passkey's PRF output (WebAuthn `prf`, input SHA-256(`muni:prf:account-key:v1`)). The input is constant so discoverable sign-in can ask; the output differs per passkey. In the browser, HKDF-SHA256 turns the output into a non-extractable AES-256-GCM key that wraps the account key (`p1.`, section 5). The server stores one wrap per passkey (`passkey_key_wraps`) and cannot open it. The PRF output never leaves the browser: requests carry no extension results, and the server refuses any. Signing in with such a passkey unlocks the key in the same step, on any device where the passkey works. A passkey gets a wrap only from a device where the key is already open: at sign-up, when added from an unlocked device, or the next time it is used on one. Passkeys without PRF (or browsers that do not return it) sign in only.
- **This device (reloads, and fallback).** Once the key is open, the device keeps an envelope (`d1.`): the account key under AES-256-GCM, keyed from two halves. `ds` is 32 random bytes kept only on the device (IndexedDB `muni-unlock`). `share` is 32 random bytes the server keeps (`device_unlocks`). Neither half opens anything alone, and the server never sees the envelope or `ds`.
  - **Release rule.** The server releases `share` only to a session of the same account that was started with a passkey that already existed when the device was bound. A passkey added later, say from a borrowed session, never unlocks it.
  - The binding is renewed whenever the device unlocks by passkey or recovery key. An account keeps at most 50 such devices; the least recently used makes room.
  - A new key is kept on the device before it is published, and an interrupted setup is finished with the same key on the next load. A key is never published while the page is being left (`pagehide`): the browser aborts storage writes then, and a published key without this device's envelope would make the next page ask for the passkey.
- **Recovery key.** 160 random bits plus a 16-bit checksum, shown once as nine groups of four (Crockford base32). The server stores the account private key sealed under a key derived from it (`r1.`, section 5). It is optional. The app warns before sign-out or passkey removal would leave no other way to unlock.
- **Sign-out** drops the key and everything opened with it from memory in every tab: a `BroadcastChannel` message, plus a counter in `localStorage` that a frozen or cached tab checks when it returns and before it seals or opens anything. Each step of reopening checks an epoch, so a late response cannot unlock a signed-out tab. Sign-out keeps the device envelope.
  - **Forget this device** also deletes the envelope, the server's share, pinned keys and drafts. It does not touch passkeys.
  - **Offline sign-out** forgets the envelope too, because the session cannot be ended yet.
  - **Session expiry** drops the key from memory (drafts stay). Signing in again reopens it.
- **Account isolation.** Tabs name the account they act for (`x-muni-account`). The server refuses a request for another account (409 `account_changed`). A tab seals a thought only if its key belongs to the account that wrote it: the envelope names no author, so the device checks this before sealing and the server checks the sending account. Shares and wraps are bound to the account.
- **Another device.** Sign in with a passkey that unlocks, use the recovery key (the unwrapped key must match the published public key), or use a device that is still unlocked, which can let the passkey unlock. There is no device-to-device transfer.
- **All keys lost.** "Start over" publishes a new key: the server bumps `key_version`, audits `keys.replaced`, and drops all passkey wraps and the shares of other devices. It needs a recent sign-in and is refused while this device can still read. Content sealed only to the old key (the person's own unrevealed thoughts) is gone. Teammates can reshare revealed sprints after confirming the new key. A new passkey cannot reconstruct a lost key.
- **Account access is not content access.** A passkey that only signs in (no PRF) never unlocks content on a device that did not already have it, nor a device envelope bound before that passkey existed (tested).
- **Revocation.** Removing a member or participant stops the server serving them anything new, and devices share keys only with current participants. Nothing erases keys or content already received. Removing or forgetting a device stops it reopening the key by itself.
- **Key substitution.** Devices pin each teammate's public key on first use (IndexedDB `muni-keys`). A later change is never used: sharing to that person stops, and the facilitator sees "X's encryption key changed" with the new fingerprint until they confirm. The server also accepts wraps only for current participants, to their current key. **Not prevented:** a malicious server showing a fake key on first sight, or adding a fake participant whom devices then share with. Both are visible to people (participant list, fingerprints) but not blocked.
- **Browser storage is not a vault.** Anyone who can use this browser profile *and* sign in with a qualifying passkey can unlock it, the same bar as signing in.

## Formats and primitives

Primitives: `@noble/curves` (X25519), `@noble/ciphers` (XChaCha20-Poly1305) and `@noble/hashes` (HKDF-SHA256, SHA-256), all independently audited libraries, in `web/src/lib/e2ee/crypto.ts`. Web Crypto (HKDF-SHA256, AES-256-GCM, non-extractable keys) unlocks the account key in `web/src/lib/e2ee/wrap.ts`.

| Object | Format | Construction |
| --- | --- | --- |
| Sealed box | `{e, n, c}` | Ephemeral X25519, HKDF(shared secret; salt = ephemeral key and recipient key; info `muni sealed box v1`), XChaCha20-Poly1305 with a context string as AAD. All-zero shared secrets (low-order keys) are refused |
| Sprint secret `S` | 32 random bytes per version | HKDF derives the sprint X25519 key pair and the discussion key. Wrapped per person as `w1.`, bound to (sprint, version, recipient) |
| Field envelope | `e1.` + base64url JSON `{v:1, t:'f', s, k, f, n, c}` | Discussion key; AAD binds sprint, version, field |
| Thought envelope | `e1.` + base64url JSON `{v:2, t:'e', s, k, r, n, c, ws, wa}` | Fresh content key; AAD binds sprint, record, version. `ws` and `wa` seal the content key to the sprint and to the author |
| Recovery blob | `r1.` + base64url JSON | XChaCha20-Poly1305 under HKDF(recovery secret; salt = account id; info `muni recovery v1`); AAD binds the account |
| Passkey wrap | `p1.` + base64url JSON `{v:1, n, c}` | AES-256-GCM, random 96-bit IV. Key: HKDF-SHA256(PRF output; salt `muni\|account\|credential`; info `muni passkey kek v1`). AAD `muni:passkey-wrap:v1\|account\|credential\|version\|publicKey` |
| Device envelope | `d1.`, same shape as `p1.` | Key: HKDF-SHA256(`ds` followed by `share`; salt `muni\|account\|device`; info `muni device kek v1`). AAD `muni:device-wrap:v1\|account\|device\|version\|publicKey` |

- **No author in thoughts.** A sealed box does not reveal its recipient, so nothing in a thought's envelope says who wrote it, and two thoughts by one person share nothing that links them. The Worker stores a thought envelope only with exactly the fields above, and database triggers refuse the older format that carried an author.
- **Nonces.** XChaCha20 uses 192-bit random nonces, fresh for every encryption. Each AES-GCM wrapping key encrypts a handful of times, far below the random-IV limit.
- **Tampering.** An AEAD failure, or content from the wrong sprint, field or record, is shown as "Can't be shown on this device". It is never shown as ciphertext and never falls back to plaintext. Thought and new-sprint ids are client-chosen UUIDs so they can be bound before upload. *Limitation:* field envelopes are bound to sprint and field, not record, so the server could swap two themes' titles within one sprint (integrity only).
- **Server enforcement.** For `e1` sprints every content field must be a well-formed envelope within length limits (`worker/src/lib/sealed.ts`); plaintext is refused with `encryption_required`. The server never does content cryptography. A minimum client revision (`x-muni-client`) makes stale tabs reload instead of writing old payloads.
- **Retries.** Thought submission is idempotent on the client-chosen id (the outbox). With no key, a thought waits as "waiting for this device's key". The service worker holds no keys and skips encrypted items.

## Remaining risks

- A malicious or compromised frontend.
- First-sight key substitution and fake recipients.
- Metadata visible to the operator: authorship, timing, categories, counts.
- A facilitator reading early by colluding with the operator.
- A facilitator losing every key before the reveal.
- Plaintext in browsers (drafts, the queue, decrypted views) and in downloaded files.
- Derived fields swapped within a sprint.
- No key rotation when a participant is removed: later writes still use the current version, and the server only stops serving the removed person.

## Tests

| File | Covers |
| --- | --- |
| `web/src/lib/e2ee/crypto.test.ts` | Round trips, wrong recipient or context, tampering, cross-sprint/record/field substitution, low-order keys, recovery-key typos, malformed envelopes, unlinkable author-free thoughts |
| `web/src/lib/e2ee/keyring.test.ts` | Decryption at the API boundary, refusal to send plaintext without keys, key pinning, sealed-version sharing, the sign-out, reload, forget-device, PRF and no-PRF, offline and account-switch lifecycle |
| `web/src/lib/e2ee/wrap.test.ts`, `web/src/lib/passkeys.test.ts` | Wrap binding and tampering, both device halves required, PRF output absent from every request body |
| `worker/test/unlock.test.ts` | Wraps only for own passkeys and current key, the share release rule, PRF results refused, `x-muni-account` isolation |
| `worker/test/encryption.test.ts` | Envelopes only, sealing policy through reveal, author-naming envelopes refused, reopen, late participants, key replacement, export and recap refusal, sprints without encryption. Scans every D1 table and the room's storage for synthetic text, private keys and sprint secrets |
| `web/e2e/encryption.mjs`, `web/e2e/unlock.mjs` | The real UI end to end, including request bodies captured in the browser; with and without PRF ([passkeys.md](passkeys.md)) |

Testing does not establish the correctness of the construction against a cryptographer's review, side channels, behaviour under a malicious frontend, browser storage security, or the recovery flow's resistance to phishing. Independent cryptographic and application-security review is needed before claiming more than this document says.

## Wording

Public copy lives in `site/index.html` and `web/src/routes/Privacy.tsx`; [privacy-claims.md](privacy-claims.md) maps each claim to its evidence. Do not claim "zero knowledge", "fully anonymous", "the operator can never access anything" or "audited".
