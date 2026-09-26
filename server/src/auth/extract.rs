//! Axum extractors that make authorization impossible to forget.
//!
//! `Auth`       — a valid session (and, for unsafe methods, a valid CSRF token).
//! `Member`     — an active membership of the workspace in the path.
//! `SprintCtx`  — an active membership plus participation in the sprint in the path.

use super::{check_origin, load_session, read_cookie, Account, CSRF_HEADER, SESSION_COOKIE};
use crate::{error::AppError, state::AppState, util};
use axum::{
    extract::{FromRequestParts, Path},
    http::{request::Parts, Method},
};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct Auth {
    pub account: Account,
    pub session_id: Uuid,
}

impl FromRequestParts<AppState> for Auth {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let token = read_cookie(&parts.headers, SESSION_COOKIE).ok_or(AppError::Unauthorized)?;
        let session = load_session(&state.db, &token).await?.ok_or(AppError::Unauthorized)?;
        let unsafe_method = !matches!(parts.method, Method::GET | Method::HEAD | Method::OPTIONS);
        if unsafe_method {
            check_origin(&parts.headers, state)?;
            let header = parts.headers.get(CSRF_HEADER).and_then(|v| v.to_str().ok()).unwrap_or("");
            if !util::constant_time_eq(header.as_bytes(), session.csrf_token.as_bytes()) {
                return Err(AppError::Forbidden("missing or stale CSRF token — reload and try again".into()));
            }
        }
        Ok(Auth { account: session.account, session_id: session.id })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    Owner,
    Member,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Member => "member",
        }
    }
    pub fn parse(s: &str) -> Role {
        if s == "owner" {
            Role::Owner
        } else {
            Role::Member
        }
    }
}

#[derive(Clone, Debug)]
pub struct Member {
    pub auth: Auth,
    pub workspace_id: Uuid,
    pub role: Role,
}

impl Member {
    pub fn require_owner(&self) -> Result<(), AppError> {
        if self.role == Role::Owner {
            Ok(())
        } else {
            Err(AppError::Forbidden("only a workspace owner can do that".into()))
        }
    }
}

pub async fn membership_role(db: &sqlx::PgPool, workspace_id: Uuid, account_id: Uuid) -> Result<Option<Role>, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT role FROM memberships WHERE workspace_id = $1 AND account_id = $2 AND revoked_at IS NULL",
    )
    .bind(workspace_id)
    .bind(account_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|(r,)| Role::parse(&r)))
}

impl FromRequestParts<AppState> for Member {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let auth = Auth::from_request_parts(parts, state).await?;
        let Path(params): Path<HashMap<String, String>> =
            Path::from_request_parts(parts, state).await.map_err(|_| AppError::NotFound("not found".into()))?;
        let workspace_id: Uuid = params
            .get("workspace_id")
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| AppError::NotFound("not found".into()))?;
        let role = membership_role(&state.db, workspace_id, auth.account.id)
            .await?
            .ok_or_else(|| AppError::Forbidden("you’re not a member of this workspace".into()))?;
        Ok(Member { auth, workspace_id, role })
    }
}

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct SprintRow {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub status: String,
    pub grouping_revision: i64,
    pub vote_budget: i32,
    pub ai_processing: bool,
    pub include_facilitator_in_rotation: bool,
}

#[derive(Clone, Debug)]
pub struct SprintCtx {
    pub auth: Auth,
    pub sprint: SprintRow,
    pub role: Role,
    pub is_participant: bool,
    pub is_facilitator: bool,
}

impl SprintCtx {
    pub fn require_facilitator(&self) -> Result<(), AppError> {
        if self.is_facilitator {
            Ok(())
        } else {
            Err(AppError::Forbidden("only the facilitator can do that".into()))
        }
    }
    pub fn require_participant(&self) -> Result<(), AppError> {
        if self.is_participant || self.is_facilitator {
            Ok(())
        } else {
            Err(AppError::Forbidden("you’re not a participant in this sprint".into()))
        }
    }
    pub fn account_id(&self) -> Uuid {
        self.auth.account.id
    }
}

impl FromRequestParts<AppState> for SprintCtx {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, AppError> {
        let auth = Auth::from_request_parts(parts, state).await?;
        let Path(params): Path<HashMap<String, String>> =
            Path::from_request_parts(parts, state).await.map_err(|_| AppError::NotFound("not found".into()))?;
        let sprint_id: Uuid = params
            .get("sprint_id")
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| AppError::NotFound("not found".into()))?;
        load_sprint_ctx(state, auth, sprint_id).await
    }
}

pub async fn load_sprint_ctx(state: &AppState, auth: Auth, sprint_id: Uuid) -> Result<SprintCtx, AppError> {
    let sprint: Option<SprintRow> = sqlx::query_as(
        "SELECT id, workspace_id, name, status, grouping_revision, vote_budget, ai_processing, include_facilitator_in_rotation
         FROM sprints WHERE id = $1",
    )
    .bind(sprint_id)
    .fetch_optional(&state.db)
    .await?;
    // Non-members get 404, not 403: don't confirm the sprint exists.
    let sprint = sprint.ok_or_else(|| AppError::NotFound("sprint not found".into()))?;
    let role = membership_role(&state.db, sprint.workspace_id, auth.account.id)
        .await?
        .ok_or_else(|| AppError::NotFound("sprint not found".into()))?;
    let part: Option<(bool,)> =
        sqlx::query_as("SELECT is_facilitator FROM sprint_participants WHERE sprint_id = $1 AND account_id = $2")
            .bind(sprint_id)
            .bind(auth.account.id)
            .fetch_optional(&state.db)
            .await?;
    let (is_participant, is_facilitator) = match part {
        Some((f,)) => (true, f),
        None => (false, false),
    };
    if !is_participant && role != Role::Owner {
        return Err(AppError::Forbidden("you’re not a participant in this sprint".into()));
    }
    Ok(SprintCtx { auth, sprint, role, is_participant, is_facilitator })
}
