# Muni — developer shortcuts. Every target can also be run by hand; the
# commands are listed in docs/DEPLOYMENT.md and the README.

.PHONY: dev-db server web api-types check test build-image

## Start PostgreSQL and Mailpit in the background (docker compose).
dev-db:
	docker compose up -d db mailpit

## Run the backend with cargo (loads .env from the repository root).
server:
	cd server && cargo run

## Run the Vite dev server (proxies /api to 127.0.0.1:8080).
web:
	cd web && npm run dev

## Regenerate openapi.json from the server and the typed client from it.
api-types:
	cargo run -p muni-server --bin muni-openapi > openapi.json
	cd web && npm run api:types

## Formatting, lints and type checks for both halves.
check:
	cargo fmt --all --check
	cargo clippy --workspace -- -D warnings
	cd web && npm run typecheck && npm run lint

## Backend tests and the browser end-to-end suite.
test:
	cargo test --workspace
	cd web && npm run e2e

## Build the production container image.
build-image:
	docker build -t muni .
