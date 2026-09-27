/**
 * Accounts and the one address mail may go to. An account is its id and its passkeys: that's the
 * only way in. An address, if an account has one, is where invitations and reminders are sent
 * (`account_emails`: at most one per account, each address on at most one account); it never
 * signs anyone in. `accounts.legacy_key` holds the account's own id (migration 0008).
 */
import { one, run } from './db'

/** SQL for the account's verified address, given the accounts table aliased as `a`. */
export const EMAIL_OF_A = '(SELECT ae.email FROM account_emails ae WHERE ae.account_id = a.id)'

export async function emailOf(db: D1Database, accountId: string): Promise<string | null> {
  return (await one<{ email: string }>(db, 'SELECT email FROM account_emails WHERE account_id = ?', accountId))?.email ?? null
}

export async function accountByEmail(db: D1Database, email: string): Promise<string | null> {
  return (await one<{ account_id: string }>(db, 'SELECT account_id FROM account_emails WHERE email = ?', email))?.account_id ?? null
}

/**
 * Keep the address an emailed invitation was sent to (the link reached that mailbox). Returns false
 * if another account already has it (the unique index decides, so two racing claims can't both win).
 */
export async function setAccountEmail(db: D1Database, accountId: string, email: string): Promise<boolean> {
  const owner = await accountByEmail(db, email)
  if (owner && owner !== accountId) return false
  try {
    await run(db, 'INSERT INTO account_emails (account_id, email, verified_at) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at', accountId, email, Date.now())
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return false
    throw e
  }
  return true
}

export async function clearAccountEmail(db: D1Database, accountId: string) {
  await run(db, 'DELETE FROM account_emails WHERE account_id = ?', accountId)
}

/** A new account: a name the person chose, and (from its first passkey) nothing else. */
export function newAccountStatement(accountId: string, displayName: string, userHandle: string): [string, ...unknown[]] {
  const now = Date.now()
  return ['INSERT INTO accounts (id, legacy_key, display_name, created_at, name_set_at, webauthn_user_id) VALUES (?,?,?,?,?,?)', accountId, accountId, displayName, now, now, userHandle]
}

