-- A person's character (one of eight stable ids, validated in code: src/lib/avatars.ts) and whether
-- their own pages wear that character's world. Both belong to the account and are returned only
-- by /api/auth/me: never selected into anything another person can see (see 0001's PRIVATE note).
--
-- avatar_intro: 0 = a new account, offered the chooser once before its first page;
--               1 = an account from before characters, shown one quiet note instead of a gate;
--               2 = done (chose, or said "decide later").
-- Additive only: accounts is never rebuilt (a D1 parent-table drop would cascade; see 0005).
ALTER TABLE accounts ADD COLUMN avatar_id TEXT;
ALTER TABLE accounts ADD COLUMN avatar_theme INTEGER NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN avatar_intro INTEGER NOT NULL DEFAULT 0;
UPDATE accounts SET avatar_intro = 1;
