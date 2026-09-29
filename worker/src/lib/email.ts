/**
 * Email delivery behind an adapter, for the two things Muni mails: invitations and sprint reminders.
 * Messages carry neutral links, never entry content, and never sign anyone in. Free-tier HTTPS providers are supported; without one
 * configured in production the app reports "setup required" instead of
 * pretending.
 */
import type { Config } from './config'
import { run } from './db'
import { quota, setupRequired } from './errors'
import { record, underLimit } from './ratelimit'

export interface Mail {
  to: string
  subject: string
  body: string
}

/** Every email the server sends, counted against EMAIL_DAILY_LIMIT (kept below the provider's own quota). */
const SENT = 'email-sent'

export async function sendMail(cfg: Config, db: D1Database, mail: Mail): Promise<void> {
  if (cfg.email !== 'none' && !(await underLimit(db, SENT, cfg.emailDailyLimit, 86_400_000)))
    throw quota(`the daily email limit (${cfg.emailDailyLimit}) is reached, so this wasn’t sent`)
  await deliver(cfg, db, mail)
  await record(db, SENT)
}

async function deliver(cfg: Config, db: D1Database, mail: Mail): Promise<void> {
  switch (cfg.email) {
    case 'console': {
      // Development inbox: stored in D1 so `wrangler dev` and tests can read it. Never in production.
      await run(db, 'INSERT INTO dev_mail (id, to_addr, subject, body, created_at) VALUES (?,?,?,?,?)', crypto.randomUUID(), mail.to, mail.subject, mail.body, Date.now())
      return
    }
    case 'resend': {
      if (!cfg.resendApiKey) throw setupRequired('email is not configured on this server (RESEND_API_KEY missing)')
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: cfg.emailFrom, to: [mail.to], subject: mail.subject, text: mail.body }),
      })
      if (!r.ok) throw new Error(`resend: status ${r.status}`)
      return
    }
    case 'brevo': {
      if (!cfg.brevoApiKey) throw setupRequired('email is not configured on this server (BREVO_API_KEY missing)')
      const m = /^(.*)<([^>]+)>$/.exec(cfg.emailFrom.trim())
      const sender = m ? { name: m[1].trim() || 'Muni', email: m[2].trim() } : { name: 'Muni', email: cfg.emailFrom.trim() }
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': cfg.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender, to: [{ email: mail.to }], subject: mail.subject, textContent: mail.body }),
      })
      if (!r.ok) throw new Error(`brevo: status ${r.status}`)
      return
    }
    case 'none':
    default:
      throw setupRequired('email delivery isn’t set up on this server yet — invitations and reminders can’t be emailed. Ask the operator to configure an email provider, or invite with a link instead.')
  }
}

export const templates = {
  invitation: (to: string, workspace: string, inviter: string, link: string): Mail => ({
    to,
    subject: `${inviter} invited you to ${workspace} on Muni`,
    body: `${inviter} invited you to join the “${workspace}” workspace on Muni.\n\nOpen this invitation to join. You’ll sign in, or create an account, with a passkey:\n\n    ${link}\n\nThe link works once and expires in 14 days; whoever opens it first joins, so please don’t forward it.\n`,
  }),
  reminder: (to: string, sprint: string, kind: string, link: string): Mail => ({
    to,
    subject: `A note for the ${sprint} retro?`,
    body: `${kind === 'midpoint' ? 'You’re halfway through the sprint. If something is worth remembering for the retro, this is a good moment to note it.' : 'The retro is tomorrow. Anything from this sprint worth bringing? Add it while it’s fresh.'}\n\nOpen the sprint:\n\n    ${link}\n\nYou can turn these reminders off from the sprint page.\n`,
  }),
}
