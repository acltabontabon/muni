-- Passkeys, session details, security events and approval-based team invitations
-- (docs/passkeys.md). Additive only: existing accounts, sessions, memberships, invitations and
-- encryption keys are untouched and keep working. Email codes remain a sign-in method for everyone.

-- An opaque, random WebAuthn user handle per account (base64url of 32 random bytes), minted the
-- first time the account adds a passkey. Never the account id, never an email address.
ALTER TABLE accounts ADD COLUMN webauthn_user_id TEXT;
CREATE UNIQUE INDEX accounts_webauthn_user_idx ON accounts(webauthn_user_id) WHERE webauthn_user_id IS NOT NULL;

-- One row per registered passkey. Stores only what verification needs, plus a label the person
-- chose. No attestation, no AAGUID, nothing that identifies a device model or a person.
CREATE TABLE webauthn_credentials (
    id             TEXT PRIMARY KEY,               -- our uuid (used in URLs and security events)
    credential_id  TEXT NOT NULL UNIQUE,           -- base64url credential id from the authenticator
    account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    public_key     TEXT NOT NULL,                  -- base64url COSE public key
    counter        INTEGER NOT NULL DEFAULT 0,
    transports     TEXT NOT NULL DEFAULT '[]',     -- JSON array, used only as hints for the browser
    backup_eligible INTEGER NOT NULL DEFAULT 0,    -- multi-device (synced) credential
    backed_up      INTEGER NOT NULL DEFAULT 0,
    name           TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    last_used_at   INTEGER
);
CREATE INDEX webauthn_credentials_account_idx ON webauthn_credentials(account_id);

-- Single-use, expiring WebAuthn challenges. `binding_hash` ties a sign-in challenge to the browser
-- that asked for it (a short-lived HttpOnly cookie); registration and re-authentication
-- challenges are also tied to the session and account that asked.
CREATE TABLE webauthn_challenges (
    id            TEXT PRIMARY KEY,
    challenge     TEXT NOT NULL UNIQUE,
    ceremony      TEXT NOT NULL CHECK (ceremony IN ('register','authenticate','reauth')),
    account_id    TEXT,
    session_id    TEXT,
    binding_hash  TEXT,
    expires_at    INTEGER NOT NULL,
    consumed_at   INTEGER,
    created_at    INTEGER NOT NULL
);
CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at);

-- How and when each session last proved control of the account. `authenticated_at` drives the
-- recent-authentication check for security-sensitive changes. Existing sessions came from email codes.
ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'email';
ALTER TABLE sessions ADD COLUMN authenticated_at INTEGER;
ALTER TABLE sessions ADD COLUMN credential_ref TEXT;   -- webauthn_credentials.id for passkey sessions
ALTER TABLE sessions ADD COLUMN client_label TEXT;     -- coarse "Safari on iOS", shown only to the account holder
UPDATE sessions SET authenticated_at = created_at WHERE authenticated_at IS NULL;

-- Account-level security history shown to the account holder. Ids and coarse labels only: never
-- codes, tokens, raw WebAuthn responses, invitation tokens or content.
CREATE TABLE security_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  TEXT NOT NULL,
    kind        TEXT NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL
);
CREATE INDEX security_events_account_idx ON security_events(account_id, id DESC);

-- Invitations grant an explicit, least-privilege role. Only 'member' exists for invitations:
-- ownership is never granted by an invitation, implicitly or otherwise.
ALTER TABLE invitations ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role = 'member');

-- Shared team invitations (the invite QR). A link never admits anyone by itself: it lets a
-- signed-in person ask to join, and a manager approves each request. Only the token's hash is kept.
CREATE TABLE join_links (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sprint_id      TEXT REFERENCES sprints(id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL UNIQUE,
    role           TEXT NOT NULL DEFAULT 'member' CHECK (role = 'member'),
    created_by     TEXT NOT NULL,
    max_requests   INTEGER NOT NULL,
    request_count  INTEGER NOT NULL DEFAULT 0,
    expires_at     INTEGER NOT NULL,
    revoked_at     INTEGER,
    created_at     INTEGER NOT NULL
);
CREATE INDEX join_links_workspace_idx ON join_links(workspace_id, created_at DESC);

CREATE TABLE join_requests (
    id            TEXT PRIMARY KEY,
    link_id       TEXT NOT NULL REFERENCES join_links(id) ON DELETE CASCADE,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sprint_id     TEXT,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn','expired')),
    created_at    INTEGER NOT NULL,
    decided_at    INTEGER,
    decided_by    TEXT
);
-- One open request per person per workspace, however many tabs, scans or links.
CREATE UNIQUE INDEX join_requests_one_pending ON join_requests(workspace_id, account_id) WHERE status = 'pending';
CREATE INDEX join_requests_workspace_idx ON join_requests(workspace_id, status, created_at DESC);
CREATE INDEX join_requests_account_idx ON join_requests(account_id, created_at DESC);
