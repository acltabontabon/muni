# Muni — production image.
#
# Three stages:
#   1. web     builds the React frontend into web/dist
#   2. server  builds the release binary muni-server
#   3. runtime a slim Debian image with the binary and the built frontend
#
# Database migrations are embedded in the binary (sqlx::migrate!("./migrations")
# in server/src/db.rs) and run automatically at startup, so server/migrations is
# NOT copied into the runtime image.
#
# Build:  docker build -t muni .
# Run:    docker run --rm -p 8080:8080 --env-file .env muni

# ---------------------------------------------------------------------------
# Stage 1: frontend
# ---------------------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# `npm run build` runs `tsc -b && vite build`. web/src/api/schema.d.ts is
# committed, so no OpenAPI codegen is needed at image build time.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: backend
# ---------------------------------------------------------------------------
# rust:1-bookworm tracks the current stable toolchain; the crate declares
# rust-version = "1.85" as its minimum. Pin to an exact tag (e.g.
# rust:1.94-bookworm) if you want fully reproducible builds.
FROM rust:1-bookworm AS server
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY server/ ./server/
# BuildKit cache mounts keep the crates.io registry and the target directory
# between builds, so unchanged dependencies are not recompiled. The binary is
# copied out of the cache mount because the mount is not part of the layer.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/target \
    cargo build --release -p muni-server --bin muni-server \
    && mkdir -p /out && cp /src/target/release/muni-server /out/muni-server

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system muni \
    && useradd --system --gid muni --home-dir /app --shell /usr/sbin/nologin muni

COPY --from=server /out/muni-server /usr/local/bin/muni-server
COPY --from=web /src/web/dist /app/web

# The server serves the built frontend from STATIC_DIR with an SPA fallback and
# the API under /api. APP_ENV=production makes config validation refuse
# insecure settings (see docs/DEPLOYMENT.md for the full variable table).
ENV STATIC_DIR=/app/web \
    BIND_ADDR=0.0.0.0:8080 \
    APP_ENV=production \
    RUST_LOG=info,sqlx=warn,tower_http=info

WORKDIR /app
USER muni
EXPOSE 8080

# /healthz is liveness only (no database check); /readyz checks the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

# tini forwards SIGTERM so the server can shut down gracefully (drain HTTP,
# stop the job worker, close the pool).
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/muni-server"]
