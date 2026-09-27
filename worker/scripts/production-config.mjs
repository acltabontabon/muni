/**
 * Renders wrangler.production.jsonc (gitignored) for *your* Cloudflare account from environment
 * variables, or checks the one you already have. `pnpm run deploy` and `pnpm migrate:remote` run
 * this first, so no remote command works from a fresh checkout until production is configured.
 *
 * Required: MUNI_DOMAIN (e.g. muni.example.com), MUNI_D1_DATABASE_ID (from `wrangler d1 create`),
 *           MUNI_EMAIL_FROM (e.g. "Muni <hello@example.com>", a sender your email provider accepts).
 * Optional: MUNI_WORKER_NAME (muni), MUNI_D1_DATABASE_NAME (muni), MUNI_EMAIL_PROVIDER (resend),
 *           MUNI_AI_PROVIDER (none). Email is for invitations and reminders; nobody signs in by email.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const dir = new URL('..', import.meta.url).pathname
const out = `${dir}wrangler.production.jsonc`
const template = readFileSync(`${dir}wrangler.production.example.jsonc`, 'utf8')
const env = process.env
const defaults = {
  MUNI_WORKER_NAME: 'muni',
  MUNI_D1_DATABASE_NAME: 'muni',
  MUNI_EMAIL_PROVIDER: 'resend',
  MUNI_AI_PROVIDER: 'none',
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
  if (!['none', 'anthropic'].includes(values.MUNI_AI_PROVIDER)) fail('MUNI_AI_PROVIDER must be none or anthropic')
  const rendered = template.replace(/\$\{(MUNI_[A-Z0-9_]+)\}/g, (_, k) => {
    if (!(k in values)) fail(`the template uses ${k}, which has no value`)
    return JSON.stringify(String(values[k])).slice(1, -1)
  })
  writeFileSync(out, `// Rendered by scripts/production-config.mjs — gitignored, specific to one Cloudflare account.\n${rendered}`)
  console.log(`production config: wrote wrangler.production.jsonc for ${values.MUNI_DOMAIN}`)
} else if (existsSync(out)) {
  if (/\$\{MUNI_|REPLACE_WITH/.test(readFileSync(out, 'utf8'))) fail('wrangler.production.jsonc still has placeholders')
  console.log('production config: using the existing wrangler.production.jsonc')
} else {
  fail(`no production config. Set ${required.join(', ')} (and optional overrides), or create wrangler.production.jsonc`)
}
