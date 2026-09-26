-- Participant-controlled encryption (docs/ENCRYPTION.md).
--
-- `sprints.encryption` is NULL for every sprint created before this migration: those stay
-- plaintext and are labelled as not encrypted. 'e1' marks a sprint whose content fields hold
-- only client-encrypted envelopes ("e1." strings); the server refuses plaintext for them.
ALTER TABLE sprints ADD COLUMN encryption TEXT;

-- One X25519 public key per account. `recovery_blob` is the private key encrypted under a
-- recovery key that only the person holds; the server cannot open it.
CREATE TABLE account_keys (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  recovery_blob TEXT,
  recovery_confirmed_at INTEGER,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A sprint's public key, per version (a new version when collection reopens).
CREATE TABLE sprint_keys (
  sprint_id TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sprint_id, version)
);

-- The sprint secret, sealed by a client to one person's account key. Useless without that
-- person's private key. Only the facilitator holds one while a version is collecting.
CREATE TABLE sprint_key_wraps (
  sprint_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_public_key TEXT NOT NULL,
  wrapped TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sprint_id, version, account_id),
  FOREIGN KEY (sprint_id, version) REFERENCES sprint_keys(sprint_id, version) ON DELETE CASCADE
);
