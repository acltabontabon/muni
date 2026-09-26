//! Anthropic Messages API adapter (raw HTTP; there is no official Rust SDK).
//! Uses `output_config.format` with a JSON schema so the reply is structured.

use super::{AiError, AiProvider, InputEntry, Proposal};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::time::Duration;

pub struct AnthropicProvider {
    api_key: String,
    model: String,
    base_url: String,
    client: reqwest::Client,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String, base_url: String) -> Self {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(80)).build().expect("http client");
        Self { api_key, model, base_url: base_url.trim_end_matches('/').to_string(), client }
    }
}

#[async_trait]
impl AiProvider for AnthropicProvider {
    async fn propose_grouping(&self, entries: &[InputEntry]) -> Result<Proposal, AiError> {
        let body = json!({
            "model": self.model,
            "max_tokens": 16000,
            "system": super::SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": super::user_prompt(entries)}],
            "output_config": {"format": {"type": "json_schema", "schema": super::proposal_schema()}, "effort": "medium"},
        });
        let mut last_err: Option<AiError> = None;
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(2 << attempt)).await;
            }
            let resp = self
                .client
                .post(format!("{}/v1/messages", self.base_url))
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await;
            let resp = match resp {
                Ok(r) => r,
                Err(e) => {
                    last_err = Some(AiError::Unavailable(e.to_string()));
                    continue;
                }
            };
            let status = resp.status();
            if status.as_u16() == 429 {
                last_err = Some(AiError::RateLimited);
                continue;
            }
            if status.is_server_error() || status.as_u16() == 529 {
                last_err = Some(AiError::Unavailable(format!("status {status}")));
                continue;
            }
            if !status.is_success() {
                // 4xx other than 429: not retryable. Do not include the body: it echoes our input.
                return Err(AiError::Unavailable(format!("provider rejected the request (status {status})")));
            }
            let v: Value = resp.json().await.map_err(|e| AiError::Malformed(e.to_string()))?;
            if v["stop_reason"].as_str() == Some("refusal") {
                return Err(AiError::Malformed("the provider declined this request".into()));
            }
            if v["stop_reason"].as_str() == Some("max_tokens") {
                return Err(AiError::Malformed("the reply was cut off".into()));
            }
            let text = v["content"]
                .as_array()
                .and_then(|blocks| blocks.iter().find(|b| b["type"] == "text"))
                .and_then(|b| b["text"].as_str())
                .ok_or_else(|| AiError::Malformed("no text block in reply".into()))?;
            return serde_json::from_str::<Proposal>(text).map_err(|e| AiError::Malformed(format!("reply did not match the schema: {e}")));
        }
        Err(last_err.unwrap_or(AiError::Unavailable("unknown".into())))
    }
    fn label(&self) -> &'static str {
        "anthropic"
    }
    fn model(&self) -> Option<String> {
        Some(self.model.clone())
    }
}
