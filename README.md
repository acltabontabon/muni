# Muni

**Keep the thought. Bring it to the conversation.**

Muni is a sprint-retrospective app for scrum teams. Everyone jots down what mattered while the sprint is happening, in private, so the retro starts from what people actually noticed, not from what they can remember on the day. Then the team talks it through and leaves with one to three experiments to try next sprint.

Try it at [act.munimuni.app](https://act.munimuni.app). You sign in with a passkey, so there are no passwords. Muni is a 1.0 release candidate, built by one person.

<p align="center"><a href="docs/demo/muni-demo.mp4"><img src="docs/demo/muni-demo.gif" alt="Muni in 75 seconds: a sprint from the first thought, written on a laptop and on a phone, to closing collection, gathering thoughts into themes, the retro's four steps with the stage and a phone side by side, and an experiment its owner says yes to." width="720"></a></p>

<p align="center"><sub>The retro from both sides, in 30 seconds: <a href="docs/demo/muni-journey.mp4">muni-journey.mp4</a></sub></p>

## How it works

1. **During the sprint: capture.** Each person adds thoughts as they happen, from a laptop or a phone, even offline (they're sent when you're back). Nobody else can see them, not even the facilitator.
2. **Close collection: the reveal.** The facilitator closes collection and every thought appears at once, unnamed and in random order. The team reads them before the retro, so nobody is swayed by who wrote what.
3. **Sort and vote.** The facilitator can gather thoughts into themes. When there are themes, everyone votes on what to talk about first.
4. **The retro, in four steps.** Look back, choose, talk, agree. It runs on a shared screen with everyone's phone alongside, so quick private check-ins and additions let quieter people take part without having to speak first.
5. **Next sprint.** The one to three experiments the team agreed on come back first, so you see whether they were tried.

## Security and privacy

- Thoughts, themes, experiments and the recap are encrypted on your team's devices before they reach Muni's servers, which don't hold the keys. A facilitator can set a sprint up without encryption, and that sprint says so.
- The server can still see names, dates, categories and who wrote what (teammates never do). In a small team the wording itself can give an author away.
- The encryption hasn't been independently audited.

Each claim and its evidence: [`docs/privacy-claims.md`](docs/privacy-claims.md). How it works: [`docs/encryption.md`](docs/encryption.md). Report vulnerabilities privately via [`SECURITY.md`](SECURITY.md).

## Contributing

Setup, checks and pull requests are in [`CONTRIBUTING.md`](CONTRIBUTING.md); no Cloudflare account is needed to develop. To host Muni yourself (Cloudflare Workers only), see [`docs/deployment.md`](docs/deployment.md). All other docs are indexed in [`docs/`](docs/README.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE).
