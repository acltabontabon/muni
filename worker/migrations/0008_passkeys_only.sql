-- Passkeys are the only way into an account (docs/passkeys.md). Email sign-in, email re-auth,
-- recovery emails and their codes are gone.
--
-- 1. Accounts that can no longer sign in — no passkey — are deleted, with everything that is theirs,
--    and so are workspaces left with no one who can sign in. (At this point the only such
--    accounts are the operator's own early test accounts.) Rows that reference an account or a
--    workspace without a foreign key are removed explicitly, so nothing is left orphaned.
-- 2. Sessions that came from email codes are ended, and the codes table is dropped.
-- 3. `accounts.email` stops being an email column. It can't be dropped (it's UNIQUE) and the table
--    can't be rebuilt (in D1, dropping `accounts` cascades into every table that references it —
--    tested, see docs/passkeys.md), so it's renamed to `legacy_key` and holds the account's own id:
--    no address, and nothing reads it. Addresses for invitations and reminders live in
--    `account_emails`, and are never a way in.

-- Who is going, and which workspaces go with them (every member is going).
CREATE TABLE _gone_accounts AS
  SELECT id FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM webauthn_credentials w WHERE w.account_id = a.id);
CREATE TABLE _gone_workspaces AS
  SELECT w.id FROM workspaces w
  WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id AND m.account_id NOT IN (SELECT id FROM _gone_accounts));
CREATE TABLE _gone_sprints AS
  SELECT id FROM sprints WHERE workspace_id IN (SELECT id FROM _gone_workspaces);

-- Rows that point at them without a foreign key.
DELETE FROM jobs WHERE status IN ('queued','running') AND (
  json_extract(payload, '$.sprint_id') IN (SELECT id FROM _gone_sprints)
  OR json_extract(payload, '$.to') IN (SELECT email FROM account_emails WHERE account_id IN (SELECT id FROM _gone_accounts))
);
DELETE FROM jobs WHERE kind = 'ai_grouping' AND json_extract(payload, '$.ai_job_id') IN (SELECT id FROM ai_jobs WHERE sprint_id IN (SELECT id FROM _gone_sprints));
DELETE FROM audit_events WHERE workspace_id IN (SELECT id FROM _gone_workspaces) OR actor_id IN (SELECT id FROM _gone_accounts);
DELETE FROM ai_usage WHERE workspace_id IN (SELECT id FROM _gone_workspaces);
DELETE FROM security_events WHERE account_id IN (SELECT id FROM _gone_accounts);
DELETE FROM webauthn_challenges WHERE account_id IN (SELECT id FROM _gone_accounts);
DELETE FROM dev_mail WHERE to_addr IN (SELECT email FROM account_emails WHERE account_id IN (SELECT id FROM _gone_accounts));
-- What they wrote, voted or added in workspaces that stay.
DELETE FROM entries WHERE author_account_id IN (SELECT id FROM _gone_accounts);
DELETE FROM votes WHERE account_id IN (SELECT id FROM _gone_accounts);
DELETE FROM context_additions WHERE author_account_id IN (SELECT id FROM _gone_accounts);
UPDATE experiments SET owner_account_id = NULL, owner_accepted_at = NULL WHERE owner_account_id IN (SELECT id FROM _gone_accounts);
DELETE FROM invitations WHERE invited_by IN (SELECT id FROM _gone_accounts) OR accepted_by IN (SELECT id FROM _gone_accounts);
UPDATE join_links SET redeemed_by = NULL WHERE redeemed_by IN (SELECT id FROM _gone_accounts);
DELETE FROM join_links WHERE created_by IN (SELECT id FROM _gone_accounts);
UPDATE join_requests SET decided_by = NULL WHERE decided_by IN (SELECT id FROM _gone_accounts);
UPDATE sprint_keys SET created_by = NULL WHERE created_by IN (SELECT id FROM _gone_accounts);
UPDATE sprint_key_wraps SET created_by = NULL WHERE created_by IN (SELECT id FROM _gone_accounts);

-- The workspaces (sprints, entries, themes, votes, keys, links… cascade), then the accounts
-- (memberships, sessions, keys, passkey wraps, addresses… cascade).
DELETE FROM workspaces WHERE id IN (SELECT id FROM _gone_workspaces);
DELETE FROM accounts WHERE id IN (SELECT id FROM _gone_accounts);
DROP TABLE _gone_sprints;
DROP TABLE _gone_workspaces;
DROP TABLE _gone_accounts;

-- 2. No session from an email code survives, and codes can't be redeemed: the table is gone.
DELETE FROM sessions WHERE auth_method <> 'passkey';
DROP INDEX IF EXISTS verification_email_idx;
DROP TABLE verification_challenges;

-- 3. Not an email column any more.
ALTER TABLE accounts RENAME COLUMN email TO legacy_key;
UPDATE accounts SET legacy_key = id;
