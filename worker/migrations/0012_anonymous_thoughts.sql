-- Encrypted thoughts never say who wrote them.
--
-- 1. A thought's envelope reaches every participant once thoughts are revealed, so it must not
--    carry its author's account id. The format that did (entry envelopes with "v":1, which begin
--    `e1.eyJ2IjoxLCJ0IjoiZSIs` — base64url of `{"v":1,"t":"e",`) is removed, with what hangs off
--    those rows (their place in a theme). The format that replaces it ("v":2) names only its
--    sprint and record; the Worker refuses anything else.
-- 2. The same prefix can't be stored again, by any version of the Worker: triggers refuse it on
--    insert and on edit.
-- 3. `context_additions` gets an index by sprint (and author), which every live-retro read of it
--    filters by.

DELETE FROM theme_entries WHERE entry_id IN (
    SELECT id FROM entries
    WHERE substr(body, 1, 23) = 'e1.eyJ2IjoxLCJ0IjoiZSIs'
      AND sprint_id IN (SELECT id FROM sprints WHERE encryption = 'e1')
);

DELETE FROM entries
WHERE substr(body, 1, 23) = 'e1.eyJ2IjoxLCJ0IjoiZSIs'
  AND sprint_id IN (SELECT id FROM sprints WHERE encryption = 'e1');

CREATE TRIGGER entries_anonymous_insert BEFORE INSERT ON entries
WHEN substr(NEW.body, 1, 23) = 'e1.eyJ2IjoxLCJ0IjoiZSIs'
BEGIN
    SELECT RAISE(ABORT, 'a thought envelope may not name its author');
END;

CREATE TRIGGER entries_anonymous_update BEFORE UPDATE OF body ON entries
WHEN substr(NEW.body, 1, 23) = 'e1.eyJ2IjoxLCJ0IjoiZSIs'
BEGIN
    SELECT RAISE(ABORT, 'a thought envelope may not name its author');
END;

CREATE INDEX context_sprint_idx ON context_additions(sprint_id, author_account_id);
