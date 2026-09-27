/**
 * Accounts and their optional email address. An account is its id and its passkeys; a verified
 * address lives in `account_emails` (at most one per account, each address on at most one
 * account). `accounts.email` is a legacy column that nothing reads (migration 0005): it holds a
 * placeholder that can never be an address, so it can't collide with or reveal a real one.
 */
import { batch, one } from './db'

export const placeholderEmail = (accountId: string) => `@${accountId}`

/** SQL for the account's verified address, given the accounts table aliased as `a`. */
export const EMAIL_OF_A = '(SELECT ae.email FROM account_emails ae WHERE ae.account_id = a.id)'

export async function emailOf(db: D1Database, accountId: string): Promise<string | null> {
  return (await one<{ email: string }>(db, 'SELECT email FROM account_emails WHERE account_id = ?', accountId))?.email ?? null
}

export async function accountByEmail(db: D1Database, email: string): Promise<string | null> {
  return (await one<{ account_id: string }>(db, 'SELECT account_id FROM account_emails WHERE email = ?', email))?.account_id ?? null
}

/**
 * Attach a verified address, replacing any previous one. Returns false if the address already
 * belongs to another account (the unique index decides, so two racing claims can't both win).
 */
export async function setAccountEmail(db: D1Database, accountId: string, email: string): Promise<boolean> {
  const owner = await accountByEmail(db, email)
  if (owner && owner !== accountId) return false
  try {
    await batch(db, [
      ['INSERT INTO account_emails (account_id, email, verified_at) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at', accountId, email, Date.now()],
      ['UPDATE accounts SET email = ? WHERE id = ?', placeholderEmail(accountId), accountId],
    ])
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return false
    throw e
  }
  return true
}

export async function clearAccountEmail(db: D1Database, accountId: string) {
  await batch(db, [
    ['DELETE FROM account_emails WHERE account_id = ?', accountId],
    ['UPDATE accounts SET email = ? WHERE id = ?', placeholderEmail(accountId), accountId],
  ])
}

/** A new, passkey-only account. The name was chosen by the person; no address is needed. */
export function newAccountStatement(accountId: string, displayName: string, userHandle: string): [string, ...unknown[]] {
  const now = Date.now()
  return ['INSERT INTO accounts (id, email, display_name, created_at, name_set_at, webauthn_user_id) VALUES (?,?,?,?,?,?)', accountId, placeholderEmail(accountId), displayName, now, now, userHandle]
}

