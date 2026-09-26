# Muni

**Keep the thought. Bring it to the conversation.**

Muni is a sprint-retrospective app. People capture what matters during the sprint, while it's
still fresh; the retro becomes a conversation about what happened and what to change. The name
comes from the Filipino *muni-muni*: to reflect, to turn a thought over.

Muni is an independently maintained project, built and operated by one developer. It is early
software: a small pilot runs at [act.munimuni.app](https://act.munimuni.app), and the data model
and API may still change.

## What it does

- **Private capture.** During the sprint only you can see your thoughts — the facilitator too.
- **A sealed reveal.** When collection closes, everyone's thoughts appear as one batch, without
  names, in random order.
- **Themes and votes.** Group thoughts by hand (optional AI drafts, off by default); vote privately.
- **A paced live retro** with a gentle speaking invitation, anonymous added context, and one to
  three experiments that come back first next sprint.
- **An installable web app** that keeps capture working offline for people who choose to keep
  drafts on their device.

The privacy is application-level, not cryptographic: the service stores who wrote what (so only you
can edit yours), and someone with database access could connect the two. Muni is not end-to-end
encrypted. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the model and
[`docs/security-review-2026-09.md`](docs/security-review-2026-09.md) for what was verified.

## How it's built

| path | what |
| --- | --- |
| `worker/` | The backend: a Cloudflare Worker (TypeScript, Hono) with D1 (SQLite) for durable data, a `MeetingRoom` Durable Object per sprint for live meeting state and WebSockets, and a cron trigger for jobs. It also serves the built web app. |
| `web/` | The React 19 + Vite + Tailwind 4 client, an installable PWA. |
| `site/` | The marketing site (static HTML/CSS/JS). |
| `docs/` | Architecture and privacy model, deployment, design notes, using Muni, the security review. |

Muni runs on Cloudflare Workers, D1 and Durable Objects, and nothing else: there is no other
supported backend and no container image.

## Run it locally

You need Node 22+ and pnpm 10 (`corepack enable`). No Cloudflare account is needed — D1 and
Durable Objects run locally.

```bash
cd worker && pnpm install && pnpm migrate:local && pnpm dev    # API + local D1, http://localhost:8787
cd web && npm install && npm run dev                           # app with hot reload, http://localhost:5173
```

Local defaults (`worker/wrangler.jsonc`): sign-in codes and invitations go to a development inbox
at `GET /api/dev/inbox` instead of email, a local stand-in replaces the AI provider, and
`POST /api/demo/seed` builds a fictional sprint for the signed-in account.

Checks:

```bash
cd worker && pnpm typecheck && pnpm test
cd web && npm run typecheck && npm run lint && npm test && npm run build
```

Browser end-to-end suites run against `wrangler dev` serving the production build:
`node e2e/entrance.mjs` and `node e2e/offline.mjs` (from `web/`, with `MUNI_URL` if not port 8787).

## Deploy your own

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In short: create a D1 database, render a
production config for your account (it is gitignored), set an email-provider secret, apply the
migrations and deploy. Commands in this repository never touch a deployment you haven't
configured.

## Known limitations

- Early software with a single maintainer; expect changes to the data model and API.
- Cloudflare only (Workers, D1, Durable Objects).
- Email one-time codes are the only sign-in; no SSO or passkeys.
- English only.
- Tested mostly in Chromium; Safari/iOS and Firefox less thoroughly.
- Not end-to-end encrypted; small teams and distinctive writing can reveal an author.
- Content of sprints that are never finished is not yet purged, and there is no self-service
  account deletion yet.

## Contributing, security and support

Contributions are welcome — please read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Report
vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md), not in public issues.

This is a one-person project maintained on a best-effort basis: there's no guaranteed response
time, release schedule, or acceptance of contributions. The open-source license covers the code;
it doesn't come with support, and the hosted pilot at act.munimuni.app is a separate, as-is
service with no uptime commitment.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE). Third-party components keep
their own licenses ([`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md)); the web build ships their texts as
`third-party-licenses.txt`. The Muni name and logo are covered separately in
[`TRADEMARKS.md`](TRADEMARKS.md).
