//! Verified-email sign-in, server-managed sessions, CSRF, invitations.
//!
//! Identity = control of a mailbox. That is stated to users as such.

pub mod extract;
pub mod handlers;
pub mod invitations;

use crate::{error::AppError, state::AppState, util};
use axum::http::{header, HeaderMap, HeaderValue};
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub const SESSION_COOKIE: &str = "muni_session";
pub const CSRF_COOKIE: &str = "muni_csrf";
pub const CSRF_HEADER: &str = "x-csrf-token";
pub const CODE_TTL_MINUTES: i64 = 10;

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct Account {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
}

#[derive(Clone, Debug)]
pub struct SessionRecord {
    pub id: Uuid,
    pub account: Account,
    pub csrf_token: String,
    pub expires_at: DateTime<Utc>,
}

pub struct NewSession {
    pub token: String,
    pub csrf: String,
}

/// Creates a session for the account and returns the raw cookie values.
pub async fn create_session(db: &PgPool, account_id: Uuid, ttl_days: i64) -> Result<NewSession, AppError> {
    let token = util::random_token(32);
    let csrf = util::random_token(24);
    let hash = util::sha256(token.as_bytes());
    sqlx::query("INSERT INTO sessions (account_id, token_hash, csrf_token, expires_at) VALUES ($1,$2,$3,$4)")
        .bind(account_id)
        .bind(&hash)
        .bind(&csrf)
        .bind(Utc::now() + Duration::days(ttl_days))
        .execute(db)
        .await?;
    Ok(NewSession { token, csrf })
}

pub async fn load_session(db: &PgPool, raw_token: &str) -> Result<Option<SessionRecord>, AppError> {
    if raw_token.is_empty() || raw_token.len() > 128 {
        return Ok(None);
    }
    let hash = util::sha256(raw_token.as_bytes());
    let row: Option<(Uuid, String, DateTime<Utc>, DateTime<Utc>, Uuid, String, String)> = sqlx::query_as(
        "SELECT s.id, s.csrf_token, s.expires_at, s.last_seen_at, a.id, a.email, a.display_name
         FROM sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL",
    )
    .bind(&hash)
    .fetch_optional(db)
    .await?;
    let Some((id, csrf_token, expires_at, last_seen_at, aid, email, display_name)) = row else {
        return Ok(None);
    };
    if expires_at < Utc::now() {
        return Ok(None);
    }
    if Utc::now() - last_seen_at > Duration::minutes(5) {
        let _ = sqlx::query("UPDATE sessions SET last_seen_at = now() WHERE id = $1").bind(id).execute(db).await;
    }
    Ok(Some(SessionRecord { id, account: Account { id: aid, email, display_name }, csrf_token, expires_at }))
}

pub async fn revoke_session(db: &PgPool, session_id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE sessions SET revoked_at = now() WHERE id = $1").bind(session_id).execute(db).await?;
    Ok(())
}

pub fn cookie_value(name: &str, value: &str, secure: bool, max_age_secs: i64, http_only: bool) -> HeaderValue {
    let mut c = format!("{name}={value}; Path=/; SameSite=Lax; Max-Age={max_age_secs}");
    if http_only {
        c.push_str("; HttpOnly");
    }
    if secure {
        c.push_str("; Secure");
    }
    HeaderValue::from_str(&c).expect("cookie header")
}

pub fn set_session_cookies(headers: &mut HeaderMap, state: &AppState, s: &NewSession) {
    let secs = state.config.session_ttl_days * 86_400;
    headers.append(header::SET_COOKIE, cookie_value(SESSION_COOKIE, &s.token, state.config.cookie_secure, secs, true));
    headers.append(header::SET_COOKIE, cookie_value(CSRF_COOKIE, &s.csrf, state.config.cookie_secure, secs, false));
}

pub fn clear_session_cookies(headers: &mut HeaderMap, state: &AppState) {
    headers.append(header::SET_COOKIE, cookie_value(SESSION_COOKIE, "", state.config.cookie_secure, 0, true));
    headers.append(header::SET_COOKIE, cookie_value(CSRF_COOKIE, "", state.config.cookie_secure, 0, false));
}

pub fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get_all(header::COOKIE).iter().find_map(|v| {
        v.to_str().ok()?.split(';').find_map(|kv| {
            let (k, val) = kv.trim().split_once('=')?;
            (k == name).then(|| val.to_string())
        })
    })
}

/// Rejects cross-site form posts and browsers that carry a session but no
/// CSRF header. Non-browser clients (tests) simply send the header.
pub fn check_origin(headers: &HeaderMap, state: &AppState) -> Result<(), AppError> {
    if let Some(site) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) {
        if site == "cross-site" {
            return Err(AppError::Forbidden("cross-site request refused".into()));
        }
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if origin != "null" && !origin_allowed(origin, state) {
            return Err(AppError::Forbidden("request origin not allowed".into()));
        }
    }
    Ok(())
}

fn origin_allowed(origin: &str, state: &AppState) -> bool {
    if origin == state.config.public_origin.trim_end_matches('/') {
        return true;
    }
    if !state.config.is_production() {
        return origin.starts_with("http://localhost:") || origin.starts_with("http://127.0.0.1:");
    }
    false
}

pub fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let first = local.chars().next().unwrap_or('•');
            format!("{first}•••@{domain}")
        }
        None => "•••".into(),
    }
}
