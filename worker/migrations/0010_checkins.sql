-- Check-ins: during the live retro, the facilitator can invite a quick, private response to the topic
-- in hand ("How did this show up for you?") or to an idea to try ("Would trying this next sprint
-- help?"). Answers stay sealed until the facilitator shares them; then everyone sees the counts and
-- any lines people added, without names. Optional, never required: nothing waits for them.
--
-- 1. `checkins`: at most one per topic and kind, so revisiting a topic finds its check-in and its
--    answers again instead of starting over. `subject` keeps the idea's wording as it was when an
--    action check-in opened (an envelope in encrypted sprints), so a later edit can't borrow the
--    answers given to the earlier wording.
-- 2. `checkin_responses`: one per person per check-in, changeable until shared. The account is kept
--    privately — like a vote — so an answer can be changed and never counted twice; no route returns
--    it. `note` is an optional line (an envelope in encrypted sprints). `reveal_order` is drawn when
--    the answers are shared, so the lines don't come out in the order they were written.
-- 3. `context_additions.kind`: what someone added during the talk may say what it is (an example,
--    another view, a question). Optional.

CREATE TABLE checkins (
    id           TEXT PRIMARY KEY,
    sprint_id    TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    theme_id     TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('topic', 'action')),
    subject      TEXT,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'shared')),
    opened_by    TEXT NOT NULL,
    opened_at    INTEGER NOT NULL,
    shared_at    INTEGER
);
CREATE UNIQUE INDEX checkins_subject_idx ON checkins(theme_id, kind);
CREATE INDEX checkins_sprint_idx ON checkins(sprint_id);

CREATE TABLE checkin_responses (
    checkin_id    TEXT NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
    account_id    TEXT NOT NULL,        -- PRIVATE
    choice        TEXT NOT NULL,
    note          TEXT,
    reveal_order  INTEGER,
    updated_at    INTEGER NOT NULL,     -- PRIVATE
    PRIMARY KEY (checkin_id, account_id)
);

ALTER TABLE context_additions ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('example', 'view', 'question'));
