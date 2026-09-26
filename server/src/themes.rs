//! Manual grouping. Works fully without AI. Structural changes bump the
//! sprint's grouping revision and must explicitly reset an open vote round.

use crate::{
    audit,
    auth::extract::SprintCtx,
    entries::{SharedEntry, SHARED_SELECT},
    error::{AppError, AppResult},
    sse::Hint,
    state::AppState,
    util,
};
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use std::collections::HashMap;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema, Clone)]
pub struct ThemeView {
    pub id: Uuid,
    pub title: String,
    pub summary: String,
    pub question: String,
    pub draft_experiment: Option<String>,
    pub position: i32,
    pub parked: bool,
    pub needs_attention: bool,
    pub order_reason: Option<String>,
    pub source: String,
    /// Number of entries — entries, not people.
    pub entry_count: i64,
    pub category_mix: HashMap<String, i64>,
    pub entries: Vec<SharedEntry>,
    /// Released anonymous context added during the meeting.
    pub context: Vec<ContextNote>,
    /// Vote total from the most recent closed round, if any.
    pub votes: Option<i64>,
}

#[derive(Serialize, ToSchema, Clone, sqlx::FromRow)]
pub struct ContextNote {
    pub id: Uuid,
    pub body: String,
}

#[derive(Serialize, ToSchema)]
pub struct GroupingView {
    pub sprint_status: String,
    pub grouping_revision: i64,
    pub themes: Vec<ThemeView>,
    pub ungrouped: Vec<SharedEntry>,
    pub total_entries: i64,
    pub can_edit: bool,
    pub voting_open: bool,
}

#[derive(sqlx::FromRow)]
struct ThemeRow {
    id: Uuid,
    title: String,
    summary: String,
    question: String,
    draft_experiment: Option<String>,
    position: i32,
    parked: bool,
    needs_attention: bool,
    order_reason: Option<String>,
    source: String,
}

pub fn sealed(status: &str) -> bool {
    matches!(status, "draft" | "collecting")
}

fn editable(status: &str) -> bool {
    matches!(status, "preparing" | "ready" | "live")
}

pub async fn grouping(state: &AppState, ctx: &SprintCtx) -> AppResult<GroupingView> {
    if sealed(&ctx.sprint.status) {
        return Err(AppError::Conflict("entries stay sealed until collection closes".into()));
    }
    let (status, revision): (String, i64) = sqlx::query_as("SELECT status, grouping_revision FROM sprints WHERE id = $1").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    let rows: Vec<ThemeRow> = sqlx::query_as(
        "SELECT id, title, summary, question, draft_experiment, position, parked, needs_attention, order_reason, source FROM themes WHERE sprint_id = $1 ORDER BY position, created_at",
    )
    .bind(ctx.sprint.id)
    .fetch_all(&state.db)
    .await?;
    let all: Vec<SharedEntry> = crate::entries::shared_entries(state, ctx.sprint.id).await?;
    let context: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT id, theme_id, body FROM context_additions WHERE sprint_id = $1 AND released_batch IS NOT NULL AND theme_id IS NOT NULL ORDER BY released_batch, reveal_order, id",
    )
    .bind(ctx.sprint.id)
    .fetch_all(&state.db)
    .await?;
    let votes = crate::voting::latest_closed_totals(state, ctx.sprint.id).await?;
    let mut themes = vec![];
    for t in rows {
        let entries: Vec<SharedEntry> = all.iter().filter(|e| e.theme_id == Some(t.id)).cloned().collect();
        let mut mix: HashMap<String, i64> = HashMap::new();
        for e in &entries {
            *mix.entry(e.category.clone().unwrap_or_else(|| "unsorted".into())).or_default() += 1;
        }
        themes.push(ThemeView {
            id: t.id,
            title: t.title,
            summary: t.summary,
            question: t.question,
            draft_experiment: t.draft_experiment,
            position: t.position,
            parked: t.parked,
            needs_attention: t.needs_attention,
            order_reason: t.order_reason,
            source: t.source,
            entry_count: entries.len() as i64,
            category_mix: mix,
            context: context.iter().filter(|(_, tid, _)| *tid == t.id).map(|(id, _, body)| ContextNote { id: *id, body: body.clone() }).collect(),
            entries,
            votes: votes.as_ref().map(|v| *v.get(&t.id).unwrap_or(&0)),
        });
    }
    let ungrouped: Vec<SharedEntry> = all.iter().filter(|e| e.theme_id.is_none()).cloned().collect();
    let (voting_open,): (i64,) = sqlx::query_as("SELECT count(*) FROM vote_rounds WHERE sprint_id = $1 AND status = 'open'").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    Ok(GroupingView {
        can_edit: ctx.is_facilitator && editable(&status),
        sprint_status: status,
        grouping_revision: revision,
        themes,
        total_entries: all.len() as i64,
        ungrouped,
        voting_open: voting_open > 0,
    })
}

/// Themes, their entries, and the ungrouped pool. Available once collection has closed.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/themes", tag = "themes", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = GroupingView)))]
pub async fn get(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<GroupingView>> {
    ctx.require_participant()?;
    grouping(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema, Default)]
pub struct ThemeBody {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub question: Option<String>,
    pub draft_experiment: Option<String>,
    pub entry_ids: Option<Vec<Uuid>>,
    pub parked: Option<bool>,
    pub needs_attention: Option<bool>,
    pub order_reason: Option<String>,
    /// Required when the change alters the theme set while a vote round is open.
    pub reset_voting_reason: Option<String>,
}

fn require_edit(ctx: &SprintCtx) -> AppResult<()> {
    ctx.require_facilitator()?;
    if !editable(&ctx.sprint.status) {
        return Err(AppError::Conflict("themes can be edited once collection has closed and until the retro is completed".into()));
    }
    Ok(())
}

/// A structural change (theme set or membership) invalidates an open vote round.
/// Refuses unless the facilitator supplied a reason, which is shown to participants.
pub async fn structural_change(tx: &mut Transaction<'_, Postgres>, ctx: &SprintCtx, reason: Option<&str>) -> AppResult<()> {
    let open: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM vote_rounds WHERE sprint_id = $1 AND status = 'open' FOR UPDATE").bind(ctx.sprint.id).fetch_optional(&mut **tx).await?;
    if let Some((round_id,)) = open {
        let reason = reason.map(str::trim).filter(|r| !r.is_empty()).ok_or_else(|| {
            AppError::Conflict("a voting round is open. Changing themes now cancels it — give a short reason for participants to continue".into())
        })?;
        sqlx::query("UPDATE vote_rounds SET status='cancelled', cancel_reason=$2, closed_at=now() WHERE id=$1")
            .bind(round_id)
            .bind(reason.chars().take(200).collect::<String>())
            .execute(&mut **tx)
            .await?;
    }
    sqlx::query("UPDATE sprints SET grouping_revision = grouping_revision + 1, updated_at = now() WHERE id = $1").bind(ctx.sprint.id).execute(&mut **tx).await?;
    audit::record(&mut **tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "grouping.changed", serde_json::json!({})).await?;
    Ok(())
}

async fn assign(tx: &mut Transaction<'_, Postgres>, sprint_id: Uuid, theme_id: Uuid, entry_ids: &[Uuid]) -> AppResult<()> {
    for eid in entry_ids {
        // Only entries of this sprint can be grouped; the subquery guards cross-sprint ids.
        sqlx::query(
            "INSERT INTO theme_entries (theme_id, entry_id) SELECT $1, id FROM entries WHERE id = $2 AND sprint_id = $3
             ON CONFLICT (entry_id) DO UPDATE SET theme_id = EXCLUDED.theme_id",
        )
        .bind(theme_id)
        .bind(eid)
        .bind(sprint_id)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

/// Create a theme, optionally with entries.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/themes", tag = "themes", params(("sprint_id" = Uuid, Path)), request_body = ThemeBody, responses((status = 200, body = GroupingView)))]
pub async fn create(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<ThemeBody>) -> AppResult<Json<GroupingView>> {
    require_edit(&ctx)?;
    let title = util::trimmed_nonempty(body.title.as_deref().unwrap_or(""), 80, "Theme title").map_err(AppError::BadRequest)?;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE sprint_id = $1").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    if n >= 40 {
        return Err(AppError::Conflict("40 themes is the limit — merge some first".into()));
    }
    let mut tx = state.db.begin().await?;
    structural_change(&mut tx, &ctx, body.reset_voting_reason.as_deref()).await?;
    let (id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO themes (sprint_id, title, summary, question, draft_experiment, position) VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(position),0)+1 FROM themes WHERE sprint_id=$1)) RETURNING id",
    )
    .bind(ctx.sprint.id)
    .bind(&title)
    .bind(body.summary.as_deref().unwrap_or("").trim().chars().take(500).collect::<String>())
    .bind(body.question.as_deref().unwrap_or("").trim().chars().take(240).collect::<String>())
    .bind(util::trimmed_optional(body.draft_experiment.as_deref(), 300, "Draft experiment").map_err(AppError::BadRequest)?)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(ids) = &body.entry_ids {
        assign(&mut tx, ctx.sprint.id, id, ids).await?;
    }
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    grouping(&state, &ctx).await.map(Json)
}

/// Edit a theme's text and flags. Text edits don't reset voting; entry changes do.
#[utoipa::path(patch, path = "/api/sprints/{sprint_id}/themes/{theme_id}", tag = "themes", params(("sprint_id" = Uuid, Path), ("theme_id" = Uuid, Path)),
    request_body = ThemeBody, responses((status = 200, body = GroupingView)))]
pub async fn update(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<ThemeBody>) -> AppResult<Json<GroupingView>> {
    let theme_id = ids.1;
    require_edit(&ctx)?;
    let mut tx = state.db.begin().await?;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE id = $1 AND sprint_id = $2").bind(theme_id).bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    if n == 0 {
        return Err(AppError::NotFound("theme not found".into()));
    }
    if let Some(t) = &body.title {
        let t = util::trimmed_nonempty(t, 80, "Theme title").map_err(AppError::BadRequest)?;
        sqlx::query("UPDATE themes SET title = $1 WHERE id = $2").bind(t).bind(theme_id).execute(&mut *tx).await?;
    }
    if let Some(s) = &body.summary {
        sqlx::query("UPDATE themes SET summary = $1 WHERE id = $2").bind(s.trim().chars().take(500).collect::<String>()).bind(theme_id).execute(&mut *tx).await?;
    }
    if let Some(q) = &body.question {
        sqlx::query("UPDATE themes SET question = $1 WHERE id = $2").bind(q.trim().chars().take(240).collect::<String>()).bind(theme_id).execute(&mut *tx).await?;
    }
    if let Some(d) = &body.draft_experiment {
        sqlx::query("UPDATE themes SET draft_experiment = $1 WHERE id = $2").bind(util::trimmed_optional(Some(d), 300, "Draft experiment").map_err(AppError::BadRequest)?).bind(theme_id).execute(&mut *tx).await?;
    }
    if let Some(p) = body.parked {
        sqlx::query("UPDATE themes SET parked = $1 WHERE id = $2").bind(p).bind(theme_id).execute(&mut *tx).await?;
    }
    if let Some(p) = body.needs_attention {
        sqlx::query("UPDATE themes SET needs_attention = $1 WHERE id = $2").bind(p).bind(theme_id).execute(&mut *tx).await?;
    }
    if let Some(r) = &body.order_reason {
        sqlx::query("UPDATE themes SET order_reason = $1 WHERE id = $2").bind(util::trimmed_optional(Some(r), 200, "Reason").map_err(AppError::BadRequest)?).bind(theme_id).execute(&mut *tx).await?;
    }
    if let Some(ids) = &body.entry_ids {
        structural_change(&mut tx, &ctx, body.reset_voting_reason.as_deref()).await?;
        assign(&mut tx, ctx.sprint.id, theme_id, ids).await?;
    }
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    grouping(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct EntryIdsBody {
    pub entry_ids: Vec<Uuid>,
    pub reset_voting_reason: Option<String>,
}

/// Move entries back to the ungrouped pool.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/themes/ungroup", tag = "themes", params(("sprint_id" = Uuid, Path)), request_body = EntryIdsBody, responses((status = 200, body = GroupingView)))]
pub async fn ungroup(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<EntryIdsBody>) -> AppResult<Json<GroupingView>> {
    require_edit(&ctx)?;
    let mut tx = state.db.begin().await?;
    structural_change(&mut tx, &ctx, body.reset_voting_reason.as_deref()).await?;
    for eid in &body.entry_ids {
        sqlx::query("DELETE FROM theme_entries te USING entries e WHERE e.id = te.entry_id AND te.entry_id = $1 AND e.sprint_id = $2")
            .bind(eid)
            .bind(ctx.sprint.id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    grouping(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct ResetBody {
    pub reset_voting_reason: Option<String>,
}

/// Delete a theme; its entries return to the ungrouped pool.
#[utoipa::path(delete, path = "/api/sprints/{sprint_id}/themes/{theme_id}", tag = "themes", params(("sprint_id" = Uuid, Path), ("theme_id" = Uuid, Path)),
    request_body = ResetBody, responses((status = 200, body = GroupingView)))]
pub async fn delete(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, body: Option<Json<ResetBody>>) -> AppResult<Json<GroupingView>> {
    let theme_id = ids.1;
    require_edit(&ctx)?;
    let mut tx = state.db.begin().await?;
    structural_change(&mut tx, &ctx, body.as_ref().and_then(|b| b.reset_voting_reason.as_deref())).await?;
    sqlx::query("DELETE FROM themes WHERE id = $1 AND sprint_id = $2").bind(theme_id).bind(ctx.sprint.id).execute(&mut *tx).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    grouping(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct MergeBody {
    pub into_theme_id: Uuid,
    pub reset_voting_reason: Option<String>,
}

/// Merge this theme into another. Text of the target is kept; entries move.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/themes/{theme_id}/merge", tag = "themes", params(("sprint_id" = Uuid, Path), ("theme_id" = Uuid, Path)),
    request_body = MergeBody, responses((status = 200, body = GroupingView)))]
pub async fn merge(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<MergeBody>) -> AppResult<Json<GroupingView>> {
    let theme_id = ids.1;
    require_edit(&ctx)?;
    if body.into_theme_id == theme_id {
        return Err(AppError::BadRequest("pick a different theme to merge into".into()));
    }
    let mut tx = state.db.begin().await?;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE sprint_id = $1 AND id IN ($2, $3)").bind(ctx.sprint.id).bind(theme_id).bind(body.into_theme_id).fetch_one(&mut *tx).await?;
    if n != 2 {
        return Err(AppError::NotFound("theme not found".into()));
    }
    structural_change(&mut tx, &ctx, body.reset_voting_reason.as_deref()).await?;
    sqlx::query("UPDATE theme_entries SET theme_id = $1 WHERE theme_id = $2").bind(body.into_theme_id).bind(theme_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE context_additions SET theme_id = $1 WHERE theme_id = $2").bind(body.into_theme_id).bind(theme_id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM themes WHERE id = $1").bind(theme_id).execute(&mut *tx).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    grouping(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct SplitBody {
    pub title: String,
    pub entry_ids: Vec<Uuid>,
    pub reset_voting_reason: Option<String>,
}

/// Split entries out of a theme into a new one.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/themes/{theme_id}/split", tag = "themes", params(("sprint_id" = Uuid, Path), ("theme_id" = Uuid, Path)),
    request_body = SplitBody, responses((status = 200, body = GroupingView)))]
pub async fn split(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<SplitBody>) -> AppResult<Json<GroupingView>> {
    let theme_id = ids.1;
    require_edit(&ctx)?;
    let title = util::trimmed_nonempty(&body.title, 80, "Theme title").map_err(AppError::BadRequest)?;
    let mut tx = state.db.begin().await?;
    structural_change(&mut tx, &ctx, body.reset_voting_reason.as_deref()).await?;
    let (new_id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO themes (sprint_id, title, position) SELECT sprint_id, $2, position + 1 FROM themes WHERE id = $1 AND sprint_id = $3 RETURNING id",
    )
    .bind(theme_id)
    .bind(&title)
    .bind(ctx.sprint.id)
    .fetch_one(&mut *tx)
    .await?;
    for eid in &body.entry_ids {
        sqlx::query("UPDATE theme_entries SET theme_id = $1 WHERE entry_id = $2 AND theme_id = $3").bind(new_id).bind(eid).bind(theme_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    grouping(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct ReorderBody {
    pub theme_ids: Vec<Uuid>,
    /// Shown when the order departs from vote totals.
    pub reason: Option<String>,
}

/// Reorder themes. Not structural: does not reset voting.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/themes/reorder", tag = "themes", params(("sprint_id" = Uuid, Path)), request_body = ReorderBody, responses((status = 200, body = GroupingView)))]
pub async fn reorder(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<ReorderBody>) -> AppResult<Json<GroupingView>> {
    require_edit(&ctx)?;
    let mut tx = state.db.begin().await?;
    for (i, id) in body.theme_ids.iter().enumerate() {
        sqlx::query("UPDATE themes SET position = $1, order_reason = COALESCE($3, order_reason) WHERE id = $2 AND sprint_id = $4")
            .bind(i as i32)
            .bind(id)
            .bind(util::trimmed_optional(body.reason.as_deref(), 200, "Reason").map_err(AppError::BadRequest)?)
            .bind(ctx.sprint.id)
            .execute(&mut *tx)
            .await?;
    }
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "themes.reordered", serde_json::json!({})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    grouping(&state, &ctx).await.map(Json)
}

/// Shared entries for one theme (used by companion "look around").
pub async fn theme_entries(state: &AppState, theme_id: Uuid) -> AppResult<Vec<SharedEntry>> {
    Ok(sqlx::query_as(&format!("{SHARED_SELECT} WHERE te.theme_id = $1 ORDER BY e.reveal_order, e.id")).bind(theme_id).fetch_all(&state.db).await?)
}
