use super::{
    check_origin, clear_session_cookies, create_session, extract::Auth, revoke_session, set_session_cookies, CODE_TTL_MINUTES,
};
use crate::{
    email::templates,
    error::{AppError, AppResult},
    state::AppState,
    util,
};
use axum::{extract::State, http::HeaderMap, Json};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::time::Duration as StdDuration;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Deserialize, ToSchema)]
pub struct RequestCodeBody {
    pub email: String,
}

#[derive(Serialize, ToSchema)]
pub struct RequestCodeResponse {
    /// Always true when the request was accepted; existence of an account is never revealed.
    pub sent: bool,
    pub expires_in_minutes: i64,
}

/// Request a one-time sign-in code by email.
#[utoipa::path(post, path = "/api/auth/request-code", tag = "auth",
    request_body = RequestCodeBody, responses((status = 200, body = RequestCodeResponse), (status = 429, body = crate::error::ErrorBody)))]
pub async fn request_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RequestCodeBody>,
) -> AppResult<Json<RequestCodeResponse>> {
    check_origin(&headers, &state)?;
    let email = util::normalize_email(&body.email).ok_or_else(|| AppError::BadRequest("enter a valid email address".into()))?;
    // Per-address: 5 codes / 15 min. Per client class: generous, protects the mailer, not people.
    if !state.limiter.check(&format!("code:{email}"), 5, StdDuration::from_secs(900)) {
        return Err(AppError::RateLimited);
    }
    if !state.limiter.check(&format!("code-ip:{}", client_class(&headers)), 120, StdDuration::from_secs(600)) {
        return Err(AppError::RateLimited);
    }
    let code = util::random_code();
    let id = Uuid::new_v4();
    let hash = code_hash(&code, id);
    sqlx::query(
        "INSERT INTO verification_challenges (id, email, code_hash, expires_at) VALUES ($1,$2,$3,$4)",
    )
    .bind(id)
    .bind(&email)
    .bind(&hash)
    .bind(Utc::now() + Duration::minutes(CODE_TTL_MINUTES))
    .execute(&state.db)
    .await?;
    // Send inline (not via the job queue) so that sign-in is immediate. The
    // mailer's own errors are reported to the user honestly.
    state
        .mailer
        .send(templates::sign_in_code(&email, &code))
        .await
        .map_err(|e| AppError::Internal(e.context("sending sign-in email")))?;
    Ok(Json(RequestCodeResponse { sent: true, expires_in_minutes: CODE_TTL_MINUTES }))
}

fn code_hash(code: &str, challenge_id: Uuid) -> Vec<u8> {
    util::sha256(format!("{code}:{challenge_id}").as_bytes())
}

fn client_class(headers: &HeaderMap) -> String {
    // Coarse: the first hop address if a proxy supplied it, else "direct".
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "direct".into())
}

#[derive(Deserialize, ToSchema)]
pub struct VerifyBody {
    pub email: String,
    pub code: String,
    /// Used only when this email has no account yet.
    pub display_name: Option<String>,
}

#[derive(Serialize, ToSchema, Clone)]
pub struct WorkspaceSummary {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub is_demo: bool,
}

#[derive(Serialize, ToSchema)]
pub struct Me {
    pub account_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub workspaces: Vec<WorkspaceSummary>,
    pub session_expires_at: chrono::DateTime<Utc>,
    pub email_transport: String,
    pub ai_provider: String,
}

/// Exchange a code for a session. Consumes the code; bounded attempts.
#[utoipa::path(post, path = "/api/auth/verify", tag = "auth", request_body = VerifyBody,
    responses((status = 200, body = Me), (status = 400, body = crate::error::ErrorBody)))]
pub async fn verify(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<VerifyBody>,
) -> AppResult<(HeaderMap, Json<Me>)> {
    check_origin(&headers, &state)?;
    let email = util::normalize_email(&body.email).ok_or_else(|| AppError::BadRequest("enter a valid email address".into()))?;
    if !state.limiter.check(&format!("verify:{email}"), 10, StdDuration::from_secs(900)) {
        return Err(AppError::RateLimited);
    }
    let code = body.code.trim().replace(' ', "");
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::BadRequest("the code is six digits".into()));
    }

    let mut tx = state.db.begin().await?;
    // Latest live challenge for this address, locked so that concurrent
    // attempts count against the same budget.
    let row: Option<(Uuid, Vec<u8>, i32, i32)> = sqlx::query_as(
        "SELECT id, code_hash, attempts, max_attempts FROM verification_challenges
         WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((cid, hash, attempts, max_attempts)) = row else {
        return Err(AppError::BadRequest("that code has expired — request a new one".into()));
    };
    if attempts >= max_attempts {
        return Err(AppError::BadRequest("too many wrong codes — request a new one".into()));
    }
    if !util::constant_time_eq(&hash, &code_hash(&code, cid)) {
        sqlx::query("UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = $1")
            .bind(cid)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(AppError::BadRequest("that code doesn’t match".into()));
    }
    sqlx::query("UPDATE verification_challenges SET consumed_at = now() WHERE id = $1").bind(cid).execute(&mut *tx).await?;

    let existing: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM accounts WHERE email = $1").bind(&email).fetch_optional(&mut *tx).await?;
    let account_id = match existing {
        Some((id,)) => id,
        None => {
            let name = body
                .display_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.chars().take(80).collect::<String>())
                .unwrap_or_else(|| email.split('@').next().unwrap_or("teammate").to_string());
            let (id,): (Uuid,) = sqlx::query_as("INSERT INTO accounts (email, display_name) VALUES ($1,$2) RETURNING id")
                .bind(&email)
                .bind(&name)
                .fetch_one(&mut *tx)
                .await?;
            id
        }
    };
    tx.commit().await?;

    // Session rotation: any session presented on this request is revoked.
    if let Some(old) = super::read_cookie(&headers, super::SESSION_COOKIE) {
        if let Some(s) = super::load_session(&state.db, &old).await? {
            revoke_session(&state.db, s.id).await?;
        }
    }
    let session = create_session(&state.db, account_id, state.config.session_ttl_days).await?;
    let mut out = HeaderMap::new();
    set_session_cookies(&mut out, &state, &session);
    let me = build_me(&state, account_id).await?;
    Ok((out, Json(me)))
}

pub async fn build_me(state: &AppState, account_id: Uuid) -> AppResult<Me> {
    let acct: (String, String) = sqlx::query_as("SELECT email, display_name FROM accounts WHERE id = $1")
        .bind(account_id)
        .fetch_one(&state.db)
        .await?;
    let rows: Vec<(Uuid, String, String, bool)> = sqlx::query_as(
        "SELECT w.id, w.name, m.role, w.is_demo FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.account_id = $1 AND m.revoked_at IS NULL ORDER BY w.created_at",
    )
    .bind(account_id)
    .fetch_all(&state.db)
    .await?;
    let (expires_at,): (chrono::DateTime<Utc>,) = sqlx::query_as(
        "SELECT COALESCE(MAX(expires_at), now()) FROM sessions WHERE account_id = $1 AND revoked_at IS NULL",
    )
    .bind(account_id)
    .fetch_one(&state.db)
    .await?;
    Ok(Me {
        account_id,
        email: acct.0,
        display_name: acct.1,
        workspaces: rows.into_iter().map(|(id, name, role, is_demo)| WorkspaceSummary { id, name, role, is_demo }).collect(),
        session_expires_at: expires_at,
        email_transport: state.mailer.label().into(),
        ai_provider: state.config.ai.provider_label().into(),
    })
}

/// Who am I, and which workspaces can I see.
#[utoipa::path(get, path = "/api/auth/me", tag = "auth", responses((status = 200, body = Me), (status = 401, body = crate::error::ErrorBody)))]
pub async fn me(State(state): State<AppState>, auth: Auth) -> AppResult<Json<Me>> {
    Ok(Json(build_me(&state, auth.account.id).await?))
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateProfileBody {
    pub display_name: String,
}

/// Change the display name shown on the speaking card and attendance list.
#[utoipa::path(patch, path = "/api/auth/me", tag = "auth", request_body = UpdateProfileBody, responses((status = 200, body = Me)))]
pub async fn update_profile(State(state): State<AppState>, auth: Auth, Json(body): Json<UpdateProfileBody>) -> AppResult<Json<Me>> {
    let name = util::trimmed_nonempty(&body.display_name, 80, "Name").map_err(AppError::BadRequest)?;
    sqlx::query("UPDATE accounts SET display_name = $1 WHERE id = $2").bind(&name).bind(auth.account.id).execute(&state.db).await?;
    Ok(Json(build_me(&state, auth.account.id).await?))
}

#[derive(Serialize, ToSchema)]
pub struct Ok {
    pub ok: bool,
}

/// Sign out of this device.
#[utoipa::path(post, path = "/api/auth/logout", tag = "auth", responses((status = 200, body = Ok)))]
pub async fn logout(State(state): State<AppState>, auth: Auth) -> AppResult<(HeaderMap, Json<Ok>)> {
    revoke_session(&state.db, auth.session_id).await?;
    let mut out = HeaderMap::new();
    clear_session_cookies(&mut out, &state);
    Ok((out, Json(Ok { ok: true })))
}

/// Sign out everywhere else.
#[utoipa::path(post, path = "/api/auth/logout-others", tag = "auth", responses((status = 200, body = Ok)))]
pub async fn logout_others(State(state): State<AppState>, auth: Auth) -> AppResult<Json<Ok>> {
    sqlx::query("UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL")
        .bind(auth.account.id)
        .bind(auth.session_id)
        .execute(&state.db)
        .await?;
    Ok(Json(Ok { ok: true }))
}

#[derive(Serialize, ToSchema)]
pub struct SessionInfo {
    pub id: Uuid,
    pub current: bool,
    pub created_at: chrono::DateTime<Utc>,
    pub last_seen_at: chrono::DateTime<Utc>,
}

/// Active sessions for this account.
#[utoipa::path(get, path = "/api/auth/sessions", tag = "auth", responses((status = 200, body = Vec<SessionInfo>)))]
pub async fn sessions(State(state): State<AppState>, auth: Auth) -> AppResult<Json<Vec<SessionInfo>>> {
    let rows: Vec<(Uuid, chrono::DateTime<Utc>, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT id, created_at, last_seen_at FROM sessions WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_seen_at DESC",
    )
    .bind(auth.account.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, created_at, last_seen_at)| SessionInfo { id, current: id == auth.session_id, created_at, last_seen_at })
            .collect(),
    ))
}
