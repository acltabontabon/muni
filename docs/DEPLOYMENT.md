# Deploying Muni on your own Cloudflare account

Muni runs on Cloudflare's developer platform: one Worker (serving the API and the built web app),
one D1 database, one Durable Object class and one cron trigger. That is the only supported
deployment. You need a Cloudflare account, a domain on it for the app, and an email provider for
invitations and sprint reminders (Resend or Brevo; both have free tiers). Nobody signs in by
email: passkeys are the only way in.

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
(`resend` or `brevo`), and `MUNI_EMAIL_DAILY_LIMIT` (`80`): the most emails Muni sends in a day.
Keep it below your provider's daily quota (Resend's free plan allows 100), so invitations can't use
up what reminders need; past it, an email fails in the `jobs` table, saying so. Each account can
also send at most 20 invitation emails and create at most 10 workspaces a day.

## 3. Secrets, schema, deploy

```bash
pnpm exec wrangler secret put RESEND_API_KEY --config wrangler.production.jsonc   # or BREVO_API_KEY
pnpm migrate:remote                                                              # creates the schema
cd ../web && npm ci && npm run build && cd ../worker
pnpm run deploy
```

The Worker attaches itself to `MUNI_DOMAIN` as a custom domain. Open `https://<your domain>`,
create an account with a passkey, and create a workspace. Until the email secret is set, invitation
and reminder emails aren't delivered: each fails with `setup_required` in the `jobs` table. The
invite dialog still shows the invitation's link to copy, and join links and QR codes work without
email.

## Updating

Update to a release tag (`git checkout v1.2.0`; the changelog says what changed and whether you must do
anything), then install, build and deploy:

```bash
cd web && npm ci && npm run build && cd ../worker
pnpm install --frozen-lockfile && pnpm migrate:remote && pnpm run deploy
```

`GET /api/version` reports what's running. Within a major, migrations are additive
([RELEASING.md](RELEASING.md) §2), so the previous Worker keeps working against a newer schema.
`pnpm exec wrangler rollback --config wrangler.production.jsonc` restores the previous Worker
version; migrations are not reversed.

**Passkeys** need no secret: the relying-party ID is rendered from `MUNI_DOMAIN` as
`WEBAUTHN_RP_ID`; if it isn't exactly `PUBLIC_ORIGIN`'s host, every request answers
`500 misconfigured` until it is. Passkeys registered on one host can't be used on another, so moving
the app to a new domain means everyone creates new passkeys there — there's no other way in, so plan
it with your users (see [PASSKEYS.md](PASSKEYS.md) §2 and §5).
The real-device test matrix is in [PASSKEYS.md](PASSKEYS.md#8-tests).

## Releasing from GitHub Actions

act.munimuni.app is released by pushing a version tag: `.github/workflows/release.yml` checks the
tag against the committed version and changelog, runs every test, applies migrations, deploys the
Worker, verifies production from outside and publishes the GitHub release. The process, the
configuration it needs (an environment called `production` that admits only `v*` tags, a scoped API
token, three variables and an optional fourth) and recovery are in [RELEASING.md](RELEASING.md). The workflow runs only in
the repository it names; for your own fork, change that guard.

Pull-request workflows never receive these: `ci.yml` runs with a read-only token and no secrets.
To check any deployment from outside: `node scripts/verify-deploy.mjs https://<your domain> <version>`.

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
  use Brevo.
