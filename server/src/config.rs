//! Environment configuration. Validated once at boot. Production refuses
//! insecure settings rather than silently degrading.

use anyhow::{bail, Context, Result};
use std::env;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Environment {
    Development,
    Test,
    Production,
}

#[derive(Clone, Debug)]
pub enum EmailConfig {
    /// Real SMTP delivery (Mailpit in development, a provider in production).
    Smtp {
        host: String,
        port: u16,
        username: Option<String>,
        password: Option<String>,
        starttls: bool,
        from: String,
    },
    /// Keep messages in memory; used by tests and by the dev inbox endpoint.
    Capture,
}

#[derive(Clone, Debug)]
pub enum AiConfig {
    /// No provider configured: AI features are visibly unavailable.
    Disabled,
    /// Anthropic Messages API.
    Anthropic { api_key: String, model: String, base_url: String },
    /// Deterministic fake used by tests and demos without credentials.
    Fake,
}

impl AiConfig {
    pub fn provider_label(&self) -> &'static str {
        match self {
            AiConfig::Disabled => "none",
            AiConfig::Anthropic { .. } => "anthropic",
            AiConfig::Fake => "fake",
        }
    }
    pub fn is_available(&self) -> bool {
        !matches!(self, AiConfig::Disabled)
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub environment: Environment,
    pub bind_addr: String,
    pub database_url: String,
    pub db_max_connections: u32,
    /// Public origin of the web app, e.g. https://retro.example.com
    pub public_origin: String,
    pub cookie_secure: bool,
    pub session_ttl_days: i64,
    pub email: EmailConfig,
    pub ai: AiConfig,
    /// Where the built frontend lives, if the server should serve it.
    pub static_dir: Option<String>,
    /// Allow the demo workspace seeder endpoint (never in production).
    pub allow_demo_seed: bool,
    pub entry_max_chars: usize,
    pub run_worker: bool,
    pub log_json: bool,
}

fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|v| !v.trim().is_empty())
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let environment = match var("APP_ENV").as_deref() {
            None | Some("development") | Some("dev") => Environment::Development,
            Some("test") => Environment::Test,
            Some("production") | Some("prod") => Environment::Production,
            Some(other) => bail!("APP_ENV must be development, test or production (got {other})"),
        };
        let is_prod = environment == Environment::Production;

        let database_url = var("DATABASE_URL").context("DATABASE_URL is required")?;
        let public_origin = var("PUBLIC_ORIGIN").unwrap_or_else(|| "http://localhost:5173".into());
        if is_prod && !public_origin.starts_with("https://") {
            bail!("PUBLIC_ORIGIN must be https:// in production");
        }
        let cookie_secure = var("COOKIE_SECURE")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(is_prod);
        if is_prod && !cookie_secure {
            bail!("COOKIE_SECURE cannot be disabled in production");
        }

        let email = match var("EMAIL_TRANSPORT").as_deref() {
            Some("capture") => {
                if is_prod {
                    bail!("EMAIL_TRANSPORT=capture is not allowed in production");
                }
                EmailConfig::Capture
            }
            None if environment == Environment::Test => EmailConfig::Capture,
            _ => EmailConfig::Smtp {
                host: var("SMTP_HOST").unwrap_or_else(|| "localhost".into()),
                port: var("SMTP_PORT").and_then(|p| p.parse().ok()).unwrap_or(1025),
                username: var("SMTP_USERNAME"),
                password: var("SMTP_PASSWORD"),
                starttls: var("SMTP_STARTTLS").map(|v| v == "true" || v == "1").unwrap_or(is_prod),
                from: var("EMAIL_FROM").unwrap_or_else(|| "Muni <muni@localhost>".into()),
            },
        };

        let ai = match var("AI_PROVIDER").as_deref() {
            None | Some("none") | Some("disabled") => AiConfig::Disabled,
            Some("fake") => {
                if is_prod {
                    bail!("AI_PROVIDER=fake is not allowed in production");
                }
                AiConfig::Fake
            }
            Some("anthropic") => AiConfig::Anthropic {
                api_key: var("ANTHROPIC_API_KEY").context("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic")?,
                model: var("ANTHROPIC_MODEL").unwrap_or_else(|| "claude-opus-5".into()),
                base_url: var("ANTHROPIC_BASE_URL").unwrap_or_else(|| "https://api.anthropic.com".into()),
            },
            Some(other) => bail!("unknown AI_PROVIDER {other}"),
        };

        let allow_demo_seed = var("ALLOW_DEMO_SEED").map(|v| v == "true" || v == "1").unwrap_or(!is_prod);
        if is_prod && allow_demo_seed {
            bail!("ALLOW_DEMO_SEED cannot be enabled in production");
        }

        Ok(Config {
            environment,
            bind_addr: var("BIND_ADDR").unwrap_or_else(|| "0.0.0.0:8080".into()),
            database_url,
            db_max_connections: var("DB_MAX_CONNECTIONS").and_then(|v| v.parse().ok()).unwrap_or(10),
            public_origin,
            cookie_secure,
            session_ttl_days: var("SESSION_TTL_DAYS").and_then(|v| v.parse().ok()).unwrap_or(30),
            email,
            ai,
            static_dir: var("STATIC_DIR"),
            allow_demo_seed,
            entry_max_chars: var("ENTRY_MAX_CHARS").and_then(|v| v.parse().ok()).unwrap_or(2000),
            run_worker: var("RUN_WORKER").map(|v| v != "false" && v != "0").unwrap_or(true),
            log_json: var("LOG_JSON").map(|v| v == "true" || v == "1").unwrap_or(is_prod),
        })
    }

    pub fn is_production(&self) -> bool {
        self.environment == Environment::Production
    }
}
