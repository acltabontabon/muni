//! An isolated demo workspace with a realistic fictional sprint. Never
//! available in production; fixtures live only here and use `.invalid`
//! addresses so no real mailbox is involved.

use crate::{
    auth::extract::Auth,
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{extract::State, Json};
use chrono::{Duration, Utc};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
pub struct DemoSeeded {
    pub workspace_id: Uuid,
    pub sprint_id: Uuid,
    pub previous_sprint_id: Uuid,
}

const PEOPLE: [(&str, &str); 7] = [
    ("Maya Reyes", "maya@demo.muni.invalid"),
    ("Jonas Weber", "jonas@demo.muni.invalid"),
    ("Priya Nair", "priya@demo.muni.invalid"),
    ("Tomás Ibarra", "tomas@demo.muni.invalid"),
    ("Aiko Tanaka", "aiko@demo.muni.invalid"),
    ("Sam O’Neill", "sam@demo.muni.invalid"),
    ("Lena Novak", "lena@demo.muni.invalid"),
];

// (author index, category, body, impact, might_help, period)
const ENTRIES: [(usize, Option<&str>, &str, Option<&str>, Option<&str>, Option<&str>); 25] = [
    (0, Some("proud"), "We shipped the billing export two days early and nothing broke in production.", Some("First release in months with zero hotfixes."), None, Some("late")),
    (1, Some("keep"), "Pairing on the migration script caught the timezone bug before it reached staging.", None, Some("Keep pairing on anything that touches dates."), Some("middle")),
    (2, Some("improve"), "PRs sat waiting for review for two or three days. I stopped opening small PRs because it wasn’t worth the wait.", Some("Work piled up into one big PR at the end."), Some("A daily 15-minute review window?"), Some("middle")),
    (3, Some("improve"), "Review turnaround was slow again this sprint. Mine averaged about two days.", None, None, Some("late")),
    (4, Some("keep"), "The Thursday demo to support was genuinely useful — they found two edge cases we missed.", Some("Fewer surprise tickets after release."), None, Some("late")),
    (5, Some("stop"), "Please stop scheduling planning at 4pm on Fridays. Half the room is already checked out and decisions get redone on Monday.", Some("We re-planned the same tickets twice."), Some("Move it to Tuesday morning."), Some("early")),
    (6, Some("improve"), "The staging environment was down for most of Wednesday and nobody knew who owned fixing it.", Some("Lost roughly a day across the team."), Some("An on-call rota for staging, even informal."), Some("middle")),
    (0, Some("try"), "Could we try writing the acceptance criteria before the ticket is estimated? Estimates felt like guesses this time.", None, None, Some("early")),
    (1, Some("improve"), "Estimates were way off on the search work. We thought three days; it took eight.", Some("Sprint goal slipped."), None, Some("late")),
    (2, Some("proud"), "Aiko’s onboarding doc meant the new contractor was committing on day two.", None, None, Some("early")),
    (3, Some("keep"), "Standups stayed under ten minutes all sprint. Let’s keep it that way.", None, None, None),
    (4, Some("stop"), "Stop merging without a green pipeline. It happened twice and both times we had to revert.", Some("Broken main for an afternoon each time."), None, Some("middle")),
    (5, Some("improve"), "Reviews: I actually liked that reviews were slower this sprint — the comments were more thoughtful than the usual rubber stamp.", None, None, Some("middle")),
    (6, Some("try"), "Try a ‘review buddy’ pairing for the sprint so every PR has a named first reviewer.", None, Some("Reduces the ‘someone will get to it’ problem."), None),
    (0, Some("improve"), "The staging outage on Wednesday cost me most of the day — I couldn’t test the export end to end.", None, None, Some("middle")),
    (1, None, "Interruptions from the support channel are constant. I counted eleven pings on Tuesday alone.", Some("Hard to get into anything deep."), Some("A rotating ‘support hat’ so one person fields questions each day?"), Some("early")),
    (2, Some("keep"), "Splitting the search epic into vertical slices meant we could demo something every week.", None, None, None),
    (3, Some("try"), "Let’s try a short written summary at the end of each pairing session so the rest of the team knows what changed.", None, None, None),
    (4, Some("improve"), "Planning ran over by 40 minutes and we still didn’t agree on the sprint goal.", None, Some("Time-box it and finish with a written goal."), Some("early")),
    (5, Some("proud"), "Nobody worked the weekend before release. That’s new for us.", None, None, Some("late")),
    (6, Some("improve"), "I don’t think the sprint goal was ever clear to me. I only understood it at the demo.", None, None, None),
    (0, Some("stop"), "Stop assigning tickets during standup — it turns a sync into a negotiation.", None, None, Some("early")),
    (1, Some("keep"), "The retro experiment (daily review window) helped: my two PRs were reviewed the same day.", None, None, Some("late")),
    (2, Some("improve"), "The daily review window didn’t change much for me — reviews still waited until someone had slack.", None, None, Some("late")),
    (3, None, "One thing I want to raise carefully: a comment in a PR review last week read as dismissive, and I noticed a couple of people went quiet afterwards. I don’t think it was intended, but it changed the tone of that thread.", Some("Less back-and-forth on that PR than it needed."), Some("Maybe we agree on how we phrase review comments."), Some("middle")),
];

/// Seed (or reset) the demo workspace for the calling account. Development only.
#[utoipa::path(post, path = "/api/demo/seed", tag = "demo", responses((status = 200, body = DemoSeeded), (status = 404, body = crate::error::ErrorBody)))]
pub async fn seed(State(state): State<AppState>, auth: Auth) -> AppResult<Json<DemoSeeded>> {
    if !state.config.allow_demo_seed {
        return Err(AppError::NotFound("not found".into()));
    }
    let mut tx = state.db.begin().await?;
    // Remove a previous demo workspace owned by this account.
    sqlx::query("DELETE FROM workspaces WHERE is_demo AND id IN (SELECT workspace_id FROM memberships WHERE account_id = $1 AND role = 'owner')")
        .bind(auth.account.id)
        .execute(&mut *tx)
        .await?;
    let (ws,): (Uuid,) = sqlx::query_as("INSERT INTO workspaces (name, is_demo, ai_enabled_default) VALUES ('Demo team (fictional)', true, true) RETURNING id").fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO memberships (workspace_id, account_id, role) VALUES ($1,$2,'owner')").bind(ws).bind(auth.account.id).execute(&mut *tx).await?;
    let mut people = vec![auth.account.id];
    for (name, email) in PEOPLE {
        let (id,): (Uuid,) = sqlx::query_as("INSERT INTO accounts (email, display_name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id")
            .bind(email)
            .bind(name)
            .fetch_one(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO memberships (workspace_id, account_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING").bind(ws).bind(id).execute(&mut *tx).await?;
        people.push(id);
    }
    let today = Utc::now().date_naive();
    // Previous sprint: completed three weeks ago, with two reviewed experiments.
    let (prev,): (Uuid,) = sqlx::query_as(
        "INSERT INTO sprints (workspace_id, name, goal, timezone, starts_on, ends_on, retro_at, status, ai_locked, collection_opened_at, collection_closed_at, revealed_once, completed_at, created_by)
         VALUES ($1,'Sprint 41 — Search foundations','Ship the first vertical slice of search','Asia/Manila',$2,$3,$4,'completed',true,$4 - interval '13 days',$4 - interval '1 hour',true,$4,$5) RETURNING id",
    )
    .bind(ws)
    .bind(today - Duration::days(35))
    .bind(today - Duration::days(22))
    .bind(Utc::now() - Duration::days(21))
    .bind(auth.account.id)
    .fetch_one(&mut *tx)
    .await?;
    for (i, p) in people.iter().enumerate() {
        sqlx::query("INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator) VALUES ($1,$2,$3)").bind(prev).bind(p).bind(i == 0).execute(&mut *tx).await?;
    }
    sqlx::query(
        "INSERT INTO experiments (workspace_id, sprint_id, theme_title, change_to_try, success_signal, owner_account_id, owner_accepted_at, review_on, status, outcome_note, reviewed_at)
         VALUES ($1,$2,'Review turnaround','For the next sprint, reserve a 15-minute daily review window right after standup.','PRs wait less than one working day for a first review.',$3,now(),$4,'helped','Most PRs got a same-day first pass. Bigger PRs still waited.',now()),
                ($1,$2,'Sprint goal clarity','Write the sprint goal as one sentence at the end of planning and pin it in the channel.','Everyone can say the goal from memory at the mid-sprint check.',$5,now(),$4,'did_not_help','We wrote it, but planning overran and nobody looked at it again.',now())",
    )
    .bind(ws)
    .bind(prev)
    .bind(people[1])
    .bind(today - Duration::days(8))
    .bind(people[2])
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO recaps (sprint_id, body, draft_source, approved_at, published_at) VALUES ($1, $2, 'manual', now(), now())")
        .bind(prev)
        .bind("# Sprint 41 — retro recap\n\nWe discussed review turnaround and the sprint goal, and agreed two experiments: a daily review window (owner Jonas) and a one-sentence sprint goal (owner Priya).\n")
        .execute(&mut *tx)
        .await?;
    // Current sprint: collection just closed, ready to prepare.
    let (cur,): (Uuid,) = sqlx::query_as(
        "INSERT INTO sprints (workspace_id, name, external_ref, goal, opening_question, timezone, starts_on, ends_on, retro_at, status, ai_processing, ai_locked, collection_opened_at, collection_closed_at, revealed_once, created_by)
         VALUES ($1,'Sprint 42 — Billing export','PROJ-42','Ship the billing export and stabilise search','What’s one thing from this sprint you’d want a new teammate to know?','Asia/Manila',$2,$3,$4,'preparing',$6,true,$4 - interval '13 days',now(),true,$5) RETURNING id",
    )
    .bind(ws)
    .bind(today - Duration::days(13))
    .bind(today + Duration::days(1))
    .bind(Utc::now() + Duration::hours(3))
    .bind(auth.account.id)
    .bind(state.config.ai.is_available())
    .fetch_one(&mut *tx)
    .await?;
    for (i, p) in people.iter().enumerate() {
        sqlx::query("INSERT INTO sprint_participants (sprint_id, account_id, is_facilitator) VALUES ($1,$2,$3)").bind(cur).bind(p).bind(i == 0).execute(&mut *tx).await?;
    }
    for (author, cat, body, impact, help, period) in ENTRIES {
        sqlx::query("INSERT INTO entries (sprint_id, author_account_id, category, body, impact, might_help, period, reveal_order) VALUES ($1,$2,$3,$4,$5,$6,$7, floor(random()*2147483647)::int)")
            .bind(cur)
            .bind(people[author + 1])
            .bind(cat)
            .bind(body)
            .bind(impact)
            .bind(help)
            .bind(period)
            .execute(&mut *tx)
            .await?;
    }
    crate::audit::record(&mut *tx, ws, Some(cur), Some(auth.account.id), "demo.seeded", serde_json::json!({})).await?;
    tx.commit().await?;
    Ok(Json(DemoSeeded { workspace_id: ws, sprint_id: cur, previous_sprint_id: prev }))
}

#[derive(Serialize, ToSchema)]
pub struct InboxMessage {
    pub to: String,
    pub subject: String,
    pub body: String,
}

/// Development inbox: messages captured by the in-memory mail transport. Never available with SMTP.
#[utoipa::path(get, path = "/api/dev/inbox", tag = "demo", responses((status = 200, body = Vec<InboxMessage>)))]
pub async fn inbox(State(state): State<AppState>) -> AppResult<Json<Vec<InboxMessage>>> {
    if state.mailer.label() != "capture" || state.config.is_production() {
        return Err(AppError::NotFound("not found".into()));
    }
    Ok(Json(state.mailer.captured().into_iter().rev().map(|m| InboxMessage { to: m.to, subject: m.subject, body: m.body }).collect()))
}
