//! Markdown and CSV exports. Summary by default; raw notes are an explicit
//! choice. No authorship, no timestamps, no votes per person, no ids that
//! would let a reader correlate with anything else.

use crate::{
    auth::extract::SprintCtx,
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue},
};
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;

#[derive(Deserialize, IntoParams)]
pub struct ExportQuery {
    /// "summary" (default) or "raw".
    pub scope: Option<String>,
}

fn check(ctx: &SprintCtx, raw: bool) -> AppResult<()> {
    ctx.require_participant()?;
    if matches!(ctx.sprint.status.as_str(), "draft" | "collecting") {
        return Err(AppError::Conflict("exports are available once collection has closed".into()));
    }
    if raw && !ctx.is_facilitator {
        return Err(AppError::Forbidden("raw-note export is a facilitator action".into()));
    }
    Ok(())
}

/// Neutralises spreadsheet formula injection.
pub fn csv_safe(s: &str) -> String {
    let t = s.replace(['\r', '\n'], " ");
    match t.chars().next() {
        Some('=') | Some('+') | Some('-') | Some('@') | Some('\t') | Some('\x0d') => format!("'{t}"),
        _ => t,
    }
}

/// Markdown export.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/export.md", tag = "exports", params(("sprint_id" = Uuid, Path), ExportQuery), responses((status = 200, description = "text/markdown")))]
pub async fn markdown(State(state): State<AppState>, ctx: SprintCtx, Query(q): Query<ExportQuery>) -> AppResult<(HeaderMap, String)> {
    let raw = q.scope.as_deref() == Some("raw");
    check(&ctx, raw)?;
    let mut out = crate::commitments::generate_recap(&state, &ctx).await?;
    // Prefer the published recap's wording when there is one.
    let published: Option<(String,)> = sqlx::query_as("SELECT body FROM recaps WHERE sprint_id = $1 AND published_at IS NOT NULL").bind(ctx.sprint.id).fetch_optional(&state.db).await?;
    if let Some((body,)) = published {
        out = body;
        out.push_str("\n\n");
    }
    out.push_str("## Themes\n\n");
    let g = crate::themes::grouping(&state, &ctx).await?;
    for t in &g.themes {
        out.push_str(&format!("### {}{}\n\n", t.title, if t.parked { " (parked)" } else { "" }));
        if !t.summary.is_empty() {
            out.push_str(&format!("{}\n\n", t.summary));
        }
        out.push_str(&format!("{} entries", t.entry_count));
        if let Some(v) = t.votes {
            out.push_str(&format!(" · {v} votes"));
        }
        out.push_str("\n\n");
        if raw {
            for e in &t.entries {
                out.push_str(&format!("- [{}] {}\n", e.category.as_deref().unwrap_or("unsorted"), e.body));
                if let Some(i) = &e.impact {
                    out.push_str(&format!("  - Impact: {i}\n"));
                }
                if let Some(h) = &e.might_help {
                    out.push_str(&format!("  - Might help: {h}\n"));
                }
            }
            for c in &t.context {
                out.push_str(&format!("- (added during the retro) {}\n", c.body));
            }
            out.push('\n');
        }
    }
    if raw && !g.ungrouped.is_empty() {
        out.push_str("### Ungrouped\n\n");
        for e in &g.ungrouped {
            out.push_str(&format!("- [{}] {}\n", e.category.as_deref().unwrap_or("unsorted"), e.body));
        }
        out.push('\n');
    }
    out.push_str("---\n_Exported from Muni. Entries are anonymous; this file contains no authorship or timing information._\n");
    let mut h = HeaderMap::new();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/markdown; charset=utf-8"));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("attachment; filename=\"{}-retro.md\"", slug(&ctx.sprint.name))).unwrap());
    Ok((h, out))
}

/// CSV export. Summary: one row per theme. Raw: one row per entry.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/export.csv", tag = "exports", params(("sprint_id" = Uuid, Path), ExportQuery), responses((status = 200, description = "text/csv")))]
pub async fn csv(State(state): State<AppState>, ctx: SprintCtx, Query(q): Query<ExportQuery>) -> AppResult<(HeaderMap, String)> {
    let raw = q.scope.as_deref() == Some("raw");
    check(&ctx, raw)?;
    let g = crate::themes::grouping(&state, &ctx).await?;
    let mut w = csv::Writer::from_writer(vec![]);
    if raw {
        w.write_record(["theme", "category", "observation", "impact", "might_help", "period"]).ok();
        for t in &g.themes {
            for e in &t.entries {
                w.write_record([csv_safe(&t.title), e.category.clone().unwrap_or_else(|| "unsorted".into()), csv_safe(&e.body), csv_safe(e.impact.as_deref().unwrap_or("")), csv_safe(e.might_help.as_deref().unwrap_or("")), e.period.clone().unwrap_or_default()]).ok();
            }
        }
        for e in &g.ungrouped {
            w.write_record(["".into(), e.category.clone().unwrap_or_else(|| "unsorted".into()), csv_safe(&e.body), csv_safe(e.impact.as_deref().unwrap_or("")), csv_safe(e.might_help.as_deref().unwrap_or("")), e.period.clone().unwrap_or_default()]).ok();
        }
    } else {
        w.write_record(["theme", "summary", "entries", "votes", "parked", "needs_attention"]).ok();
        for t in &g.themes {
            w.write_record([csv_safe(&t.title), csv_safe(&t.summary), t.entry_count.to_string(), t.votes.map(|v| v.to_string()).unwrap_or_default(), t.parked.to_string(), t.needs_attention.to_string()]).ok();
        }
        let exps: Vec<crate::commitments::Experiment> = sqlx::query_as(
            "SELECT e.id, e.sprint_id, s.name AS sprint_name, e.theme_id, e.theme_title, e.change_to_try, e.success_signal, e.owner_account_id, a.display_name AS owner_name,
             (e.owner_accepted_at IS NOT NULL) AS owner_accepted, e.review_on, e.status, e.outcome_note, e.reviewed_at, e.created_at
             FROM experiments e JOIN sprints s ON s.id = e.sprint_id LEFT JOIN accounts a ON a.id = e.owner_account_id WHERE e.sprint_id = $1 ORDER BY e.created_at",
        )
        .bind(ctx.sprint.id)
        .fetch_all(&state.db)
        .await?;
        w.write_record(["", "", "", "", "", ""]).ok();
        w.write_record(["experiment", "success_signal", "owner", "review_on", "status", "outcome"]).ok();
        for e in exps {
            w.write_record([csv_safe(&e.change_to_try), csv_safe(&e.success_signal), csv_safe(e.owner_name.as_deref().unwrap_or("")), e.review_on.to_string(), e.status, csv_safe(e.outcome_note.as_deref().unwrap_or(""))]).ok();
        }
    }
    let bytes = w.into_inner().map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let mut h = HeaderMap::new();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/csv; charset=utf-8"));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("attachment; filename=\"{}-retro.csv\"", slug(&ctx.sprint.name))).unwrap());
    Ok((h, String::from_utf8_lossy(&bytes).into_owned()))
}

fn slug(s: &str) -> String {
    let t: String = s.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    t.trim_matches('-').chars().take(40).collect::<String>().replace("--", "-")
}

#[allow(dead_code)]
fn _p(_: Uuid) {}
