//! Invitations: a URL token identifies the invitation; joining still requires
//! a session whose verified email equals the invited address.

use super::{extract::Auth, mask_email};
use crate::{
    error::{AppError, AppResult},
    state::AppState,
    util,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::Utc;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
pub struct InvitationPreview {
    pub valid: bool,
    /// Masked recipient, e.g. "j•••@example.com".
    pub email_hint: Option<String>,
    /// Only present when the caller's verified email matches the invitation.
    pub workspace_name: Option<String>,
    pub matches_session: bool,
    pub signed_in: bool,
}

#[derive(sqlx::FromRow)]
struct InviteRow {
    id: Uuid,
    workspace_id: Uuid,
    email: String,
    sprint_id: Option<Uuid>,
    workspace_name: String,
}

async fn find_live(state: &AppState, token: &str) -> AppResult<Option<InviteRow>> {
    if token.len() > 128 {
        return Ok(None);
    }
    let hash = util::sha256(token.as_bytes());
    Ok(sqlx::query_as(
        "SELECT i.id, i.workspace_id, i.email, i.sprint_id, w.name AS workspace_name
         FROM invitations i JOIN workspaces w ON w.id = i.workspace_id
         WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()",
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await?)
}

/// Preview an invitation. Safe without a session: reveals only a masked address.
#[utoipa::path(get, path = "/api/invitations/{token}", tag = "invitations", params(("token" = String, Path)),
    responses((status = 200, body = InvitationPreview)))]
pub async fn preview(State(state): State<AppState>, headers: HeaderMap, Path(token): Path<String>) -> AppResult<Json<InvitationPreview>> {
    let session = match super::read_cookie(&headers, super::SESSION_COOKIE) {
        Some(t) => super::load_session(&state.db, &t).await?,
        None => None,
    };
    let Some(inv) = find_live(&state, &token).await? else {
        return Ok(Json(InvitationPreview {
            valid: false,
            email_hint: None,
            workspace_name: None,
            matches_session: false,
            signed_in: session.is_some(),
        }));
    };
    let matches = session.as_ref().map(|s| s.account.email == inv.email).unwrap_or(false);
    Ok(Json(InvitationPreview {
        valid: true,
        email_hint: Some(mask_email(&inv.email)),
        workspace_name: matches.then_some(inv.workspace_name),
        matches_session: matches,
        signed_in: session.is_some(),
    }))
}

#[derive(Serialize, ToSchema)]
pub struct AcceptResponse {
    pub workspace_id: Uuid,
    pub sprint_id: Option<Uuid>,
}

/// Accept an invitation with a session whose verified email matches. Single use.
#[utoipa::path(post, path = "/api/invitations/{token}/accept", tag = "invitations", params(("token" = String, Path)),
    responses((status = 200, body = AcceptResponse), (status = 403, body = crate::error::ErrorBody), (status = 410, body = crate::error::ErrorBody)))]
pub async fn accept(State(state): State<AppState>, auth: Auth, Path(token): Path<String>) -> AppResult<Json<AcceptResponse>> {
    let Some(inv) = find_live(&state, &token).await? else {
        return Err(AppError::NotFound("this invitation is no longer valid".into()));
    };
    if inv.email != auth.account.email {
        return Err(AppError::Forbidden(format!(
            "this invitation was sent to {} — sign in with that address to accept it",
            mask_email(&inv.email)
        )));
    }
    let mut tx = state.db.begin().await?;
    // Single-use under concurrency: the conditional UPDATE wins exactly once.
    let claimed: Option<(Uuid,)> = sqlx::query_as(
        "UPDATE invitations SET accepted_at = now(), accepted_by = $2
         WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id",
    )
    .bind(inv.id)
    .bind(auth.account.id)
    .fetch_optional(&mut *tx)
    .await?;
    if claimed.is_none() {
        return Err(AppError::Conflict("this invitation was already used".into()));
    }
    sqlx::query(
        "INSERT INTO memberships (workspace_id, account_id, role) VALUES ($1,$2,'member')
         ON CONFLICT (workspace_id, account_id) DO UPDATE SET revoked_at = NULL",
    )
    .bind(inv.workspace_id)
    .bind(auth.account.id)
    .execute(&mut *tx)
    .await?;
    if let Some(sid) = inv.sprint_id {
        sqlx::query(
            "INSERT INTO sprint_participants (sprint_id, account_id) SELECT $1, $2 FROM sprints
             WHERE id = $1 AND status NOT IN ('completed','archived') ON CONFLICT DO NOTHING",
        )
        .bind(sid)
        .bind(auth.account.id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("INSERT INTO audit_events (workspace_id, actor_id, action, meta) VALUES ($1,$2,'invitation.accepted', jsonb_build_object('invitation_id',$3::text))")
        .bind(inv.workspace_id)
        .bind(auth.account.id)
        .bind(inv.id.to_string())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let _ = Utc::now();
    Ok(Json(AcceptResponse { workspace_id: inv.workspace_id, sprint_id: inv.sprint_id }))
}
