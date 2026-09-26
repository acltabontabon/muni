//! One error type for the whole HTTP surface. Messages are safe to show to
//! users and never echo request bodies or secrets.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("sign in to continue")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("too many attempts — wait a little and try again")]
    RateLimited,
    #[error("{0}")]
    Unprocessable(String),
    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}

#[derive(Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: String,
    pub code: String,
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::RowNotFound => AppError::NotFound("not found".into()),
            _ => AppError::Internal(anyhow::Error::from(e).context("database")),
        }
    }
}

impl AppError {
    pub fn status(&self) -> StatusCode {
        match self {
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden(_) => StatusCode::FORBIDDEN,
            AppError::NotFound(_) => StatusCode::NOT_FOUND,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::Unprocessable(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
    fn code(&self) -> &'static str {
        match self {
            AppError::BadRequest(_) => "bad_request",
            AppError::Unauthorized => "unauthorized",
            AppError::Forbidden(_) => "forbidden",
            AppError::NotFound(_) => "not_found",
            AppError::Conflict(_) => "conflict",
            AppError::RateLimited => "rate_limited",
            AppError::Unprocessable(_) => "unprocessable",
            AppError::Internal(_) => "internal",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if let AppError::Internal(e) = &self {
            // Log the chain, never any request content.
            tracing::error!(error = %format!("{e:#}"), "request failed");
        }
        let body = ErrorBody { error: self.to_string(), code: self.code().into() };
        (self.status(), Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Shorthand used throughout handlers.
pub fn bad<T>(msg: impl Into<String>) -> AppResult<T> {
    Err(AppError::BadRequest(msg.into()))
}
pub fn forbidden<T>(msg: impl Into<String>) -> AppResult<T> {
    Err(AppError::Forbidden(msg.into()))
}
pub fn conflict<T>(msg: impl Into<String>) -> AppResult<T> {
    Err(AppError::Conflict(msg.into()))
}
