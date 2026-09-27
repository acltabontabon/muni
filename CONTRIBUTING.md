# Contributing to Muni

Thanks for your interest. Muni is maintained by one person in their own time, so please read this
before putting work into a change.

## What to expect

- Responses are best-effort. An issue or pull request may wait a while, and some will be declined —
  usually because a change doesn't fit the product's direction or would be hard to maintain alone.
  That's not a judgement of the work.
- For anything larger than a small fix, open an issue first and describe the problem you want to
  solve. It saves you from building something that can't be merged.
- There is no release schedule. Versions are tagged from `main` when they're ready ([`docs/RELEASING.md`](docs/RELEASING.md)).
- If your change is visible to people using Muni, add a line under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), written for them.

## Reporting bugs

Open an issue with what you did, what you expected and what happened, plus browser and device if it
is a UI problem. Please don't include real names, emails or retro content — use synthetic data.
Security problems go through [`SECURITY.md`](SECURITY.md), never a public issue.

## Making a change

1. Set up locally as described in the [README](README.md#run-it-locally).
2. Keep the change focused, and match the surrounding code's style and comment density.
3. Add or update tests: `worker/test/` runs against the real Workers runtime; `web/` has unit
   tests and browser end-to-end scripts in `web/e2e/`.
4. Run the checks before opening a pull request:

   ```bash
   cd worker && pnpm typecheck && pnpm test
   cd web && npm run typecheck && npm run lint && npm test && npm run build
   ```

Things that matter here more than usual:

- **The privacy boundary.** Never add author, voter, timestamp or network fields to a shared
  response, and keep sealed collection sealed for everyone, facilitators included. See the rules in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#the-privacy-boundary); the privacy tests enforce
  them.
- **Honest wording.** User-facing claims about privacy, security or retention must match what the
  code does. [`docs/privacy-claims.md`](docs/privacy-claims.md) lists each claim with its evidence;
  update it with the claim.
- **Accessibility.** Keyboard use, visible focus, text contrast of at least 4.5:1, and
  `prefers-reduced-motion` respected.
- **Platform.** Muni runs on Cloudflare Workers, D1 and Durable Objects. Changes that add services
  or another backend need discussion first.

## Licensing of contributions

Muni is licensed under the Apache License 2.0. Unless you say otherwise, a contribution you submit
is under the same license (section 5 of the license). Only submit work you have the right to
license this way.

## Conduct

Be kind and assume good faith. Harassment or personal attacks aren't welcome in issues, pull
requests or anywhere else in the project, and the maintainer may remove them.
