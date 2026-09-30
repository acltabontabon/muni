-- Passkey-first accounts (docs/passkeys.md): an account is its id and its passkeys; an email
-- address is an optional, verified setting.
--
-- `accounts` is deliberately NOT rebuilt. Making `accounts.email` nullable would need a table
-- rebuild, and dropping a parent table in D1 runs an implicit DELETE whose ON DELETE CASCADE
-- actions would wipe memberships, sessions and keys. Instead verified addresses move to
-- `account_emails`, and `accounts.email` becomes a legacy column that the code no longer reads:
-- new accounts store the placeholder '@' || id there (unique, and never a valid address because
-- nothing can precede the '@'), and removing or changing an address scrubs it the same way.

CREATE TABLE account_emails (
    account_id   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    email        TEXT NOT NULL UNIQUE,
    verified_at  INTEGER NOT NULL
);
-- Every existing address was proven with a one-time code when the account was made.
INSERT INTO account_emails (account_id, email, verified_at)
  SELECT id, email, created_at FROM accounts WHERE email NOT LIKE '@%';

-- Codes now serve three purposes, each bound to what it may do: signing in to an existing
-- account, adding an address to the signed-in account, and confirming an emailed invitation.
ALTER TABLE verification_challenges ADD COLUMN purpose TEXT NOT NULL DEFAULT 'signin';
ALTER TABLE verification_challenges ADD COLUMN account_id TEXT;

-- Challenges gain the 'signup' ceremony (a new account's first passkey) and carry the pending
-- account's handle and name until the registration is verified. The table holds only
-- five-minute, single-use rows and nothing references it, so it is rebuilt (in-flight
-- ceremonies at deploy time simply ask the person to try again).
CREATE TABLE webauthn_challenges_v2 (
    id            TEXT PRIMARY KEY,
    challenge     TEXT NOT NULL UNIQUE,
    ceremony      TEXT NOT NULL CHECK (ceremony IN ('register','authenticate','reauth','signup')),
    account_id    TEXT,
    session_id    TEXT,
    binding_hash  TEXT,
    pending_handle TEXT,
    pending_name  TEXT,
    expires_at    INTEGER NOT NULL,
    consumed_at   INTEGER,
    created_at    INTEGER NOT NULL
);
DROP TABLE webauthn_challenges;
ALTER TABLE webauthn_challenges_v2 RENAME TO webauthn_challenges;
CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at);

-- Invite links: 'approval' (a team QR — each request needs a manager) or 'direct' (a personal,
-- single-use link that joins whoever redeems it first, signed in). `redeemed_by` records that one use.
ALTER TABLE join_links ADD COLUMN mode TEXT NOT NULL DEFAULT 'approval' CHECK (mode IN ('approval','direct'));
ALTER TABLE join_links ADD COLUMN redeemed_by TEXT;
ALTER TABLE join_links ADD COLUMN redemption_id TEXT;

-- The winning decision in a batch is identified by a random nonce, not a timestamp: two
-- managers (or tabs) acting in the same millisecond must not both count as the decider.
ALTER TABLE join_requests ADD COLUMN decision_nonce TEXT;
