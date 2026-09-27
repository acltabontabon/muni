# Muni

**Keep the thought. Bring it to the conversation.**

Muni is a sprint-retrospective app. Capture what matters during the sprint while it's fresh, then have a real conversation about what happened and what to change.

Try it at [act.munimuni.app](https://act.munimuni.app).

## How it works

- **Private capture.** Your thoughts stay hidden until collection closes — even from the facilitator.
- **Blind reveal.** When collection closes, all thoughts appear at once, unnamed and in random order.
- **Themes and voting.** The facilitator groups thoughts into themes; everyone votes on what to discuss first.
- **Live retrospective.** A gentle, paced conversation where people speak up and one to three experiments come back first next sprint.
- **Offline-first.** Works on planes, trains, or anywhere — drafts are kept on your device.

Sprint content is end-to-end encrypted: the backend never sees what you write, only that you wrote something. See [`docs/privacy-claims.md`](docs/privacy-claims.md) for details.

## What you should know

- **Early software.** Built by one person; expect the data model and API to change.
- **Passkeys only.** No email, password, or social sign-in — use a passkey to sign in. Losing all your passkeys means losing access to your account.
- **Cloudflare only.** Runs on Cloudflare Workers; no other deployments are supported.
- **English only** for now.
- **Mostly Chromium.** Works on Safari and Firefox, but tested mainly on Chromium browsers.
- **Encryption limits.** End-to-end encrypted sprints haven't been independently audited. Who wrote what is still recorded, so analysis of writing patterns could reveal authors in small teams.
- **No account deletion yet.** You can't delete your account or purge finished sprints yourself.

## For contributors and hosters

- **Contributing:** Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first.
- **Security:** Report vulnerabilities privately in [`SECURITY.md`](SECURITY.md).
- **Self-hosting:** See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- **Development:** Node 22+, pnpm 10. Run `pnpm install && pnpm migrate:local && pnpm dev` in `worker/`, and `npm run dev` in `web/`. No Cloudflare account needed for local development.

## License

Apache License 2.0 — see [`LICENSE`](LICENSE). The Muni name and logo are covered in [`TRADEMARKS.md`](TRADEMARKS.md).
