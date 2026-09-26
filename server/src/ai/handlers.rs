use super::Proposal;
use crate::{
    audit,
    auth::extract::SprintCtx,
    error::{AppError, AppResult},
    sse::Hint,
    state::AppState,
    themes,
};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
pub struct AiJobView {
    pub id: Uuid,
    pub status: String,
    pub error_summary: Option<String>,
    pub provider: String,
    pub model: Option<String>,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, ToSchema)]
pub struct AiProposalView {
    pub id: Uuid,
    pub job_id: Uuid,
    pub proposal: Proposal,
    pub applied_at: Option<DateTime<Utc>>,
    pub rejected_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub struct AiStatus {
    /// A provider is configured on this server.
    pub available: bool,
    /// This sprint opted in before collection started.
    pub enabled: bool,
    pub provider: String,
    pub jobs: Vec<AiJobView>,
    pub proposals: Vec<AiProposalView>,
    pub explanation: String,
}

pub fn explanation(state: &AppState) -> String {
    match &state.config.ai {
        crate::config::AiConfig::Disabled => "No AI provider is configured on this server. Grouping is manual.".into(),
        crate::config::AiConfig::Fake => "A local, deterministic grouping helper is configured. Nothing leaves this server.".into(),
        crate::config::AiConfig::Anthropic { model, .. } => format!(
            "When enabled, entry text and opaque entry ids are sent to Anthropic ({model}) to draft themes. No names, emails, attendance or authorship are sent. Check Anthropic’s current data-handling terms for your account; Muni does not claim the provider never retains data."
        ),
    }
}

/// AI preparation status, jobs and proposals for this sprint.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/ai", tag = "ai", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = AiStatus)))]
pub async fn status(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<AiStatus>> {
    ctx.require_facilitator()?;
    let jobs: Vec<(Uuid, String, Option<String>, String, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>)> =
        sqlx::query_as("SELECT id, status, error_summary, provider, model, created_at, finished_at FROM ai_jobs WHERE sprint_id = $1 ORDER BY created_at DESC LIMIT 10")
            .bind(ctx.sprint.id)
            .fetch_all(&state.db)
            .await?;
    let props: Vec<(Uuid, Uuid, serde_json::Value, Option<DateTime<Utc>>, Option<DateTime<Utc>>, DateTime<Utc>)> =
        sqlx::query_as("SELECT id, job_id, proposal, applied_at, rejected_at, created_at FROM ai_proposals WHERE sprint_id = $1 ORDER BY created_at DESC LIMIT 10")
            .bind(ctx.sprint.id)
            .fetch_all(&state.db)
            .await?;
    Ok(Json(AiStatus {
        available: state.config.ai.is_available(),
        enabled: ctx.sprint.ai_processing,
        provider: state.config.ai.provider_label().into(),
        jobs: jobs
            .into_iter()
            .map(|(id, status, error_summary, provider, model, created_at, finished_at)| AiJobView { id, status, error_summary, provider, model, created_at, finished_at })
            .collect(),
        proposals: props
            .into_iter()
            .filter_map(|(id, job_id, p, applied_at, rejected_at, created_at)| Some(AiProposalView { id, job_id, proposal: serde_json::from_value(p).ok()?, applied_at, rejected_at, created_at }))
            .collect(),
        explanation: explanation(&state),
    }))
}

/// Ask for a grouping draft. Idempotent per input snapshot; runs in the background.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/ai/grouping", tag = "ai", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = AiStatus), (status = 409, body = crate::error::ErrorBody)))]
pub async fn request_grouping(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<AiStatus>> {
    ctx.require_facilitator()?;
    if !state.config.ai.is_available() {
        return Err(AppError::Conflict("no AI provider is configured on this server — grouping stays manual".into()));
    }
    if !ctx.sprint.ai_processing {
        return Err(AppError::Conflict("AI processing wasn’t enabled for this sprint before collection started".into()));
    }
    if themes::sealed(&ctx.sprint.status) {
        return Err(AppError::Conflict("close collection first".into()));
    }
    let input = super::load_input(&state, ctx.sprint.id).await?;
    if input.is_empty() {
        return Err(AppError::Conflict("there are no entries to group".into()));
    }
    let hash = super::snapshot_hash(&input);
    let existing: Option<(Uuid, String)> = sqlx::query_as("SELECT id, status FROM ai_jobs WHERE sprint_id = $1 AND kind = 'grouping' AND input_hash = $2").bind(ctx.sprint.id).bind(&hash).fetch_optional(&state.db).await?;
    let job_id = match existing {
        Some((id, st)) if st == "failed" || st == "skipped" => {
            sqlx::query("UPDATE ai_jobs SET status='queued', error_summary=NULL, finished_at=NULL WHERE id=$1").bind(id).execute(&state.db).await?;
            id
        }
        Some((id, _)) => id,
        None => {
            let (id,): (Uuid,) = sqlx::query_as("INSERT INTO ai_jobs (sprint_id, input_hash, input_snapshot, provider, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id")
                .bind(ctx.sprint.id)
                .bind(&hash)
                .bind(serde_json::to_value(&input).unwrap())
                .bind(state.config.ai.provider_label())
                .bind(ctx.account_id())
                .fetch_one(&state.db)
                .await?;
            id
        }
    };
    crate::jobs::enqueue(&state.db, "ai_grouping", serde_json::json!({"ai_job_id": job_id}), Utc::now(), Some(format!("ai:{job_id}:{}", Utc::now().timestamp()))).await?;
    audit::record(&state.db, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "ai.grouping_requested", serde_json::json!({"job_id": job_id})).await?;
    status(State(state), ctx).await
}

#[derive(Deserialize, ToSchema)]
pub struct ApplyBody {
    /// "replace" clears existing themes first; "add" appends the draft's themes.
    pub mode: String,
    pub reset_voting_reason: Option<String>,
}

/// Turn a proposal into editable themes. Explicit; never automatic.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/ai/proposals/{proposal_id}/apply", tag = "ai", params(("sprint_id" = Uuid, Path), ("proposal_id" = Uuid, Path)),
    request_body = ApplyBody, responses((status = 200, body = themes::GroupingView)))]
pub async fn apply(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<ApplyBody>) -> AppResult<Json<themes::GroupingView>> {
    let proposal_id = ids.1;
    ctx.require_facilitator()?;
    if !matches!(ctx.sprint.status.as_str(), "preparing" | "ready") {
        return Err(AppError::Conflict("apply drafts while preparing".into()));
    }
    let row: Option<(serde_json::Value,)> = sqlx::query_as("SELECT proposal FROM ai_proposals WHERE id = $1 AND sprint_id = $2").bind(proposal_id).bind(ctx.sprint.id).fetch_optional(&state.db).await?;
    let Some((p,)) = row else { return Err(AppError::NotFound("proposal not found".into())) };
    let proposal: Proposal = serde_json::from_value(p).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let mut tx = state.db.begin().await?;
    themes::structural_change(&mut tx, &ctx, body.reset_voting_reason.as_deref()).await?;
    if body.mode == "replace" {
        sqlx::query("DELETE FROM themes WHERE sprint_id = $1").bind(ctx.sprint.id).execute(&mut *tx).await?;
    } else if body.mode != "add" {
        return Err(AppError::BadRequest("mode must be replace or add".into()));
    }
    let (mut pos,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position),0) FROM themes WHERE sprint_id = $1").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    for t in &proposal.themes {
        pos += 1;
        let (tid,): (Uuid,) = sqlx::query_as("INSERT INTO themes (sprint_id, title, summary, question, draft_experiment, position, source) VALUES ($1,$2,$3,$4,$5,$6,'ai') RETURNING id")
            .bind(ctx.sprint.id)
            .bind(&t.title)
            .bind(&t.summary)
            .bind(&t.question)
            .bind(&t.draft_experiment)
            .bind(pos)
            .fetch_one(&mut *tx)
            .await?;
        for eid in &t.entry_ids {
            // Entries already in another theme (mode=add) are left where the facilitator put them.
            sqlx::query("INSERT INTO theme_entries (theme_id, entry_id) SELECT $1, id FROM entries WHERE id = $2 AND sprint_id = $3 ON CONFLICT (entry_id) DO NOTHING")
                .bind(tid)
                .bind(eid)
                .bind(ctx.sprint.id)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query("UPDATE ai_proposals SET applied_at = now() WHERE id = $1").bind(proposal_id).execute(&mut *tx).await?;
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "ai.proposal_applied", serde_json::json!({"proposal_id": proposal_id, "mode": body.mode})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    themes::grouping(&state, &ctx).await.map(Json)
}

/// Reject a proposal (kept for the record, hidden from the studio).
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/ai/proposals/{proposal_id}/reject", tag = "ai", params(("sprint_id" = Uuid, Path), ("proposal_id" = Uuid, Path)), responses((status = 200, body = AiStatus)))]
pub async fn reject(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>) -> AppResult<Json<AiStatus>> {
    let proposal_id = ids.1;
    ctx.require_facilitator()?;
    sqlx::query("UPDATE ai_proposals SET rejected_at = now() WHERE id = $1 AND sprint_id = $2").bind(proposal_id).bind(ctx.sprint.id).execute(&state.db).await?;
    status(State(state), ctx).await
}
