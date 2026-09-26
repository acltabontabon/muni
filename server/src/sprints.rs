//! Sprint setup, participants and the guarded lifecycle.
//!
//! DRAFT → COLLECTING → PREPARING → READY → LIVE → COMPLETED → ARCHIVED
//! (with PREPARING ⇄ COLLECTING reopen, READY → PREPARING, LIVE → READY cancel)

use crate::{
    audit,
    auth::extract::{Member, Role, SprintCtx},
    error::{AppError, AppResult},
    jobs,
    sse::Hint,
    state::AppState,
    util,
};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Duration, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub const STATUSES: [&str; 7] = ["draft", "collecting", "preparing", "ready", "live", "completed", "archived"];

#[derive(Serialize, Deserialize, ToSchema, Clone)]
pub struct SprintSchedule {
    pub timezone: String,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
    /// Local calendar date of the retro in `timezone`.
    pub retro_date: NaiveDate,
    /// Local wall time, "HH:MM".
    pub retro_time: String,
    pub retro_duration_min: i32,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateSprintBody {
    pub name: String,
    pub external_ref: Option<String>,
    pub goal: Option<String>,
    /// Optional brief opening question for the retro's first minutes.
    pub opening_question: Option<String>,
    #[serde(flatten)]
    pub schedule: SprintSchedule,
    pub participant_ids: Vec<Uuid>,
    pub facilitator_id: Uuid,
    pub ai_processing: bool,
    pub reminders_enabled: bool,
    pub vote_budget: Option<i32>,
    pub include_facilitator_in_rotation: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateSprintBody {
    pub name: Option<String>,
    pub external_ref: Option<String>,
    pub goal: Option<String>,
    pub opening_question: Option<String>,
    pub schedule: Option<SprintSchedule>,
    pub facilitator_id: Option<Uuid>,
    /// Only honoured while the sprint is a draft (privacy choices lock at collection start).
    pub ai_processing: Option<bool>,
    pub reminders_enabled: Option<bool>,
    pub vote_budget: Option<i32>,
    pub include_facilitator_in_rotation: Option<bool>,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct Participant {
    pub account_id: Uuid,
    pub display_name: String,
    pub is_facilitator: bool,
    pub is_you: bool,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct SprintSummary {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub external_ref: Option<String>,
    pub goal: Option<String>,
    pub status: String,
    pub timezone: String,
    pub starts_on: NaiveDate,
    pub ends_on: NaiveDate,
    pub retro_at: DateTime<Utc>,
    pub retro_local: String,
    pub retro_duration_min: i32,
    pub participant_count: i64,
    pub facilitator_name: Option<String>,
    pub is_facilitator: bool,
    pub is_participant: bool,
}

#[derive(Serialize, ToSchema)]
pub struct SprintDetail {
    #[serde(flatten)]
    pub summary: SprintSummary,
    pub opening_question: Option<String>,
    pub ai_processing: bool,
    pub ai_locked: bool,
    pub ai_provider: String,
    pub reminders_enabled: bool,
    pub my_reminders_opt_out: bool,
    pub vote_budget: i32,
    pub include_facilitator_in_rotation: bool,
    pub participants: Vec<Participant>,
    /// Aggregate only, and only once collection has closed.
    pub entry_count: Option<i64>,
    pub theme_count: i64,
    pub grouping_revision: i64,
    pub collection_opened_at: Option<DateTime<Utc>>,
    pub collection_closed_at: Option<DateTime<Utc>>,
    pub reopened_count: i32,
    pub revealed_once: bool,
    pub completed_at: Option<DateTime<Utc>>,
    pub content_purged_at: Option<DateTime<Utc>>,
    pub has_session: bool,
    pub session_cancelled: bool,
    pub allowed_transitions: Vec<String>,
    pub role: String,
    pub workspace_name: String,
    pub previous_sprint_id: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct FullRow {
    id: Uuid,
    workspace_id: Uuid,
    name: String,
    external_ref: Option<String>,
    goal: Option<String>,
    opening_question: Option<String>,
    status: String,
    timezone: String,
    starts_on: NaiveDate,
    ends_on: NaiveDate,
    retro_at: DateTime<Utc>,
    retro_duration_min: i32,
    ai_processing: bool,
    ai_locked: bool,
    reminders_enabled: bool,
    vote_budget: i32,
    include_facilitator_in_rotation: bool,
    grouping_revision: i64,
    collection_opened_at: Option<DateTime<Utc>>,
    collection_closed_at: Option<DateTime<Utc>>,
    reopened_count: i32,
    revealed_once: bool,
    completed_at: Option<DateTime<Utc>>,
    content_purged_at: Option<DateTime<Utc>>,
}

const FULL_COLS: &str = "id, workspace_id, name, external_ref, goal, opening_question, status, timezone, starts_on, ends_on, retro_at, retro_duration_min,
    ai_processing, ai_locked, reminders_enabled, vote_budget, include_facilitator_in_rotation, grouping_revision,
    collection_opened_at, collection_closed_at, reopened_count, revealed_once, completed_at, content_purged_at";

pub fn parse_tz(s: &str) -> AppResult<Tz> {
    s.parse::<Tz>().map_err(|_| AppError::BadRequest(format!("unknown timezone “{s}”")))
}

/// Resolves a local date + wall time to an instant. Nonexistent local times
/// (spring-forward gaps) are rejected; ambiguous ones (fall-back) use the
/// earlier instant, which is what a calendar would show.
pub fn resolve_local(tz: Tz, date: NaiveDate, time: &str) -> AppResult<DateTime<Utc>> {
    let t = NaiveTime::parse_from_str(time, "%H:%M").map_err(|_| AppError::BadRequest("retro time must be HH:MM".into()))?;
    let naive = date.and_time(t);
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => Ok(dt.with_timezone(&Utc)),
        chrono::LocalResult::Ambiguous(a, _) => Ok(a.with_timezone(&Utc)),
        chrono::LocalResult::None => Err(AppError::BadRequest(
            "that local time doesn’t exist on that date (clocks skip forward) — pick another time".into(),
        )),
    }
}

pub fn local_label(tz: &str, at: DateTime<Utc>) -> String {
    match tz.parse::<Tz>() {
        Ok(tz) => at.with_timezone(&tz).format("%a %-d %b %Y, %H:%M %Z").to_string(),
        Err(_) => at.to_rfc3339(),
    }
}

fn validate_schedule(s: &SprintSchedule) -> AppResult<(Tz, DateTime<Utc>)> {
    let tz = parse_tz(&s.timezone)?;
    if s.starts_on > s.ends_on {
        return Err(AppError::BadRequest("the sprint can’t end before it starts".into()));
    }
    if (s.ends_on - s.starts_on).num_days() > 120 {
        return Err(AppError::BadRequest("sprints longer than 120 days aren’t supported".into()));
    }
    if s.retro_date < s.starts_on {
        return Err(AppError::BadRequest("the retro can’t happen before the sprint starts".into()));
    }
    if !(10..=240).contains(&s.retro_duration_min) {
        return Err(AppError::BadRequest("retro duration must be between 10 and 240 minutes".into()));
    }
    let retro_at = resolve_local(tz, s.retro_date, &s.retro_time)?;
    Ok((tz, retro_at))
}

async fn active_member(state: &AppState, workspace_id: Uuid, account_id: Uuid) -> AppResult<bool> {
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM memberships WHERE workspace_id = $1 AND account_id = $2 AND revoked_at IS NULL")
        .bind(workspace_id)
        .bind(account_id)
        .fetch_one(&state.db)
        .await?;
    Ok(n > 0)
}

/// Create a sprint (owners and members can create; the creator or the chosen facilitator runs it).
#[utoipa::path(post, path = "/api/workspaces/{workspace_id}/sprints", tag = "sprints", params(("workspace_id" = Uuid, Path)),
    request_body = CreateSprintBody, responses((status = 200, body = SprintDetail)))]
pub async fn create(State(state): State<AppState>, m: Member, Json(body): Json<CreateSprintBody>) -> AppResult<Json<SprintDetail>> {
    let name = util::trimmed_nonempty(&body.name, 120, "Sprint name").map_err(AppError::BadRequest)?;
    let external_ref = util::trimmed_optional(body.external_ref.as_deref(), 60, "External id").map_err(AppError::BadRequest)?;
    let goal = util::trimmed_optional(body.goal.as_deref(), 300, "Sprint goal").map_err(AppError::BadRequest)?;
    let opening_question = util::trimmed_optional(body.opening_question.as_deref(), 200, "Opening question").map_err(AppError::BadRequest)?;
    let (_, retro_at) = validate_schedule(&body.schedule)?;
    let budget = body.vote_budget.unwrap_or(3);
    if !(1..=10).contains(&budget) {
        return Err(AppError::BadRequest("votes per person must be between 1 and 10".into()));
    }
    let mut ids: Vec<Uuid> = body.participant_ids.clone();
    if !ids.contains(&body.facilitator_id) {
        ids.push(body.facilitator_id);
    }
    ids.sort();
    ids.dedup();
    if ids.len() > 60 {
        return Err(AppError::BadRequest("a sprint can have at most 60 participants".into()));
    }
    for id in &ids {
        if !active_member(&state, m.workspace_id, *id).await? {
            return Err(AppError::BadRequest("every participant must be a member of this workspace".into()));
        }
    }
    let mut tx = state.db.begin().await?;
    let (id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO sprints (workspace_id, name, external_ref, goal, timezone, starts_on, ends_on, retro_at, retro_duration_min,
            ai_processing, reminders_enabled, vote_budget, include_facilitator_in_rotation, created_by, opening_question)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id",
    )
    .bind(m.workspace_id)
    .bind(&name)
    .bind(&external_ref)
    .bind(&goal)
    .bind(&body.schedule.timezone)
    .bind(body.schedule.starts_on)
    .bind(body.schedule.ends_on)
    .bind(retro_at)
    .bind(body.schedule.retro_duration_min)
    .bind(body.ai_processing && state.config.ai.is_available())
    .bind(body.reminders_enabled)
    .bind(budget)
    .bind(body.include_facilitator_in_rotation.unwrap_or(false))
    .bind(m.auth.account.id)
    .bind(&opening_question)
    .fetch_one(&mut *tx)
    .await?;
    for pid in &ids {
        sqlx::query("INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator) VALUES ($1,$2,$3)")
            .bind(id)
            .bind(pid)
            .bind(*pid == body.facilitator_id)
            .execute(&mut *tx)
            .await?;
    }
    audit::record(&mut *tx, m.workspace_id, Some(id), Some(m.auth.account.id), "sprint.created", serde_json::json!({})).await?;
    tx.commit().await?;
    let ctx = crate::auth::extract::load_sprint_ctx(&state, m.auth.clone(), id).await?;
    detail(&state, &ctx).await.map(Json)
}

/// Sprints in a workspace, newest first.
#[utoipa::path(get, path = "/api/workspaces/{workspace_id}/sprints", tag = "sprints", params(("workspace_id" = Uuid, Path)),
    responses((status = 200, body = Vec<SprintSummary>)))]
pub async fn list(State(state): State<AppState>, m: Member) -> AppResult<Json<Vec<SprintSummary>>> {
    let rows: Vec<FullRow> = sqlx::query_as(&format!("SELECT {FULL_COLS} FROM sprints WHERE workspace_id = $1 ORDER BY starts_on DESC, created_at DESC"))
        .bind(m.workspace_id)
        .fetch_all(&state.db)
        .await?;
    let mut out = vec![];
    for r in rows {
        out.push(summary(&state, &r, m.auth.account.id).await?);
    }
    Ok(Json(out))
}

async fn summary(state: &AppState, r: &FullRow, me: Uuid) -> AppResult<SprintSummary> {
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM sprint_participants WHERE sprint_id = $1").bind(r.id).fetch_one(&state.db).await?;
    let fac: Option<(String,)> = sqlx::query_as(
        "SELECT a.display_name FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id WHERE sp.sprint_id = $1 AND sp.is_facilitator LIMIT 1",
    )
    .bind(r.id)
    .fetch_optional(&state.db)
    .await?;
    let mine: Option<(bool,)> = sqlx::query_as("SELECT is_facilitator FROM sprint_participants WHERE sprint_id = $1 AND account_id = $2")
        .bind(r.id)
        .bind(me)
        .fetch_optional(&state.db)
        .await?;
    Ok(SprintSummary {
        id: r.id,
        workspace_id: r.workspace_id,
        name: r.name.clone(),
        external_ref: r.external_ref.clone(),
        goal: r.goal.clone(),
        status: r.status.clone(),
        timezone: r.timezone.clone(),
        starts_on: r.starts_on,
        ends_on: r.ends_on,
        retro_at: r.retro_at,
        retro_local: local_label(&r.timezone, r.retro_at),
        retro_duration_min: r.retro_duration_min,
        participant_count: count,
        facilitator_name: fac.map(|f| f.0),
        is_facilitator: mine.map(|m| m.0).unwrap_or(false),
        is_participant: mine.is_some(),
    })
}

pub fn allowed_transitions(status: &str, is_facilitator: bool) -> Vec<String> {
    if !is_facilitator {
        return vec![];
    }
    match status {
        "draft" => vec!["collecting"],
        "collecting" => vec!["preparing"],
        "preparing" => vec!["ready", "collecting"],
        "ready" => vec!["live", "preparing"],
        "live" => vec!["completed", "ready"],
        "completed" => vec!["archived"],
        _ => vec![],
    }
    .into_iter()
    .map(String::from)
    .collect()
}

pub async fn detail(state: &AppState, ctx: &SprintCtx) -> AppResult<SprintDetail> {
    let r: FullRow = sqlx::query_as(&format!("SELECT {FULL_COLS} FROM sprints WHERE id = $1")).bind(ctx.sprint.id).fetch_one(&state.db).await?;
    let summary = summary(state, &r, ctx.account_id()).await?;
    let prows: Vec<(Uuid, String, bool)> = sqlx::query_as(
        "SELECT a.id, a.display_name, sp.is_facilitator FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id
         WHERE sp.sprint_id = $1 ORDER BY sp.is_facilitator DESC, a.display_name",
    )
    .bind(r.id)
    .fetch_all(&state.db)
    .await?;
    let participants = prows
        .into_iter()
        .map(|(account_id, display_name, is_facilitator)| Participant { account_id, display_name, is_facilitator, is_you: account_id == ctx.account_id() })
        .collect();
    // Sealed: aggregate count is only available once collection has closed.
    let entry_count = if matches!(r.status.as_str(), "draft" | "collecting") {
        None
    } else {
        let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM entries WHERE sprint_id = $1").bind(r.id).fetch_one(&state.db).await?;
        Some(n)
    };
    let (theme_count,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE sprint_id = $1").bind(r.id).fetch_one(&state.db).await?;
    let sess: Option<(bool,)> = sqlx::query_as("SELECT cancelled FROM retro_sessions WHERE sprint_id = $1").bind(r.id).fetch_optional(&state.db).await?;
    let opt: Option<(bool,)> = sqlx::query_as("SELECT reminders_opt_out FROM sprint_participants WHERE sprint_id = $1 AND account_id = $2")
        .bind(r.id)
        .bind(ctx.account_id())
        .fetch_optional(&state.db)
        .await?;
    let (workspace_name,): (String,) = sqlx::query_as("SELECT name FROM workspaces WHERE id = $1").bind(r.workspace_id).fetch_one(&state.db).await?;
    let prev: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM sprints WHERE workspace_id = $1 AND id <> $2 AND status IN ('completed','archived') AND starts_on <= $3 ORDER BY starts_on DESC, created_at DESC LIMIT 1",
    )
    .bind(r.workspace_id)
    .bind(r.id)
    .bind(r.starts_on)
    .fetch_optional(&state.db)
    .await?;
    Ok(SprintDetail {
        summary,
        opening_question: r.opening_question.clone(),
        ai_processing: r.ai_processing,
        ai_locked: r.ai_locked,
        ai_provider: state.config.ai.provider_label().into(),
        reminders_enabled: r.reminders_enabled,
        my_reminders_opt_out: opt.map(|o| o.0).unwrap_or(false),
        vote_budget: r.vote_budget,
        include_facilitator_in_rotation: r.include_facilitator_in_rotation,
        participants,
        entry_count,
        theme_count,
        grouping_revision: r.grouping_revision,
        collection_opened_at: r.collection_opened_at,
        collection_closed_at: r.collection_closed_at,
        reopened_count: r.reopened_count,
        revealed_once: r.revealed_once,
        completed_at: r.completed_at,
        content_purged_at: r.content_purged_at,
        has_session: sess.is_some(),
        session_cancelled: sess.map(|s| s.0).unwrap_or(false),
        allowed_transitions: allowed_transitions(&r.status, ctx.is_facilitator),
        role: ctx.role.as_str().into(),
        workspace_name,
        previous_sprint_id: prev.map(|p| p.0),
    })
}

/// A sprint as seen by the caller. Never includes per-person contribution status.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}", tag = "sprints", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = SprintDetail)))]
pub async fn get(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<SprintDetail>> {
    detail(&state, &ctx).await.map(Json)
}

/// Update sprint setup. Privacy/AI choices lock once collection starts.
#[utoipa::path(patch, path = "/api/sprints/{sprint_id}", tag = "sprints", params(("sprint_id" = Uuid, Path)),
    request_body = UpdateSprintBody, responses((status = 200, body = SprintDetail)))]
pub async fn update(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<UpdateSprintBody>) -> AppResult<Json<SprintDetail>> {
    ctx.require_facilitator()?;
    if matches!(ctx.sprint.status.as_str(), "completed" | "archived") {
        return Err(AppError::Conflict("this sprint is finished and can’t be edited".into()));
    }
    let mut tx = state.db.begin().await?;
    if let Some(name) = &body.name {
        let name = util::trimmed_nonempty(name, 120, "Sprint name").map_err(AppError::BadRequest)?;
        sqlx::query("UPDATE sprints SET name = $1, updated_at = now() WHERE id = $2").bind(name).bind(ctx.sprint.id).execute(&mut *tx).await?;
    }
    if let Some(v) = &body.external_ref {
        let v = util::trimmed_optional(Some(v), 60, "External id").map_err(AppError::BadRequest)?;
        sqlx::query("UPDATE sprints SET external_ref = $1 WHERE id = $2").bind(v).bind(ctx.sprint.id).execute(&mut *tx).await?;
    }
    if let Some(v) = &body.goal {
        let v = util::trimmed_optional(Some(v), 300, "Sprint goal").map_err(AppError::BadRequest)?;
        sqlx::query("UPDATE sprints SET goal = $1 WHERE id = $2").bind(v).bind(ctx.sprint.id).execute(&mut *tx).await?;
    }
    if let Some(v) = &body.opening_question {
        let v = util::trimmed_optional(Some(v), 200, "Opening question").map_err(AppError::BadRequest)?;
        sqlx::query("UPDATE sprints SET opening_question = $1 WHERE id = $2").bind(v).bind(ctx.sprint.id).execute(&mut *tx).await?;
    }
    if let Some(s) = &body.schedule {
        let (_, retro_at) = validate_schedule(s)?;
        sqlx::query("UPDATE sprints SET timezone=$1, starts_on=$2, ends_on=$3, retro_at=$4, retro_duration_min=$5, updated_at=now() WHERE id=$6")
            .bind(&s.timezone)
            .bind(s.starts_on)
            .bind(s.ends_on)
            .bind(retro_at)
            .bind(s.retro_duration_min)
            .bind(ctx.sprint.id)
            .execute(&mut *tx)
            .await?;
        // Rescheduling: rebuild reminder jobs that haven't run.
        jobs::cancel_reminders(&mut tx, ctx.sprint.id).await?;
        if ctx.sprint.status == "collecting" {
            jobs::schedule_reminders(&mut tx, ctx.sprint.id).await?;
        }
    }
    if let Some(v) = body.ai_processing {
        // Never widen processing after people have submitted.
        if ctx.sprint.status != "draft" && v && !ctx.sprint.ai_processing {
            return Err(AppError::Conflict(
                "AI processing can’t be turned on after collection has started — it applies to the next sprint".into(),
            ));
        }
        sqlx::query("UPDATE sprints SET ai_processing = $1 WHERE id = $2").bind(v && state.config.ai.is_available()).bind(ctx.sprint.id).execute(&mut *tx).await?;
    }
    if let Some(v) = body.reminders_enabled {
        sqlx::query("UPDATE sprints SET reminders_enabled = $1 WHERE id = $2").bind(v).bind(ctx.sprint.id).execute(&mut *tx).await?;
        if !v {
            jobs::cancel_reminders(&mut tx, ctx.sprint.id).await?;
        } else if ctx.sprint.status == "collecting" {
            jobs::cancel_reminders(&mut tx, ctx.sprint.id).await?;
            jobs::schedule_reminders(&mut tx, ctx.sprint.id).await?;
        }
    }
    if let Some(b) = body.vote_budget {
        if !(1..=10).contains(&b) {
            return Err(AppError::BadRequest("votes per person must be between 1 and 10".into()));
        }
        let (open,): (i64,) = sqlx::query_as("SELECT count(*) FROM vote_rounds WHERE sprint_id = $1 AND status = 'open'").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
        if open > 0 {
            return Err(AppError::Conflict("close the open voting round before changing the budget".into()));
        }
        sqlx::query("UPDATE sprints SET vote_budget = $1 WHERE id = $2").bind(b).bind(ctx.sprint.id).execute(&mut *tx).await?;
    }
    if let Some(v) = body.include_facilitator_in_rotation {
        sqlx::query("UPDATE sprints SET include_facilitator_in_rotation = $1 WHERE id = $2").bind(v).bind(ctx.sprint.id).execute(&mut *tx).await?;
    }
    if let Some(fid) = body.facilitator_id {
        let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM sprint_participants WHERE sprint_id = $1 AND account_id = $2").bind(ctx.sprint.id).bind(fid).fetch_one(&mut *tx).await?;
        if n == 0 {
            return Err(AppError::BadRequest("the facilitator must be a participant".into()));
        }
        sqlx::query("UPDATE sprint_participants SET is_facilitator = (account_id = $2) WHERE sprint_id = $1").bind(ctx.sprint.id).bind(fid).execute(&mut *tx).await?;
    }
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "sprint.updated", serde_json::json!({})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::sprint());
    let ctx = crate::auth::extract::load_sprint_ctx(&state, ctx.auth.clone(), ctx.sprint.id).await?;
    detail(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct ParticipantBody {
    pub account_id: Uuid,
}

#[derive(Serialize, ToSchema)]
pub struct Ok {
    pub ok: bool,
}

/// Add a workspace member to the sprint.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/participants", tag = "sprints", params(("sprint_id" = Uuid, Path)),
    request_body = ParticipantBody, responses((status = 200, body = Ok)))]
pub async fn add_participant(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<ParticipantBody>) -> AppResult<Json<Ok>> {
    ctx.require_facilitator()?;
    if matches!(ctx.sprint.status.as_str(), "completed" | "archived") {
        return Err(AppError::Conflict("this sprint is finished".into()));
    }
    if !active_member(&state, ctx.sprint.workspace_id, body.account_id).await? {
        return Err(AppError::BadRequest("that person isn’t a member of this workspace".into()));
    }
    sqlx::query("INSERT INTO sprint_participants (sprint_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(ctx.sprint.id)
        .bind(body.account_id)
        .execute(&state.db)
        .await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::sprint());
    Ok(Json(Ok { ok: true }))
}

/// Remove a participant. Sealed entries they already saved stay in the sprint pool.
#[utoipa::path(delete, path = "/api/sprints/{sprint_id}/participants/{account_id}", tag = "sprints",
    params(("sprint_id" = Uuid, Path), ("account_id" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn remove_participant(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>) -> AppResult<Json<Ok>> {
    let account_id = ids.1;
    ctx.require_facilitator()?;
    if account_id == ctx.account_id() {
        return Err(AppError::Conflict("hand facilitation to someone else before leaving".into()));
    }
    sqlx::query("DELETE FROM sprint_participants WHERE sprint_id = $1 AND account_id = $2 AND NOT is_facilitator")
        .bind(ctx.sprint.id)
        .bind(account_id)
        .execute(&state.db)
        .await?;
    state.broadcaster.revoke_sprint(ctx.sprint.id, account_id);
    state.broadcaster.publish(ctx.sprint.id, Hint::sprint());
    Ok(Json(Ok { ok: true }))
}

#[derive(Deserialize, ToSchema)]
pub struct MyPrefsBody {
    pub reminders_opt_out: bool,
}

/// Personal reminder preference for this sprint.
#[utoipa::path(patch, path = "/api/sprints/{sprint_id}/me", tag = "sprints", params(("sprint_id" = Uuid, Path)), request_body = MyPrefsBody, responses((status = 200, body = Ok)))]
pub async fn my_prefs(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<MyPrefsBody>) -> AppResult<Json<Ok>> {
    ctx.require_participant()?;
    sqlx::query("UPDATE sprint_participants SET reminders_opt_out = $1 WHERE sprint_id = $2 AND account_id = $3")
        .bind(body.reminders_opt_out)
        .bind(ctx.sprint.id)
        .bind(ctx.account_id())
        .execute(&state.db)
        .await?;
    Ok(Json(Ok { ok: true }))
}

#[derive(Deserialize, ToSchema)]
pub struct TransitionBody {
    pub to: String,
    /// Required for closing collection (it reveals feedback) and reopening it.
    pub confirm: Option<bool>,
}

/// Move the sprint through its lifecycle. Every transition is checked server-side.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/transition", tag = "sprints", params(("sprint_id" = Uuid, Path)),
    request_body = TransitionBody, responses((status = 200, body = SprintDetail), (status = 409, body = crate::error::ErrorBody)))]
pub async fn transition(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<TransitionBody>) -> AppResult<Json<SprintDetail>> {
    ctx.require_facilitator()?;
    let to = body.to.as_str();
    if !STATUSES.contains(&to) {
        return Err(AppError::BadRequest("unknown status".into()));
    }
    let mut tx = state.db.begin().await?;
    // Lock the sprint row: submissions take FOR SHARE, so closing waits for in-flight saves.
    let (from, retro_at, reminders, ws): (String, DateTime<Utc>, bool, Uuid) =
        sqlx::query_as("SELECT status, retro_at, reminders_enabled, workspace_id FROM sprints WHERE id = $1 FOR UPDATE")
            .bind(ctx.sprint.id)
            .fetch_one(&mut *tx)
            .await?;
    if !allowed_transitions(&from, true).iter().any(|t| t == to) {
        return Err(AppError::Conflict(format!("can’t move from {from} to {to}")));
    }
    let now = Utc::now();
    match (from.as_str(), to) {
        ("draft", "collecting") => {
            let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM sprint_participants WHERE sprint_id = $1").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
            if n == 0 {
                return Err(AppError::Conflict("add at least one participant before opening collection".into()));
            }
            sqlx::query("UPDATE sprints SET status='collecting', ai_locked=true, collection_opened_at=COALESCE(collection_opened_at,$2), updated_at=$2 WHERE id=$1")
                .bind(ctx.sprint.id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            if reminders {
                jobs::schedule_reminders(&mut tx, ctx.sprint.id).await?;
            }
        }
        ("collecting", "preparing") => {
            if body.confirm != Some(true) {
                return Err(AppError::Conflict("closing collection reveals everyone’s entries to the sprint’s participants — confirm to continue".into()));
            }
            // Batch reveal with randomised ordering. Nothing about submission time survives into shared views.
            sqlx::query("UPDATE entries SET reveal_order = floor(random() * 2147483647)::int WHERE sprint_id = $1")
                .bind(ctx.sprint.id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE sprints SET status='preparing', collection_closed_at=$2, revealed_once=true, updated_at=$2 WHERE id=$1")
                .bind(ctx.sprint.id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            jobs::cancel_reminders(&mut tx, ctx.sprint.id).await?;
            let _ = retro_at;
        }
        ("preparing", "collecting") => {
            if body.confirm != Some(true) {
                return Err(AppError::Conflict("reopening keeps what participants have already seen visible in their history — confirm to continue".into()));
            }
            sqlx::query("UPDATE vote_rounds SET status='cancelled', cancel_reason='collection reopened', closed_at=now() WHERE sprint_id=$1 AND status='open'")
                .bind(ctx.sprint.id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("UPDATE sprints SET status='collecting', reopened_count=reopened_count+1, grouping_revision=grouping_revision+1, updated_at=$2 WHERE id=$1")
                .bind(ctx.sprint.id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
        }
        ("preparing", "ready") => {
            sqlx::query("UPDATE sprints SET status='ready', updated_at=$2 WHERE id=$1").bind(ctx.sprint.id).bind(now).execute(&mut *tx).await?;
        }
        ("ready", "preparing") => {
            sqlx::query("UPDATE sprints SET status='preparing', updated_at=$2 WHERE id=$1").bind(ctx.sprint.id).bind(now).execute(&mut *tx).await?;
        }
        ("ready", "live") => {
            crate::meeting::start_session(&mut tx, &ctx).await?;
            sqlx::query("UPDATE sprints SET status='live', updated_at=$2 WHERE id=$1").bind(ctx.sprint.id).bind(now).execute(&mut *tx).await?;
        }
        ("live", "ready") => {
            sqlx::query("UPDATE retro_sessions SET cancelled=true, ended_at=now(), version=version+1 WHERE sprint_id=$1").bind(ctx.sprint.id).execute(&mut *tx).await?;
            sqlx::query("UPDATE vote_rounds SET status='cancelled', cancel_reason='session cancelled', closed_at=now() WHERE sprint_id=$1 AND status='open'").bind(ctx.sprint.id).execute(&mut *tx).await?;
            sqlx::query("UPDATE sprints SET status='ready', updated_at=$2 WHERE id=$1").bind(ctx.sprint.id).bind(now).execute(&mut *tx).await?;
        }
        ("live", "completed") => {
            sqlx::query("UPDATE retro_sessions SET ended_at=now(), phase='leave', version=version+1 WHERE sprint_id=$1").bind(ctx.sprint.id).execute(&mut *tx).await?;
            sqlx::query("UPDATE vote_rounds SET status='closed', closed_at=now() WHERE sprint_id=$1 AND status='open'").bind(ctx.sprint.id).execute(&mut *tx).await?;
            sqlx::query("UPDATE sprints SET status='completed', completed_at=$2, updated_at=$2 WHERE id=$1").bind(ctx.sprint.id).bind(now).execute(&mut *tx).await?;
        }
        ("completed", "archived") => {
            sqlx::query("UPDATE sprints SET status='archived', archived_at=$2, updated_at=$2 WHERE id=$1").bind(ctx.sprint.id).bind(now).execute(&mut *tx).await?;
        }
        _ => return Err(AppError::Conflict(format!("can’t move from {from} to {to}"))),
    }
    audit::record(&mut *tx, ws, Some(ctx.sprint.id), Some(ctx.account_id()), "sprint.transition", serde_json::json!({"from": from, "to": to})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::sprint());
    state.broadcaster.publish(ctx.sprint.id, Hint::meeting());
    let ctx = crate::auth::extract::load_sprint_ctx(&state, ctx.auth.clone(), ctx.sprint.id).await?;
    let _ = Duration::zero();
    detail(&state, &ctx).await.map(Json)
}

/// Delete a draft sprint.
#[utoipa::path(delete, path = "/api/sprints/{sprint_id}", tag = "sprints", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<Ok>> {
    if !(ctx.is_facilitator || ctx.role == Role::Owner) {
        return Err(AppError::Forbidden("only the facilitator or an owner can delete a draft".into()));
    }
    if ctx.sprint.status != "draft" {
        return Err(AppError::Conflict("only draft sprints can be deleted; finished sprints follow the retention policy".into()));
    }
    sqlx::query("DELETE FROM sprints WHERE id = $1 AND status = 'draft'").bind(ctx.sprint.id).execute(&state.db).await?;
    Ok(Json(Ok { ok: true }))
}

#[derive(Serialize, ToSchema)]
pub struct CaptureTarget {
    /// Sprints currently collecting that the caller participates in, most recently opened first.
    pub collecting: Vec<SprintSummary>,
    /// Sprints the caller participates in that are past collection but not finished (retro soon or live).
    pub upcoming: Vec<SprintSummary>,
}

/// Where should a new thought go? Powers the bookmarkable /capture route.
#[utoipa::path(get, path = "/api/me/capture-target", tag = "sprints", responses((status = 200, body = CaptureTarget)))]
pub async fn capture_target(State(state): State<AppState>, auth: crate::auth::extract::Auth) -> AppResult<Json<CaptureTarget>> {
    let rows: Vec<FullRow> = sqlx::query_as(&format!(
        "SELECT {FULL_COLS} FROM sprints s WHERE s.status IN ('collecting','preparing','ready','live')
         AND EXISTS (SELECT 1 FROM sprint_participants sp WHERE sp.sprint_id = s.id AND sp.account_id = $1)
         AND EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = s.workspace_id AND m.account_id = $1 AND m.revoked_at IS NULL)
         ORDER BY s.collection_opened_at DESC NULLS LAST, s.retro_at"
    ))
    .bind(auth.account.id)
    .fetch_all(&state.db)
    .await?;
    let mut collecting = vec![];
    let mut upcoming = vec![];
    for r in rows {
        let sm = summary(&state, &r, auth.account.id).await?;
        if r.status == "collecting" {
            collecting.push(sm);
        } else {
            upcoming.push(sm);
        }
    }
    Ok(Json(CaptureTarget { collecting, upcoming }))
}
