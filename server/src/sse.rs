//! Live updates. Events are *hints* — a resource name and a version — never
//! content, so a broadcast can't carry something a recipient may not see.
//! Clients respond by fetching a fresh authorized snapshot.

use crate::{auth::extract::SprintCtx, error::AppResult, state::AppState};
use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use futures::stream::Stream;
use serde::Serialize;
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
pub struct Hint {
    pub resource: &'static str,
    pub at: chrono::DateTime<chrono::Utc>,
}

impl Hint {
    fn new(resource: &'static str) -> Self {
        Hint { resource, at: chrono::Utc::now() }
    }
    pub fn sprint() -> Self {
        Self::new("sprint")
    }
    pub fn entries() -> Self {
        Self::new("entries")
    }
    pub fn themes() -> Self {
        Self::new("themes")
    }
    pub fn meeting() -> Self {
        Self::new("meeting")
    }
    pub fn votes() -> Self {
        Self::new("votes")
    }
    pub fn commitments() -> Self {
        Self::new("commitments")
    }
    pub fn ai() -> Self {
        Self::new("ai")
    }
}

#[derive(Clone, Debug)]
enum Msg {
    Hint(Hint),
    /// Close streams held by this account (membership or participation revoked).
    Revoke(Uuid),
}

#[derive(Clone, Default)]
pub struct Broadcaster {
    sprints: Arc<Mutex<HashMap<Uuid, broadcast::Sender<Msg>>>>,
    /// workspace -> sender, used to close every stream for a revoked account.
    workspaces: Arc<Mutex<HashMap<Uuid, broadcast::Sender<Msg>>>>,
}

impl Broadcaster {
    pub fn new() -> Self {
        Self::default()
    }

    fn sprint_sender(&self, sprint_id: Uuid) -> broadcast::Sender<Msg> {
        self.sprints.lock().unwrap().entry(sprint_id).or_insert_with(|| broadcast::channel(256).0).clone()
    }
    fn workspace_sender(&self, workspace_id: Uuid) -> broadcast::Sender<Msg> {
        self.workspaces.lock().unwrap().entry(workspace_id).or_insert_with(|| broadcast::channel(64).0).clone()
    }

    pub fn publish(&self, sprint_id: Uuid, hint: Hint) {
        let _ = self.sprint_sender(sprint_id).send(Msg::Hint(hint));
    }
    pub fn revoke(&self, workspace_id: Uuid, account_id: Uuid) {
        let _ = self.workspace_sender(workspace_id).send(Msg::Revoke(account_id));
    }
    pub fn revoke_sprint(&self, sprint_id: Uuid, account_id: Uuid) {
        let _ = self.sprint_sender(sprint_id).send(Msg::Revoke(account_id));
    }
}

/// Live hints for a sprint. Authorization is re-checked periodically; a
/// revoked member's stream ends within one heartbeat.
#[utoipa::path(get, path = "/api/sprints/{sprint_id}/events", tag = "live", params(("sprint_id" = Uuid, Path)),
    responses((status = 200, description = "text/event-stream of {resource, at} hints")))]
pub async fn events(State(state): State<AppState>, ctx: SprintCtx) -> AppResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    ctx.require_participant()?;
    let sprint_id = ctx.sprint.id;
    let account_id = ctx.account_id();
    let mut rx_sprint = state.broadcaster.sprint_sender(sprint_id).subscribe();
    let mut rx_ws = state.broadcaster.workspace_sender(ctx.sprint.workspace_id).subscribe();
    let db = state.db.clone();

    let stream = async_stream::stream! {
        yield Ok(Event::default().event("hello").data(serde_json::json!({"sprint_id": sprint_id, "server_time": chrono::Utc::now()}).to_string()));
        let mut recheck = tokio::time::interval(Duration::from_secs(30));
        recheck.tick().await;
        loop {
            tokio::select! {
                m = rx_sprint.recv() => match m {
                    Ok(Msg::Hint(h)) => yield Ok(Event::default().event("hint").data(serde_json::to_string(&h).unwrap_or_default())),
                    Ok(Msg::Revoke(a)) if a == account_id => { yield Ok(Event::default().event("revoked").data("{}")); break; }
                    Ok(Msg::Revoke(_)) => {}
                    Err(broadcast::error::RecvError::Lagged(_)) => yield Ok(Event::default().event("hint").data(serde_json::to_string(&Hint::new("all")).unwrap_or_default())),
                    Err(_) => break,
                },
                m = rx_ws.recv() => match m {
                    Ok(Msg::Revoke(a)) if a == account_id => { yield Ok(Event::default().event("revoked").data("{}")); break; }
                    Err(broadcast::error::RecvError::Closed) => break,
                    _ => {}
                },
                _ = recheck.tick() => {
                    let ok: Option<(i64,)> = sqlx::query_as(
                        "SELECT count(*) FROM sprint_participants sp JOIN sprints s ON s.id = sp.sprint_id
                         JOIN memberships m ON m.workspace_id = s.workspace_id AND m.account_id = sp.account_id AND m.revoked_at IS NULL
                         WHERE sp.sprint_id = $1 AND sp.account_id = $2").bind(sprint_id).bind(account_id).fetch_optional(&db).await.ok().flatten();
                    if ok.map(|c| c.0).unwrap_or(0) == 0 { yield Ok(Event::default().event("revoked").data("{}")); break; }
                }
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping")))
}
