-- `accounts.account_ref`: a unique copy of the account's own id. SQLite can't drop a UNIQUE column,
-- so it stays, under a name that says what it holds. Nothing reads it.
ALTER TABLE accounts RENAME COLUMN legacy_key TO account_ref;
