//! Durable background jobs in PostgreSQL: email, reminders, AI preparation,
//! retention. Claimed with FOR UPDATE SKIP LOCKED; bounded retries with
//! exponential backoff; explicit failed state.

use crate::{email::templates, state::AppState};
use anyhow::{Context, Result};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use std::time::Duration as StdDuration;
use uuid::Uuid;

pub async fn enqueue(
    db: impl sqlx::PgExecutor<'_>,
    kind: &str,
    payload: Value,
    run_at: DateTime<Utc>,
    idempotency_key: Option<String>,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "INSERT INTO jobs (kind, payload, run_at, idempotency_key) VALUES ($1,$2,$3,$4)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id",
    )
    .bind(kind)
    .bind(payload)
    .bind(run_at)
    .bind(idempotency_key)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|r| r.0))
}

pub async fn enqueue_email(db: &PgPool, mail: crate::email::OutgoingEmail, key: Option<String>) -> Result<(), sqlx::Error> {
    enqueue(db, "email", json!({"to": mail.to, "subject": mail.subject, "body": mail.body}), Utc::now(), key).await?;
    Ok(())
}

/// Reminder jobs are scheduled per sprint (not per person) and resolve
/// recipients when they run, so opting out later is respected and nobody's
/// contribution status is ever consulted.
pub async fn schedule_reminders(tx: &mut Transaction<'_, Postgres>, sprint_id: Uuid) -> Result<(), sqlx::Error> {
    let (starts_on, ends_on, retro_at, reopened): (chrono::NaiveDate, chrono::NaiveDate, DateTime<Utc>, i32) =
        sqlx::query_as("SELECT starts_on, ends_on, retro_at, reopened_count FROM sprints WHERE id = $1").bind(sprint_id).fetch_one(&mut **tx).await?;
    let days = (ends_on - starts_on).num_days();
    let midpoint_date = starts_on + Duration::days(days / 2);
    let midpoint = midpoint_date.and_hms_opt(10, 0, 0).unwrap().and_utc();
    let day_before = retro_at - Duration::days(1);
    for (kind, at) in [("midpoint", midpoint), ("day_before", day_before)] {
        if at > Utc::now() && at < retro_at {
            enqueue(
                &mut **tx,
                "reminder",
                json!({"sprint_id": sprint_id, "kind": kind}),
                at,
                Some(format!("reminder:{sprint_id}:{kind}:{reopened}")),
            )
            .await?;
        }
    }
    Ok(())
}

pub async fn cancel_reminders(tx: &mut Transaction<'_, Postgres>, sprint_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE jobs SET status='cancelled', idempotency_key = idempotency_key || ':cancelled:' || id::text WHERE kind='reminder' AND status='queued' AND payload->>'sprint_id' = $1")
        .bind(sprint_id.to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct Job {
    id: Uuid,
    kind: String,
    payload: Value,
    attempts: i32,
    max_attempts: i32,
}

/// Runs one claimed job to completion (success, retry, or failure). Returns
/// true if a job was found.
pub async fn run_one(state: &AppState) -> Result<bool> {
    let mut tx = state.db.begin().await?;
    let job: Option<Job> = sqlx::query_as(
        "UPDATE jobs SET status='running', locked_at=now(), attempts=attempts+1
         WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_at <= now() ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id, kind, payload, attempts, max_attempts",
    )
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    let Some(job) = job else { return Ok(false) };

    let result = tokio::time::timeout(StdDuration::from_secs(120), execute(state, &job)).await;
    let outcome = match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(format!("{e:#}")),
        Err(_) => Err("timed out".into()),
    };
    match outcome {
        Ok(()) => {
            sqlx::query("UPDATE jobs SET status='succeeded', finished_at=now(), locked_at=NULL WHERE id=$1").bind(job.id).execute(&state.db).await?;
        }
        Err(msg) => {
            // Never log payloads: they may contain an email address or AI input.
            let summary: String = msg.chars().take(500).collect();
            if job.attempts >= job.max_attempts {
                tracing::warn!(job = %job.id, kind = %job.kind, "job failed permanently");
                sqlx::query("UPDATE jobs SET status='failed', finished_at=now(), locked_at=NULL, last_error=$2 WHERE id=$1")
                    .bind(job.id)
                    .bind(&summary)
                    .execute(&state.db)
                    .await?;
                if job.kind == "ai_grouping" {
                    crate::ai::mark_failed(state, &job.payload, &summary).await.ok();
                }
            } else {
                let backoff = Duration::seconds(15_i64.saturating_mul(1 << job.attempts.min(6)));
                sqlx::query("UPDATE jobs SET status='queued', run_at=$2, locked_at=NULL, last_error=$3 WHERE id=$1")
                    .bind(job.id)
                    .bind(Utc::now() + backoff)
                    .bind(&summary)
                    .execute(&state.db)
                    .await?;
            }
        }
    }
    Ok(true)
}

async fn execute(state: &AppState, job: &Job) -> Result<()> {
    match job.kind.as_str() {
        "email" => {
            let to = job.payload["to"].as_str().context("missing recipient")?;
            let subject = job.payload["subject"].as_str().unwrap_or("Muni");
            let body = job.payload["body"].as_str().unwrap_or("");
            state.mailer.send(crate::email::OutgoingEmail { to: to.into(), subject: subject.into(), body: body.into() }).await
        }
        "reminder" => send_reminders(state, job).await,
        "ai_grouping" => crate::ai::run_grouping_job(state, &job.payload).await,
        "retention" => crate::retention::run(state).await,
        other => anyhow::bail!("unknown job kind {other}"),
    }
}

async fn send_reminders(state: &AppState, job: &Job) -> Result<()> {
    let sprint_id: Uuid = job.payload["sprint_id"].as_str().context("sprint_id")?.parse()?;
    let kind = job.payload["kind"].as_str().unwrap_or("day_before");
    let sprint: Option<(String, String, bool)> = sqlx::query_as("SELECT name, status, reminders_enabled FROM sprints WHERE id = $1").bind(sprint_id).fetch_optional(&state.db).await?;
    let Some((name, status, enabled)) = sprint else { return Ok(()) };
    if status != "collecting" || !enabled {
        return Ok(());
    }
    // Every participant who hasn't opted out. Contribution status is deliberately not consulted.
    let recipients: Vec<(String,)> = sqlx::query_as(
        "SELECT a.email FROM sprint_participants sp JOIN accounts a ON a.id = sp.account_id
         JOIN sprints s ON s.id = sp.sprint_id JOIN memberships m ON m.workspace_id = s.workspace_id AND m.account_id = a.id AND m.revoked_at IS NULL
         WHERE sp.sprint_id = $1 AND NOT sp.reminders_opt_out",
    )
    .bind(sprint_id)
    .fetch_all(&state.db)
    .await?;
    let link = format!("{}/sprints/{}", state.config.public_origin.trim_end_matches('/'), sprint_id);
    for (email,) in recipients {
        let mail = templates::reminder(&email, &name, kind, &link);
        enqueue(&state.db, "email", json!({"to": mail.to, "subject": mail.subject, "body": mail.body}), Utc::now(), Some(format!("reminder-mail:{sprint_id}:{kind}:{}", crate::util::sha256_hex(email.as_bytes())))).await?;
    }
    Ok(())
}

/// The worker loop. One instance; polls with a short sleep when idle.
pub async fn worker(state: AppState, mut shutdown: tokio::sync::watch::Receiver<bool>) {
    // Daily retention sweep, idempotent by date key.
    let mut daily = tokio::time::interval(StdDuration::from_secs(3600));
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            _ = daily.tick() => {
                let key = format!("retention:{}", Utc::now().format("%Y-%m-%d"));
                let _ = enqueue(&state.db, "retention", json!({}), Utc::now(), Some(key)).await;
            }
            _ = tokio::time::sleep(StdDuration::from_millis(500)) => {
                loop {
                    match run_one(&state).await {
                        Ok(true) => continue,
                        Ok(false) => break,
                        Err(e) => { tracing::error!(error = %format!("{e:#}"), "worker error"); break; }
                    }
                }
            }
        }
    }
}
