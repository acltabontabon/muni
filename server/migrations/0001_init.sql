-- Muni initial schema.
-- Privacy note: columns marked "PRIVATE" carry ownership needed for
-- authorization only. They must never be selected into shared response types.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email            TEXT NOT NULL,            -- normalized (lowercase, trimmed)
    display_name     TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (email)
);

CREATE TABLE workspaces (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                     TEXT NOT NULL,
    retention_days           INT  NOT NULL DEFAULT 90,   -- raw notes and derivatives
    outcome_retention_days   INT  NOT NULL DEFAULT 730,  -- commitments + approved recaps (separately disclosed)
    ai_enabled_default       BOOLEAN NOT NULL DEFAULT false,
    is_demo                  BOOLEAN NOT NULL DEFAULT false,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role           TEXT NOT NULL CHECK (role IN ('owner','member')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at     TIMESTAMPTZ,
    UNIQUE (workspace_id, account_id)
);
CREATE INDEX memberships_account_idx ON memberships(account_id);

CREATE TABLE invitations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email          TEXT NOT NULL,             -- normalized intended recipient
    token_hash     BYTEA NOT NULL UNIQUE,     -- sha256 of the URL token
    invited_by     UUID NOT NULL REFERENCES accounts(id),
    sprint_id      UUID,                      -- optional: auto-add to this sprint on accept
    expires_at     TIMESTAMPTZ NOT NULL,
    accepted_at    TIMESTAMPTZ,
    accepted_by    UUID REFERENCES accounts(id),
    revoked_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invitations_workspace_idx ON invitations(workspace_id);

CREATE TABLE verification_challenges (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL,
    code_hash      BYTEA NOT NULL,            -- sha256(code || challenge id)
    purpose        TEXT NOT NULL DEFAULT 'signin',
    attempts       INT NOT NULL DEFAULT 0,
    max_attempts   INT NOT NULL DEFAULT 5,
    expires_at     TIMESTAMPTZ NOT NULL,
    consumed_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX verification_email_idx ON verification_challenges(email, created_at DESC);

CREATE TABLE sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash     BYTEA NOT NULL UNIQUE,
    csrf_token     TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ
);
CREATE INDEX sessions_account_idx ON sessions(account_id);

CREATE TABLE sprints (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    external_ref          TEXT,
    goal                  TEXT,
    opening_question      TEXT,
    timezone              TEXT NOT NULL,
    starts_on             DATE NOT NULL,
    ends_on               DATE NOT NULL,
    retro_at              TIMESTAMPTZ NOT NULL,
    retro_duration_min    INT NOT NULL DEFAULT 45,
    status                TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','collecting','preparing','ready','live','completed','archived')),
    ai_processing         BOOLEAN NOT NULL DEFAULT false,
    ai_locked             BOOLEAN NOT NULL DEFAULT false,  -- true once collection has started
    reminders_enabled     BOOLEAN NOT NULL DEFAULT true,
    vote_budget           INT NOT NULL DEFAULT 3,
    include_facilitator_in_rotation BOOLEAN NOT NULL DEFAULT false,
    grouping_revision     BIGINT NOT NULL DEFAULT 0,
    collection_opened_at  TIMESTAMPTZ,
    collection_closed_at  TIMESTAMPTZ,
    reopened_count        INT NOT NULL DEFAULT 0,
    revealed_once         BOOLEAN NOT NULL DEFAULT false,
    completed_at          TIMESTAMPTZ,
    archived_at           TIMESTAMPTZ,
    content_purged_at     TIMESTAMPTZ,
    created_by            UUID NOT NULL REFERENCES accounts(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (starts_on <= ends_on)
);
CREATE INDEX sprints_workspace_idx ON sprints(workspace_id, starts_on DESC);

CREATE TABLE sprint_participants (
    sprint_id        UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    is_facilitator   BOOLEAN NOT NULL DEFAULT false,
    reminders_opt_out BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sprint_id, account_id)
);

CREATE TABLE entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id         UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    author_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,  -- PRIVATE
    category          TEXT CHECK (category IN ('proud','keep','improve','stop','try')),  -- NULL = unsorted
    body              TEXT NOT NULL,
    impact            TEXT,
    might_help        TEXT,
    period            TEXT CHECK (period IN ('early','middle','late')),
    idempotency_key   TEXT,                     -- PRIVATE, dedupes retries per author
    reveal_order      INT,                      -- random, assigned at collection close
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- PRIVATE
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- PRIVATE
    UNIQUE (sprint_id, author_account_id, idempotency_key)
);
CREATE INDEX entries_sprint_idx ON entries(sprint_id);
CREATE INDEX entries_author_idx ON entries(author_account_id, sprint_id);

CREATE TABLE themes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id        UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    summary          TEXT NOT NULL DEFAULT '',
    question         TEXT NOT NULL DEFAULT '',
    draft_experiment TEXT,
    position         INT NOT NULL DEFAULT 0,
    parked           BOOLEAN NOT NULL DEFAULT false,
    needs_attention  BOOLEAN NOT NULL DEFAULT false,
    order_reason     TEXT,
    source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX themes_sprint_idx ON themes(sprint_id, position);

CREATE TABLE theme_entries (
    theme_id   UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    entry_id   UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id)              -- an entry belongs to at most one theme
);
CREATE INDEX theme_entries_theme_idx ON theme_entries(theme_id);

CREATE TABLE ai_jobs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id          UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    kind               TEXT NOT NULL DEFAULT 'grouping',
    status             TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','succeeded','failed','skipped')),
    input_hash         TEXT NOT NULL,
    input_snapshot     JSONB NOT NULL,
    provider           TEXT NOT NULL,
    model              TEXT,
    attempts           INT NOT NULL DEFAULT 0,
    error_summary      TEXT,
    requested_by       UUID NOT NULL REFERENCES accounts(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ,
    UNIQUE (sprint_id, kind, input_hash)
);

CREATE TABLE ai_proposals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
    sprint_id    UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    proposal     JSONB NOT NULL,
    applied_at   TIMESTAMPTZ,
    rejected_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_proposals_sprint_idx ON ai_proposals(sprint_id, created_at DESC);

CREATE TABLE vote_rounds (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id          UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    budget             INT NOT NULL DEFAULT 3,
    grouping_revision  BIGINT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
    cancel_reason      TEXT,
    opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at          TIMESTAMPTZ
);
CREATE INDEX vote_rounds_sprint_idx ON vote_rounds(sprint_id, opened_at DESC);
CREATE UNIQUE INDEX vote_rounds_one_open ON vote_rounds(sprint_id) WHERE status = 'open';

CREATE TABLE votes (
    round_id    UUID NOT NULL REFERENCES vote_rounds(id) ON DELETE CASCADE,
    theme_id    UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,   -- PRIVATE
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (round_id, theme_id, account_id)
);
CREATE INDEX votes_round_theme_idx ON votes(round_id, theme_id);

CREATE TABLE retro_sessions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id             UUID NOT NULL UNIQUE REFERENCES sprints(id) ON DELETE CASCADE,
    version               BIGINT NOT NULL DEFAULT 1,
    phase                 TEXT NOT NULL DEFAULT 'arrive'
        CHECK (phase IN ('arrive','remember','discover','discuss','decide','leave')),
    quiet_reading         BOOLEAN NOT NULL DEFAULT false,
    current_theme_id      UUID REFERENCES themes(id) ON DELETE SET NULL,
    agenda                JSONB NOT NULL DEFAULT '[]',     -- [{theme_id, reason}]
    plan                  JSONB NOT NULL DEFAULT '{}',     -- per-phase minutes
    timer_ends_at         TIMESTAMPTZ,
    timer_remaining_secs  INT,
    timer_total_secs      INT,
    controller_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    controller_seen_at    TIMESTAMPTZ,
    started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at              TIMESTAMPTZ,
    cancelled             BOOLEAN NOT NULL DEFAULT false,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attendance (
    session_id   UUID NOT NULL REFERENCES retro_sessions(id) ON DELETE CASCADE,
    account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    present      BOOLEAN NOT NULL DEFAULT false,
    ready        BOOLEAN NOT NULL DEFAULT true,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, account_id)
);

CREATE TABLE speaking_rounds (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID NOT NULL REFERENCES retro_sessions(id) ON DELETE CASCADE,
    ordering      JSONB NOT NULL,       -- shuffled account ids
    cursor        INT NOT NULL DEFAULT 0,
    current_account_id UUID,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','ended')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX speaking_rounds_one_active ON speaking_rounds(session_id) WHERE status = 'active';

CREATE TABLE context_additions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id         UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    theme_id          UUID REFERENCES themes(id) ON DELETE CASCADE,
    author_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,  -- PRIVATE
    body              TEXT NOT NULL,
    released_batch    INT,                 -- null = still sealed
    reveal_order      INT,
    idempotency_key   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),  -- PRIVATE
    UNIQUE (sprint_id, author_account_id, idempotency_key)
);
CREATE INDEX context_theme_idx ON context_additions(theme_id);

CREATE TABLE discussion_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id   UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    theme_id    UUID NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    what_happened TEXT NOT NULL DEFAULT '',
    impact        TEXT NOT NULL DEFAULT '',
    could_try     TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    discussed     BOOLEAN NOT NULL DEFAULT false,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (theme_id)
);

CREATE TABLE experiments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sprint_id          UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    theme_id           UUID REFERENCES themes(id) ON DELETE SET NULL,
    theme_title        TEXT,                     -- denormalized so it survives retention
    change_to_try      TEXT NOT NULL,
    success_signal     TEXT NOT NULL,
    owner_account_id   UUID REFERENCES accounts(id) ON DELETE SET NULL,
    owner_accepted_at  TIMESTAMPTZ,
    review_on          DATE NOT NULL,
    status             TEXT NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed','accepted','helped','did_not_help','inconclusive','not_tried')),
    outcome_note       TEXT,
    reviewed_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX experiments_workspace_idx ON experiments(workspace_id, created_at);
CREATE INDEX experiments_sprint_idx ON experiments(sprint_id);

CREATE TABLE recaps (
    sprint_id     UUID PRIMARY KEY REFERENCES sprints(id) ON DELETE CASCADE,
    body          TEXT NOT NULL DEFAULT '',
    draft_source  TEXT NOT NULL DEFAULT 'manual' CHECK (draft_source IN ('manual','generated','ai')),
    approved_at   TIMESTAMPTZ,
    published_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind             TEXT NOT NULL,
    payload          JSONB NOT NULL,
    idempotency_key  TEXT UNIQUE,
    run_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts         INT NOT NULL DEFAULT 0,
    max_attempts     INT NOT NULL DEFAULT 5,
    status           TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
    last_error       TEXT,
    locked_at        TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ
);
CREATE INDEX jobs_queue_idx ON jobs(status, run_at);

CREATE TABLE audit_events (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    sprint_id     UUID REFERENCES sprints(id) ON DELETE CASCADE,
    actor_id      UUID REFERENCES accounts(id) ON DELETE SET NULL,
    action        TEXT NOT NULL,
    meta          JSONB NOT NULL DEFAULT '{}',   -- resource ids only, never content
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_workspace_idx ON audit_events(workspace_id, created_at DESC);

CREATE TABLE rate_events (
    bucket      TEXT NOT NULL,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rate_events_idx ON rate_events(bucket, at);
