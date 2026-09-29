-- Indexes for deleting an account: each of its statements finds the account's rows by an index
-- instead of reading the whole table (lib/departure.ts). Additive only — the Worker that's still
-- serving while this runs reads and writes exactly as before.
--
-- Rows naming the account that go, or are cut loose from it.
CREATE INDEX IF NOT EXISTS context_author_idx ON context_additions(author_account_id);
CREATE INDEX IF NOT EXISTS votes_account_idx ON votes(account_id);
CREATE INDEX IF NOT EXISTS checkin_responses_account_idx ON checkin_responses(account_id);
CREATE INDEX IF NOT EXISTS experiments_owner_idx ON experiments(owner_account_id) WHERE owner_account_id IS NOT NULL;
-- Things they started, kept for the team.
CREATE INDEX IF NOT EXISTS sprints_created_by_idx ON sprints(created_by);
CREATE INDEX IF NOT EXISTS checkins_opened_by_idx ON checkins(opened_by);
CREATE INDEX IF NOT EXISTS sprint_keys_created_by_idx ON sprint_keys(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS sprint_key_wraps_created_by_idx ON sprint_key_wraps(created_by) WHERE created_by IS NOT NULL;
-- Their key wraps go with the account (ON DELETE CASCADE finds them by this).
CREATE INDEX IF NOT EXISTS sprint_key_wraps_account_idx ON sprint_key_wraps(account_id);
-- Invitations and links they sent, accepted, redeemed or decided, and invitations to their address.
CREATE INDEX IF NOT EXISTS invitations_invited_by_idx ON invitations(invited_by);
CREATE INDEX IF NOT EXISTS invitations_accepted_by_idx ON invitations(accepted_by) WHERE accepted_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations(email);
CREATE INDEX IF NOT EXISTS join_links_created_by_idx ON join_links(created_by);
CREATE INDEX IF NOT EXISTS join_links_redeemed_by_idx ON join_links(redeemed_by) WHERE redeemed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS join_requests_decided_by_idx ON join_requests(decided_by) WHERE decided_by IS NOT NULL;
-- Workspace history they appear in: as the actor, and as the member an event was about.
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_events(actor_id);
CREATE INDEX IF NOT EXISTS audit_meta_account_idx ON audit_events(json_extract(meta, '$.account_id')) WHERE json_extract(meta, '$.account_id') IS NOT NULL;
