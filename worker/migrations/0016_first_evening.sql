-- The first evening: a new account's guide through its team's first sprint and retro
-- (web/src/lib/guide.ts). It points at the next real control; it never holds anything of its own.
--
-- guide: 0 = a new account: the prologue plays once before its first page;
--        1 = guiding;
--        2 = hidden by the person (they can bring it back);
--        3 = done: their first retro closed the evening, or the account predates the guide.
-- Additive only: accounts is never rebuilt (a D1 parent-table drop would cascade; see 0005).
ALTER TABLE accounts ADD COLUMN guide INTEGER NOT NULL DEFAULT 0;
UPDATE accounts SET guide = 3;
