-- Indexes for the daily retention sweep (jobs.ts `retention`): each of its statements finds the rows
-- that expired by an index instead of reading the whole table. Additive only — the Worker that's
-- still serving while this runs reads and writes exactly as before.
--
-- Rate-limit rows older than a day (the existing index leads with the bucket).
CREATE INDEX IF NOT EXISTS rate_events_at_idx ON rate_events(at);
-- Sessions that expired, or were revoked, a week ago.
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_revoked_idx ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
-- An account's own history, kept a year.
CREATE INDEX IF NOT EXISTS security_events_created_idx ON security_events(created_at);
-- Invitations 30 days after they were accepted, withdrawn or expired (the sweep's own expression).
CREATE INDEX IF NOT EXISTS invitations_done_idx ON invitations(COALESCE(accepted_at, revoked_at, expires_at));
-- Join requests: open ones that go stale, decided ones after 180 days, and whether a dead link
-- still has any.
CREATE INDEX IF NOT EXISTS join_requests_status_idx ON join_requests(status, created_at);
CREATE INDEX IF NOT EXISTS join_requests_done_idx ON join_requests(COALESCE(decided_at, created_at)) WHERE status <> 'pending';
CREATE INDEX IF NOT EXISTS join_requests_link_idx ON join_requests(link_id);
CREATE INDEX IF NOT EXISTS join_links_done_idx ON join_links(COALESCE(revoked_at, expires_at));
