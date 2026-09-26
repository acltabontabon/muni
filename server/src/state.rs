use crate::{config::Config, email::Mailer, ai::AiProvider, sse::Broadcaster, ratelimit::RateLimiter};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: PgPool,
    pub mailer: Arc<dyn Mailer>,
    pub ai: Arc<dyn AiProvider>,
    pub broadcaster: Broadcaster,
    pub limiter: RateLimiter,
    pub started_at: chrono::DateTime<chrono::Utc>,
}
