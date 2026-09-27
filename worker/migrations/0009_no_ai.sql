-- AI theme drafts are gone from Muni. Grouping, theme names, summaries and questions are written by
-- people; nothing is sent to a model.
--
-- 1. Queued, running or finished drafting jobs are removed, so nothing retries them.
-- 2. The drafting tables go: `ai_jobs` (it held copies of thoughts sent for drafting), `ai_proposals`
--    (unapplied drafts) and `ai_usage` (rate accounting). A draft that was applied became ordinary
--    themes, which people may have edited since; those themes, their thoughts and everything
--    recorded about them stay exactly as they are.
-- 3. The opt-in settings (`workspaces.ai_enabled_default`, `sprints.ai_processing`, `ai_locked`) and
--    the themes' draft marker (`themes.source`) are dropped: nothing reads them any more.
--    DROP COLUMN leaves every row and every foreign key in place (no table is rebuilt).
--
-- Workspace activity keeps its past `ai.*` audit rows (ids only, never content): they're history.

DELETE FROM jobs WHERE kind = 'ai_grouping';

DROP INDEX IF EXISTS ai_proposals_sprint_idx;
DROP TABLE IF EXISTS ai_proposals;
DROP TABLE IF EXISTS ai_jobs;
DROP INDEX IF EXISTS ai_usage_idx;
DROP TABLE IF EXISTS ai_usage;

ALTER TABLE workspaces DROP COLUMN ai_enabled_default;
ALTER TABLE sprints DROP COLUMN ai_processing;
ALTER TABLE sprints DROP COLUMN ai_locked;
ALTER TABLE themes DROP COLUMN source;
