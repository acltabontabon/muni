//! Private capture and the sealed → revealed boundary.
//!
//! `MyEntry` is what an author sees of their own entry. `SharedEntry` is the
//! only representation that ever leaves the author's account, and it has no
//! author, timestamp or alias fields by construction.

use crate::{
    auth::extract::SprintCtx,
    error::{AppError, AppResult},
    sse::Hint,
    state::AppState,
    util,
};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub const CATEGORIES: [&str; 5] = ["proud", "keep", "improve", "stop", "try"];
pub const PERIODS: [&str; 3] = ["early", "middle", "late"];

#[derive(Deserialize, ToSchema)]
pub struct EntryBody {
    /// Optional. A thought without a category is "unsorted" and can be sorted later.
    pub category: Option<String>,
    pub body: String,
    pub impact: Option<String>,
    pub might_help: Option<String>,
    pub period: Option<String>,
    /// Client-generated key so retries after a dropped connection don't duplicate.
    pub idempotency_key: Option<String>,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct MyEntry {
    pub id: Uuid,
    pub category: Option<String>,
    pub body: String,
    pub impact: Option<String>,
    pub might_help: Option<String>,
    pub period: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub editable: bool,
}

/// The shared, anonymous representation. Add fields here with care.
#[derive(Serialize, ToSchema, Clone, sqlx::FromRow)]
pub struct SharedEntry {
    pub id: Uuid,
    pub category: Option<String>,
    pub body: String,
    pub impact: Option<String>,
    pub might_help: Option<String>,
    pub period: Option<String>,
    pub theme_id: Option<Uuid>,
}

pub const SHARED_SELECT: &str = "SELECT e.id, e.category, e.body, e.impact, e.might_help, e.period, te.theme_id
    FROM entries e LEFT JOIN theme_entries te ON te.entry_id = e.id";

struct Validated {
    category: Option<String>,
    body: String,
    impact: Option<String>,
    might_help: Option<String>,
    period: Option<String>,
}

fn validate(state: &AppState, b: &EntryBody) -> AppResult<Validated> {
    let category = match b.category.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(c) if CATEGORIES.contains(&c) => Some(c.to_string()),
        Some(_) => return Err(AppError::BadRequest("unknown category".into())),
    };
    let max = state.config.entry_max_chars;
    let body = util::trimmed_nonempty(&b.body, max, "The observation").map_err(AppError::BadRequest)?;
    let impact = util::trimmed_optional(b.impact.as_deref(), max, "Impact").map_err(AppError::BadRequest)?;
    let might_help = util::trimmed_optional(b.might_help.as_deref(), max, "What might help").map_err(AppError::BadRequest)?;
    let period = match b.period.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(p) if PERIODS.contains(&p) => Some(p.to_string()),
        Some(_) => return Err(AppError::BadRequest("period must be early, middle or late".into())),
    };
    Ok(Validated { category, body, impact, might_help, period })
}

fn my_entry(row: (Uuid, Option<String>, String, Option<String>, Option<String>, Option<String>, DateTime<Utc>, DateTime<Utc>), editable: bool) -> MyEntry {
    MyEntry { id: row.0, category: row.1, body: row.2, impact: row.3, might_help: row.4, period: row.5, created_at: row.6, updated_at: row.7, editable }
}

const MY_COLS: &str = "id, category, body, impact, might_help, period, created_at, updated_at";

/// Save a thought. Only while collection is open; only visible to you until it closes.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/entries", tag = "entries", params(("sprint_id" = Uuid, Path)),
    request_body = EntryBody, responses((status = 200, body = MyEntry), (status = 409, body = crate::error::ErrorBody)))]
pub async fn create(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<EntryBody>) -> AppResult<Json<MyEntry>> {
    ctx.require_participant()?;
    let v = validate(&state, &body)?;
    let key = body.idempotency_key.as_deref().map(str::trim).filter(|k| !k.is_empty() && k.len() <= 64).map(String::from);
    let mut tx = state.db.begin().await?;
    // FOR SHARE: many saves may proceed together; closing collection (FOR UPDATE) waits for them.
    let (status,): (String,) = sqlx::query_as("SELECT status FROM sprints WHERE id = $1 FOR SHARE").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    if status != "collecting" {
        return Err(AppError::Conflict("collection for this sprint has closed — this thought wasn’t saved".into()));
    }
    if let Some(k) = &key {
        let existing: Option<(Uuid, Option<String>, String, Option<String>, Option<String>, Option<String>, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(
            &format!("SELECT {MY_COLS} FROM entries WHERE sprint_id = $1 AND author_account_id = $2 AND idempotency_key = $3"),
        )
        .bind(ctx.sprint.id)
        .bind(ctx.account_id())
        .bind(k)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(row) = existing {
            tx.commit().await?;
            return Ok(Json(my_entry(row, true)));
        }
    }
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM entries WHERE sprint_id = $1 AND author_account_id = $2")
        .bind(ctx.sprint.id)
        .bind(ctx.account_id())
        .fetch_one(&mut *tx)
        .await?;
    if count >= 200 {
        return Err(AppError::Conflict("you’ve saved 200 entries for this sprint — that’s the limit".into()));
    }
    let row = sqlx::query_as(&format!(
        "INSERT INTO entries (sprint_id, author_account_id, category, body, impact, might_help, period, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (sprint_id, author_account_id, idempotency_key) DO UPDATE SET updated_at = entries.updated_at
         RETURNING {MY_COLS}"
    ))
    .bind(ctx.sprint.id)
    .bind(ctx.account_id())
    .bind(&v.category)
    .bind(&v.body)
    .bind(&v.impact)
    .bind(&v.might_help)
    .bind(&v.period)
    .bind(&key)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    // Deliberately no broadcast: per-submission changes are not announced during collection.
    Ok(Json(my_entry(row, true)))
}

/// Your own entries for this sprint, on any device.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/entries/mine", tag = "entries", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = Vec<MyEntry>)))]
pub async fn mine(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<Vec<MyEntry>>> {
    ctx.require_participant()?;
    let rows: Vec<(Uuid, Option<String>, String, Option<String>, Option<String>, Option<String>, DateTime<Utc>, DateTime<Utc>)> =
        sqlx::query_as(&format!("SELECT {MY_COLS} FROM entries WHERE sprint_id = $1 AND author_account_id = $2 ORDER BY created_at DESC"))
            .bind(ctx.sprint.id)
            .bind(ctx.account_id())
            .fetch_all(&state.db)
            .await?;
    let editable = ctx.sprint.status == "collecting";
    Ok(Json(rows.into_iter().map(|r| my_entry(r, editable)).collect()))
}

/// Edit one of your entries while collection is open.
#[utoipa::path(patch, path = "/api/sprints/{sprint_id}/entries/{entry_id}", tag = "entries",
    params(("sprint_id" = Uuid, Path), ("entry_id" = Uuid, Path)), request_body = EntryBody, responses((status = 200, body = MyEntry)))]
pub async fn update(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<EntryBody>) -> AppResult<Json<MyEntry>> {
    let entry_id = ids.1;
    ctx.require_participant()?;
    let v = validate(&state, &body)?;
    let mut tx = state.db.begin().await?;
    let (status,): (String,) = sqlx::query_as("SELECT status FROM sprints WHERE id = $1 FOR SHARE").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    if status != "collecting" {
        return Err(AppError::Conflict("collection has closed; originals are read-only now. Add clarification as a new note during the meeting.".into()));
    }
    // Ownership is enforced in the WHERE clause: a non-owner gets 404, not 403, so ids leak nothing.
    let row: Option<(Uuid, Option<String>, String, Option<String>, Option<String>, Option<String>, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(&format!(
        "UPDATE entries SET category=$3, body=$4, impact=$5, might_help=$6, period=$7, updated_at=now()
         WHERE id=$1 AND sprint_id=$2 AND author_account_id=$8 RETURNING {MY_COLS}"
    ))
    .bind(entry_id)
    .bind(ctx.sprint.id)
    .bind(&v.category)
    .bind(&v.body)
    .bind(&v.impact)
    .bind(&v.might_help)
    .bind(&v.period)
    .bind(ctx.account_id())
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    row.map(|r| Json(my_entry(r, true))).ok_or_else(|| AppError::NotFound("entry not found".into()))
}

#[derive(Serialize, ToSchema)]
pub struct Ok {
    pub ok: bool,
}

/// Delete one of your entries while collection is open.
#[utoipa::path(delete, path = "/api/sprints/{sprint_id}/entries/{entry_id}", tag = "entries",
    params(("sprint_id" = Uuid, Path), ("entry_id" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>) -> AppResult<Json<Ok>> {
    let entry_id = ids.1;
    ctx.require_participant()?;
    let mut tx = state.db.begin().await?;
    let (status,): (String,) = sqlx::query_as("SELECT status FROM sprints WHERE id = $1 FOR SHARE").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    if status != "collecting" {
        return Err(AppError::Conflict("collection has closed; originals are read-only now".into()));
    }
    let res = sqlx::query("DELETE FROM entries WHERE id=$1 AND sprint_id=$2 AND author_account_id=$3")
        .bind(entry_id)
        .bind(ctx.sprint.id)
        .bind(ctx.account_id())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("entry not found".into()));
    }
    Ok(Json(Ok { ok: true }))
}

/// Everyone's entries, revealed as a batch after collection closes. Anonymous; randomised order.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/entries", tag = "entries", params(("sprint_id" = Uuid, Path)),
    responses((status = 200, body = Vec<SharedEntry>), (status = 409, body = crate::error::ErrorBody)))]
pub async fn shared(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<Vec<SharedEntry>>> {
    ctx.require_participant()?;
    if matches!(ctx.sprint.status.as_str(), "draft" | "collecting") {
        // Sealed. This applies to the facilitator too.
        return Err(AppError::Conflict("entries stay sealed until collection closes".into()));
    }
    Ok(Json(shared_entries(&state, ctx.sprint.id).await?))
}

pub async fn shared_entries(state: &AppState, sprint_id: Uuid) -> AppResult<Vec<SharedEntry>> {
    Ok(sqlx::query_as(&format!("{SHARED_SELECT} WHERE e.sprint_id = $1 ORDER BY e.reveal_order, e.id"))
        .bind(sprint_id)
        .fetch_all(&state.db)
        .await?)
}

pub fn publish_hint(state: &AppState, sprint_id: Uuid) {
    state.broadcaster.publish(sprint_id, Hint::entries());
}
