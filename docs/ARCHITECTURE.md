# Muni — architecture and privacy note

Muni (from the Filipino *muni-muni*, to reflect) is a sprint-retrospective tool built around one loop:
capture observations while they are fresh → reveal the sprint's themes → choose
worthwhile conversations → invite everyone to contribute → agree on a few
experiments → revisit them next sprint.

This note records the shape of the system and, more importantly, where the
privacy boundary sits. It is written before implementation and kept current.

## Shape

A modular monolith: one React frontend, one Rust backend, one PostgreSQL
database. A single backend instance is the v1 deployment assumption.

```
web/      React 19 + TypeScript + Vite + Tailwind 4 + Radix primitives
server/   Rust 2021, Axum 0.8, Tokio, SQLx 0.8 (Postgres), versioned migrations
docs/     this note, privacy, design, deployment, operations
```

Requests are plain REST (JSON). Live updates use server-sent events (SSE).
SSE messages are *hints* — they name the resource that changed and its
version; the client then fetches a fresh, authorized snapshot. This makes it
impossible for a broadcast to leak something the recipient may not see, and it
makes reconnection trivial: reconnecting is just fetching again.

Background work (email, reminders, AI preparation, retention) is a `jobs`
table in PostgreSQL, claimed with `FOR UPDATE SKIP LOCKED`, with bounded
attempts, exponential backoff and an explicit `failed` state that the
facilitator can see for AI jobs.

### Backend modules

| module | responsibility |
| --- | --- |
| `config` | environment configuration, validated at boot; production refuses insecure settings |
| `db` | pool, migrations, health |
| `auth` | email verification codes, invitations, sessions, CSRF, rate limits |
| `authz` | membership and sprint-participant checks used by every protected handler |
| `workspaces` | workspace, membership, roles, settings, retention policy |
| `sprints` | sprint setup, lifecycle transitions, participants |
| `entries` | private capture, "my entries", sealed collection and batch reveal |
| `themes` | manual grouping, revisions, parking lot, AI proposals |
| `voting` | vote rounds, private votes, transactional budgets |
| `meeting` | server-authoritative stage: phase, topic, timer, attendance, speaking rotation, context batches |
| `commitments` | experiments, owner acceptance, review outcomes, recap |
| `exports` | Markdown and CSV, summary by default |
| `ai` | provider trait, Anthropic adapter, deterministic fake, schema validation |
| `jobs` | durable worker loop |
| `email` | SMTP (lettre) and a capturing in-memory transport for tests |
| `sse` | per-sprint broadcast, membership re-check, revocation close |
| `audit` | privacy-preserving audit events for facilitator actions |
| `retention` | scheduled deletion of content-derived records |

## Data model

Normalised tables, opaque UUID identifiers everywhere. Sprint names are labels.

```
workspaces            accounts             memberships (workspace, account, role, revoked_at)
invitations           verification_challenges (hashed code, attempts, expiry)
sessions (hashed token, rotation, expiry, revoked)
sprints               sprint_participants (sprint, account, is_facilitator, reminder opt-out)
entries               (sprint, category, body, impact, help, period, author_account_id  ← private column)
themes                theme_entries        grouping_revisions (counter on sprint)
ai_jobs               ai_proposals
vote_rounds           votes (round, theme, account) ← private
retro_sessions        (phase, current theme, version, timer, controller)
attendance            speaking_rounds       speaking_turns
context_additions     (theme, body, author_account_id ← private, release batch)
discussion_notes      experiments           recaps
jobs                  audit_events          rate_events
```

## The privacy boundary

The promise made in the product is:

> Your identity is verified to access this sprint. Your entries and votes are
> shown without your identity to teammates and facilitators. The service
> operator may technically be able to associate activity with accounts. Your
> wording can still reveal who you are.

This is application-level anonymity. It is implemented as follows.

1. **Ownership is a private column.** `entries.author_account_id`,
   `votes.account_id` and `context_additions.author_account_id` exist only so
   the server can authorise private editing and enforce vote budgets. They are
   never selected into a shared response type.
2. **Allow-listed response types.** Shared representations (`SharedEntry`,
   `ThemeView`, `StageSnapshot`, exports) are distinct Rust structs with no
   author, alias, avatar, timestamp, user-agent or IP field. There is no
   "with author" variant. The presenter route uses the same sanitized types.
3. **No reveal endpoint.** Workspace ownership grants settings and membership
   administration, not an author lookup. There is no administrative
   "who wrote this" feature, by design.
4. **Sealed collection.** While a sprint is `COLLECTING`, the only entry
   listing is "my entries" (filtered by the caller's account). Facilitators
   get no listing at all until they close collection, which is an explicit,
   confirmed action. At close, every entry receives a random `reveal_order`,
   and shared listings sort by it, so ordering cannot leak submission time.
5. **No per-person status.** Collection status is only shown after close, as
   an aggregate count of entries. There are no typing indicators, no
   "X just submitted", no per-person contribution lists and no live count
   changes during collection.
6. **Votes stay private.** Totals are revealed only after a round closes.
   A participant sees their own remaining budget; nobody sees who has voted.
7. **AI sees text and opaque IDs only.** The AI adapter receives entry bodies
   and entry IDs. It never receives account, email, attendance or membership
   data. Outputs are stored as proposals tied to an input snapshot hash.
8. **Logs are body-free.** Request logging records method, path, status and
   latency. Entry bodies, votes, codes, tokens and account↔entry pairs are
   never logged. Error responses do not echo request bodies.
9. **Speaking rotation is named, feedback is not.** The speaking card shows a
   participant's display name because it invites them to speak; it never
   links them to an entry, and prompts avoid implying authorship.
10. **Audit without content.** Audit events record who changed a phase,
    regrouped or closed collection, with resource IDs only.

### Known limits (documented in the product, not hidden)

- The operator, with database access or a backup, can join
  `entries.author_account_id` to `accounts`. This is stated in the privacy
  explanation. Mitigation is operational (access control, retention), not
  cryptographic.
- Small teams and distinctive prose can identify an author regardless of the
  software.
- Email verification proves control of a mailbox, not that a mailbox belongs
  to one unique person.
- Exports and AI provider requests are copies that retention cannot retract.

## Authorization model

- Every protected request carries a session cookie. The session is looked up
  by the SHA-256 of the cookie token, checked for expiry and revocation.
- Mutating requests require a matching `X-CSRF-Token` header (double-submit
  cookie) and an allowed `Origin`/`Sec-Fetch-Site`.
- Handlers resolve a `WorkspaceMember` (active membership) and, for sprint
  routes, a `SprintAccess` (membership + sprint participant, with the
  facilitator flag). Revoking a membership makes the next request fail with
  403 and closes SSE streams for that account within one heartbeat.
- The presenter route is the same authenticated stage snapshot served with a
  presenter flag that hides private controls in the UI; it contains no
  private fields to hide server-side because the type has none.

## Meeting state

`retro_sessions` is the single source of truth. Every facilitator command
carries the version it observed; the server applies the command only if the
version matches (`UPDATE … WHERE version = $expected`), increments it, writes
an audit event, commits, and only then broadcasts an SSE hint. Timers are
stored as `timer_ends_at` (running) or `timer_remaining_secs` (paused), so a
refresh derives the same clock. One controller account is recorded; a second
facilitator must explicitly take over.

## Decisions taken without waiting

- SQLx 0.8.6 rather than 0.9.0: 0.9 changed the query API in May 2026 and the
  ecosystem is still catching up; 0.8 is stable and supported.
- TypeScript 5.x rather than 7.x, React Router 7 rather than 8, for the same
  ecosystem-maturity reason. Vite 8, React 19, Tailwind 4 are current.
- No ORM. Plain SQL with `sqlx::query_as` and `FromRow` keeps the backend
  readable and the privacy boundary auditable by reading the SELECT lists.
- The AI adapter targets the Anthropic Messages API; a deterministic fake
  implements the same trait for tests and for running without credentials.

## Naming

The product was scaffolded under the working name "Afterglow" and renamed to
Muni before the first commit, so no database, cookie or environment identifier
carries the old name. The repository directory and GitHub project keep the
`afterglow` slug for now; it is the only legacy name retained.
