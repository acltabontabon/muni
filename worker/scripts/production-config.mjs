/**
 * Renders wrangler.production.jsonc (gitignored) for *your* Cloudflare account from environment
 * variables, or checks the one you already have. `pnpm run deploy` and `pnpm migrate:remote` run
 * this first, so no remote command works from a fresh checkout until production is configured.
 *
 * Required: MUNI_DOMAIN (e.g. muni.example.com), MUNI_D1_DATABASE_ID (from `wrangler d1 create`),
 *           MUNI_EMAIL_FROM (e.g. "Muni <hello@example.com>", a sender your email provider accepts).
 * Optional: MUNI_WORKER_NAME (muni), MUNI_D1_DATABASE_NAME (muni), MUNI_EMAIL_PROVIDER (resend),
 *           MUNI_EMAIL_DAILY_LIMIT (80: the most emails Muni sends in a day; keep it below your
 *           provider's daily quota). Email is for invitations and reminders; nobody signs in by email.
 *           MUNI_EDGE_LIMIT_NAMESPACE (1001: the edge rate limiter's namespace, a positive integer
 *           unique among the rate limiters on your Cloudflare account).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const dir = new URL('..', import.meta.url).pathname
const out = `${dir}wrangler.production.jsonc`
const template = readFileSync(`${dir}wrangler.production.example.jsonc`, 'utf8')
const env = process.env
/**
 * The edge rate limit (the `EDGE_LIMIT` binding, worker/src/lib/ratelimit.ts `edgeLimit`): requests
 * one address may make per period to the signed-out paths — /api/auth/*, /api/join/*,
 * /api/invitations/*, except GETs — before the Worker answers 429 without touching D1. Joining is
 * about four requests (the passkey's two, a name, the request to join), so 60 a minute is fifteen
 * people behind one office address scanning the team's QR in the same minute; the D1 limits behind
 * it are tighter per ten minutes. Cloudflare allows a period of 10 or 60 seconds.
 */
const EDGE_LIMIT = { requests: 60, periodSeconds: 60 }
const defaults = {
  MUNI_WORKER_NAME: 'muni',
  MUNI_D1_DATABASE_NAME: 'muni',
  MUNI_EMAIL_PROVIDER: 'resend',
  MUNI_EMAIL_DAILY_LIMIT: '80',
  MUNI_EDGE_LIMIT_NAMESPACE: '1001',
}
const required = ['MUNI_DOMAIN', 'MUNI_D1_DATABASE_ID', 'MUNI_EMAIL_FROM']
const fail = (msg) => {
  console.error(`production config: ${msg}\nSee docs/DEPLOYMENT.md.`)
  process.exit(1)
}

if (required.some((k) => env[k])) {
  const missing = required.filter((k) => !env[k])
  if (missing.length) fail(`set ${missing.join(', ')} as well`)
  const values = { ...defaults, ...Object.fromEntries(Object.keys(defaults).filter((k) => env[k]).map((k) => [k, env[k]])), ...Object.fromEntries(required.map((k) => [k, env[k]])) }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(values.MUNI_DOMAIN)) fail('MUNI_DOMAIN must be a bare host name, like muni.example.com')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.MUNI_D1_DATABASE_ID)) fail('MUNI_D1_DATABASE_ID must be the UUID printed by `wrangler d1 create`')
  if (!['resend', 'brevo'].includes(values.MUNI_EMAIL_PROVIDER)) fail('MUNI_EMAIL_PROVIDER must be resend or brevo')
  if (!/^[1-9]\d{0,6}$/.test(values.MUNI_EMAIL_DAILY_LIMIT)) fail('MUNI_EMAIL_DAILY_LIMIT must be a whole number of emails a day, like 80')
  if (!/^[1-9]\d{0,9}$/.test(values.MUNI_EDGE_LIMIT_NAMESPACE)) fail('MUNI_EDGE_LIMIT_NAMESPACE must be a positive whole number, like 1001')
  // Not overridable: the limit is part of the code's design, not the account's.
  values.MUNI_EDGE_LIMIT_REQUESTS = String(EDGE_LIMIT.requests)
  values.MUNI_EDGE_LIMIT_PERIOD = String(EDGE_LIMIT.periodSeconds)
  const rendered = template.replace(/\$\{(MUNI_[A-Z0-9_]+)\}/g, (_, k) => {
    if (!(k in values)) fail(`the template uses ${k}, which has no value`)
    return JSON.stringify(String(values[k])).slice(1, -1)
  })
  writeFileSync(out, `// Rendered by scripts/production-config.mjs — gitignored, specific to one Cloudflare account.\n${rendered}`)
  console.log(`production config: wrote wrangler.production.jsonc for ${values.MUNI_DOMAIN}`)
} else if (existsSync(out)) {
  const existing = readFileSync(out, 'utf8')
  if (/\$\{MUNI_|REPLACE_WITH/.test(existing)) fail('wrangler.production.jsonc still has placeholders')
  // Rendered before the edge rate limiter existed: it deploys without one (the Worker works either
  // way), so say how to add it.
  if (!/"ratelimits"/.test(existing)) console.warn('production config: wrangler.production.jsonc has no edge rate limiter (EDGE_LIMIT). Render it again (set MUNI_DOMAIN, MUNI_D1_DATABASE_ID and MUNI_EMAIL_FROM) to add it.')
  console.log('production config: using the existing wrangler.production.jsonc')
} else {
  fail(`no production config. Set ${required.join(', ')} (and optional overrides), or create wrangler.production.jsonc`)
}
