//! Audit events record *who did what to which resource*, never content.

use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

pub async fn record<'e, E: PgExecutor<'e>>(
    ex: E,
    workspace_id: Uuid,
    sprint_id: Option<Uuid>,
    actor: Option<Uuid>,
    action: &str,
    meta: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO audit_events (workspace_id, sprint_id, actor_id, action, meta) VALUES ($1,$2,$3,$4,$5)")
        .bind(workspace_id)
        .bind(sprint_id)
        .bind(actor)
        .bind(action)
        .bind(meta)
        .execute(ex)
        .await?;
    Ok(())
}
