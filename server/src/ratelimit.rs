//! Humane, in-memory sliding-window rate limits keyed by an explicit bucket
//! (an email address, or an "IP class" for unauthenticated endpoints).
//! Single-instance by design (see docs/ARCHITECTURE.md). Per-IP limits are
//! deliberately generous so that a whole team behind one NAT is not treated
//! as one person; the per-email limits are what actually protect codes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a hit and returns false if the bucket exceeded `max` hits in `window`.
    pub fn check(&self, bucket: &str, max: usize, window: Duration) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap();
        let hits = map.entry(bucket.to_string()).or_default();
        hits.retain(|t| now.duration_since(*t) < window);
        if hits.len() >= max {
            return false;
        }
        hits.push(now);
        if map.len() > 50_000 {
            map.retain(|_, v| v.iter().any(|t| now.duration_since(*t) < window));
        }
        true
    }

    #[cfg(test)]
    pub fn reset(&self) {
        self.inner.lock().unwrap().clear();
    }
}
