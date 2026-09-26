//! Retention: content-derived records are deleted after the workspace's
//! retention window; commitments and approved recaps live under the separate,
//! disclosed outcome retention rule.

use crate::state::AppState;
use anyhow::Result;
use uuid::Uuid;

pub async fn run(state: &AppState) -> Result<()> {
    let due: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT s.id, s.workspace_id FROM sprints s JOIN workspaces w ON w.id = s.workspace_id
         WHERE s.content_purged_at IS NULL AND s.status IN ('completed','archived')
           AND COALESCE(s.completed_at, s.updated_at) < now() - (w.retention_days || ' days')::interval",
    )
    .fetch_all(&state.db)
    .await?;
    for (sprint_id, workspace_id) in due {
        purge_sprint_content(state, sprint_id, workspace_id).await?;
    }
    // Outcome retention: experiments and recaps of sprints older than the outcome window.
    sqlx::query(
        "DELETE FROM experiments e USING sprints s, workspaces w WHERE s.id = e.sprint_id AND w.id = s.workspace_id
         AND COALESCE(s.completed_at, s.updated_at) < now() - (w.outcome_retention_days || ' days')::interval",
    )
    .execute(&state.db)
    .await?;
    sqlx::query(
        "DELETE FROM recaps r USING sprints s, workspaces w WHERE s.id = r.sprint_id AND w.id = s.workspace_id
         AND COALESCE(s.completed_at, s.updated_at) < now() - (w.outcome_retention_days || ' days')::interval",
    )
    .execute(&state.db)
    .await?;
    // Housekeeping: expired challenges, old sessions, finished jobs, rate events.
    sqlx::query("DELETE FROM verification_challenges WHERE expires_at < now() - interval '1 day'").execute(&state.db).await?;
    sqlx::query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days'").execute(&state.db).await?;
    sqlx::query("DELETE FROM jobs WHERE status IN ('succeeded','cancelled') AND finished_at < now() - interval '30 days'").execute(&state.db).await?;
    sqlx::query("DELETE FROM jobs WHERE status = 'failed' AND finished_at < now() - interval '90 days'").execute(&state.db).await?;
    sqlx::query("DELETE FROM rate_events WHERE at < now() - interval '1 day'").execute(&state.db).await?;
    Ok(())
}

/// Deletes everything derived from participants' words for one sprint.
/// Keeps: the sprint record, participants, experiments, the approved recap.
pub async fn purge_sprint_content(state: &AppState, sprint_id: Uuid, workspace_id: Uuid) -> Result<()> {
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM context_additions WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM discussion_notes WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM ai_proposals WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM ai_jobs WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM votes WHERE round_id IN (SELECT id FROM vote_rounds WHERE sprint_id = $1)").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM vote_rounds WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE experiments SET theme_id = NULL WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM themes WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM entries WHERE sprint_id = $1").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM speaking_rounds WHERE session_id IN (SELECT id FROM retro_sessions WHERE sprint_id = $1)").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM recaps WHERE sprint_id = $1 AND published_at IS NULL").bind(sprint_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE sprints SET content_purged_at = now(), status = 'archived', archived_at = COALESCE(archived_at, now()) WHERE id = $1").bind(sprint_id).execute(&mut *tx).await?;
    crate::audit::record(&mut *tx, workspace_id, Some(sprint_id), None, "retention.purged", serde_json::json!({})).await?;
    tx.commit().await?;
    Ok(())
}
