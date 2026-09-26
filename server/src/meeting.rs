//! The live retro: one server-authoritative stage per sprint.
//!
//! Every facilitator command carries the version it observed; the server
//! applies it under a row lock only if the version still matches, persists,
//! commits, then broadcasts a hint. Timers are stored as instants so a
//! refresh derives the same clock. Attendance is explicit.

use crate::{
    audit,
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
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Postgres, Transaction};
use utoipa::ToSchema;
use uuid::Uuid;

pub const PHASES: [&str; 6] = ["arrive", "remember", "discover", "discuss", "decide", "leave"];

pub fn default_plan(total_min: i32) -> Value {
    // Scaled from the 45-minute default: arrive 2 / remember 7 / discover 5 / discuss 24 / decide 5 / leave 2.
    let f = total_min as f64 / 45.0;
    let m = |x: f64| ((x * f).round() as i64).max(1);
    json!({"arrive": m(2.0), "remember": m(7.0), "discover": m(5.0), "discuss": m(24.0), "decide": m(5.0), "leave": m(2.0)})
}

#[derive(Serialize, ToSchema, Clone)]
pub struct TimerView {
    pub running: bool,
    pub ends_at: Option<DateTime<Utc>>,
    pub remaining_secs: i64,
    pub total_secs: i64,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct AttendeeView {
    pub account_id: Uuid,
    pub display_name: String,
    pub present: bool,
    /// Only shown to the facilitator and to the person themself.
    pub ready: Option<bool>,
    pub is_facilitator: bool,
    pub is_you: bool,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct SpeakerView {
    pub account_id: Uuid,
    pub display_name: String,
    pub is_you: bool,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct SpeakingView {
    pub round_id: Uuid,
    pub status: String,
    pub current: Option<SpeakerView>,
    pub remaining: i64,
    pub prompt: String,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct AgendaItem {
    pub theme_id: Uuid,
    pub reason: Option<String>,
}

#[derive(Serialize, ToSchema, Clone, Default)]
pub struct DiscussionNotes {
    pub what_happened: String,
    pub impact: String,
    pub could_try: String,
    pub notes: String,
    pub discussed: bool,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct MyContext {
    pub id: Uuid,
    pub theme_id: Option<Uuid>,
    pub body: String,
    pub released: bool,
}

#[derive(Serialize, ToSchema)]
pub struct StageSnapshot {
    pub session_id: Uuid,
    pub version: i64,
    pub phase: String,
    pub phases: Vec<String>,
    pub plan: Value,
    pub current_theme_id: Option<Uuid>,
    pub agenda: Vec<AgendaItem>,
    pub timer: TimerView,
    pub server_time: DateTime<Utc>,
    pub controller_name: Option<String>,
    pub you_control: bool,
    pub controller_stale: bool,
    /// A short silent-reading pause is running: the stage stays quiet.
    pub quiet_reading: bool,
    pub opening_question: Option<String>,
    pub attendance: Vec<AttendeeView>,
    pub speaking: Option<SpeakingView>,
    pub notes: DiscussionNotes,
    pub discussed_theme_ids: Vec<Uuid>,
    /// Facilitator only: there is context waiting to be released.
    pub has_unreleased_context: Option<bool>,
    pub my_context: Vec<MyContext>,
    pub include_facilitator_in_rotation: bool,
    pub retro_duration_min: i32,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub cancelled: bool,
    pub is_facilitator: bool,
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    id: Uuid,
    version: i64,
    phase: String,
    current_theme_id: Option<Uuid>,
    agenda: Value,
    plan: Value,
    timer_ends_at: Option<DateTime<Utc>>,
    timer_remaining_secs: Option<i32>,
    timer_total_secs: Option<i32>,
    controller_account_id: Option<Uuid>,
    controller_seen_at: Option<DateTime<Utc>>,
    quiet_reading: bool,
    started_at: DateTime<Utc>,
    ended_at: Option<DateTime<Utc>>,
    cancelled: bool,
}

const SESSION_COLS: &str = "id, version, phase, current_theme_id, agenda, plan, timer_ends_at, timer_remaining_secs, timer_total_secs, controller_account_id, controller_seen_at, quiet_reading, started_at, ended_at, cancelled";

pub async fn start_session(tx: &mut Transaction<'_, Postgres>, ctx: &SprintCtx) -> AppResult<()> {
    let (duration,): (i32,) = sqlx::query_as("SELECT retro_duration_min FROM sprints WHERE id = $1").bind(ctx.sprint.id).fetch_one(&mut **tx).await?;
    // A cancelled session is replaced by a fresh one; an ended one too (re-run).
    sqlx::query("DELETE FROM retro_sessions WHERE sprint_id = $1").bind(ctx.sprint.id).execute(&mut **tx).await?;
    // Default agenda: unparked themes by position.
    let themes: Vec<(Uuid, Option<String>)> = sqlx::query_as("SELECT id, order_reason FROM themes WHERE sprint_id = $1 AND NOT parked ORDER BY position, created_at").bind(ctx.sprint.id).fetch_all(&mut **tx).await?;
    let agenda: Vec<Value> = themes.into_iter().map(|(id, reason)| json!({"theme_id": id, "reason": reason})).collect();
    sqlx::query("INSERT INTO retro_sessions (sprint_id, plan, agenda, controller_account_id, controller_seen_at) VALUES ($1,$2,$3,$4,now())")
        .bind(ctx.sprint.id)
        .bind(default_plan(duration))
        .bind(Value::Array(agenda))
        .bind(ctx.account_id())
        .execute(&mut **tx)
        .await?;
    audit::record(&mut **tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(ctx.account_id()), "meeting.started", json!({})).await?;
    Ok(())
}

fn timer_view(s: &SessionRow, now: DateTime<Utc>) -> TimerView {
    let total = s.timer_total_secs.unwrap_or(0) as i64;
    match s.timer_ends_at {
        Some(ends) => TimerView { running: true, ends_at: Some(ends), remaining_secs: (ends - now).num_seconds().max(0), total_secs: total },
        None => TimerView { running: false, ends_at: None, remaining_secs: s.timer_remaining_secs.unwrap_or(0) as i64, total_secs: total },
    }
}

fn prompt_for(cursor: i32) -> &'static str {
    const PROMPTS: [&str; 4] = [
        "Anything you’d add?",
        "How did this show up in your work?",
        "What would help here?",
        "Have we missed another perspective?",
    ];
    PROMPTS[(cursor.max(0) as usize) % PROMPTS.len()]
}

pub async fn snapshot(state: &AppState, ctx: &SprintCtx) -> AppResult<StageSnapshot> {
    let s: Option<SessionRow> = sqlx::query_as(&format!("SELECT {SESSION_COLS} FROM retro_sessions WHERE sprint_id = $1")).bind(ctx.sprint.id).fetch_optional(&state.db).await?;
    let s = s.ok_or_else(|| AppError::NotFound("the retro hasn’t started yet".into()))?;
    let now = Utc::now();
    let me = ctx.account_id();
    let people: Vec<(Uuid, String, bool, Option<bool>, Option<bool>)> = sqlx::query_as(
        "SELECT a.id, a.display_name, sp.is_facilitator, at.present, at.ready FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id
         LEFT JOIN attendance at ON at.session_id = $2 AND at.account_id = sp.account_id WHERE sp.sprint_id = $1 ORDER BY sp.is_facilitator DESC, a.display_name",
    )
    .bind(ctx.sprint.id)
    .bind(s.id)
    .fetch_all(&state.db)
    .await?;
    let attendance = people
        .iter()
        .map(|(id, name, fac, present, ready)| AttendeeView {
            account_id: *id,
            display_name: name.clone(),
            present: present.unwrap_or(false),
            ready: (ctx.is_facilitator || *id == me).then_some(ready.unwrap_or(true)),
            is_facilitator: *fac,
            is_you: *id == me,
        })
        .collect();
    let round: Option<(Uuid, Value, i32, Option<Uuid>, String)> = sqlx::query_as("SELECT id, ordering, cursor, current_account_id, status FROM speaking_rounds WHERE session_id = $1 AND status <> 'ended' ORDER BY created_at DESC LIMIT 1")
        .bind(s.id)
        .fetch_optional(&state.db)
        .await?;
    let speaking = round.map(|(round_id, ordering, cursor, current, status)| {
        let order: Vec<Uuid> = serde_json::from_value(ordering).unwrap_or_default();
        let current = current.and_then(|cid| people.iter().find(|p| p.0 == cid).map(|p| SpeakerView { account_id: cid, display_name: p.1.clone(), is_you: cid == me }));
        SpeakingView { round_id, status, current, remaining: (order.len() as i64 - cursor as i64 - 1).max(0), prompt: prompt_for(cursor).into() }
    });
    let notes = match s.current_theme_id {
        Some(tid) => {
            let n: Option<(String, String, String, String, bool)> = sqlx::query_as("SELECT what_happened, impact, could_try, notes, discussed FROM discussion_notes WHERE theme_id = $1").bind(tid).fetch_optional(&state.db).await?;
            n.map(|(what_happened, impact, could_try, notes, discussed)| DiscussionNotes { what_happened, impact, could_try, notes, discussed }).unwrap_or_default()
        }
        None => DiscussionNotes::default(),
    };
    let discussed: Vec<(Uuid,)> = sqlx::query_as("SELECT theme_id FROM discussion_notes WHERE sprint_id = $1 AND discussed").bind(ctx.sprint.id).fetch_all(&state.db).await?;
    let has_unreleased = if ctx.is_facilitator {
        let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM context_additions WHERE sprint_id = $1 AND released_batch IS NULL").bind(ctx.sprint.id).fetch_one(&state.db).await?;
        Some(n > 0)
    } else {
        None
    };
    let mine: Vec<(Uuid, Option<Uuid>, String, Option<i32>)> = sqlx::query_as("SELECT id, theme_id, body, released_batch FROM context_additions WHERE sprint_id = $1 AND author_account_id = $2 ORDER BY created_at")
        .bind(ctx.sprint.id)
        .bind(me)
        .fetch_all(&state.db)
        .await?;
    let controller_name = match s.controller_account_id {
        Some(cid) => people.iter().find(|p| p.0 == cid).map(|p| p.1.clone()),
        None => None,
    };
    let (duration, opening_question): (i32, Option<String>) = sqlx::query_as("SELECT retro_duration_min, opening_question FROM sprints WHERE id = $1").bind(ctx.sprint.id).fetch_one(&state.db).await?;
    let agenda: Vec<AgendaItem> = s.agenda.as_array().map(|a| a.iter().filter_map(|i| Some(AgendaItem { theme_id: i["theme_id"].as_str()?.parse().ok()?, reason: i["reason"].as_str().map(String::from) })).collect()).unwrap_or_default();
    Ok(StageSnapshot {
        session_id: s.id,
        version: s.version,
        phase: s.phase.clone(),
        phases: PHASES.iter().map(|p| p.to_string()).collect(),
        plan: s.plan.clone(),
        current_theme_id: s.current_theme_id,
        agenda,
        timer: timer_view(&s, now),
        server_time: now,
        controller_name,
        you_control: s.controller_account_id == Some(me),
        controller_stale: s.controller_seen_at.map(|t| now - t > Duration::seconds(90)).unwrap_or(true),
        quiet_reading: s.quiet_reading && s.timer_ends_at.map(|e| e > now).unwrap_or(false),
        opening_question,
        attendance,
        speaking,
        notes,
        discussed_theme_ids: discussed.into_iter().map(|d| d.0).collect(),
        has_unreleased_context: has_unreleased,
        my_context: mine.into_iter().map(|(id, theme_id, body, rb)| MyContext { id, theme_id, body, released: rb.is_some() }).collect(),
        include_facilitator_in_rotation: ctx.sprint.include_facilitator_in_rotation,
        retro_duration_min: duration,
        started_at: s.started_at,
        ended_at: s.ended_at,
        cancelled: s.cancelled,
        is_facilitator: ctx.is_facilitator,
    })
}

/// The stage as the caller may see it. Same shape for participants, facilitator and presenter.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/meeting", tag = "meeting", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = StageSnapshot)))]
pub async fn get(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<StageSnapshot>> {
    ctx.require_participant()?;
    snapshot(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    SetPhase { phase: String },
    SetTopic { theme_id: Option<Uuid> },
    SetAgenda { items: Vec<AgendaInput> },
    SetPlan { plan: Value },
    TimerStart { secs: i64 },
    TimerPause,
    TimerResume,
    TimerAdjust { delta_secs: i64 },
    TimerClear,
    TakeControl,
    SpeakingStart,
    SpeakingNext,
    SpeakingOpenFloor,
    SpeakingEnd,
    ReleaseContext,
    /// A short silent-reading pause before a difficult theme. Ends with the timer; skippable via TimerClear.
    QuietReading { secs: i64 },
    MarkDiscussed { theme_id: Uuid, discussed: bool },
}

#[derive(Deserialize, ToSchema, Clone)]
pub struct AgendaInput {
    pub theme_id: Uuid,
    pub reason: Option<String>,
}

#[derive(Deserialize, ToSchema)]
pub struct CommandBody {
    /// The stage version the client last saw. Mismatch → 409, refetch.
    pub expected_version: i64,
    pub command: Command,
}

/// Facilitator commands. Applied only if `expected_version` matches the stage.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/meeting/command", tag = "meeting", params(("sprint_id" = Uuid, Path)), request_body = CommandBody,
    responses((status = 200, body = StageSnapshot), (status = 409, body = crate::error::ErrorBody)))]
pub async fn command(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<CommandBody>) -> AppResult<Json<StageSnapshot>> {
    ctx.require_facilitator()?;
    if ctx.sprint.status != "live" {
        return Err(AppError::Conflict("the retro isn’t live".into()));
    }
    let mut tx = state.db.begin().await?;
    let s: SessionRow = sqlx::query_as(&format!("SELECT {SESSION_COLS} FROM retro_sessions WHERE sprint_id = $1 FOR UPDATE")).bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
    if s.version != body.expected_version {
        return Err(AppError::Conflict("the stage changed since you last saw it — it’s been refreshed, try again".into()));
    }
    let now = Utc::now();
    let me = ctx.account_id();
    // One controller. A stale controller (no heartbeat for 90s) can be replaced implicitly; a live one needs TakeControl.
    let stale = s.controller_seen_at.map(|t| now - t > Duration::seconds(90)).unwrap_or(true);
    let is_take = matches!(body.command, Command::TakeControl);
    if s.controller_account_id != Some(me) && !stale && !is_take {
        return Err(AppError::Conflict("another facilitator is controlling the stage — take control explicitly to continue".into()));
    }
    let mut action = "meeting.command";
    match body.command {
        Command::TakeControl => {
            sqlx::query("UPDATE retro_sessions SET controller_account_id=$2, controller_seen_at=now() WHERE id=$1").bind(s.id).bind(me).execute(&mut *tx).await?;
            action = "meeting.control_taken";
        }
        Command::SetPhase { phase } => {
            if !PHASES.contains(&phase.as_str()) {
                return Err(AppError::BadRequest("unknown phase".into()));
            }
            let mins = s.plan[&phase].as_i64().unwrap_or(5);
            // Entering a phase arms (but does not start) its planned time.
            sqlx::query("UPDATE retro_sessions SET phase=$2, timer_ends_at=NULL, timer_remaining_secs=$3, timer_total_secs=$3, quiet_reading=false WHERE id=$1")
                .bind(s.id)
                .bind(&phase)
                .bind((mins * 60) as i32)
                .execute(&mut *tx)
                .await?;
            action = "meeting.phase_changed";
        }
        Command::SetTopic { theme_id } => {
            if let Some(tid) = theme_id {
                let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE id=$1 AND sprint_id=$2").bind(tid).bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
                if n == 0 {
                    return Err(AppError::NotFound("theme not found".into()));
                }
                sqlx::query("INSERT INTO discussion_notes (sprint_id, theme_id) VALUES ($1,$2) ON CONFLICT (theme_id) DO NOTHING").bind(ctx.sprint.id).bind(tid).execute(&mut *tx).await?;
            }
            let per_topic = per_topic_secs(&s);
            sqlx::query("UPDATE retro_sessions SET current_theme_id=$2, timer_ends_at=NULL, timer_remaining_secs=$3, timer_total_secs=$3, quiet_reading=false WHERE id=$1")
                .bind(s.id)
                .bind(theme_id)
                .bind(per_topic)
                .execute(&mut *tx)
                .await?;
            action = "meeting.topic_changed";
        }
        Command::SetAgenda { items } => {
            let mut agenda = vec![];
            for i in items.iter().take(40) {
                let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE id=$1 AND sprint_id=$2").bind(i.theme_id).bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
                if n == 1 {
                    agenda.push(json!({"theme_id": i.theme_id, "reason": i.reason.as_deref().map(|r| r.chars().take(200).collect::<String>())}));
                }
            }
            sqlx::query("UPDATE retro_sessions SET agenda=$2 WHERE id=$1").bind(s.id).bind(Value::Array(agenda)).execute(&mut *tx).await?;
            action = "meeting.agenda_changed";
        }
        Command::SetPlan { plan } => {
            let mut clean = serde_json::Map::new();
            for p in PHASES {
                let v = plan[p].as_i64().unwrap_or_else(|| s.plan[p].as_i64().unwrap_or(5)).clamp(1, 180);
                clean.insert(p.into(), json!(v));
            }
            sqlx::query("UPDATE retro_sessions SET plan=$2 WHERE id=$1").bind(s.id).bind(Value::Object(clean)).execute(&mut *tx).await?;
        }
        Command::TimerStart { secs } => {
            let secs = secs.clamp(10, 7200);
            sqlx::query("UPDATE retro_sessions SET timer_ends_at=$2, timer_remaining_secs=NULL, timer_total_secs=$3, quiet_reading=false WHERE id=$1")
                .bind(s.id)
                .bind(now + Duration::seconds(secs))
                .bind(secs as i32)
                .execute(&mut *tx)
                .await?;
        }
        Command::TimerPause => {
            if let Some(ends) = s.timer_ends_at {
                let remaining = (ends - now).num_seconds().max(0) as i32;
                sqlx::query("UPDATE retro_sessions SET timer_ends_at=NULL, timer_remaining_secs=$2 WHERE id=$1").bind(s.id).bind(remaining).execute(&mut *tx).await?;
            }
        }
        Command::TimerResume => {
            if s.timer_ends_at.is_none() {
                let remaining = s.timer_remaining_secs.unwrap_or(0).max(0) as i64;
                if remaining > 0 {
                    sqlx::query("UPDATE retro_sessions SET timer_ends_at=$2, timer_remaining_secs=NULL WHERE id=$1").bind(s.id).bind(now + Duration::seconds(remaining)).execute(&mut *tx).await?;
                }
            }
        }
        Command::TimerAdjust { delta_secs } => {
            let delta = delta_secs.clamp(-3600, 3600);
            match s.timer_ends_at {
                Some(ends) => {
                    let new_end = (ends + Duration::seconds(delta)).max(now);
                    sqlx::query("UPDATE retro_sessions SET timer_ends_at=$2, timer_total_secs=GREATEST(COALESCE(timer_total_secs,0)+$3,0) WHERE id=$1").bind(s.id).bind(new_end).bind(delta as i32).execute(&mut *tx).await?;
                }
                None => {
                    let r = (s.timer_remaining_secs.unwrap_or(0) as i64 + delta).max(0) as i32;
                    sqlx::query("UPDATE retro_sessions SET timer_remaining_secs=$2, timer_total_secs=GREATEST(COALESCE(timer_total_secs,0)+$3,0) WHERE id=$1").bind(s.id).bind(r).bind(delta as i32).execute(&mut *tx).await?;
                }
            }
        }
        Command::TimerClear => {
            sqlx::query("UPDATE retro_sessions SET timer_ends_at=NULL, timer_remaining_secs=NULL, timer_total_secs=NULL, quiet_reading=false WHERE id=$1").bind(s.id).execute(&mut *tx).await?;
        }
        Command::QuietReading { secs } => {
            let secs = secs.clamp(15, 600);
            sqlx::query("UPDATE retro_sessions SET quiet_reading=true, timer_ends_at=$2, timer_remaining_secs=NULL, timer_total_secs=$3 WHERE id=$1")
                .bind(s.id)
                .bind(now + Duration::seconds(secs))
                .bind(secs as i32)
                .execute(&mut *tx)
                .await?;
            action = "meeting.quiet_reading";
        }
        Command::SpeakingStart => {
            sqlx::query("UPDATE speaking_rounds SET status='ended' WHERE session_id=$1 AND status<>'ended'").bind(s.id).execute(&mut *tx).await?;
            let mut eligible = eligible_speakers(&mut tx, &ctx, s.id).await?;
            util::shuffle(&mut eligible);
            let first = eligible.first().copied();
            let status = if first.is_some() { "active" } else { "exhausted" };
            sqlx::query("INSERT INTO speaking_rounds (session_id, ordering, cursor, current_account_id, status) VALUES ($1,$2,0,$3,$4)")
                .bind(s.id)
                .bind(serde_json::to_value(&eligible).unwrap())
                .bind(first)
                .bind(status)
                .execute(&mut *tx)
                .await?;
            action = "meeting.speaking_started";
        }
        Command::SpeakingNext => {
            advance_speaker(&mut tx, &ctx, s.id).await?;
        }
        Command::SpeakingOpenFloor => {
            sqlx::query("UPDATE speaking_rounds SET current_account_id=NULL WHERE session_id=$1 AND status='active'").bind(s.id).execute(&mut *tx).await?;
        }
        Command::SpeakingEnd => {
            sqlx::query("UPDATE speaking_rounds SET status='ended' WHERE session_id=$1 AND status<>'ended'").bind(s.id).execute(&mut *tx).await?;
        }
        Command::ReleaseContext => {
            let (batch,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(released_batch),0)+1 FROM context_additions WHERE sprint_id=$1").bind(ctx.sprint.id).fetch_one(&mut *tx).await?;
            sqlx::query("UPDATE context_additions SET released_batch=$2, reveal_order=floor(random()*2147483647)::int WHERE sprint_id=$1 AND released_batch IS NULL")
                .bind(ctx.sprint.id)
                .bind(batch)
                .execute(&mut *tx)
                .await?;
            action = "meeting.context_released";
        }
        Command::MarkDiscussed { theme_id, discussed } => {
            sqlx::query("INSERT INTO discussion_notes (sprint_id, theme_id, discussed) VALUES ($1,$2,$3) ON CONFLICT (theme_id) DO UPDATE SET discussed=$3, updated_at=now()")
                .bind(ctx.sprint.id)
                .bind(theme_id)
                .bind(discussed)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query("UPDATE retro_sessions SET version=version+1, updated_at=now(), controller_account_id=$2, controller_seen_at=now() WHERE id=$1").bind(s.id).bind(me).execute(&mut *tx).await?;
    audit::record(&mut *tx, ctx.sprint.workspace_id, Some(ctx.sprint.id), Some(me), action, json!({})).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::meeting());
    if action == "meeting.context_released" {
        state.broadcaster.publish(ctx.sprint.id, Hint::themes());
    }
    snapshot(&state, &ctx).await.map(Json)
}

fn per_topic_secs(s: &SessionRow) -> i32 {
    let discuss_min = s.plan["discuss"].as_i64().unwrap_or(24);
    let topics = s.agenda.as_array().map(|a| a.len()).unwrap_or(0).clamp(1, 3) as i64;
    ((discuss_min * 60) / topics) as i32
}

async fn eligible_speakers(tx: &mut Transaction<'_, Postgres>, ctx: &SprintCtx, session_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT sp.account_id FROM sprint_participants sp JOIN attendance at ON at.session_id = $1 AND at.account_id = sp.account_id
         WHERE sp.sprint_id = $2 AND at.present AND at.ready AND (NOT sp.is_facilitator OR $3)",
    )
    .bind(session_id)
    .bind(ctx.sprint.id)
    .bind(ctx.sprint.include_facilitator_in_rotation)
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Moves to the next eligible person. People who left or passed are skipped;
/// late arrivals are appended at the end so nobody else's place changes.
async fn advance_speaker(tx: &mut Transaction<'_, Postgres>, ctx: &SprintCtx, session_id: Uuid) -> AppResult<()> {
    let round: Option<(Uuid, Value, i32)> = sqlx::query_as("SELECT id, ordering, cursor FROM speaking_rounds WHERE session_id=$1 AND status='active' FOR UPDATE").bind(session_id).fetch_optional(&mut **tx).await?;
    let Some((round_id, ordering, cursor)) = round else {
        return Err(AppError::Conflict("no speaking round is active".into()));
    };
    let mut order: Vec<Uuid> = serde_json::from_value(ordering).unwrap_or_default();
    let eligible = eligible_speakers(tx, ctx, session_id).await?;
    let mut late: Vec<Uuid> = eligible.iter().copied().filter(|id| !order.contains(id)).collect();
    util::shuffle(&mut late);
    order.extend(late);
    let mut next = cursor + 1;
    while (next as usize) < order.len() && !eligible.contains(&order[next as usize]) {
        next += 1;
    }
    if (next as usize) < order.len() {
        sqlx::query("UPDATE speaking_rounds SET ordering=$2, cursor=$3, current_account_id=$4 WHERE id=$1")
            .bind(round_id)
            .bind(serde_json::to_value(&order).unwrap())
            .bind(next)
            .bind(order[next as usize])
            .execute(&mut **tx)
            .await?;
    } else {
        sqlx::query("UPDATE speaking_rounds SET ordering=$2, cursor=$3, current_account_id=NULL, status='exhausted' WHERE id=$1")
            .bind(round_id)
            .bind(serde_json::to_value(&order).unwrap())
            .bind(order.len() as i32)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

#[derive(Deserialize, ToSchema)]
pub struct AttendanceBody {
    pub present: Option<bool>,
    /// true = "Ready to speak", false = "Pass for now".
    pub ready: Option<bool>,
}

/// Your own attendance and readiness.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/meeting/attendance", tag = "meeting", params(("sprint_id" = Uuid, Path)), request_body = AttendanceBody, responses((status = 200, body = StageSnapshot)))]
pub async fn attendance(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<AttendanceBody>) -> AppResult<Json<StageSnapshot>> {
    ctx.require_participant()?;
    set_attendance(&state, &ctx, ctx.account_id(), body).await?;
    snapshot(&state, &ctx).await.map(Json)
}

/// Facilitator: mark someone present or absent.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/meeting/attendance/{account_id}", tag = "meeting", params(("sprint_id" = Uuid, Path), ("account_id" = Uuid, Path)),
    request_body = AttendanceBody, responses((status = 200, body = StageSnapshot)))]
pub async fn attendance_for(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<AttendanceBody>) -> AppResult<Json<StageSnapshot>> {
    let account_id = ids.1;
    ctx.require_facilitator()?;
    // The facilitator sets presence, never someone's readiness.
    set_attendance(&state, &ctx, account_id, AttendanceBody { present: body.present, ready: None }).await?;
    snapshot(&state, &ctx).await.map(Json)
}

async fn set_attendance(state: &AppState, ctx: &SprintCtx, account_id: Uuid, body: AttendanceBody) -> AppResult<()> {
    let mut tx = state.db.begin().await?;
    let (session_id,): (Uuid,) = sqlx::query_as("SELECT id FROM retro_sessions WHERE sprint_id = $1").bind(ctx.sprint.id).fetch_one(&mut *tx).await.map_err(|_| AppError::NotFound("the retro hasn’t started yet".into()))?;
    let (is_part,): (i64,) = sqlx::query_as("SELECT count(*) FROM sprint_participants WHERE sprint_id=$1 AND account_id=$2").bind(ctx.sprint.id).bind(account_id).fetch_one(&mut *tx).await?;
    if is_part == 0 {
        return Err(AppError::NotFound("participant not found".into()));
    }
    sqlx::query(
        "INSERT INTO attendance (session_id, account_id, present, ready) VALUES ($1,$2,COALESCE($3,false),COALESCE($4,true))
         ON CONFLICT (session_id, account_id) DO UPDATE SET present=COALESCE($3, attendance.present), ready=COALESCE($4, attendance.ready), updated_at=now()",
    )
    .bind(session_id)
    .bind(account_id)
    .bind(body.present)
    .bind(body.ready)
    .execute(&mut *tx)
    .await?;
    // If the current speaker just passed or left, respect it immediately.
    if body.ready == Some(false) || body.present == Some(false) {
        let cur: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM speaking_rounds WHERE session_id=$1 AND status='active' AND current_account_id=$2").bind(session_id).bind(account_id).fetch_optional(&mut *tx).await?;
        if cur.is_some() {
            advance_speaker(&mut tx, ctx, session_id).await?;
        }
    }
    sqlx::query("UPDATE retro_sessions SET version=version+1, updated_at=now() WHERE id=$1").bind(session_id).execute(&mut *tx).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::meeting());
    Ok(())
}

/// Pass your turn (only meaningful when the card shows you).
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/meeting/pass", tag = "meeting", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = StageSnapshot)))]
pub async fn pass(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<StageSnapshot>> {
    ctx.require_participant()?;
    let mut tx = state.db.begin().await?;
    let (session_id,): (Uuid,) = sqlx::query_as("SELECT id FROM retro_sessions WHERE sprint_id = $1 FOR UPDATE").bind(ctx.sprint.id).fetch_one(&mut *tx).await.map_err(|_| AppError::NotFound("the retro hasn’t started yet".into()))?;
    let cur: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM speaking_rounds WHERE session_id=$1 AND status='active' AND current_account_id=$2").bind(session_id).bind(ctx.account_id()).fetch_optional(&mut *tx).await?;
    // Passing is "not now": step out of the rotation until you choose Ready again.
    sqlx::query("INSERT INTO attendance (session_id, account_id, present, ready) VALUES ($1,$2,true,false) ON CONFLICT (session_id, account_id) DO UPDATE SET ready=false, updated_at=now()")
        .bind(session_id)
        .bind(ctx.account_id())
        .execute(&mut *tx)
        .await?;
    if cur.is_some() {
        advance_speaker(&mut tx, &ctx, session_id).await?;
    }
    sqlx::query("UPDATE retro_sessions SET version=version+1, updated_at=now() WHERE id=$1").bind(session_id).execute(&mut *tx).await?;
    tx.commit().await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::meeting());
    snapshot(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct ContextBody {
    pub theme_id: Uuid,
    pub body: String,
    pub idempotency_key: Option<String>,
}

/// Add anonymous context to a theme during the meeting. Released in batches by the facilitator.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/meeting/context", tag = "meeting", params(("sprint_id" = Uuid, Path)), request_body = ContextBody, responses((status = 200, body = StageSnapshot)))]
pub async fn add_context(State(state): State<AppState>, ctx: SprintCtx, Json(body): Json<ContextBody>) -> AppResult<Json<StageSnapshot>> {
    ctx.require_participant()?;
    if ctx.sprint.status != "live" {
        return Err(AppError::Conflict("context can be added while the retro is live".into()));
    }
    let text = util::trimmed_nonempty(&body.body, state.config.entry_max_chars, "The note").map_err(AppError::BadRequest)?;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE id=$1 AND sprint_id=$2").bind(body.theme_id).bind(ctx.sprint.id).fetch_one(&state.db).await?;
    if n == 0 {
        return Err(AppError::NotFound("theme not found".into()));
    }
    let key = body.idempotency_key.as_deref().map(str::trim).filter(|k| !k.is_empty() && k.len() <= 64).map(String::from);
    sqlx::query("INSERT INTO context_additions (sprint_id, theme_id, author_account_id, body, idempotency_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sprint_id, author_account_id, idempotency_key) DO NOTHING")
        .bind(ctx.sprint.id)
        .bind(body.theme_id)
        .bind(ctx.account_id())
        .bind(&text)
        .bind(&key)
        .execute(&state.db)
        .await?;
    // A bare "meeting changed" hint: only the facilitator's snapshot carries the
    // "something is waiting" flag; nobody else's snapshot changes.
    state.broadcaster.publish(ctx.sprint.id, Hint::meeting());
    snapshot(&state, &ctx).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct NotesBody {
    pub what_happened: Option<String>,
    pub impact: Option<String>,
    pub could_try: Option<String>,
    pub notes: Option<String>,
}

/// Facilitator's discussion notes for a theme.
#[utoipa::path(put, path = "/api/sprints/{sprint_id}/meeting/notes/{theme_id}", tag = "meeting", params(("sprint_id" = Uuid, Path), ("theme_id" = Uuid, Path)), request_body = NotesBody, responses((status = 200, body = StageSnapshot)))]
pub async fn notes(State(state): State<AppState>, ctx: SprintCtx, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<NotesBody>) -> AppResult<Json<StageSnapshot>> {
    let theme_id = ids.1;
    ctx.require_facilitator()?;
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM themes WHERE id=$1 AND sprint_id=$2").bind(theme_id).bind(ctx.sprint.id).fetch_one(&state.db).await?;
    if n == 0 {
        return Err(AppError::NotFound("theme not found".into()));
    }
    let c = |s: &Option<String>| s.as_deref().map(|v| v.trim().chars().take(4000).collect::<String>());
    sqlx::query(
        "INSERT INTO discussion_notes (sprint_id, theme_id, what_happened, impact, could_try, notes) VALUES ($1,$2,COALESCE($3,''),COALESCE($4,''),COALESCE($5,''),COALESCE($6,''))
         ON CONFLICT (theme_id) DO UPDATE SET what_happened=COALESCE($3, discussion_notes.what_happened), impact=COALESCE($4, discussion_notes.impact),
         could_try=COALESCE($5, discussion_notes.could_try), notes=COALESCE($6, discussion_notes.notes), updated_at=now()",
    )
    .bind(ctx.sprint.id)
    .bind(theme_id)
    .bind(c(&body.what_happened))
    .bind(c(&body.impact))
    .bind(c(&body.could_try))
    .bind(c(&body.notes))
    .execute(&state.db)
    .await?;
    sqlx::query("UPDATE retro_sessions SET version=version+1, updated_at=now() WHERE sprint_id=$1").bind(ctx.sprint.id).execute(&state.db).await?;
    state.broadcaster.publish(ctx.sprint.id, Hint::meeting());
    snapshot(&state, &ctx).await.map(Json)
}

/// Controller heartbeat. Keeps the "who controls the stage" indicator honest.
#[utoipa::path(post, path = "/api/sprints/{sprint_id}/meeting/heartbeat", tag = "meeting", params(("sprint_id" = Uuid, Path)), responses((status = 200, body = StageSnapshot)))]
pub async fn heartbeat(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Json<StageSnapshot>> {
    ctx.require_facilitator()?;
    sqlx::query("UPDATE retro_sessions SET controller_seen_at=now() WHERE sprint_id=$1 AND controller_account_id=$2").bind(ctx.sprint.id).bind(ctx.account_id()).execute(&state.db).await?;
    snapshot(&state, &ctx).await.map(Json)
}
