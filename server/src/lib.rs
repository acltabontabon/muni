pub mod ai;
pub mod audit;
pub mod auth;
pub mod commitments;
pub mod config;
pub mod db;
pub mod demo;
pub mod email;
pub mod entries;
pub mod error;
pub mod exports;
pub mod jobs;
pub mod meeting;
pub mod ratelimit;
pub mod retention;
pub mod sprints;
pub mod sse;
pub mod state;
pub mod themes;
pub mod util;
pub mod voting;
pub mod workspaces;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    Json, Router,
};
use serde::Serialize;
use state::AppState;
use std::sync::Arc;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

#[derive(OpenApi)]
#[openapi(
    info(title = "Muni API", description = "Sprint retrospectives that start before the meeting.", version = "0.1.0"),
    tags(
        (name = "auth"), (name = "invitations"), (name = "workspaces"), (name = "sprints"), (name = "entries"),
        (name = "themes"), (name = "voting"), (name = "meeting"), (name = "commitments"), (name = "exports"),
        (name = "ai"), (name = "live"), (name = "demo"), (name = "system")
    )
)]
pub struct ApiDoc;

#[derive(Serialize, ToSchema)]
pub struct Health {
    pub status: String,
    pub database: String,
    pub email_transport: String,
    pub ai_provider: String,
    pub uptime_secs: i64,
}

/// Liveness: the process is up.
#[utoipa::path(get, path = "/healthz", tag = "system", responses((status = 200, body = Health)))]
pub async fn healthz(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        database: "unchecked".into(),
        email_transport: state.mailer.label().into(),
        ai_provider: state.config.ai.provider_label().into(),
        uptime_secs: (chrono::Utc::now() - state.started_at).num_seconds(),
    })
}

/// Readiness: the database answers.
#[utoipa::path(get, path = "/readyz", tag = "system", responses((status = 200, body = Health), (status = 503, body = Health)))]
pub async fn readyz(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();
    let body = Health {
        status: if db_ok { "ready" } else { "not ready" }.into(),
        database: if db_ok { "ok" } else { "unreachable" }.into(),
        email_transport: state.mailer.label().into(),
        ai_provider: state.config.ai.provider_label().into(),
        uptime_secs: (chrono::Utc::now() - state.started_at).num_seconds(),
    };
    (if db_ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE }, Json(body))
}

pub fn api_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(healthz))
        .routes(routes!(readyz))
        // auth
        .routes(routes!(auth::handlers::request_code))
        .routes(routes!(auth::handlers::verify))
        .routes(routes!(auth::handlers::me, auth::handlers::update_profile))
        .routes(routes!(auth::handlers::logout))
        .routes(routes!(auth::handlers::logout_others))
        .routes(routes!(auth::handlers::sessions))
        .routes(routes!(auth::invitations::preview))
        .routes(routes!(auth::invitations::accept))
        // workspaces
        .routes(routes!(workspaces::create))
        .routes(routes!(workspaces::get, workspaces::update))
        .routes(routes!(workspaces::invite))
        .routes(routes!(workspaces::revoke_invitation))
        .routes(routes!(workspaces::revoke_member, workspaces::set_role))
        .routes(routes!(workspaces::audit_log))
        .routes(routes!(commitments::history))
        // sprints
        .routes(routes!(sprints::create, sprints::list))
        .routes(routes!(sprints::get, sprints::update, sprints::delete))
        .routes(routes!(sprints::add_participant))
        .routes(routes!(sprints::remove_participant))
        .routes(routes!(sprints::my_prefs))
        .routes(routes!(sprints::transition))
        .routes(routes!(sprints::capture_target))
        // entries
        .routes(routes!(entries::create, entries::shared))
        .routes(routes!(entries::mine))
        .routes(routes!(entries::update, entries::delete))
        // themes
        .routes(routes!(themes::get, themes::create))
        .routes(routes!(themes::update, themes::delete))
        .routes(routes!(themes::ungroup))
        .routes(routes!(themes::merge))
        .routes(routes!(themes::split))
        .routes(routes!(themes::reorder))
        // voting
        .routes(routes!(voting::get, voting::cast))
        .routes(routes!(voting::open_round))
        .routes(routes!(voting::close_round))
        // meeting
        .routes(routes!(meeting::get))
        .routes(routes!(meeting::command))
        .routes(routes!(meeting::attendance))
        .routes(routes!(meeting::attendance_for))
        .routes(routes!(meeting::pass))
        .routes(routes!(meeting::add_context))
        .routes(routes!(meeting::notes))
        .routes(routes!(meeting::heartbeat))
        // commitments & recap
        .routes(routes!(commitments::list, commitments::create))
        .routes(routes!(commitments::previous))
        .routes(routes!(commitments::update, commitments::delete))
        .routes(routes!(commitments::accept))
        .routes(routes!(commitments::get_recap, commitments::put_recap))
        // exports
        .routes(routes!(exports::markdown))
        .routes(routes!(exports::csv))
        // ai
        .routes(routes!(ai::handlers::status))
        .routes(routes!(ai::handlers::request_grouping))
        .routes(routes!(ai::handlers::apply))
        .routes(routes!(ai::handlers::reject))
        // live
        .routes(routes!(sse::events))
        // demo / dev
        .routes(routes!(demo::seed))
        .routes(routes!(demo::inbox))
}

pub fn openapi() -> utoipa::openapi::OpenApi {
    let (_, api) = api_router().split_for_parts();
    let mut doc = ApiDoc::openapi();
    doc.merge(api);
    doc
}

/// Builds the full application: API, security headers, optional static files.
pub fn app(state: AppState) -> Router {
    let (api, _) = api_router().split_for_parts();
    let cors = CorsLayer::new()
        .allow_origin(state.config.public_origin.parse::<HeaderValue>().unwrap_or_else(|_| HeaderValue::from_static("http://localhost:5173")))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::PUT, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, axum::http::HeaderName::from_static("x-csrf-token")])
        .allow_credentials(true);
    let mut router = api.with_state(state.clone());
    if let Some(dir) = &state.config.static_dir {
        let index = format!("{dir}/index.html");
        router = router.fallback_service(ServeDir::new(dir).not_found_service(ServeFile::new(index)));
    }
    router
        .layer(SetResponseHeaderLayer::overriding(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
        .layer(SetResponseHeaderLayer::overriding(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::overriding(header::REFERRER_POLICY, HeaderValue::from_static("same-origin")))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"),
        ))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, std::time::Duration::from_secs(60)))
        .layer(cors)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|req: &axum::http::Request<_>| tracing::info_span!("request", method = %req.method(), path = %req.uri().path()))
                .on_request(())
                .on_body_chunk(())
                .on_eos(()),
        )
}

/// Wires state from config; shared by main and tests.
pub async fn build_state(config: config::Config) -> anyhow::Result<AppState> {
    let db = db::connect(&config.database_url, config.db_max_connections).await?;
    let mailer = email::build(&config.email)?;
    let ai = ai::build(&config.ai);
    Ok(AppState {
        config: Arc::new(config),
        db,
        mailer,
        ai,
        broadcaster: sse::Broadcaster::new(),
        limiter: ratelimit::RateLimiter::new(),
        started_at: chrono::Utc::now(),
    })
}
