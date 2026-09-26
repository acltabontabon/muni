# Muni

**Good retros start before the meeting.**
Capture thoughts throughout the sprint. Reflect together. Turn insights into action.

Muni (from the Filipino *muni-muni*, to reflect) is a sprint-retrospective app for
software teams of roughly 3–20 people: private capture during the sprint, sealed
collection revealed as one anonymous batch, manual (optionally AI-drafted) themes,
private votes, a paced live retro with a gentle speaking invitation, and one to
three experiments that come back first next time.

## What is here

| path | what |
| --- | --- |
| `worker/` | **The application backend**: a Cloudflare Worker (TypeScript, Hono) with D1 (SQLite) for durable data and a `MeetingRoom` Durable Object per sprint for live meeting state and hibernating WebSockets. Also serves the built web app as static assets. |
| `web/` | The React 19 + Vite + Tailwind 4 client (capture, studio, stage, companion, outcomes). |
| `worker/src/contract.ts` | The typed API contract shared by both. |
| `worker/test/` | Integration tests that run inside the Workers runtime (`@cloudflare/vitest-pool-workers`). |
| `server/`, `Dockerfile`, `docker-compose*.yml` | The earlier Rust/Axum/PostgreSQL backend and its Docker packaging. **Retired, not maintained**: kept in history for reference until the Cloudflare version is established. Do not deploy it. |
| `docs/` | Architecture and privacy note, design direction, deployment/operations notes (the Docker sections there describe the retired backend). |

## Run locally

Requirements: Node 22, pnpm 10 (`corepack enable`), no database server (D1 runs locally).

```bash
# 1. backend (Worker + local D1 + Durable Objects), http://localhost:8787
cd worker && pnpm install && pnpm migrate:local && pnpm dev

# 2. frontend with hot reload, http://localhost:5173 (proxies /api and the WebSocket to :8787)
cd web && npm install && npm run dev
```

Local defaults (in `worker/wrangler.jsonc` `vars`): `EMAIL_PROVIDER=console` (sign-in codes
and invitations land in a dev inbox at `GET /api/dev/inbox`), `AI_PROVIDER=fake` (a local
keyword grouper, clearly labelled as provisional), `ALLOW_DEMO_SEED=true`
(`POST /api/demo/seed` builds a fictional eight-person sprint for the signed-in user).

Checks: `cd worker && pnpm typecheck && pnpm test` · `cd web && npm run typecheck && npm run lint && npm run build`.

## Deploy to Cloudflare (free plan)

Resources: one Worker (`muni`) with static assets, one D1 database (`muni`), one Durable Object
class (`MeetingRoom`, SQLite-backed), one cron trigger (`*/15 * * * *`). No KV, Queues or R2.

```bash
cd worker
wrangler login                                   # or set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
wrangler d1 create muni                          # paste the database_id into wrangler.jsonc
wrangler d1 migrations apply muni --remote       # additive migrations only; see "Rollback"
wrangler secret put RESEND_API_KEY               # or BREVO_API_KEY; optional: ANTHROPIC_API_KEY
# production vars (edit wrangler.jsonc or an env block): APP_ENV=production,
# PUBLIC_ORIGIN=https://muni.acltabontabon.com (or the *.workers.dev preview URL),
# EMAIL_PROVIDER=resend|brevo, EMAIL_FROM="Muni <muni@yourdomain>", AI_PROVIDER=none|anthropic, ALLOW_DEMO_SEED=false
cd ../web && npm run build && cd ../worker && wrangler deploy
```

`.github/workflows/deploy.yml` does the same on push to `main` when the repository has the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

Production refuses insecure settings at request time (non-https `PUBLIC_ORIGIN`, console
email, fake AI, demo seeding). Without an email provider configured, sign-in returns an
explicit `setup_required` error — there is no development login bypass.

Custom domain: add a Workers custom domain `muni.acltabontabon.com` in the Cloudflare
dashboard once the zone is confirmed; until then the `*.workers.dev` URL works and must be set
as `PUBLIC_ORIGIN`. Cookies are scoped to the app host; the marketing site never receives them.

Rollback: `wrangler rollback` restores the previous Worker version. Migrations are not reversed
automatically — keep them additive (new tables/columns, no drops) so an older Worker keeps
working against a newer schema. Backups: `wrangler d1 export muni --remote --output backup.sql`
(contains the private author columns; protect and expire it like the database).

## Privacy, in one paragraph

Your identity is verified to access each sprint. Your entries and votes are shown without your
identity to teammates and facilitators. The service operator may technically be able to
associate activity with accounts. Your wording can still reveal who you are. See
`docs/ARCHITECTURE.md` for how the boundary is implemented.

## Status

Early pilot preparation. See the handoff notes in `docs/HANDOFF.md`.
