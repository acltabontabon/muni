-- Workspace history (audit_events) is kept 400 days, then deleted by the daily retention sweep
-- (jobs.ts `retention`), a bounded batch at a time. This index lets it find the oldest rows
-- without reading the whole table. Additive only — the Worker that's still serving while this runs
-- reads and writes exactly as before.
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at);
