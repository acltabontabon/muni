use muni::{config::Config, jobs};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    let config = Config::from_env()?;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,tower_http=info"));
    if config.log_json {
        tracing_subscriber::registry().with(filter).with(fmt::layer().json().flatten_event(true)).init();
    } else {
        tracing_subscriber::registry().with(filter).with(fmt::layer().compact()).init();
    }
    let state = muni::build_state(config).await?;
    muni::db::migrate(&state.db).await?;
    tracing::info!(env = ?state.config.environment, email = state.mailer.label(), ai = state.config.ai.provider_label(), "Muni starting");

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let worker = if state.config.run_worker { Some(tokio::spawn(jobs::worker(state.clone(), shutdown_rx))) } else { None };

    let listener = tokio::net::TcpListener::bind(&state.config.bind_addr).await?;
    tracing::info!(addr = %state.config.bind_addr, "listening");
    let app = muni::app(state.clone());
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    let _ = shutdown_tx.send(true);
    if let Some(w) = worker {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(10), w).await;
    }
    state.db.close().await;
    tracing::info!("stopped");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async { tokio::signal::ctrl_c().await.ok() };
    #[cfg(unix)]
    let term = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal").recv().await;
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutdown requested");
}
