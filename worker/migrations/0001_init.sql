-- Muni schema for Cloudflare D1 (SQLite).
-- Ids are UUID strings minted by the Worker. Instants are INTEGER unix
-- milliseconds. Booleans are INTEGER 0/1. JSON is TEXT.
-- Columns marked PRIVATE carry ownership needed for authorization only and
-- must never be selected into a shared response type.

CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE workspaces (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    retention_days          INTEGER NOT NULL DEFAULT 90,
    outcome_retention_days  INTEGER NOT NULL DEFAULT 730,
    ai_enabled_default      INTEGER NOT NULL DEFAULT 0,
    is_demo                 INTEGER NOT NULL DEFAULT 0,
    created_at              INTEGER NOT NULL
);

CREATE TABLE memberships (
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('owner','member')),
    created_at    INTEGER NOT NULL,
    revoked_at    INTEGER,
    PRIMARY KEY (workspace_id, account_id)
);
CREATE INDEX memberships_account_idx ON memberships(account_id);

CREATE TABLE invitations (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email         TEXT NOT NULL,
    token_hash    TEXT NOT NULL UNIQUE,
    invited_by    TEXT NOT NULL,
    sprint_id     TEXT,
    expires_at    INTEGER NOT NULL,
    accepted_at   INTEGER,
    accepted_by   TEXT,
    revoked_at    INTEGER,
    created_at    INTEGER NOT NULL
);
CREATE INDEX invitations_workspace_idx ON invitations(workspace_id);

CREATE TABLE verification_challenges (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL,
    code_hash     TEXT NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    max_attempts  INTEGER NOT NULL DEFAULT 5,
    expires_at    INTEGER NOT NULL,
    consumed_at   INTEGER,
    created_at    INTEGER NOT NULL
);
CREATE INDEX verification_email_idx ON verification_challenges(email, created_at DESC);

CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    csrf_token    TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    revoked_at    INTEGER
);
CREATE INDEX sessions_account_idx ON sessions(account_id);

CREATE TABLE sprints (
    id                    TEXT PRIMARY KEY,
    workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    external_ref          TEXT,
    goal                  TEXT,
    opening_question      TEXT,
    timezone              TEXT NOT NULL,
    starts_on             TEXT NOT NULL,     -- YYYY-MM-DD
    ends_on               TEXT NOT NULL,
    retro_at              INTEGER NOT NULL,  -- instant
    retro_local_date      TEXT NOT NULL,     -- YYYY-MM-DD in timezone
    retro_local_time      TEXT NOT NULL,     -- HH:MM in timezone
    retro_duration_min    INTEGER NOT NULL DEFAULT 45,
    status                TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','collecting','preparing','ready','live','completed','archived')),
    ai_processing         INTEGER NOT NULL DEFAULT 0,
    ai_locked             INTEGER NOT NULL DEFAULT 0,
    reminders_enabled     INTEGER NOT NULL DEFAULT 1,
    vote_budget           INTEGER NOT NULL DEFAULT 3,
    include_facilitator_in_rotation INTEGER NOT NULL DEFAULT 0,
    grouping_revision     INTEGER NOT NULL DEFAULT 0,
    collection_opened_at  INTEGER,
    collection_closed_at  INTEGER,
    reopened_count        INTEGER NOT NULL DEFAULT 0,
    revealed_once         INTEGER NOT NULL DEFAULT 0,
    completed_at          INTEGER,
    archived_at           INTEGER,
    content_purged_at     INTEGER,
    session_started_at    INTEGER,           -- retro session bookkeeping (live state lives in the room object)
    session_ended_at      INTEGER,
    session_cancelled     INTEGER NOT NULL DEFAULT 0,
    created_by            TEXT NOT NULL,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    CHECK (starts_on <= ends_on)
);
CREATE INDEX sprints_workspace_idx ON sprints(workspace_id, starts_on DESC);
CREATE INDEX sprints_status_idx ON sprints(status);

CREATE TABLE sprint_participants (
    sprint_id           TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    is_facilitator      INTEGER NOT NULL DEFAULT 0,
    reminders_opt_out   INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    PRIMARY KEY (sprint_id, account_id)
);
CREATE INDEX sprint_participants_account_idx ON sprint_participants(account_id);

CREATE TABLE entries (
    id                 TEXT PRIMARY KEY,
    sprint_id          TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    author_account_id  TEXT NOT NULL,        -- PRIVATE
    category           TEXT CHECK (category IN ('proud','keep','improve','stop','try')),
    body               TEXT NOT NULL,
    impact             TEXT,
    might_help         TEXT,
    period             TEXT CHECK (period IN ('early','middle','late')),
    idempotency_key    TEXT,                 -- PRIVATE
    reveal_order       INTEGER,              -- random, assigned at collection close
    created_at         INTEGER NOT NULL,     -- PRIVATE
    updated_at         INTEGER NOT NULL      -- PRIVATE
);
CREATE INDEX entries_sprint_idx ON entries(sprint_id, reveal_order);
CREATE INDEX entries_author_idx ON entries(author_account_id, sprint_id);
CREATE UNIQUE INDEX entries_idempotency_idx ON entries(sprint_id, author_account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE themes (
    id                TEXT PRIMARY KEY,
    sprint_id         TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    summary           TEXT NOT NULL DEFAULT '',
    question          TEXT NOT NULL DEFAULT '',
    draft_experiment  TEXT,
    position          INTEGER NOT NULL DEFAULT 0,
    parked            INTEGER NOT NULL DEFAULT 0,
    needs_attention   INTEGER NOT NULL DEFAULT 0,
    order_reason      TEXT,
    source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
    created_at        INTEGER NOT NULL
);
CREATE INDEX themes_sprint_idx ON themes(sprint_id, position);

CREATE TABLE theme_entries (
    entry_id   TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
    theme_id   TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE
);
CREATE INDEX theme_entries_theme_idx ON theme_entries(theme_id);

CREATE TABLE ai_jobs (
    id              TEXT PRIMARY KEY,
    sprint_id       TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    workspace_id    TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'grouping',
    status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','skipped')),
    input_hash      TEXT NOT NULL,
    input_snapshot  TEXT NOT NULL,           -- JSON: text + opaque ids only
    provider        TEXT NOT NULL,
    model           TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    error_summary   TEXT,
    requested_by    TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    finished_at     INTEGER,
    UNIQUE (sprint_id, kind, input_hash)
);

CREATE TABLE ai_proposals (
    id           TEXT PRIMARY KEY,
    job_id       TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
    sprint_id    TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    proposal     TEXT NOT NULL,              -- JSON
    applied_at   INTEGER,
    rejected_at  INTEGER,
    created_at   INTEGER NOT NULL
);
CREATE INDEX ai_proposals_sprint_idx ON ai_proposals(sprint_id, created_at DESC);

CREATE TABLE vote_rounds (
    id                 TEXT PRIMARY KEY,
    sprint_id          TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    budget             INTEGER NOT NULL DEFAULT 3,
    grouping_revision  INTEGER NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
    cancel_reason      TEXT,
    opened_at          INTEGER NOT NULL,
    closed_at          INTEGER
);
CREATE INDEX vote_rounds_sprint_idx ON vote_rounds(sprint_id, opened_at DESC);
CREATE UNIQUE INDEX vote_rounds_one_open ON vote_rounds(sprint_id) WHERE status = 'open';

CREATE TABLE votes (
    round_id    TEXT NOT NULL REFERENCES vote_rounds(id) ON DELETE CASCADE,
    theme_id    TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    account_id  TEXT NOT NULL,               -- PRIVATE
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (round_id, theme_id, account_id)
);
CREATE INDEX votes_round_theme_idx ON votes(round_id, theme_id);

CREATE TABLE context_additions (
    id                 TEXT PRIMARY KEY,
    sprint_id          TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    theme_id           TEXT REFERENCES themes(id) ON DELETE CASCADE,
    author_account_id  TEXT NOT NULL,        -- PRIVATE
    body               TEXT NOT NULL,
    released_batch     INTEGER,
    reveal_order       INTEGER,
    idempotency_key    TEXT,
    created_at         INTEGER NOT NULL      -- PRIVATE
);
CREATE INDEX context_theme_idx ON context_additions(theme_id);
CREATE UNIQUE INDEX context_idempotency_idx ON context_additions(sprint_id, author_account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE discussion_notes (
    theme_id       TEXT PRIMARY KEY REFERENCES themes(id) ON DELETE CASCADE,
    sprint_id      TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    takeaway       TEXT NOT NULL DEFAULT '',  -- the one shared takeaway for the topic
    what_happened  TEXT NOT NULL DEFAULT '',
    impact         TEXT NOT NULL DEFAULT '',
    could_try      TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    discussed      INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL
);
CREATE INDEX discussion_notes_sprint_idx ON discussion_notes(sprint_id);

CREATE TABLE experiments (
    id                 TEXT PRIMARY KEY,
    workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sprint_id          TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    theme_id           TEXT,
    theme_title        TEXT,
    change_to_try      TEXT NOT NULL,
    success_signal     TEXT NOT NULL,
    owner_account_id   TEXT,
    owner_accepted_at  INTEGER,
    review_on          TEXT NOT NULL,        -- YYYY-MM-DD
    status             TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed','accepted','helped','did_not_help','inconclusive','not_tried')),
    outcome_note       TEXT,
    reviewed_at        INTEGER,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
);
CREATE INDEX experiments_workspace_idx ON experiments(workspace_id, created_at);
CREATE INDEX experiments_sprint_idx ON experiments(sprint_id);

CREATE TABLE recaps (
    sprint_id     TEXT PRIMARY KEY REFERENCES sprints(id) ON DELETE CASCADE,
    body          TEXT NOT NULL DEFAULT '',
    draft_source  TEXT NOT NULL DEFAULT 'manual' CHECK (draft_source IN ('manual','generated','ai')),
    approved_at   INTEGER,
    published_at  INTEGER,
    updated_at    INTEGER NOT NULL
);

-- Durable, small, idempotent background work claimed by the scheduled handler.
CREATE TABLE jobs (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,
    payload          TEXT NOT NULL,          -- JSON, never entry content
    idempotency_key  TEXT UNIQUE,
    run_at           INTEGER NOT NULL,
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 5,
    status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
    last_error       TEXT,
    locked_at        INTEGER,
    created_at       INTEGER NOT NULL,
    finished_at      INTEGER
);
CREATE INDEX jobs_queue_idx ON jobs(status, run_at);

CREATE TABLE audit_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id  TEXT NOT NULL,
    sprint_id     TEXT,
    actor_id      TEXT,
    action        TEXT NOT NULL,
    meta          TEXT NOT NULL DEFAULT '{}', -- resource ids only, never content
    created_at    INTEGER NOT NULL
);
CREATE INDEX audit_workspace_idx ON audit_events(workspace_id, id DESC);

-- Coarse counters for request limits (single-writer D1 keeps them consistent).
CREATE TABLE rate_events (
    bucket  TEXT NOT NULL,
    at      INTEGER NOT NULL
);
CREATE INDEX rate_events_idx ON rate_events(bucket, at);

-- Per-workspace AI usage accounting (calls per rolling window).
CREATE TABLE ai_usage (
    workspace_id  TEXT NOT NULL,
    at            INTEGER NOT NULL
);
CREATE INDEX ai_usage_idx ON ai_usage(workspace_id, at);

-- Development-only inbox for the console email provider. Never used in production.
CREATE TABLE dev_mail (
    id          TEXT PRIMARY KEY,
    to_addr     TEXT NOT NULL,
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
