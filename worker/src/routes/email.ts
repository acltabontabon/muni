/**
 * The account's optional email address. Adding one enables: signing in with a code if every
 * passkey is lost, email invitations sent to that address, and sprint reminder emails. It is
 * never needed to sign in. Every change needs a recent sign-in; removing the address needs at
 * least one passkey, so no account is left without a way in.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireAuth, requireRecentAuth, securityEvent } from '../lib/auth'
import { accountByEmail, clearAccountEmail, setAccountEmail } from '../lib/accounts'
import { issueCode, spendCode } from '../lib/codes'
import { count } from '../lib/db'
import { AppError, bad } from '../lib/errors'
import { normalizeEmail } from '../lib/util'

export const email = new Hono<HonoEnv>()

/** Send a code to the address. The answer is the same whether or not another account has it. */
email.post('/api/me/email/request', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  requireRecentAuth(a)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string }
  const address = normalizeEmail(body.email ?? '')
  if (!address) throw bad('enter a valid email address')
  if (address === a.account.email) throw bad('that’s already your address')
  return c.json(await issueCode(c, cfg, address, 'add_email', a.account.id))
})

/**
 * Prove the mailbox, then keep the address. Only after the code is verified does the answer say
 * that the address is on another account (and so tell nothing to someone who doesn't control it).
 */
email.post('/api/me/email/verify', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  requireRecentAuth(a)
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; code?: string }
  const address = normalizeEmail(body.email ?? '')
  if (!address) throw bad('enter a valid email address')
  await spendCode(c.env.DB, address, body.code, 'add_email', a.account.id)
  const owner = await accountByEmail(c.env.DB, address)
  if ((owner && owner !== a.account.id) || !(await setAccountEmail(c.env.DB, a.account.id, address)))
    throw new AppError(409, 'email_in_use', 'that address is on another Muni account — if it’s yours, sign in to that account with “Used Muni before?”')
  await securityEvent(c.env.DB, a.account.id, a.account.email ? 'email.changed' : 'email.added')
  return c.json({ ok: true, email: address })
})

email.delete('/api/me/email', async (c) => {
  const cfg = config(c.env)
  const a = await requireAuth(c, cfg, c.env.DB)
  requireRecentAuth(a)
  if (!a.account.email) return c.json({ ok: true })
  const passkeys = await count(c.env.DB, 'SELECT count(*) AS n FROM webauthn_credentials WHERE account_id = ?', a.account.id)
  if (passkeys === 0) throw new AppError(409, 'last_method', 'add a passkey first — without an address or a passkey there would be no way to sign in')
  await clearAccountEmail(c.env.DB, a.account.id)
  await securityEvent(c.env.DB, a.account.id, 'email.removed')
  return c.json({ ok: true })
})
