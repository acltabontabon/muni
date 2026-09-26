//! Experiments (commitments), owner acceptance, review outcomes, recap.
//! Ownership is named; the observation that inspired it is not.

use crate::{
    audit,
    auth::extract::{Member, SprintCtx},
    error::{AppError, AppResult},
    sse::Hint,
    state::AppState,
    util,
};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

pub const STATUSES: [&str; 6] = ["proposed", "accepted", "helped", "did_not_help", "inconclusive", "not_tried"];

#[derive(Serialize, ToSchema, Clone, sqlx::FromRow)]
pub struct Experiment {
    pub id: Uuid,
    pub sprint_id: Uuid,
    pub sprint_name: String,
    pub theme_id: Option<Uuid>,
    pub theme_title: Option<String>,
    pub change_to_try: String,
    pub success_signal: String,
    pub owner_account_id: Option<Uuid>,
    pub owner_name: Option<String>,
    pub owner_accepted: bool,
    pub review_on: NaiveDate,
    pub status: String,
    pub outcome_note: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

const EXP_SELECT: &str = "SELECT e.id, e.sprint_id, s.name AS sprint_name, e.theme_id, e.theme_title, e.change_to_try, e.success_signal, e.owner_account_id,
    a.display_name AS owner_name, (e.owner_accepted_at IS NOT NULL) AS owner_accepted, e.review_on, e.status, e.outcome_note, e.reviewed_at, e.created_at
    FROM experiments e JOIN sprints s ON s.id = e.sprint_id LEFT JOIN accounts a ON a.id = e.owner_account_id";

#[derive(Deserialize, ToSchema)]
pub struct ExperimentBody {
    pub change_to_try: String,
    pub success_signal: String,
    pub owner_account_id: Option<Uuid>,
    pub review_on: Option<NaiveDate>,
    pub theme_id: Option<Uuid>,
    /// Required to create more than three experiments in one sprint.
    pub override_limit: Option<bool>,
}

fn vague(change: &str) -> Option<&'static str> {
    let c = change.to_lowercase();
    let words = c.split_whitespace().count();
    let generic = ["communicate better", "be more careful", "try harder", "improve communication", "work better together", "be better", "do better", "more transparency"];
    if generic.iter().any(|g| c.contains(g)) || words < 4 {
        return Some("That reads as an intention rather than a change. What will someone do differently, and when? For example: “For the next sprint, reserve a 15-minute daily review window; see whether PRs spend less time waiting.”");
    }
    None
}

/// Experiments for this sprint.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/experiments", tag = "commitments", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = Vec<Experiment>)))]
pub async fn list(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<Vec<Experiment>>> {
    ctx.require_participant()?;
    Ok(Json(sqlx::query_as(&format!("{EXP_SELECT} WHERE e.sprint_id = $1 ORDER BY e.created_at")).bind(ctx.sprint.id).fetch_all(&state.db).await?))
}

/// Experiments carried from earlier sprints ("Last time, we said…").
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/experiments/previous", tag = "commitments", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = Vec<Experiment>)))]
pub async fn previous(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<Vec<Experiment>>> {
    ctx.require_participant()?;
    Ok(Json(
        sqlx::query_as(&format!(
            "{EXP_SELECT} WHERE e.workspace_id = $1 AND e.sprint_id <> $2 AND e.status <> 'proposed' AND s.starts_on <= (SELECT starts_on FROM sprints WHERE id = $2)
             ORDER BY s.starts_on DESC, e.created_at DESC LIMIT 12"
        ))
        .bind(ctx.sprint.workspace_id)
        .bind(ctx.sprint.id)
        .fetch_all(&state.db)
        .await?,
    ))
}

/// Propose an experiment. The nominated owner must accept before it counts.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/experiments", tag = "commitments", params(("sprint_id" = Uuid, Path)), request_body = ExperimentBody, responses((status = 200, body = Vec<Experiment>)))]
pub async fn create(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<ExperimentBody>) -> AppResult<Json<Vec<Experiment>>> {
    ctx.require_facilitator()?;
    if !matches!(ctx.sprint.status.as_str(), "live" | "completed" | "ready") {
        return Err(AppError::Conflict("experiments are agreed during or after the retro".into()));
    }
    let change = util::trimmed_nonempty(&body.change_to_try, 500, "The change to try").map_err(AppError::BadRequest)?;
    if let Some(msg) = vague(&change) {
        return Err(AppError::Unprocessable(msg.into()));
    }
    let signal = util::trimmed_nonempty(&body.success_signal, 300, "The success signal").map_err(AppError::BadRequest)?;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM experiments WHERE sprint_id = $1").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    if n >= 3 && body.override_limit != Some(true) {
        return Err(AppError::Conflict("three experiments is plenty for one sprint. Add another only if you’re sure the team can carry it — confirm to continue".into()));
    }
    if n >= 10 {
        return Err(AppError::Conflict("ten experiments is the hard limit".into()));
    }
    let review_on = match body.review_on {
        Some(d) => d,
        None => {
            let (ends,): (NaiveDate,) = sqlx::query_as("SELECT ends_on FROM sprints WHERE id = $1").bind(ctx.sprint.id).fetch_one(&state.db).await?;
            ends + chrono::Duration::days(14)
        }
    };
    if let Some(owner) = body.owner_account_id {
        let (ok,): (i64,) = sqlx::query_as("SELECT count(*) FROM sprint_participants WHERE sprint_id = $1 AND account_id = $2").bind(ctx.sprint.id).bind(owner).fetch_one(&state.db).await?;
        if ok == 0 {
            return Err(AppError::BadRequest("the owner must be a participant in this sprint".into()));
        }
    }
    let theme_title: Option<String> = match body.theme_id {
        Some(tid) => sqlx::query_as::<_, (String,)>("SELECT title FROM themes WHERE id = $1 AND sprint_id = $2").bind(tid).bind(ctx.sprint.id).fetch_optional(&state.db).await?.map(|t| t.0),
        None => None,
    };
    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO experiments (workspace_id, sprint_id, theme_id, theme_title, change_to_try, success_signal, owner_account_id, review_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(ctx.sprint.workspace_id)
    .bind(ctx.sprint.id)
    .bind(body.theme_id.filter(|_| theme_title.is_some()))
    .bind(&theme_title)
    .bind(&change)
    .bind(&signal)
    .bind(body.owner_account_id)
    .bind(review_on)
    .execute(&mut *tx)
    .await?;
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "experiment.proposed", serde_json::json!({})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::commitments());
    list(State(state), ctx).await
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateExperimentBody {
    pub change_to_try: Option<String>,
    pub success_signal: Option<String>,
    pub owner_account_id: Option<Uuid>,
    pub review_on: Option<NaiveDate>,
    pub status: Option<String>,
    pub outcome_note: Option<String>,
}

/// Edit an experiment or record its outcome. Facilitators of the sprint and the owner may edit.
#[utoipa::path(patch, path = "/api/sprints/{sprint_id}/experiments/{experiment_id}", tag = "commitments", params(("sprint_id" = Uuid, Path), ("experiment_id" = Uuid, Path)),
    request_body = UpdateExperimentBody, responses((status = 200, body = Vec<Experiment>)))]
pub async fn update(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<UpdateExperimentBody>) -> AppResult<Json<Vec<Experiment>>> {
    let experiment_id = ids.1;
    ctx.require_participant()?;
    let row: Option<(Option<Uuid>, String)> = sqlx::query_as("SELECT owner_account_id, status FROM experiments WHERE id = $1 AND sprint_id = $2").bind(experiment_id).bind(ctx.sprint.id).fetch_optional(&state.db).await?;
    let Some((owner, _)) = row else { return Err(AppError::NotFound("experiment not found".into())) };
    let is_owner = owner == Some(ctx.account_id());
    if !(ctx.is_facilitator || is_owner) {
        return Err(AppError::Forbidden("only the facilitator or the experiment’s owner can edit it".into()));
    }
    let mut tx = state.db.begin().await?;
    if let Some(c) = &body.change_to_try {
        let c = util::trimmed_nonempty(c, 500, "The change to try").map_err(AppError::BadRequest)?;
        if let Some(msg) = vague(&c) {
            return Err(AppError::Unprocessable(msg.into()));
        }
        sqlx::query("UPDATE experiments SET change_to_try=$1, updated_at=now() WHERE id=$2").bind(c).bind(experiment_id).execute(&mut *tx).await?;
    }
    if let Some(s) = &body.success_signal {
        let s = util::trimmed_nonempty(s, 300, "The success signal").map_err(AppError::BadRequest)?;
        sqlx::query("UPDATE experiments SET success_signal=$1, updated_at=now() WHERE id=$2").bind(s).bind(experiment_id).execute(&mut *tx).await?;
    }
    if let Some(o) = body.owner_account_id {
        if !ctx.is_facilitator {
            return Err(AppError::Forbidden("only the facilitator can nominate an owner".into()));
        }
        // A new nominee must accept again; status returns to proposed.
        sqlx::query("UPDATE experiments SET owner_account_id=$1, owner_accepted_at=NULL, status=CASE WHEN status IN ('proposed','accepted') THEN 'proposed' ELSE status END, updated_at=now() WHERE id=$2")
            .bind(o)
            .bind(experiment_id)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(d) = body.review_on {
        sqlx::query("UPDATE experiments SET review_on=$1, updated_at=now() WHERE id=$2").bind(d).bind(experiment_id).execute(&mut *tx).await?;
    }
    if let Some(st) = &body.status {
        if !STATUSES.contains(&st.as_str()) {
            return Err(AppError::BadRequest("unknown status".into()));
        }
        if st == "accepted" {
            return Err(AppError::BadRequest("acceptance comes from the owner via /accept".into()));
        }
        let reviewed = matches!(st.as_str(), "helped" | "did_not_help" | "inconclusive" | "not_tried");
        sqlx::query("UPDATE experiments SET status=$1, reviewed_at=CASE WHEN $3 THEN now() ELSE reviewed_at END, updated_at=now() WHERE id=$2")
            .bind(st)
            .bind(experiment_id)
            .bind(reviewed)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(n) = &body.outcome_note {
        sqlx::query("UPDATE experiments SET outcome_note=$1, updated_at=now() WHERE id=$2").bind(util::trimmed_optional(Some(n), 500, "Outcome note").map_err(AppError::BadRequest)?).bind(experiment_id).execute(&mut *tx).await?;
    }
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "experiment.updated", serde_json::json!({"experiment_id": experiment_id})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::commitments());
    list(State(state), ctx).await
}

/// The nominated owner accepts (or declines) ownership.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/experiments/{experiment_id}/accept", tag = "commitments", params(("sprint_id" = Uuid, Path), ("experiment_id" = Uuid, Path)),
    request_body = AcceptBody, responses((status = 200, body = Vec<Experiment>)))]
pub async fn accept(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<AcceptBody>) -> AppResult<Json<Vec<Experiment>>> {
    let experiment_id = ids.1;
    ctx.require_participant()?;
    let res = if body.accept {
        sqlx::query("UPDATE experiments SET owner_accepted_at=now(), status='accepted', updated_at=now() WHERE id=$1 AND sprint_id=$2 AND owner_account_id=$3 AND status='proposed'")
    } else {
        sqlx::query("UPDATE experiments SET owner_account_id=NULL, owner_accepted_at=NULL, status='proposed', updated_at=now() WHERE id=$1 AND sprint_id=$2 AND owner_account_id=$3")
    }
    .bind(experiment_id)
    .bind(ctx.sprint.id)
    .bind(ctx.account_id())
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Conflict("this experiment isn’t waiting on you".into()));
    }
    state.broadcaster.publish(ctx.sprint.id, Hint::commitments());
    list(State(state), ctx).await
}

#[derive(Deserialize, ToSchema)]
pub struct AcceptBody {
    pub accept: bool,
}

#[derive(Serialize, ToSchema)]
pub struct Ok {
    pub ok: bool,
}

/// Remove a proposed experiment.
#[utoipa::path(delete, path = "/api/sprints/{sprint_id}/experiments/{experiment_id}", tag = "commitments", params(("sprint_id" = Uuid, Path), ("experiment_id" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>) -> AppResult<Json<Ok>> {
    let experiment_id = ids.1;
    ctx.require_facilitator()?;
    sqlx::query("DELETE FROM experiments WHERE id=$1 AND sprint_id=$2 AND status IN ('proposed','accepted') AND reviewed_at IS NULL").bind(experiment_id).bind(ctx.sprint.id).execute(&state.db).await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::commitments());
    Ok(Json(Ok { ok: true }))
}

/// Workspace-wide experiment history.
#[utoipa::path(get, path = "/api/workspaces/{workspace_id}/experiments", tag = "commitments", params(("workspace_id" = Uuid, Path)), responses((status = 200, body = Vec<Experiment>)))]
pub async fn history(State(state): State<AppState>, m: Member) -> AppResult<Json<Vec<Experiment>>> {
    Ok(Json(sqlx::query_as(&format!("{EXP_SELECT} WHERE e.workspace_id = $1 ORDER BY s.starts_on DESC, e.created_at DESC LIMIT 200")).bind(m.workspace_id).fetch_all(&state.db).await?))
}

// ---------- Recap ----------

#[derive(Serialize, ToSchema)]
pub struct Recap {
    pub body: String,
    pub draft_source: String,
    pub approved_at: Option<DateTime<Utc>>,
    pub published_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub exists: bool,
}

/// The meeting recap. Participants see it once published; the facilitator always.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/recap", tag = "commitments", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = Recap)))]
pub async fn get_recap(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<Recap>> {
    ctx.require_participant()?;
    let row: Option<(String, String, Option<DateTime<Utc>>, Option<DateTime<Utc>>, DateTime<Utc>)> =
        sqlx::query_as("SELECT body, draft_source, approved_at, published_at, updated_at FROM recaps WHERE sprint_id = $1").bind(ctx.sprint.id).fetch_optional(&state.db).await?;
    match row {
        Some((body, draft_source, approved_at, published_at, updated_at)) => {
            if published_at.is_none() && !ctx.is_facilitator {
                return Ok(Json(Recap { body: String::new(), draft_source, approved_at: None, published_at: None, updated_at: None, exists: false }));
            }
            Ok(Json(Recap { body, draft_source, approved_at, published_at, updated_at: Some(updated_at), exists: true }))
        }
        None => Ok(Json(Recap { body: String::new(), draft_source: "manual".into(), approved_at: None, published_at: None, updated_at: None, exists: false })),
    }
}

/// Build a recap draft from the meeting record. Never auto-published.
pub async fn generate_recap(state: &AppState, ctx: &SprintCtx) -> AppResult<String> {
    let (name, goal): (String, Option<String>) = sqlx::query_as("SELECT name, goal FROM sprints WHERE id = $1").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    let mut out = format!("# {name} — retro recap\n\n");
    if let Some(g) = goal {
        out.push_str(&format!("Sprint goal: {g}\n\n"));
    }
    let themes: Vec<(Uuid, String, String, bool, bool, Option<String>, Option<String>, Option<String>, Option<bool>)> = sqlx::query_as(
        "SELECT t.id, t.title, t.summary, t.parked, t.needs_attention, d.what_happened, d.impact, d.could_try, d.discussed FROM themes t LEFT JOIN discussion_notes d ON d.theme_id = t.id WHERE t.sprint_id = $1 ORDER BY t.position",
    )
    .bind(ctx.sprint.id)
    .fetch_all(&state.db)
    .await?;
    let (entries,): (i64,) = sqlx::query_as("SELECT count(*) FROM entries WHERE sprint_id = $1").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    out.push_str(&format!("{entries} observations were captured during the sprint and grouped into {} themes.\n\n", themes.len()));
    out.push_str("## Topics discussed\n\n");
    let mut any = false;
    for t in themes.iter().filter(|t| t.8 == Some(true)) {
        any = true;
        out.push_str(&format!("### {}\n\n{}\n\n", t.1, t.2));
        if let Some(w) = t.5.as_deref().filter(|s| !s.is_empty()) {
            out.push_str(&format!("**What happened:** {w}\n\n"));
        }
        if let Some(i) = t.6.as_deref().filter(|s| !s.is_empty()) {
            out.push_str(&format!("**Impact:** {i}\n\n"));
        }
        if let Some(c) = t.7.as_deref().filter(|s| !s.is_empty()) {
            out.push_str(&format!("**What we could try:** {c}\n\n"));
        }
    }
    if !any {
        out.push_str("_No theme was marked as discussed._\n\n");
    }
    out.push_str("## Decisions and open questions\n\n_Add decisions and open questions here._\n\n");
    out.push_str("## Experiments\n\n");
    let exps: Vec<Experiment> = sqlx::query_as(&format!("{EXP_SELECT} WHERE e.sprint_id = $1 ORDER BY e.created_at")).bind(ctx.sprint.id).fetch_all(&state.db).await?;
    if exps.is_empty() {
        out.push_str("_No experiments were agreed._\n\n");
    }
    for e in &exps {
        let owner = match (&e.owner_name, e.owner_accepted) {
            (Some(n), true) => format!("owner: {n}"),
            (Some(n), false) => format!("proposed owner: {n} (not yet accepted)"),
            (None, _) => "no owner yet".into(),
        };
        out.push_str(&format!("- **{}** — success signal: {}. Review on {}. ({})\n", e.change_to_try, e.success_signal, e.review_on, owner));
    }
    out.push('\n');
    out.push_str("## Parked\n\n");
    let parked: Vec<&_> = themes.iter().filter(|t| t.3 || (t.8 != Some(true) && !t.3)).collect();
    if parked.is_empty() {
        out.push_str("_Nothing was parked._\n");
    }
    for t in parked {
        out.push_str(&format!("- {}{}\n", t.1, if t.4 { " (needs attention despite low votes)" } else { "" }));
    }
    Ok(out)
}

#[derive(Deserialize, ToSchema)]
pub struct RecapBody {
    /// Replace the recap text. Omit to regenerate a draft from the meeting record.
    pub body: Option<String>,
    pub publish: Option<bool>,
}

/// Save, regenerate, or publish the recap. Publishing is explicit.
#[utoipa::path(put, path = "/api/sprints/{sprint_id}/recap", tag = "commitments", params(("sprint_id" = Uuid, Path)), request_body = RecapBody, responses((status = 200, body = Recap)))]
pub async fn put_recap(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<RecapBody>) -> AppResult<Json<Recap>> {
    ctx.require_facilitator()?;
    if !matches!(ctx.sprint.status.as_str(), "live" | "completed" | "archived") {
        return Err(AppError::Conflict("the recap is written during or after the retro".into()));
    }
    let (text, source) = match &body.body {
        Some(b) => (b.trim().chars().take(20_000).collect::<String>(), "manual"),
        None => (generate_recap(&state, &ctx).await?, "generated"),
    };
    sqlx::query(
        "INSERT INTO recaps (sprint_id, body, draft_source) VALUES ($1,$2,$3)
         ON CONFLICT (sprint_id) DO UPDATE SET body=$2, draft_source=$3, updated_at=now()",
    )
    .bind(ctx.sprint.id)
    .bind(&text)
    .bind(source)
    .execute(&state.db)
    .await?;
    if body.publish == Some(true) {
        sqlx::query("UPDATE recaps SET approved_at=now(), published_at=now() WHERE sprint_id=$1").bind(ctx.sprint.id).execute(&state.db).await?;
        audit::record(&state.db, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "recap.published", serde_json::json!({})).await?;
    }
    state.broadcaster.publish(ctx.sprint.id, Hint::commitments());
    get_recap(State(state), ctx).await
}
