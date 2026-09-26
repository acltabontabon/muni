# Deploying Muni on your own Cloudflare account

Muni runs on Cloudflare's developer platform: one Worker (serving the API and the built web app),
one D1 database, one Durable Object class and one cron trigger. That is the only supported
deployment. You need a Cloudflare account, a domain on it for the app, and an email provider for
sign-in codes (Resend or Brevo; both have free tiers).

Nothing here touches anyone else's resources: the repository's `worker/wrangler.jsonc` is for local
development only, and every remote command reads a production config you create for your account.

## 1. One-time setup

```bash
cd worker && pnpm install
pnpm exec wrangler login                      # or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler d1 create muni             # note the database_id it prints
```

Choose the host name the app will live on (a subdomain of a zone in your account, e.g.
`muni.example.com`) and a sender address your email provider has verified.

## 2. Render your production config

```bash
MUNI_DOMAIN=muni.example.com \
MUNI_D1_DATABASE_ID=<the id from step 1> \
MUNI_EMAIL_FROM='Muni <hello@example.com>' \
node scripts/production-config.mjs
```

This writes `worker/wrangler.production.jsonc` from `wrangler.production.example.jsonc`. The file
is gitignored — it describes your account, not the project. Optional overrides:
`MUNI_WORKER_NAME` (default `muni`), `MUNI_D1_DATABASE_NAME` (`muni`), `MUNI_EMAIL_PROVIDER`
(`resend` or `brevo`), `MUNI_AI_PROVIDER` (`none`), `MUNI_SIGNIN_CODES_PER_NETWORK_DAILY` (30), `MUNI_SIGNIN_EMAILS_DAILY_LIMIT`
(60 — keep it under your provider's daily quota; invitations and reminders need the rest).

## 3. Secrets, schema, deploy

```bash
pnpm exec wrangler secret put RESEND_API_KEY --config wrangler.production.jsonc   # or BREVO_API_KEY
pnpm migrate:remote                                                              # additive migrations
cd ../web && npm ci && npm run build && cd ../worker
pnpm run deploy
```

The Worker attaches itself to `MUNI_DOMAIN` as a custom domain. Open `https://<your domain>`, sign
in with your email, and create a workspace. Until the email secret is set, sign-in answers
`setup_required` instead of pretending to send.

AI-drafted themes are off by default. To offer them, render with `MUNI_AI_PROVIDER=anthropic` and
add `ANTHROPIC_API_KEY` as a secret; each sprint still opts in before collection starts, and entry
text (no names or emails) is then sent to that provider.

## Updating

Pull, rebuild the web app, then `pnpm migrate:remote && pnpm run deploy`. Migrations are additive
(new tables and columns, no drops), so the previous Worker keeps working against a newer schema.
`pnpm exec wrangler rollback --config wrangler.production.jsonc` restores the previous Worker
version; migrations are not reversed.

## Deploying from GitHub Actions (optional)

`.github/workflows/deploy.yml` is manual-only and runs only in the repository it names. For your
own fork, change that guard, then create an environment called `production` limited to your main
branch, with:

- secrets `CLOUDFLARE_API_TOKEN` (an API token scoped to one account: Workers Scripts edit,
  D1 edit, Workers Routes edit — not a Global API Key) and `CLOUDFLARE_ACCOUNT_ID`;
- variables `MUNI_DOMAIN`, `MUNI_D1_DATABASE_ID`, `MUNI_EMAIL_FROM`.

Pull-request workflows never receive these: `ci.yml` runs with a read-only token and no secrets.

## Operations

- **Logs.** Workers Logs keeps request metadata (method, URL, redacted headers) for 3 days on the
  Free plan and 7 on Paid; the app itself logs failures only, without content.
- **Backups.** D1 Time Travel restores to any point in the last 7 (Free) or 30 (Paid) days. An
  export (`wrangler d1 export … --remote`) contains the private author columns: protect and expire
  it like the database itself.
- **Costs.** One team fits comfortably in the Workers Free plan (see the capacity note in
  `ARCHITECTURE.md`). Allowances are per account and shared with anything else you run there.
- **Access.** Anyone with your Cloudflare account or an API token for it can read the database.
  Use MFA on the account and keep tokens narrowly scoped.
- **Your privacy page.** The app's Privacy & data page (`web/src/routes/Privacy.tsx`) describes the
  hosted act.munimuni.app: its operator, contact address and providers. Change those for your
  deployment, and check the rest against [`privacy-claims.md`](privacy-claims.md) — for example if you
  use Brevo or turn AI on.
