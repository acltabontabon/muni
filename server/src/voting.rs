//! Private prioritisation. Budgets and uniqueness are enforced in one
//! transaction under a per-(round, account) advisory lock, so two devices or
//! two concurrent requests can't spend more than the budget.

use crate::{
    audit,
    auth::extract::SprintCtx,
    error::{AppError, AppResult},
    sse::Hint,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
pub struct VoteRoundView {
    pub id: Uuid,
    pub status: String,
    pub budget: i32,
    pub cancel_reason: Option<String>,
    pub opened_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    /// Your own choices in this round. Private.
    pub my_votes: Vec<Uuid>,
    pub my_remaining: i32,
    /// Totals per theme, only after the round has closed.
    pub totals: Option<HashMap<Uuid, i64>>,
    /// True when you are eligible to vote (a participant; facilitators vote too).
    pub eligible: bool,
}

#[derive(Serialize, ToSchema)]
pub struct VotingState {
    pub current: Option<VoteRoundView>,
    pub previous: Vec<VoteRoundView>,
}

async fn round_view(state: &AppState, ctx: &SprintCtx, row: (Uuid, String, i32, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>)) -> AppResult<VoteRoundView> {
    let (id, status, budget, cancel_reason, opened_at, closed_at) = row;
    let mine: Vec<(Uuid,)> = sqlx::query_as("SELECT theme_id FROM votes WHERE round_id = $1 AND account_id = $2").bind(id).bind(ctx.account_id()).fetch_all(&state.db).await?;
    let my_votes: Vec<Uuid> = mine.into_iter().map(|m| m.0).collect();
    let totals = if status == "closed" {
        let rows: Vec<(Uuid, i64)> = sqlx::query_as("SELECT theme_id, count(*) FROM votes WHERE round_id = $1 GROUP BY theme_id").bind(id).fetch_all(&state.db).await?;
        Some(rows.into_iter().collect())
    } else {
        None
    };
    Ok(VoteRoundView {
        id,
        status,
        budget,
        cancel_reason,
        opened_at,
        closed_at,
        my_remaining: budget - my_votes.len() as i32,
        my_votes,
        totals,
        eligible: ctx.is_participant,
    })
}

const ROUND_COLS: &str = "id, status, budget, cancel_reason, opened_at, closed_at";

/// Voting state for the caller: open round with private remaining budget, closed rounds with totals.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/votes", tag = "voting", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = VotingState)))]
pub async fn get(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<VotingState>> {
    ctx.require_participant()?;
    let rows: Vec<(Uuid, String, i32, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>)> =
        sqlx::query_as(&format!("SELECT {ROUND_COLS} FROM vote_rounds WHERE sprint_id = $1 ORDER BY opened_at DESC")).bind(ctx.sprint.id).fetch_all(&state.db).await?;
    let mut current = None;
    let mut previous = vec![];
    for r in rows {
        let v = round_view(&state, &ctx, r).await?;
        if v.status == "open" && current.is_none() {
            current = Some(v);
        } else {
            previous.push(v);
        }
    }
    Ok(Json(VotingState { current, previous }))
}

pub async fn latest_closed_totals(state: &AppState, sprint_id: Uuid) -> AppResult<Option<HashMap<Uuid, i64>>> {
    let round: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM vote_rounds WHERE sprint_id = $1 AND status = 'closed' ORDER BY closed_at DESC LIMIT 1").bind(sprint_id).fetch_optional(&state.db).await?;
    let Some((id,)) = round else { return Ok(None) };
    let rows: Vec<(Uuid, i64)> = sqlx::query_as("SELECT theme_id, count(*) FROM votes WHERE round_id = $1 GROUP BY theme_id").bind(id).fetch_all(&state.db).await?;
    Ok(Some(rows.into_iter().collect()))
}

#[derive(Deserialize, ToSchema)]
pub struct OpenRoundBody {
    /// Votes per person; defaults to the sprint setting.
    pub budget: Option<i32>,
}

/// Open a voting round over the current theme set. Freezes grouping until closed or cancelled.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/votes/rounds", tag = "voting", params(("sprint_id" = Uuid, Path)), request_body = OpenRoundBody, responses((status = 200, body = VotingState)))]
pub async fn open_round(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<OpenRoundBody>) -> AppResult<Json<VotingState>> {
    ctx.require_facilitator()?;
    if !matches!(ctx.sprint.status.as_str(), "ready" | "live") {
        return Err(AppError::Conflict("voting opens once the themes are ready".into()));
    }
    let budget = body.budget.unwrap_or(ctx.sprint.vote_budget);
    if !(1..=10).contains(&budget) {
        return Err(AppError::BadRequest("votes per person must be between 1 and 10".into()));
    }
    let (themes,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE sprint_id = $1 AND NOT parked").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    if themes == 0 {
        return Err(AppError::Conflict("there are no themes to vote on yet".into()));
    }
    let mut tx = state.db.begin().await?;
    let (rev,): (i64,) = sqlx::query_as("SELECT grouping_revision FROM sprints WHERE id = $1 FOR UPDATE").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    let inserted = sqlx::query("INSERT INTO vote_rounds (sprint_id, budget, grouping_revision) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING")
        .bind(ctx.sprint.id)
        .bind(budget)
        .bind(rev)
        .execute(&mut *tx)
        .await?;
    if inserted.rows_affected() == 0 {
        return Err(AppError::Conflict("a voting round is already open".into()));
    }
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "votes.round_opened", serde_json::json!({"budget": budget})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::votes());
    get(State(state), ctx).await
}

#[derive(Deserialize, ToSchema)]
pub struct CastBody {
    pub theme_id: Uuid,
    /// true to add a vote, false to take it back.
    pub cast: bool,
}

/// Cast or withdraw a vote. At most one per theme; budget enforced transactionally.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/votes", tag = "voting", params(("sprint_id" = Uuid, Path)), request_body = CastBody,
    responses((status = 200, body = VotingState), (status = 409, body = crate::error::ErrorBody)))]
pub async fn cast(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<CastBody>) -> AppResult<Json<VotingState>> {
    if !ctx.is_participant {
        return Err(AppError::Forbidden("only sprint participants can vote".into()));
    }
    let mut tx = state.db.begin().await?;
    let round: Option<(Uuid, i32, i64)> = sqlx::query_as("SELECT id, budget, grouping_revision FROM vote_rounds WHERE sprint_id = $1 AND status = 'open'").bind(ctx.sprint.id).fetch_optional(&mut *tx).await?;
    let Some((round_id, budget, round_rev)) = round else {
        return Err(AppError::Conflict("voting isn’t open right now".into()));
    };
    let (rev,): (i64,) = sqlx::query_as("SELECT grouping_revision FROM sprints WHERE id = $1").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    if rev != round_rev {
        return Err(AppError::Conflict("the themes changed since this round opened — the facilitator needs to reopen voting".into()));
    }
    let (theme_ok,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE id = $1 AND sprint_id = $2 AND NOT parked").bind(body.theme_id).bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    if theme_ok == 0 {
        return Err(AppError::NotFound("theme not found".into()));
    }
    // Serialise this account's votes in this round.
    let key = format!("{round_id}:{}", ctx.account_id());
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))").bind(&key).execute(&mut *tx).await?;
    if body.cast {
        let (used,): (i64,) = sqlx::query_as("SELECT count(*) FROM votes WHERE round_id = $1 AND account_id = $2").bind(round_id).bind(ctx.account_id()).fetch_one(&mut *tx).await?;
        let (dup,): (i64,) = sqlx::query_as("SELECT count(*) FROM votes WHERE round_id = $1 AND account_id = $2 AND theme_id = $3").bind(round_id).bind(ctx.account_id()).bind(body.theme_id).fetch_one(&mut *tx).await?;
        if dup > 0 {
            tx.commit().await?;
            return get(State(state), ctx).await;
        }
        if used >= budget as i64 {
            return Err(AppError::Conflict("you’ve used all your votes — take one back to change your mind".into()));
        }
        sqlx::query("INSERT INTO votes (round_id, theme_id, account_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING").bind(round_id).bind(body.theme_id).bind(ctx.account_id()).execute(&mut *tx).await?;
    } else {
        sqlx::query("DELETE FROM votes WHERE round_id = $1 AND theme_id = $2 AND account_id = $3").bind(round_id).bind(body.theme_id).bind(ctx.account_id()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    // No broadcast: nobody learns that someone voted.
    get(State(state), ctx).await
}

#[derive(Deserialize, ToSchema)]
pub struct CloseBody {
    /// "close" reveals totals; "cancel" discards the round.
    pub action: String,
    pub reason: Option<String>,
}

/// Close (reveal totals) or cancel the open round.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/votes/rounds/close", tag = "voting", params(("sprint_id" = Uuid, Path)), request_body = CloseBody, responses((status = 200, body = VotingState)))]
pub async fn close_round(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<CloseBody>) -> AppResult<Json<VotingState>> {
    ctx.require_facilitator()?;
    let mut tx = state.db.begin().await?;
    let status = match body.action.as_str() {
        "close" => "closed",
        "cancel" => "cancelled",
        _ => return Err(AppError::BadRequest("action must be close or cancel".into())),
    };
    let res = sqlx::query("UPDATE vote_rounds SET status = $2, cancel_reason = $3, closed_at = now() WHERE sprint_id = $1 AND status = 'open'")
        .bind(ctx.sprint.id)
        .bind(status)
        .bind(body.reason.as_deref().map(|r| r.chars().take(200).collect::<String>()))
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Conflict("no voting round is open".into()));
    }
    if status == "closed" {
        // Suggest an order from totals; parked and needs-attention themes keep their flags.
        let rows: Vec<(Uuid, i64)> = sqlx::query_as(
            "SELECT t.id, count(v.theme_id) FROM themes t LEFT JOIN votes v ON v.theme_id = t.id AND v.round_id = (SELECT id FROM vote_rounds WHERE sprint_id = $1 ORDER BY closed_at DESC LIMIT 1)
             WHERE t.sprint_id = $1 GROUP BY t.id ORDER BY t.parked, count(v.theme_id) DESC, t.position",
        )
        .bind(ctx.sprint.id)
        .fetch_all(&mut *tx)
        .await?;
        for (i, (id, _)) in rows.iter().enumerate() {
            sqlx::query("UPDATE themes SET position = $1, order_reason = NULL WHERE id = $2").bind(i as i32).bind(id).execute(&mut *tx).await?;
        }
    }
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "votes.round_closed", serde_json::json!({"status": status})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::votes());
    state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    get(State(state), ctx).await
}

#[allow(dead_code)]
fn _unused(_: Path<Uuid>) {}
