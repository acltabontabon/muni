# Muni — deployment

> **Retired backend.** This document describes the Rust server under `server/`, which is no longer
> deployed. The supported deployment is the Cloudflare Worker in `worker/` (see README “Deploy to
> Cloudflare”, `docs/HANDOFF.md`); its security and privacy properties are in `docs/SECURITY.md`.

This document describes how to run Muni in production. It is written from
the code in `server/src/config.rs`, `server/src/main.rs` and
`server/src/lib.rs`; when the two disagree, the code wins and this file needs
a fix. Day-two operations (backups, retention, monitoring, key rotation) are
in [OPERATIONS.md](OPERATIONS.md).

## What you are deploying

One process. The `muni-server` binary serves the JSON API under `/api`, the
built React frontend from `STATIC_DIR` (with an SPA fallback to
`index.html`), server-sent events for live updates, and, in the same process,
the background job worker (email, reminders, AI preparation, retention).
State lives in PostgreSQL only. There is no Redis, no message broker and no
application signing key: sessions are database rows keyed by the SHA-256 of
the cookie token.

```
browser ──HTTPS──▶ reverse proxy (Caddy / nginx) ──HTTP──▶ muni-server :8080 ──▶ PostgreSQL
                                                                 │
                                                                 ├─▶ SMTP relay (sign-in codes, invitations, reminders)
                                                                 └─▶ api.anthropic.com (only if AI_PROVIDER=anthropic)
```

### Single instance, by design

Run **exactly one replica** of the app. Three things are in-process and are
not shared across instances:

- the SSE fan-out (`sse::Broadcaster`) that tells connected clients a sprint
  changed;
- the meeting controller (one controller account per live retro, tracked with
  a heartbeat);
- the rate limiter for sign-in codes and invitations (in memory).

The job worker (`RUN_WORKER=true`, the default) also runs inside that one
process. Jobs are claimed from the `jobs` table with
`FOR UPDATE SKIP LOCKED`, so a second worker would not corrupt anything, but
SSE hints published from a second app instance would never reach clients
connected to the first. Horizontal scaling is not supported in v1; scale up
(a bigger box, a higher `DB_MAX_CONNECTIONS`) rather than out.

## Requirements

| Component | Requirement |
| --- | --- |
| PostgreSQL | 14 or newer; 16 is what development and CI use. The schema needs the `pgcrypto` extension (`CREATE EXTENSION IF NOT EXISTS pgcrypto` runs in the first migration; on PostgreSQL 13+ it is a trusted extension, so the application role can create it). |
| SMTP | A relay that accepts STARTTLS on port 587 (or plaintext on a private network). Sign-in codes are sent synchronously during the request, so the relay must be reachable and reasonably fast. |
| TLS | Terminate HTTPS in a reverse proxy. Production refuses a `PUBLIC_ORIGIN` that is not `https://`. |
| Outbound network | The SMTP relay, and `https://api.anthropic.com` if AI is enabled. Nothing else. |
| Resources | Modest. The release binary is a few tens of MB; memory use is dominated by the connection pool and in-flight requests. Request bodies are capped at 64 KiB and every request has a 60-second timeout. |

## Configuration

All configuration is by environment variables, read once at boot
(`Config::from_env`). A `.env` file in the working directory is loaded if
present (`dotenvy`), which is convenient in development and unnecessary in
containers. Empty values are treated as unset. Booleans are `true`/`1`;
anything else is false (except `RUN_WORKER`, which is true unless set to
`false`/`0`).

Production is `APP_ENV=production` (or `prod`). Several defaults change with
it, and several values are **refused** — the process exits with an error at
startup rather than running in a degraded state.

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_ENV` | `development` | `development`/`dev`, `test`, or `production`/`prod`. Anything else is an error. |
| `BIND_ADDR` | `0.0.0.0:8080` | Listen address. |
| `DATABASE_URL` | *required* | `postgres://user:password@host:5432/dbname`. TLS via `?sslmode=require` if your database is not on a private network. |
| `DB_MAX_CONNECTIONS` | `10` | Upper bound of the connection pool (min 1, acquire timeout 10 s, idle timeout 300 s). Keep it under the database's `max_connections` with room for backups and a psql session. |
| `PUBLIC_ORIGIN` | `http://localhost:5173` | The exact origin people open, e.g. `https://retro.example.com`, no trailing slash. Used for the CORS allow-origin, the `Origin` check on every mutating request, and the links in invitation and reminder emails. **Production refuses anything that does not start with `https://`.** |
| `COOKIE_SECURE` | `true` in production, `false` otherwise | Marks the session cookie `Secure`. **Production refuses `false`.** |
| `SESSION_TTL_DAYS` | `30` | Session lifetime. |
| `EMAIL_TRANSPORT` | `smtp` (`capture` under `APP_ENV=test`) | `smtp` or `capture`. `capture` keeps mail in memory and exposes it at `/api/dev/inbox`. **Production refuses `capture`.** |
| `SMTP_HOST` | `localhost` | Relay host. |
| `SMTP_PORT` | `1025` | Set to `587` for a real relay. |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | unset | Both must be set for authentication to be used. |
| `SMTP_STARTTLS` | `true` in production, `false` otherwise | `true` upgrades the connection with STARTTLS (and verifies the relay's certificate against the system roots). `false` uses a plaintext connection; only for a relay on a private network or Mailpit. Implicit TLS (SMTPS on port 465) is not supported. |
| `EMAIL_FROM` | `Muni <muni@localhost>` | Sender mailbox; must parse as an address. Set it to something your relay is allowed to send as. |
| `AI_PROVIDER` | `none` | `none`/`disabled`, `fake`, or `anthropic`. **Production refuses `fake`.** |
| `ANTHROPIC_API_KEY` | unset | Required when `AI_PROVIDER=anthropic`. |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model id sent to the Messages API. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Override only for a gateway that speaks the Anthropic Messages API. |
| `STATIC_DIR` | unset | Directory with the built frontend (`web/dist`). Unset means the server is API-only and something else must serve the frontend from the same origin. The container image sets `/app/web`. |
| `ALLOW_DEMO_SEED` | `false` in production, `true` otherwise | Enables `POST /api/demo/seed`, which creates a fictional demo workspace for the caller. **Production refuses `true`.** |
| `ENTRY_MAX_CHARS` | `2000` | Maximum length of an entry body. |
| `RUN_WORKER` | `true` | Run the background job worker in this process. Only set to `false` if you run a separate worker process (same binary, same env, `RUN_WORKER=true`, and then the web process with `false`); one worker in total. |
| `LOG_JSON` | `true` in production, `false` otherwise | One JSON object per log line, or a compact human format. |
| `RUST_LOG` | `info,sqlx=warn,tower_http=info` | Standard `tracing` filter. `debug` is safe with respect to content (see Logging below) but noisy. |

A minimal production environment:

```sh
APP_ENV=production
DATABASE_URL=postgres://muni:********@db.internal:5432/muni?sslmode=require
PUBLIC_ORIGIN=https://retro.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=retro@example.com
SMTP_PASSWORD=********
EMAIL_FROM=Muni <retro@example.com>
STATIC_DIR=/app/web
```

Everything else can stay at its default. `COOKIE_SECURE`, `SMTP_STARTTLS`
and `LOG_JSON` become `true` automatically; `ALLOW_DEMO_SEED` becomes `false`.

## Reverse proxy

The frontend and the API must be served from **one origin**: the content
security policy is `connect-src 'self'` and the CSRF check compares the
request `Origin` with `PUBLIC_ORIGIN` exactly. So the proxy forwards every
path (both `/` and `/api/...`) to the same upstream.

Two things need care:

1. **Server-sent events.** `GET /api/sprints/{id}/events` is a long-lived
   `text/event-stream` response. The server sends a `ping` comment every
   15 seconds and re-checks the caller's membership every 30 seconds. The
   proxy must not buffer the response and must not apply a short read
   timeout to it.
2. **`X-Forwarded-For`.** The server keys its per-IP rate limit for sign-in
   code requests on the **first** address in `X-Forwarded-For` (or the
   literal `direct` when the header is absent). The limit is deliberately
   coarse (120 requests per 10 minutes per address; the per-email limit of 5
   per 15 minutes is the real protection), so the only thing that matters is
   that the proxy **sets** the header from the real client address rather
   than appending to whatever the client sent. Otherwise a client can choose
   its own bucket by sending the header itself.

### Caddy

Caddy terminates TLS with automatic certificates, streams event streams
without buffering, and by default replaces incoming `X-Forwarded-*` headers
from untrusted clients with the real remote address.

```caddyfile
retro.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8080 {
        # Stream responses immediately (SSE). Caddy already does this for
        # text/event-stream, but being explicit costs nothing.
        flush_interval -1
    }
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name retro.example.com;

    ssl_certificate     /etc/letsencrypt/live/retro.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/retro.example.com/privkey.pem;

    client_max_body_size 1m;          # the app itself caps bodies at 64 KiB

    # Live updates: no buffering, no short timeouts. The app pings every 15 s.
    location ~ ^/api/sprints/[0-9a-f-]+/events$ {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Connection "";
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $remote_addr;    # set, do not append
        proxy_set_header   X-Forwarded-Proto https;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $remote_addr;    # set, do not append
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 75s;                             # the app times requests out at 60 s
    }
}

server {
    listen 80;
    server_name retro.example.com;
    return 301 https://$host$request_uri;
}
```

If there is another trusted proxy or CDN in front of nginx, use
`$proxy_add_x_forwarded_for` together with the `real_ip` module configured
with that proxy's addresses, so that the first hop is still a value you
trust.

Do not enable request-body logging (nginx `$request_body`, Caddy
`request_body` logging, or any "full request capture" feature) for `/api`
paths in the proxy. Entry text, votes, and sign-in codes travel in request
bodies; the application never logs them, and the proxy should not either.

## Build and run

### With Docker

The `Dockerfile` at the repository root produces one image that contains the
release binary and the built frontend. Migrations are embedded in the binary
(`sqlx::migrate!`), so nothing else is needed at runtime.

```sh
docker build -t muni .                       # or: make build-image
docker run --rm -p 127.0.0.1:8080:8080 --env-file /etc/muni/env muni
```

The image runs as the non-root user `muni`, sets `STATIC_DIR=/app/web`,
`BIND_ADDR=0.0.0.0:8080` and `APP_ENV=production`, and has a `HEALTHCHECK`
on `/healthz`. `tini` is the entrypoint so `docker stop` (SIGTERM) triggers a
graceful shutdown.

`docker-compose.prod.yml` is a worked single-host example with the app and
PostgreSQL; read its comments before using it. `docker-compose.yml` is for
development only.

### Without Docker

Build on a machine with Rust (1.85 or newer) and Node 22:

```sh
# frontend
cd web && npm ci && npm run build && cd ..        # -> web/dist

# backend
cargo build --release -p muni-server --bin muni-server   # -> target/release/muni-server
```

Copy `target/release/muni-server` and the `web/dist` directory to the host.
The binary links against glibc and rustls; it needs no OpenSSL and no shared
libraries beyond the C library. Run it with the environment from the table
above and `STATIC_DIR` pointing at the copied `dist` directory. A systemd unit
looks like this:

```ini
[Unit]
Description=Muni
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=muni
Group=muni
EnvironmentFile=/etc/muni/env
ExecStart=/usr/local/bin/muni-server
Restart=on-failure
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

### Startup sequence

1. Read and validate configuration; refuse insecure production settings.
2. Open the connection pool.
3. Run pending migrations from `server/migrations` (embedded). The
   `_sqlx_migrations` table records what has been applied. There is no
   separate migrate command and none is needed; a new release migrates
   itself when it starts. Migrations are additive and run inside
   transactions; a failed migration stops startup with the error in the log.
4. Start the job worker task (if `RUN_WORKER`).
5. Bind `BIND_ADDR` and serve.

Startup logs one line, `Muni starting`, with the environment, the email
transport label and the AI provider label, so you can confirm at a glance
that the process is running with the configuration you intended.

### Graceful shutdown

On SIGTERM or SIGINT the server stops accepting connections, lets in-flight
requests finish, signals the worker to stop (waiting up to 10 seconds for a
running job), closes the pool and exits. Give it at least 15 seconds
(`stop_grace_period`, `TimeoutStopSec`). Long-lived SSE connections are
closed; the client reconnects and fetches a fresh snapshot, which is the
normal recovery path and loses nothing.

## Health

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /healthz` | The process is up. Does not touch the database. Returns `200` with `{"status":"ok","database":"unchecked",...}`. | Liveness probe, container `HEALTHCHECK`. |
| `GET /readyz` | Runs `SELECT 1`. Returns `200` `{"status":"ready","database":"ok",...}` or **`503`** `{"status":"not ready","database":"unreachable",...}`. | Readiness probe, load-balancer target check, alerting. |

Both include `email_transport`, `ai_provider` and `uptime_secs`. Neither
requires authentication and neither returns anything sensitive.

## Logging

With `LOG_JSON=true` (the production default) each line is a JSON object with
a `level`, `target`, `message` and the span fields. Request logs carry
`method`, `path`, status and latency only. By construction the application
never logs entry bodies, votes, verification codes, session or invitation
tokens, email bodies, AI inputs or outputs, or which account wrote which
entry. Job failures are logged with the job id and kind but never the
payload. It is therefore safe to ship logs to a central system; the same
care applies there as to the proxy: do not add body capture in front of the
app.

## Enabling AI preparation

AI is off unless configured. To turn it on:

```sh
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# optional
ANTHROPIC_MODEL=claude-opus-5
```

Restart the server; `/healthz` then reports `"ai_provider":"anthropic"` and
the product shows the AI options. What this enables, and its limits:

- **Opt-in is per sprint and happens before collection.** A facilitator
  turns "AI processing" on when creating or editing a sprint in `draft`. Once
  collection has opened the sprint is `ai_locked` and the switch can no
  longer be turned on for that sprint (it can still be turned off). The
  workspace setting `ai_enabled_default` only pre-fills the switch for new
  sprints.
- **What is sent.** One request per grouping job, containing the sprint's
  entries as `{id, category, body, impact, might_help}`, i.e. the text people
  wrote plus opaque entry UUIDs. No account ids, emails, display names,
  attendance, timestamps or workspace information are included, and the
  request carries no metadata about who asked for it.
- **What comes back** is stored as a proposal tied to a hash of the exact
  input snapshot. A facilitator reviews it and applies or rejects it; it
  never changes the sprint on its own.
- **Failures** are visible to the facilitator (the AI job's status and a
  short error summary), and retried with backoff up to the job's attempt
  limit. HTTP 429/5xx from the provider are retried; other 4xx are not.
- The provider's response body is never logged (it echoes the input).

Set `AI_PROVIDER=none` and restart to disable again; existing proposals stay
readable, new ones cannot be requested. Note that anything already sent to the
provider is a copy retention cannot retract; the product's privacy note says
so.

## Enabling email

Email is required, not optional: sign-in is by a code sent to the person's
address, and invitations are links sent by email. Configure the `SMTP_*`
variables and `EMAIL_FROM` from the table above. Then check:

- Request a sign-in code from the sign-in page. This is sent **inline** during
  the request, so a misconfigured relay shows up immediately as an error to
  the user and in the log (`sending sign-in email`).
- Invitations and reminders go through the `jobs` table and are retried with
  exponential backoff (15 s, 30 s, 60 s, ... up to 5 attempts). Failures land
  in `jobs.last_error`; see [OPERATIONS.md](OPERATIONS.md#monitoring).

Links in those emails are built from `PUBLIC_ORIGIN`:
`{PUBLIC_ORIGIN}/invite/{token}` and `{PUBLIC_ORIGIN}/sprints/{id}`. If
`PUBLIC_ORIGIN` is wrong, the emails will point somewhere wrong even though
the site itself appears to work, so verify one invitation end to end after a
deployment.

## Checklist for a new environment

1. Create the database and role; grant the role the database.
2. Write the env file (mode `0600`, owned by the service user); never commit
   it.
3. Start the app; watch the log for `Muni starting` and `listening`.
4. `curl -s https://retro.example.com/readyz` returns `200`.
5. Sign in with a real address; receive the code.
6. Create a workspace, invite a second address, accept the invitation from
   the link in that email.
7. Open a sprint in two browsers and confirm that a change in one appears in
   the other without a reload (SSE through the proxy works).
8. Configure backups per [OPERATIONS.md](OPERATIONS.md).
