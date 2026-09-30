# Releasing Muni

This guide is for maintainers. It covers what a version number promises, how to prepare and tag a release, how the release workflow and its configuration work, and what to do when a release goes wrong. User-facing notes live in [`CHANGELOG.md`](../CHANGELOG.md).

Pushing a `v*` tag is the only way Muni reaches production (act.munimuni.app) and GitHub Releases.

## One version, one source

The version is the `version` in the root [`package.json`](../package.json). Everything else follows it:

| Where | How |
| --- | --- |
| The app (About, What's new, `<meta name="muni-version">`) | Built in by `web/vite.config.ts` |
| The Worker (`GET /api/version`, `GET /api/health`) | Bundled from the same file (`worker/src/index.ts`) |
| `web/package.json`, `web/package-lock.json`, `worker/package.json` | Kept equal to the root version |
| The git tag | `v` + the version, such as `v1.2.0` |
| What's new and the GitHub release | The version's entry in `CHANGELOG.md` |

Nothing bumps the version automatically. A version and its notes are committed, reviewed and merged before anyone tags them.

`node scripts/release.mjs check` runs in CI on every pull request and every push to `main`, and again on every tag. It fails unless:

- the versions above agree and `CHANGELOG.md` has a valid, correctly ordered entry for the version;
- the web client's `CLIENT_REVISION` equals the Worker's `MIN_CLIENT_REVISION`;
- the four demo files exist and are each under 10 MB.

So `main` can always be tagged at the version it declares.

## What a version number promises

Muni uses [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`, with `-rc.N` for release candidates. A MAJOR version protects this contract:

- **Your data.** Accounts, workspaces, sprints, thoughts, themes, notes, experiments and recaps written by any earlier release of the same major stay readable after updating. Migrations only move forward, and within a major they are additive, so the live Worker keeps working against the new schema.
- **Encrypted content and keys.** Envelopes (`e1`), sprint-key wraps (`w1`), passkey wraps (`p1`), device envelopes (`d1`) and recovery keys (`r1`) made by any earlier release of the same major still open. Nobody has to re-encrypt or re-enrol because of an update.
- **Signing in.** Registered passkeys keep working on the same domain.
- **Open tabs and installed apps.** A client from an earlier release either keeps working or is told to reload, and loses nothing unsent. `MIN_CLIENT_REVISION` in `worker/src/index.ts` makes the Worker answer `426 upgrade_required`; drafts and the send queue survive the reload. Raising the revision is compatible because of this.
- **Links people have been sent.** Invitations (`/invite#…`), team join links (`/join#…`) and links to sprints and pages keep working.
- **Self-hosting.** Updating a deployment is "migrate, then deploy" from any earlier release of the same major, with the same variables and secrets ([deployment.md](deployment.md)).

Not part of the contract: the HTTP API under `/api/` (it is Muni's own client's and changes with it), the look, layout, wording and navigation of the app, the Durable Object's internal state, and anything marked experimental. A redesign is not a major release.

Choose the number by what changed:

- **MAJOR** breaks something above. Examples: a migration that needs the new Worker deployed first; content or keys an earlier client cannot open; passkeys that must be registered again; removing a feature whose data people would lose; new required configuration for self-hosters. The changelog entry says what people and operators must do.
- **MINOR** adds something and keeps the contract: a feature, a setting, an additive migration.
- **PATCH** fixes bugs, performance, copy or security issues and keeps the contract.
- **Prerelease** (`1.3.0-rc.1`) is a candidate that runs in production but is not yet verified enough to carry the plain number. GitHub marks it as a prerelease.

## Preparing a release

1. As changes land, add user-facing notes under `## [Unreleased]` in `CHANGELOG.md`. The file follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/): bullets under `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` and `### Security`, in that order, only the ones you need.
   - Say what people can now do, what got easier or was fixed, and what they must do after updating.
   - A breaking change goes under Changed or Removed and starts with **Breaking:**.
   - Leave out refactors, dependency updates, file names and commit hashes.
   - A bullet can lead with a **bold phrase**. When a release's first section does, the app shows those as highlights.

   `scripts/changelog.mjs` rejects anything else: other headings, free text, empty sections, a wrong order, versions out of order and stale link references.
2. On a branch, choose the number ([section 2](#what-a-version-number-promises)) and run:

   ```bash
   node scripts/release.mjs prepare 1.2.0    # sets every version, dates the Unreleased notes, updates the links
   node scripts/release.mjs check
   node scripts/release.mjs notes v1.2.0     # previews the GitHub release body
   ```

   The date is today's. Pass `--date YYYY-MM-DD` to use the day you will tag.
3. If the app looks different enough, re-record the demo and the journey film ([demo/README.md](demo/README.md)). Every release attaches the four committed files in `docs/demo/` as they are; nothing is recorded during a release.
4. Open a pull request, let CI pass and merge.
5. Tag the merged commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag -a v1.2.0 -m "Muni 1.2.0"
   git push origin v1.2.0
   ```

## What the release workflow does

`.github/workflows/release.yml` runs on a pushed `v*` tag, one release at a time (`concurrency: production-release`, never cancelled mid-deploy). It runs only in `acltabontabon/muni`. If a job fails, nothing after it runs, so a release is never published for a deploy that did not verify.

1. **check** (no secrets). Runs `node scripts/release.mjs check --tag <tag>` and the changelog tests. Confirms the tagged commit is on `main`. Then runs the web app's typecheck, lint, tests and build, and the Worker's typecheck and tests.
2. **deploy** (the `production` environment).
   - Asks production what it runs. If it already runs this version and commit, the workflow skips to verification (a re-run). If it runs a later version, the workflow stops: going back is a [rollback](#when-something-goes-wrong), not a release. The exception is a later version whose tag was deleted (a withdrawn release); this release then replaces it.
   - Otherwise it builds the tagged commit, records a D1 Time Travel bookmark (a failure here only warns), applies D1 migrations (retrying once) and deploys the Worker. The Worker serves the API and the app together, so they change in one step. The deploy is stamped with the commit (`--var MUNI_COMMIT:<sha>`) and tagged with the version.
   - Finally it runs `scripts/verify-deploy.mjs` for up to 4 minutes, until `/api/version` reports this version and commit, `/api/health` reaches the database, and the page, its scripts and the service worker all belong to the same build.
3. **publish** (the only job with `contents: write`). Builds the release body from `scripts/release.mjs notes`: the demo, a line on what Muni is and where to open it, a note on a release candidate, the version's changelog entry and the comparison with the previous tag. Creates the release as a draft with the four demo files attached, then publishes it (marked prerelease for `-rc` versions, latest otherwise) and checks that the demo GIF's URL resolves. On a re-run it updates the existing release instead of creating another.

Two other workflows run alongside:

- `watch.yml` checks `/api/health` and `/api/version` every 30 minutes and fails the run (GitHub emails the owner) if production is unhealthy twice in a row.
- `pages.yml` publishes the marketing site (`site/`, munimuni.app) to GitHub Pages whenever `site/` changes on `main`. The site has no version.

There is no preview deployment. Pull requests run the checks in `ci.yml` with a read-only token and no secrets; try a change locally against `wrangler dev` (see the README).

## Configuration

### GitHub

- **Environment `production`** (Settings, Environments):
  - *Deployment branches and tags*: selected, with the single rule `v*`, so the deploy job cannot run for anything else.
  - *Secrets*: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  - *Variables*: `MUNI_DOMAIN` (such as `act.munimuni.app`), `MUNI_D1_DATABASE_ID` and `MUNI_EMAIL_FROM`, the same values as in the local production config ([deployment.md](deployment.md)). Optionally `MUNI_EMAIL_DAILY_LIMIT` (80 when unset). Variables are not secret.
  - Optional: *Required reviewers* to approve each production deploy.
- Recommended: a tag ruleset for `v*` (Settings, Rules) that only you can create, update or delete, so nobody else with write access can start a release.
- The workflow's permissions are `contents: read`, except `contents: write` for the publish job. Pull requests never see the environment's secrets.
- `watch.yml` reads the repository variable `MUNI_DOMAIN` if set, otherwise uses act.munimuni.app. It cannot read the environment's variable.

### Cloudflare

- An **API token** scoped to one account (My Profile, API Tokens, Create Token). Start from the *Edit Cloudflare Workers* template, restrict it to this account and the app's zone, and add *Account, D1, Edit*. Do not use a Global API Key. Give it an expiry and rotate it together with the GitHub secret.
- The **D1 database** and the Worker's **secret** (`RESEND_API_KEY`, or `BREVO_API_KEY`) already exist from the first deployment ([deployment.md](deployment.md)). A deploy keeps secrets as they are.
- Nothing else. The Durable Object class, the cron trigger and the edge rate limiter come from the rendered Wrangler config.

## Checking a release

The workflow does this; anyone can repeat it:

```bash
node scripts/verify-deploy.mjs https://act.munimuni.app 1.2.0 <commit sha>
```

Then open the app: About shows the version and What's new shows the entry. On GitHub, check the release's title, prerelease flag and date, and that the demo plays in its body.

## When something goes wrong

- **`check` failed.** Nothing was deployed. If a runner was flaky, re-run the job. If the tag was wrong (a mismatched version, a commit not on `main`), delete it with `git push --delete origin v1.2.0 && git tag -d v1.2.0`, fix `main` and tag again. Once a tag has been deployed or published, do not move it: release the fix as the next patch or `-rc.N+1`.
- **Missing configuration.** The deploy job names what is missing before it changes anything. Add it ([section 5](#configuration)) and re-run the failed jobs.
- **Migrations failed.** The live Worker is untouched, and migrations that were applied do not run again. Re-run if the cause was transient. Otherwise fix the migration on `main` and release the next patch. The job log and summary show the Time Travel bookmark recorded just before migrating.
- **Deployed, but verification failed.** Production may already run the new Worker. Read the failed check. If it is propagation, re-run: a live deploy is skipped and verification runs again. If the release is broken, roll back (below), then fix forward with a new patch tag. No GitHub release exists yet, so there is nothing to retract.
- **Publishing failed.** Production is fine. Re-run the failed jobs: deploy sees the release is live and skips to verification, and publish creates or updates the release.
- **`watch.yml` reports production unhealthy.** Open `/api/health` and `/api/version`, check the Worker in the Cloudflare dashboard, and roll back if the last deploy caused it.
- **Rolling back.** From `worker/` with the production config:

  ```bash
  pnpm exec wrangler deployments list --config wrangler.production.jsonc
  pnpm exec wrangler rollback <version-id> --config wrangler.production.jsonc --message "Back to 1.1.3"
  ```

  You can also use Cloudflare dashboard, Workers, muni, Deployments, Rollback. This restores the previous Worker and the app it served. D1 migrations are not reversed, which is safe because they are additive. Then mark the GitHub release as broken in its notes (or delete it) and release a fix.
- **Restoring data.** D1 Time Travel loses everything written since the bookmark, so use it only in an emergency. Find a bookmark for a moment just before the deploy, then restore it:

  ```bash
  pnpm exec wrangler d1 time-travel info DB --timestamp=2026-10-01T09:00:00Z --config wrangler.production.jsonc
  pnpm exec wrangler d1 time-travel restore DB --bookmark=<bookmark> --config wrangler.production.jsonc
  ```

- **Withdrawing a release.** Delete it with its tag: `gh release delete v1.2.0 --cleanup-tag`. The next release then replaces the version production still runs.
- **A mistake in published notes.** Fix `CHANGELOG.md` on `main` and edit the release body on GitHub to match. The app shows the corrected text from the next release.

## How people get the new version

The app is one content-hashed script and stylesheet, cached indefinitely, plus a service worker that is always re-checked (`web/public/_headers`). After a deploy, an open tab keeps working because its service worker precached every asset its build needs.

The new service worker waits. Muni offers *Update* when it is safe and holds it back during a live retro, while a thought is sending, and while unsent writing exists only in that tab (`UpdateNotice` in `web/src/ui/status.tsx`).

If a release raises the minimum client revision, an old tab's requests are refused with a reload prompt. Its drafts and send queue survive the reload.
