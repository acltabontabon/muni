/**
 * One-time email codes. Three purposes, each bound to what it may do: signing in to an existing
 * account that has this address ('signin'), adding the address to the signed-in account
 * ('add_email'), and confirming an emailed invitation's address ('invite'). A code for one purpose
 * (or one account) can never be used for another. Limits are per address across all purposes,
 * so no purpose can be used to flood a mailbox.
 */
import type { Context } from 'hono'
import type { HonoEnv } from '../env'
import type { Config } from './config'
import { CODE_TTL_MS } from './auth'
import { constantTimeEqual, randomCode, sha256Hex, uuid } from './crypto'
import { one, run } from './db'
import { AppError, quota } from './errors'
import { sendMail, templates } from './email'
import { clientClass, limit } from './ratelimit'

export type CodePurpose = 'signin' | 'add_email' | 'invite'
const DAY_MS = 86_400_000
/** A new code can be sent once this long after the last one for the same address. */
export const RESEND_COOLDOWN_MS = 30_000
const codeHash = (code: string, challengeId: string) => sha256Hex(`${code}:${challengeId}`)

export async function issueCode(c: Context<HonoEnv>, cfg: Config, email: string, purpose: CodePurpose, accountId: string | null = null) {
  const db = c.env.DB
  const last = await one<{ created_at: number }>(db, 'SELECT created_at FROM verification_challenges WHERE email = ? ORDER BY created_at DESC LIMIT 1', email)
  if (last && Date.now() - last.created_at < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((last.created_at + RESEND_COOLDOWN_MS - Date.now()) / 1000)
    throw new AppError(429, 'resend_cooldown', `a code was just sent — you can ask for another in ${wait} seconds`, { retry_after_seconds: wait })
  }
  // Buckets hold hashes, so the limiter table never stores an address or an IP in the clear.
  const who = await sha256Hex(email)
  const net = await sha256Hex(clientClass(c.req.raw))
  await limit(db, `code:${who}`, 5, 15 * 60_000)
  await limit(db, `code-ip:${net}`, 120, 10 * 60_000)
  await limit(db, `code-ip-day:${net}`, cfg.signinCodesPerNetworkDaily, DAY_MS)
  await limit(db, 'code-all', cfg.signinEmailsDailyLimit, DAY_MS, () =>
    quota('Muni has sent all the emails it can for today. Please try again tomorrow; devices that are already signed in keep working.'),
  )
  const code = randomCode()
  const id = uuid()
  await run(db, 'INSERT INTO verification_challenges (id, email, code_hash, expires_at, created_at, purpose, account_id) VALUES (?,?,?,?,?,?,?)', id, email, await codeHash(code, id), Date.now() + CODE_TTL_MS, Date.now(), purpose, accountId)
  // Sent inline so the next step is immediate; provider errors are reported honestly.
  await sendMail(cfg, db, purpose === 'signin' ? templates.signInCode(email, code) : templates.confirmCode(email, code, purpose))
  return { sent: true, expires_in_minutes: CODE_TTL_MS / 60_000, resend_after_seconds: RESEND_COOLDOWN_MS / 1000 }
}

/** Checks and spends the newest code for this address and purpose (and account, if bound). */
export async function spendCode(db: D1Database, email: string, rawCode: unknown, purpose: CodePurpose, accountId: string | null = null) {
  await limit(db, `verify:${await sha256Hex(email)}`, 10, 15 * 60_000)
  const code = String(rawCode ?? '').replace(/\D/g, '')
  if (code.length !== 6) throw new AppError(400, 'code_format', 'the code is six digits')
  const ch = await one<{ id: string; code_hash: string; attempts: number; max_attempts: number; consumed_at: number | null; expires_at: number; account_id: string | null }>(
    db,
    'SELECT id, code_hash, attempts, max_attempts, consumed_at, expires_at, account_id FROM verification_challenges WHERE email = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1',
    email,
    purpose,
  )
  if (!ch || ch.expires_at <= Date.now() || (accountId !== null && ch.account_id !== accountId)) throw new AppError(400, 'code_expired', 'that code has expired — send a new one')
  if (ch.consumed_at) throw new AppError(400, 'code_used', 'that code was already used — send a new one')
  if (ch.attempts >= ch.max_attempts) throw new AppError(400, 'code_locked', 'too many wrong tries for this code — send a new one')
  if (!constantTimeEqual(ch.code_hash, await codeHash(code, ch.id))) {
    await run(db, 'UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = ?', ch.id)
    const left = ch.max_attempts - ch.attempts - 1
    if (left <= 0) throw new AppError(400, 'code_locked', 'that code doesn’t match, and it can’t be tried again — send a new one')
    throw new AppError(400, 'code_mismatch', 'that code doesn’t match', { attempts_left: left })
  }
  // Consume exactly once: the conditional update wins for a single concurrent verifier.
  const consumed = await run(db, 'UPDATE verification_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', Date.now(), ch.id)
  if (!consumed.meta.changes) throw new AppError(400, 'code_used', 'that code was already used — send a new one')
}
