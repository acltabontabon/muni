-- Unlocking encrypted content with a passkey, and keeping a device unlockable across sign-out
-- (docs/encryption.md, "Keys"). Additive only: account_keys, sprint keys and wraps are untouched, and no
-- parent table is rebuilt (a D1 parent-table drop would cascade; see 0005).
--
-- Neither table lets the server open anything. A passkey wrap is the account's private key
-- encrypted under a key derived in the browser from the passkey's PRF output, which never leaves
-- the browser. A device share is half of the input to a device's key; the other half and the
-- encrypted key itself exist only on that device.

-- One wrap per passkey that can unlock the account key. Deleting the passkey deletes its wrap.
CREATE TABLE passkey_key_wraps (
    credential_id  TEXT PRIMARY KEY REFERENCES webauthn_credentials(id) ON DELETE CASCADE,  -- our uuid
    account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key_version    INTEGER NOT NULL,        -- account_keys.key_version it opens to
    public_key     TEXT NOT NULL,           -- account public key it opens to (checked by the browser)
    wrapped        TEXT NOT NULL,           -- 'p1.' envelope
    created_at     INTEGER NOT NULL,
    last_used_at   INTEGER
);
CREATE INDEX passkey_key_wraps_account_idx ON passkey_key_wraps(account_id);

-- Devices that can reopen the account key after signing in again. `share` is released only to a
-- session of the account; when `requires_passkey` is set, only to one started with a passkey that
-- existed when the device was bound (`bound_at`), so an email code alone never unlocks it.
CREATE TABLE device_unlocks (
    id               TEXT PRIMARY KEY,      -- chosen by the device (uuid)
    account_id       TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    share            TEXT NOT NULL,         -- 32 random bytes, base64url
    key_version      INTEGER NOT NULL,
    requires_passkey INTEGER NOT NULL DEFAULT 1,
    bound_at         INTEGER NOT NULL,
    label            TEXT,                  -- coarse "Safari on iPhone", shown only to the account holder
    created_at       INTEGER NOT NULL,
    last_used_at     INTEGER
);
CREATE INDEX device_unlocks_account_idx ON device_unlocks(account_id);
