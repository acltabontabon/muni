# Contributing to Muni

Thanks for your interest. One person maintains Muni in their own time, so please read this before
putting work into a change.

## What to expect

- Responses are best-effort. Some issues and pull requests are declined, usually because a change
  does not fit the product's direction or is hard to maintain alone. That is not a judgement of
  the work.
- For anything larger than a small fix, open an issue first and describe the problem. It saves you
  from building something that cannot be merged.
- Versions are tagged from `main` when ready, with no fixed schedule ([`docs/releasing.md`](docs/releasing.md)).

## Reporting bugs

Open an issue with what you did, what you expected and what happened, plus browser and device for a
UI problem. Use synthetic data, never real names, emails or retro content. Report security problems
through [`SECURITY.md`](SECURITY.md), never a public issue.

## Development setup

You need Node 22+ and pnpm 10. No Cloudflare account is required.

```bash
# Build the web app; the Worker serves it
cd web && npm ci && npm run build

# Apply migrations to a local database and start the Worker
cd ../worker && pnpm install && pnpm migrate:local && pnpm dev
```

Open http://localhost:8787. For live reload, also run `npm run dev` in `web/` and open
http://localhost:5173; it proxies `/api` to the Worker. [`docs/architecture.md`](docs/architecture.md)
explains how the pieces fit.

## Checks

Run these before opening a pull request. CI runs the same ones.

```bash
(cd worker && pnpm typecheck && pnpm test)
(cd web && npm run typecheck && npm run lint && npm test && npm run build)
node --test scripts/*.test.mjs && node scripts/release.mjs check
```

- `worker/test/` runs against the real Workers runtime.
- `web/` has unit tests. Browser end-to-end suites live in `web/e2e/` and run with
  `MUNI_URL=http://localhost:8787 node scripts/e2e.mjs [suite…]` against a running Worker that
  serves a production build; with no suite names, it runs everything CI runs.

- `web/e2e/experience.mjs` covers everyday navigation, search, prompts and draft preservation.
  Set `SHOTS=../docs/screenshots` from `web/` to refresh the real app screenshots; use only a local
  development Worker, because the script creates fictional accounts and content.
- The static marketing page has its own suite. Serve `site/` on a local port, then run
  `cd web && SITE_URL=http://localhost:4322 node e2e/site.mjs` for responsive layout and the
  original site's retro walkthrough, keyboard and motion behavior. It runs separately from the app suites.

## Pull requests

- Keep the change focused and match the surrounding code's style and comment density.
- Add or update tests.
- If people using Muni will notice the change, add a line for them under `## [Unreleased]` in
  [`CHANGELOG.md`](CHANGELOG.md).

Some rules matter more than usual:

- **Privacy boundary.** Never add author, voter, timestamp or network fields to a shared response,
  and keep collection sealed for everyone, facilitators included. See
  [`docs/architecture.md`](docs/architecture.md#the-privacy-boundary); the privacy tests enforce it.
- **Honest wording.** User-facing claims about privacy, security or retention must match the code.
  Update [`docs/privacy-claims.md`](docs/privacy-claims.md) with the claim.
- **Accessibility.** Support keyboard use, visible focus, a text contrast of at least 4.5:1 and
  `prefers-reduced-motion`.
- **Platform.** Muni runs on Cloudflare Workers, D1 and Durable Objects. Discuss changes that add a
  service or another backend first.

## Licensing of contributions

Muni is licensed under the Apache License 2.0. Unless you say otherwise, a contribution you submit
is under the same license (section 5 of the license). Only submit work you have the right to
license this way.

## Conduct

Be kind and assume good faith. Harassment and personal attacks are not welcome in issues, pull
requests or anywhere else in the project, and the maintainer may remove them.
