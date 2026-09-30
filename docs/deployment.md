# Deploying Muni on your own Cloudflare account

This guide is for anyone self-hosting Muni. Muni runs as one Worker (the API and the built web app), one D1 database, one Durable Object class and one cron trigger. That is the only supported deployment.

You need:

- A Cloudflare account with a domain (a zone) on it.
- An email provider for invitations and sprint reminders: Resend or Brevo. Both have free tiers. Nobody signs in by email; passkeys are the only way in.
- Node 22, npm and pnpm 10.

`worker/wrangler.jsonc` is for local development only. Every remote command reads a production config that you render for your account.

## 1. One-time setup

```bash
cd worker && pnpm install
pnpm exec wrangler login                # or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler d1 create muni       # prints the database_id
```

Choose the host name the app will live on (a subdomain of a zone in your account, such as `muni.example.com`) and a sender address your email provider has verified.

## 2. Render the production config

```bash
MUNI_DOMAIN=muni.example.com \
MUNI_D1_DATABASE_ID=<the id from step 1> \
MUNI_EMAIL_FROM='Muni <hello@example.com>' \
node scripts/production-config.mjs
```

This writes `worker/wrangler.production.jsonc` from `wrangler.production.example.jsonc`. The file is gitignored because it describes your account. Once it exists, `pnpm run deploy` and `pnpm migrate:remote` reuse it; they re-render it only when the three variables above are set.

Optional variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MUNI_WORKER_NAME` | `muni` | Worker name |
| `MUNI_D1_DATABASE_NAME` | `muni` | D1 database name |
| `MUNI_EMAIL_PROVIDER` | `resend` | `resend` or `brevo` |
| `MUNI_EMAIL_DAILY_LIMIT` | `80` | Most emails Muni sends in a day. Keep it below your provider's daily quota (Resend's free plan allows 100) so invitations cannot use up what reminders need. Past the limit, an email fails in the `jobs` table with a message saying so. |
| `MUNI_EDGE_LIMIT_NAMESPACE` | `1001` | Namespace of the edge rate limiter. Must be unique among the rate limiters in your account. |

Each account can also send at most 20 invitation emails and create at most 10 workspaces a day.

## 3. Secrets, schema, deploy

```bash
pnpm exec wrangler secret put RESEND_API_KEY --config wrangler.production.jsonc   # BREVO_API_KEY for Brevo
pnpm migrate:remote                                                              # creates the schema
(cd ../web && npm ci && npm run build)
pnpm run deploy
```

The Worker attaches itself to `MUNI_DOMAIN` as a custom domain. Open `https://<your domain>`, create an account with a passkey and create a workspace.

Until the email secret is set, invitation and reminder emails fail with `setup_required` in the `jobs` table. The invite dialog still shows a link to copy, and join links and QR codes work without email.

### Passkeys and the domain

Passkeys need no secret. The relying-party ID is rendered from `MUNI_DOMAIN` as `WEBAUTHN_RP_ID`. If it is not exactly the host of `PUBLIC_ORIGIN`, every request answers `500 misconfigured`.

A passkey works only on the host it was registered on. Moving to a new domain means everyone creates new passkeys, and there is no other way in, so plan it with your users. See [passkeys.md](passkeys.md).

### Edge rate limit

Requests other than GETs to `/api/auth/*`, `/api/join/*` and `/api/invitations/*` are limited to 60 a minute per address by a Workers Rate Limiting binding (`EDGE_LIMIT`). The Worker refuses a flood with `429` before it touches D1, so the flood cannot use up the Free plan's daily D1 writes. The numbers are fixed in `worker/scripts/production-config.mjs`. A config rendered before this binding existed has none: render it again to add it.

## 4. Updating

Check out a release tag and read the [changelog](../CHANGELOG.md) for anything you must do. Then build, migrate and deploy:

```bash
git checkout v1.2.0
(cd web && npm ci && npm run build)
cd worker && pnpm install --frozen-lockfile
pnpm migrate:remote && pnpm run deploy
```

`GET /api/version` reports what is running. Within a major version, migrations are additive ([releasing.md](releasing.md#what-a-version-number-promises)), so the previous Worker keeps working against a newer schema.

To go back, run `pnpm exec wrangler rollback --config wrangler.production.jsonc` from `worker/`. It restores the previous Worker version and the app it served. Migrations are not reversed.

To deploy from GitHub Actions instead, see [releasing.md](releasing.md). The release workflow runs only in the repository it names; in a fork, change its `github.repository` guard.

To check any deployment from outside, run this from the repository root:

```bash
node scripts/verify-deploy.mjs https://<your domain> <version>
```

## 5. Operations

- **Logs.** Workers Logs keeps request metadata (method, URL, redacted headers) for 3 days on the Free plan and 7 on Paid. The app logs failures only, without content.
- **Backups.** D1 Time Travel restores to any point in the last 7 days (Free) or 30 days (Paid). A `wrangler d1 export DB --remote --config wrangler.production.jsonc` file contains the private author columns, so protect and expire it like the database.
- **Costs.** Muni runs on the Workers Free plan. Allowances are per account and shared with anything else you run there; when one runs out, the Worker answers `503 quota` ([architecture.md](architecture.md#limits)). The Paid plan gives D1 much more room and longer logs and backups.
- **Access.** Anyone with your Cloudflare account or an API token for it can read the database. Use MFA and narrowly scoped tokens.
- **Privacy page.** The Privacy & data page (`web/src/routes/Privacy.tsx`) describes the hosted act.munimuni.app: its operator, contact address and providers. Change those for your deployment and check the rest against [privacy-claims.md](privacy-claims.md), for example if you use Brevo.

## 6. Before real teams rely on it

- **Get told when something breaks.** Alert on the Worker's 5xx rate (Workers Logs, or Logpush to your alerting). Also watch failed jobs: undelivered emails stay in the `jobs` table with `status = 'failed'` and a short `last_error` for 90 days. From `worker/`:

  ```bash
  pnpm exec wrangler d1 execute DB --remote --config wrangler.production.jsonc \
    --command "SELECT kind, count(*) AS n FROM jobs WHERE status = 'failed' GROUP BY kind"
  ```

- **Bookmark before migrating.** Record where the database stands so a bad migration has a point to go back to. The release workflow does this for you; by hand:

  ```bash
  pnpm exec wrangler d1 time-travel info DB --config wrangler.production.jsonc    # prints a bookmark
  ```

- **Rehearse one restore** in a quiet window or on a test deployment, so you know the steps and how long they take:

  ```bash
  pnpm exec wrangler d1 time-travel restore DB --bookmark=<bookmark> --config wrangler.production.jsonc
  ```

  A restore replaces the whole database, including anything written since the bookmark.
