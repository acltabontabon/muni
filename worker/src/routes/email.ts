/**
 * The address invitations and reminders go to, if the account has one (it comes from accepting an
 * emailed invitation). It is never a way to sign in. Removing it just stops that mail.
 */
import { Hono } from 'hono'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireAuth, securityEvent } from '../lib/auth'
import { clearAccountEmail } from '../lib/accounts'

export const email = new Hono<HonoEnv>()

email.delete('/api/me/email', async (c) => {
  const a = await requireAuth(c, config(c.env), c.env.DB)
  if (!a.account.email) return c.json({ ok: true })
  await clearAccountEmail(c.env.DB, a.account.id)
  await securityEvent(c.env.DB, a.account.id, 'email.removed')
  return c.json({ ok: true })
})
