//! Workspaces, membership, invitations, settings.

use crate::{
    audit,
    auth::extract::{Auth, Member, Role},
    email::templates,
    error::{AppError, AppResult},
    state::AppState,
    util,
};
use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Deserialize, ToSchema)]
pub struct CreateWorkspaceBody {
    pub name: String,
}

#[derive(Serialize, ToSchema)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub retention_days: i32,
    pub outcome_retention_days: i32,
    pub ai_enabled_default: bool,
    pub ai_provider: String,
    pub is_demo: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub struct MemberInfo {
    pub account_id: Uuid,
    pub display_name: String,
    /// Present for workspace owners only.
    pub email: Option<String>,
    pub role: String,
    pub joined_at: DateTime<Utc>,
    pub is_you: bool,
}

#[derive(Serialize, ToSchema)]
pub struct PendingInvitation {
    pub id: Uuid,
    pub email: String,
    pub sprint_id: Option<Uuid>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub struct WorkspaceDetail {
    pub workspace: Workspace,
    pub members: Vec<MemberInfo>,
    pub pending_invitations: Vec<PendingInvitation>,
    pub can_invite: bool,
}

/// Create a workspace. The creator becomes its owner.
#[utoipa::path(post, path = "/api/workspaces", tag = "workspaces", request_body = CreateWorkspaceBody, responses((status = 200, body = Workspace)))]
pub async fn create(State(state): State<AppState>, auth: Auth, Json(body): Json<CreateWorkspaceBody>) -> AppResult<Json<Workspace>> {
    let name = util::trimmed_nonempty(&body.name, 80, "Workspace name").map_err(AppError::BadRequest)?;
    let mut tx = state.db.begin().await?;
    let (id,): (Uuid,) = sqlx::query_as("INSERT INTO workspaces (name) VALUES ($1) RETURNING id").bind(&name).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO memberships (workspace_id, account_id, role) VALUES ($1,$2,'owner')")
        .bind(id)
        .bind(auth.account.id)
        .execute(&mut *tx)
        .await?;
    audit::record(&mut *tx, id, None, Some(auth.account.id), "workspace.created", serde_json::json!({})).await?;
    tx.commit().await?;
    load_workspace(&state, id, &Role::Owner).await.map(Json)
}

pub async fn load_workspace(state: &AppState, id: Uuid, role: &Role) -> AppResult<Workspace> {
    let row: (Uuid, String, i32, i32, bool, bool, DateTime<Utc>) = sqlx::query_as(
        "SELECT id, name, retention_days, outcome_retention_days, ai_enabled_default, is_demo, created_at FROM workspaces WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    Ok(Workspace {
        id: row.0,
        name: row.1,
        role: role.as_str().into(),
        retention_days: row.2,
        outcome_retention_days: row.3,
        ai_enabled_default: row.4,
        ai_provider: state.config.ai.provider_label().into(),
        is_demo: row.5,
        created_at: row.6,
    })
}

pub async fn can_invite(state: &AppState, m: &Member) -> AppResult<bool> {
    if m.role == Role::Owner {
        return Ok(true);
    }
    let (n,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id
         WHERE s.workspace_id = $1 AND sp.account_id = $2 AND sp.is_facilitator AND s.status NOT IN ('completed','archived')",
    )
    .bind(m.workspace_id)
    .bind(m.auth.account.id)
    .fetch_one(&state.db)
    .await?;
    Ok(n > 0)
}

/// Workspace details: settings, members, pending invitations.
#[utoipa::path(get, path = "/api/workspaces/{workspace_id}", tag = "workspaces", params(("workspace_id" = Uuid, Path)),
    responses((status = 200, body = WorkspaceDetail)))]
pub async fn get(State(state): State<AppState>, m: Member) -> AppResult<Json<WorkspaceDetail>> {
    let workspace = load_workspace(&state, m.workspace_id, &m.role).await?;
    let is_owner = m.role == Role::Owner;
    let rows: Vec<(Uuid, String, String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT a.id, a.display_name, a.email, m.role, m.created_at FROM memberships m JOIN accounts a ON a.id = m.account_id
         WHERE m.workspace_id = $1 AND m.revoked_at IS NULL ORDER BY m.created_at",
    )
    .bind(m.workspace_id)
    .fetch_all(&state.db)
    .await?;
    let members = rows
        .into_iter()
        .map(|(account_id, display_name, email, role, joined_at)| MemberInfo {
            account_id,
            display_name,
            email: is_owner.then_some(email),
            role,
            joined_at,
            is_you: account_id == m.auth.account.id,
        })
        .collect();
    let can_invite = can_invite(&state, &m).await?;
    let pending_invitations = if can_invite {
        let rows: Vec<(Uuid, String, Option<Uuid>, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(
            "SELECT id, email, sprint_id, expires_at, created_at FROM invitations
             WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC",
        )
        .bind(m.workspace_id)
        .fetch_all(&state.db)
        .await?;
        rows.into_iter()
            .map(|(id, email, sprint_id, expires_at, created_at)| PendingInvitation { id, email, sprint_id, expires_at, created_at })
            .collect()
    } else {
        vec![]
    };
    Ok(Json(WorkspaceDetail { workspace, members, pending_invitations, can_invite }))
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateWorkspaceBody {
    pub name: Option<String>,
    pub retention_days: Option<i32>,
    pub outcome_retention_days: Option<i32>,
    pub ai_enabled_default: Option<bool>,
}

/// Update workspace settings (owner only).
#[utoipa::path(patch, path = "/api/workspaces/{workspace_id}", tag = "workspaces", params(("workspace_id" = Uuid, Path)),
    request_body = UpdateWorkspaceBody, responses((status = 200, body = Workspace)))]
pub async fn update(State(state): State<AppState>, m: Member, Json(body): Json<UpdateWorkspaceBody>) -> AppResult<Json<Workspace>> {
    m.require_owner()?;
    if let Some(name) = &body.name {
        let name = util::trimmed_nonempty(name, 80, "Workspace name").map_err(AppError::BadRequest)?;
        sqlx::query("UPDATE workspaces SET name = $1 WHERE id = $2").bind(name).bind(m.workspace_id).execute(&state.db).await?;
    }
    if let Some(d) = body.retention_days {
        if !(7..=3650).contains(&d) {
            return Err(AppError::BadRequest("retention must be between 7 and 3650 days".into()));
        }
        sqlx::query("UPDATE workspaces SET retention_days = $1 WHERE id = $2").bind(d).bind(m.workspace_id).execute(&state.db).await?;
    }
    if let Some(d) = body.outcome_retention_days {
        if !(30..=3650).contains(&d) {
            return Err(AppError::BadRequest("outcome retention must be between 30 and 3650 days".into()));
        }
        sqlx::query("UPDATE workspaces SET outcome_retention_days = $1 WHERE id = $2").bind(d).bind(m.workspace_id).execute(&state.db).await?;
    }
    if let Some(v) = body.ai_enabled_default {
        sqlx::query("UPDATE workspaces SET ai_enabled_default = $1 WHERE id = $2").bind(v).bind(m.workspace_id).execute(&state.db).await?;
    }
    audit::record(&state.db, m.workspace_id, None, Some(m.auth.account.id), "workspace.settings_updated", serde_json::json!({})).await?;
    load_workspace(&state, m.workspace_id, &m.role).await.map(Json)
}

#[derive(Deserialize, ToSchema)]
pub struct InviteBody {
    pub email: String,
    /// Add the invitee to this sprint once they join.
    pub sprint_id: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub struct InviteResponse {
    pub invitation_id: Uuid,
    pub email: String,
    pub already_member: bool,
}

/// Invite a teammate by email. Sends a link; joining requires verifying that address.
#[utoipa::path(post, path = "/api/workspaces/{workspace_id}/invitations", tag = "workspaces", params(("workspace_id" = Uuid, Path)),
    request_body = InviteBody, responses((status = 200, body = InviteResponse)))]
pub async fn invite(State(state): State<AppState>, m: Member, Json(body): Json<InviteBody>) -> AppResult<Json<InviteResponse>> {
    if !can_invite(&state, &m).await? {
        return Err(AppError::Forbidden("only owners and facilitators can invite".into()));
    }
    let email = util::normalize_email(&body.email).ok_or_else(|| AppError::BadRequest("enter a valid email address".into()))?;
    if !state.limiter.check(&format!("invite:{}", m.workspace_id), 60, std::time::Duration::from_secs(3600)) {
        return Err(AppError::RateLimited);
    }
    if let Some(sid) = body.sprint_id {
        let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM sprints WHERE id = $1 AND workspace_id = $2")
            .bind(sid)
            .bind(m.workspace_id)
            .fetch_one(&state.db)
            .await?;
        if n == 0 {
            return Err(AppError::NotFound("sprint not found".into()));
        }
    }
    // Already an active member? Add to sprint directly and say so.
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT a.id FROM accounts a JOIN memberships mm ON mm.account_id = a.id
         WHERE a.email = $1 AND mm.workspace_id = $2 AND mm.revoked_at IS NULL",
    )
    .bind(&email)
    .bind(m.workspace_id)
    .fetch_optional(&state.db)
    .await?;
    if let Some((account_id,)) = existing {
        if let Some(sid) = body.sprint_id {
            sqlx::query("INSERT INTO sprint_participants (sprint_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING")
                .bind(sid)
                .bind(account_id)
                .execute(&state.db)
                .await?;
        }
        return Ok(Json(InviteResponse { invitation_id: Uuid::nil(), email, already_member: true }));
    }
    let token = util::random_token(32);
    let hash = util::sha256(token.as_bytes());
    let (id,): (Uuid,) = sqlx::query_as(
        "INSERT INTO invitations (workspace_id, email, token_hash, invited_by, sprint_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    )
    .bind(m.workspace_id)
    .bind(&email)
    .bind(&hash)
    .bind(m.auth.account.id)
    .bind(body.sprint_id)
    .bind(Utc::now() + Duration::days(14))
    .fetch_one(&state.db)
    .await?;
    let (ws_name,): (String,) = sqlx::query_as("SELECT name FROM workspaces WHERE id = $1").bind(m.workspace_id).fetch_one(&state.db).await?;
    let link = format!("{}/invite/{}", state.config.public_origin.trim_end_matches('/'), token);
    crate::jobs::enqueue_email(&state.db, templates::invitation(&email, &ws_name, &m.auth.account.display_name, &link), Some(format!("invite:{id}"))).await?;
    audit::record(&state.db, m.workspace_id, body.sprint_id, Some(m.auth.account.id), "invitation.sent", serde_json::json!({"invitation_id": id})).await?;
    Ok(Json(InviteResponse { invitation_id: id, email, already_member: false }))
}

#[derive(Serialize, ToSchema)]
pub struct Ok {
    pub ok: bool,
}

/// Revoke a pending invitation.
#[utoipa::path(delete, path = "/api/workspaces/{workspace_id}/invitations/{invitation_id}", tag = "workspaces",
    params(("workspace_id" = Uuid, Path), ("invitation_id" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn revoke_invitation(State(state): State<AppState>, m: Member, Path(ids): Path<(Uuid, Uuid)>) -> AppResult<Json<Ok>> {
    let invitation_id = ids.1;
    if !can_invite(&state, &m).await? {
        return Err(AppError::Forbidden("only owners and facilitators can manage invitations".into()));
    }
    sqlx::query("UPDATE invitations SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL")
        .bind(invitation_id)
        .bind(m.workspace_id)
        .execute(&state.db)
        .await?;
    Ok(Json(Ok { ok: true }))
}

/// Remove a member. Their sessions keep working elsewhere but every request to this workspace fails from now on.
#[utoipa::path(delete, path = "/api/workspaces/{workspace_id}/members/{account_id}", tag = "workspaces",
    params(("workspace_id" = Uuid, Path), ("account_id" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn revoke_member(State(state): State<AppState>, m: Member, Path(ids): Path<(Uuid, Uuid)>) -> AppResult<Json<Ok>> {
    let account_id = ids.1;
    m.require_owner()?;
    if account_id == m.auth.account.id {
        let (owners,): (i64,) = sqlx::query_as("SELECT count(*) FROM memberships WHERE workspace_id = $1 AND role = 'owner' AND revoked_at IS NULL")
            .bind(m.workspace_id)
            .fetch_one(&state.db)
            .await?;
        if owners <= 1 {
            return Err(AppError::Conflict("a workspace needs at least one owner".into()));
        }
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE memberships SET revoked_at = now() WHERE workspace_id = $1 AND account_id = $2 AND revoked_at IS NULL")
        .bind(m.workspace_id)
        .bind(account_id)
        .execute(&mut *tx)
        .await?;
    // Drop them from sprints that haven't finished; their sealed entries stay in the sprint's pool.
    sqlx::query(
        "DELETE FROM sprint_participants sp USING sprints s WHERE s.id = sp.sprint_id AND s.workspace_id = $1 AND sp.account_id = $2 AND s.status NOT IN ('completed','archived')",
    )
    .bind(m.workspace_id)
    .bind(account_id)
    .execute(&mut *tx)
    .await?;
    audit::record(&mut *tx, m.workspace_id, None, Some(m.auth.account.id), "membership.revoked", serde_json::json!({"account_id": account_id})).await?;
    tx.commit().await?;
    state.broadcaster.revoke(m.workspace_id, account_id);
    Ok(Json(Ok { ok: true }))
}

#[derive(Deserialize, ToSchema)]
pub struct RoleBody {
    pub role: String,
}

/// Promote or demote a member (owner only).
#[utoipa::path(patch, path = "/api/workspaces/{workspace_id}/members/{account_id}", tag = "workspaces",
    params(("workspace_id" = Uuid, Path), ("account_id" = Uuid, Path)), request_body = RoleBody, responses((status = 200, body = Ok)))]
pub async fn set_role(State(state): State<AppState>, m: Member, Path(ids): Path<(Uuid, Uuid)>, Json(body): Json<RoleBody>) -> AppResult<Json<Ok>> {
    let account_id = ids.1;
    m.require_owner()?;
    if body.role != "owner" && body.role != "member" {
        return Err(AppError::BadRequest("role must be owner or member".into()));
    }
    sqlx::query("UPDATE memberships SET role = $1 WHERE workspace_id = $2 AND account_id = $3 AND revoked_at IS NULL")
        .bind(&body.role)
        .bind(m.workspace_id)
        .bind(account_id)
        .execute(&state.db)
        .await?;
    Ok(Json(Ok { ok: true }))
}

#[derive(Serialize, ToSchema)]
pub struct AuditEvent {
    pub id: i64,
    pub sprint_id: Option<Uuid>,
    pub actor_name: Option<String>,
    pub action: String,
    pub meta: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

/// Recent facilitator/owner actions. Contains resource ids, never content.
#[utoipa::path(get, path = "/api/workspaces/{workspace_id}/audit", tag = "workspaces", params(("workspace_id" = Uuid, Path)),
    responses((status = 200, body = Vec<AuditEvent>)))]
pub async fn audit_log(State(state): State<AppState>, m: Member) -> AppResult<Json<Vec<AuditEvent>>> {
    m.require_owner()?;
    let rows: Vec<(i64, Option<Uuid>, Option<String>, String, serde_json::Value, DateTime<Utc>)> = sqlx::query_as(
        "SELECT e.id, e.sprint_id, a.display_name, e.action, e.meta, e.created_at FROM audit_events e
         LEFT JOIN accounts a ON a.id = e.actor_id WHERE e.workspace_id = $1 ORDER BY e.id DESC LIMIT 200",
    )
    .bind(m.workspace_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, sprint_id, actor_name, action, meta, created_at)| AuditEvent { id, sprint_id, actor_name, action, meta, created_at })
            .collect(),
    ))
}
