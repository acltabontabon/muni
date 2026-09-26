//! Test harness: a real server per test on a random port, the test database,
//! captured email, deterministic AI. Every test creates its own accounts and
//! workspace with unique emails, so tests run in parallel without truncation.

#![allow(dead_code)]

use muni::{
    config::{AiConfig, Config, EmailConfig, Environment},
    state::AppState,
};
use reqwest::{header, StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

pub struct Harness {
    pub base: String,
    pub state: AppState,
    pub http: reqwest::Client,
    _server: tokio::task::JoinHandle<()>,
}

#[derive(Clone, Debug)]
pub struct User {
    pub email: String,
    pub session: String,
    pub csrf: String,
    pub account_id: Uuid,
}

pub fn test_config() -> Config {
    Config {
        environment: Environment::Test,
        bind_addr: "127.0.0.1:0".into(),
        database_url: std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| "postgres://postgres@localhost:5432/muni_test".into()),
        db_max_connections: 6,
        public_origin: "http://localhost:5173".into(),
        cookie_secure: false,
        session_ttl_days: 30,
        email: EmailConfig::Capture,
        ai: AiConfig::Fake,
        static_dir: None,
        allow_demo_seed: true,
        entry_max_chars: 2000,
        run_worker: false,
        log_json: false,
    }
}

impl Harness {
    pub async fn new() -> Harness {
        Self::with_config(test_config()).await
    }

    pub async fn with_config(config: Config) -> Harness {
        let mut state = muni::build_state(config).await.expect("state");
        // Tests share one database and therefore one job queue: whichever harness
        // runs a job must deliver mail where every harness can read it.
        static MAILER: std::sync::OnceLock<Arc<muni::email::CaptureMailer>> = std::sync::OnceLock::new();
        state.mailer = MAILER.get_or_init(|| Arc::new(muni::email::CaptureMailer::default())).clone();
        static MIGRATED: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        MIGRATED.get_or_init(|| async { muni::db::migrate(&state.db).await.expect("migrate") }).await;
        Self::serve(state).await
    }

    pub async fn serve(state: AppState) -> Harness {
        let app = muni::app(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
        });
        Harness { base: format!("http://{addr}"), state, http: reqwest::Client::new(), _server: server }
    }

    /// A lightweight handle for spawning concurrent requests from another task.
    pub fn handle(&self) -> Harness {
        Harness { base: self.base.clone(), state: self.state.clone(), http: self.http.clone(), _server: tokio::spawn(async {}) }
    }

    pub fn ai(mut self, provider: Arc<dyn muni::ai::AiProvider>) -> Self {
        self.state.ai = provider;
        self
    }

    fn req(&self, method: reqwest::Method, path: &str, user: Option<&User>) -> reqwest::RequestBuilder {
        let mut r = self.http.request(method, format!("{}{}", self.base, path)).header(header::ORIGIN, "http://localhost:5173");
        if let Some(u) = user {
            r = r.header(header::COOKIE, format!("muni_session={}; muni_csrf={}", u.session, u.csrf)).header("x-csrf-token", &u.csrf);
        }
        r
    }

    pub async fn get(&self, user: &User, path: &str) -> (StatusCode, Value) {
        let r = self.req(reqwest::Method::GET, path, Some(user)).send().await.unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    pub async fn get_text(&self, user: &User, path: &str) -> (StatusCode, String) {
        let r = self.req(reqwest::Method::GET, path, Some(user)).send().await.unwrap();
        let s = r.status();
        (s, r.text().await.unwrap_or_default())
    }
    pub async fn get_anon(&self, path: &str) -> (StatusCode, Value) {
        let r = self.req(reqwest::Method::GET, path, None).send().await.unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    pub async fn post(&self, user: &User, path: &str, body: Value) -> (StatusCode, Value) {
        let r = self.req(reqwest::Method::POST, path, Some(user)).json(&body).send().await.unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    pub async fn post_anon(&self, path: &str, body: Value) -> (StatusCode, Value) {
        let r = self.req(reqwest::Method::POST, path, None).json(&body).send().await.unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    pub async fn patch(&self, user: &User, path: &str, body: Value) -> (StatusCode, Value) {
        let r = self.req(reqwest::Method::PATCH, path, Some(user)).json(&body).send().await.unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    pub async fn put(&self, user: &User, path: &str, body: Value) -> (StatusCode, Value) {
        let r = self.req(reqwest::Method::PUT, path, Some(user)).json(&body).send().await.unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }
    pub async fn delete(&self, user: &User, path: &str) -> (StatusCode, Value) {
        let r = self.req(reqwest::Method::DELETE, path, Some(user)).json(&json!({})).send().await.unwrap();
        let s = r.status();
        (s, r.json().await.unwrap_or(Value::Null))
    }

    /// The latest captured email to an address.
    pub fn last_mail_to(&self, email: &str) -> Option<muni::email::OutgoingEmail> {
        self.state.mailer.captured().into_iter().rev().find(|m| m.to == email)
    }

    pub fn code_for(&self, email: &str) -> String {
        self.last_mail_to(email).expect("sign-in mail").subject.split(' ').next().unwrap().to_string()
    }

    /// Full sign-in through the real endpoints.
    pub async fn signin(&self, email: &str, name: &str) -> User {
        let (s, _) = self.post_anon("/api/auth/request-code", json!({"email": email})).await;
        assert_eq!(s, StatusCode::OK, "request-code");
        let code = self.code_for(&email.to_lowercase());
        self.verify(email, &code, name).await.expect("verify")
    }

    pub async fn verify(&self, email: &str, code: &str, name: &str) -> Result<User, (StatusCode, Value)> {
        let r = self
            .req(reqwest::Method::POST, "/api/auth/verify", None)
            .json(&json!({"email": email, "code": code, "display_name": name}))
            .send()
            .await
            .unwrap();
        let status = r.status();
        let cookies: Vec<String> = r.headers().get_all(header::SET_COOKIE).iter().map(|v| v.to_str().unwrap().to_string()).collect();
        let body: Value = r.json().await.unwrap_or(Value::Null);
        if status != StatusCode::OK {
            return Err((status, body));
        }
        let find = |name: &str| cookies.iter().find_map(|c| c.strip_prefix(&format!("{name}=")).map(|rest| rest.split(';').next().unwrap().to_string())).unwrap();
        Ok(User { email: email.to_lowercase(), session: find("muni_session"), csrf: find("muni_csrf"), account_id: body["account_id"].as_str().unwrap().parse().unwrap() })
    }

    /// Owner + workspace + `n` invited-and-joined members. Returns (owner, members, workspace_id).
    pub async fn team(&self, n: usize) -> (User, Vec<User>, Uuid) {
        let tag = Uuid::new_v4().simple().to_string();
        let owner = self.signin(&format!("owner-{tag}@example.com"), "Owner").await;
        let (s, w) = self.post(&owner, "/api/workspaces", json!({"name": format!("Team {tag}")})).await;
        assert_eq!(s, StatusCode::OK);
        let ws: Uuid = w["id"].as_str().unwrap().parse().unwrap();
        let mut members = vec![];
        for i in 0..n {
            let email = format!("m{i}-{tag}@example.com");
            let (s, _) = self.post(&owner, &format!("/api/workspaces/{ws}/invitations"), json!({"email": email})).await;
            assert_eq!(s, StatusCode::OK);
            let token = self.invite_token(&email).await;
            let u = self.signin(&email, &format!("Member {i}")).await;
            let (s, _) = self.post(&u, &format!("/api/invitations/{token}/accept"), json!({})).await;
            assert_eq!(s, StatusCode::OK, "accept invite");
            members.push(u);
        }
        (owner, members, ws)
    }

    /// Runs queued jobs (email, ai) until none are due, then extracts the invite token from the captured mail.
    pub async fn invite_token(&self, email: &str) -> String {
        let mut mail = None;
        for _ in 0..40 {
            self.run_jobs().await;
            mail = self.last_mail_to(email);
            if mail.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let mail = mail.expect("invite mail");
        mail.body.lines().find_map(|l| l.trim().strip_prefix("http://localhost:5173/invite/").map(|t| t.trim().to_string())).expect("token in mail")
    }

    pub async fn run_jobs(&self) {
        for _ in 0..50 {
            if !muni::jobs::run_one(&self.state).await.unwrap() {
                break;
            }
        }
    }

    /// A sprint with the owner as facilitator and all members as participants, in the given status.
    pub async fn sprint(&self, owner: &User, members: &[User], ws: Uuid, status: &str) -> Uuid {
        let ids: Vec<String> = members.iter().map(|m| m.account_id.to_string()).collect();
        let (s, sp) = self
            .post(
                owner,
                &format!("/api/workspaces/{ws}/sprints"),
                json!({
                    "name": "Sprint T", "timezone": "Europe/Berlin", "starts_on": "2026-09-14", "ends_on": "2026-09-27",
                    "retro_date": "2026-09-28", "retro_time": "14:00", "retro_duration_min": 45,
                    "participant_ids": ids, "facilitator_id": owner.account_id, "ai_processing": true, "reminders_enabled": false
                }),
            )
            .await;
        assert_eq!(s, StatusCode::OK, "create sprint: {sp}");
        let id: Uuid = sp["id"].as_str().unwrap().parse().unwrap();
        let path = ["draft", "collecting", "preparing", "ready", "live", "completed"];
        let target = path.iter().position(|p| *p == status).unwrap();
        for to in path.iter().take(target + 1).skip(1) {
            let (s, r) = self.post(owner, &format!("/api/sprints/{id}/transition"), json!({"to": to, "confirm": true})).await;
            assert_eq!(s, StatusCode::OK, "transition to {to}: {r}");
        }
        id
    }

    pub async fn entry(&self, u: &User, sprint: Uuid, category: &str, body: &str) -> Value {
        let (s, e) = self.post(u, &format!("/api/sprints/{sprint}/entries"), json!({"category": category, "body": body})).await;
        assert_eq!(s, StatusCode::OK, "entry: {e}");
        e
    }

    pub async fn close_collection(&self, owner: &User, sprint: Uuid) {
        let (s, r) = self.post(owner, &format!("/api/sprints/{sprint}/transition"), json!({"to": "preparing", "confirm": true})).await;
        assert_eq!(s, StatusCode::OK, "{r}");
    }

    pub async fn go(&self, owner: &User, sprint: Uuid, to: &str) -> (StatusCode, Value) {
        self.post(owner, &format!("/api/sprints/{sprint}/transition"), json!({"to": to, "confirm": true})).await
    }

    pub async fn command(&self, u: &User, sprint: Uuid, cmd: Value) -> (StatusCode, Value) {
        let (_, snap) = self.get(u, &format!("/api/sprints/{sprint}/meeting")).await;
        self.post(u, &format!("/api/sprints/{sprint}/meeting/command"), json!({"expected_version": snap["version"], "command": cmd})).await
    }

    /// Reads SSE events for up to `ms` milliseconds; returns the raw text received.
    pub async fn sse(&self, u: &User, sprint: Uuid, ms: u64) -> (StatusCode, String) {
        let r = self.req(reqwest::Method::GET, &format!("/api/sprints/{sprint}/events"), Some(u)).send().await.unwrap();
        let status = r.status();
        if status != StatusCode::OK {
            return (status, r.text().await.unwrap_or_default());
        }
        let mut out = String::new();
        let mut r = r;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(ms);
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                break;
            }
            match tokio::time::timeout(left, r.chunk()).await {
                Ok(Ok(Some(c))) => out.push_str(&String::from_utf8_lossy(&c)),
                Ok(Ok(None)) => break,
                Ok(Err(_)) => break,
                Err(_) => break,
            }
        }
        (status, out)
    }
}

pub fn ids(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap().to_string()).collect()
}
