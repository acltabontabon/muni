# Releasing Muni

How a version of Muni gets from `main` to act.munimuni.app and onto GitHub Releases: what the version
number promises, how to prepare and tag a release, what has to be configured, how to check it worked,
and what to do when it didn't.

Everything user-facing about a release lives in [`CHANGELOG.md`](../CHANGELOG.md). This file is for
maintainers.

## 1. One version, one source

The version is the `version` in the root [`package.json`](../package.json). Everything else follows it:

| where | how |
| --- | --- |
| The app (About, What's new, `<meta name="muni-version">`) | Built in by `web/vite.config.ts` |
| The Worker (`GET /api/version`, `GET /api/health`) | Bundled from the same file (`worker/src/index.ts`) |
| `web/package.json`, `web/package-lock.json`, `worker/package.json` | Kept equal; `scripts/release.mjs check` fails otherwise |
| The git tag | `v` + the version, e.g. `v1.2.0`; the release workflow refuses anything else |
| What's new, the GitHub release | The version's entry in `CHANGELOG.md` (`scripts/changelog.mjs` reads it) |

Nothing bumps the version automatically. A version and its notes are committed, reviewed and merged
before anyone tags them. CI runs `node scripts/release.mjs check` on every push, so `main` can always
be tagged at the version it declares.

## 2. What a version number promises

Muni uses [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`, with `-rc.N` for release
candidates. For Muni, the compatibility contract that MAJOR protects is:

- **Your data.** Accounts, workspaces, sprints, thoughts, themes, notes, experiments and recaps written
  by any earlier release of the same major stay readable and usable after updating. Database migrations
  only move forward, and within a major they're additive: the Worker that's live keeps working against
  the new schema.
- **Encrypted content and keys.** Envelopes (`e1`), passkey wraps (`p1`), device envelopes (`d1`) and
  recovery keys made by any earlier release of the same major still open. People never have to
  re-encrypt, re-enrol or start over because of an update.
- **Signing in.** Registered passkeys keep working on the same domain.
- **Open tabs and installed apps.** A client from an earlier release of the same major either keeps
  working or is told to reload — and loses nothing unsent when it does (`MIN_CLIENT_REVISION` in
  `worker/src/index.ts` answers `426 upgrade_required`; drafts and the send queue survive a reload).
  Raising that revision is compatible *because* of this guarantee.
- **Links people have been sent.** Invitations (`/invite#…`), team join links (`/join#…`) and links to
  sprints and pages keep working.
- **Running your own copy.** Updating a deployment is "migrate, then deploy" from any earlier release of
  the same major, with the same configuration variables and secrets (`docs/DEPLOYMENT.md`).

What is **not** part of the contract: the HTTP API under `/api/` is Muni's own client's, not a public
API (it changes together with the client, and old tabs are handled by the revision check above); the
look, layout, words and navigation of the app; the Durable Object's internal state; anything marked
experimental. A redesign is not a major release.

So:

- **MAJOR** — breaks something above. Examples: a migration that needs the new Worker deployed first and
  can't run under the previous one; content or keys an earlier client can't open with no automatic path;
  passkeys that must be registered again; removing a feature whose data people would lose; new
  required configuration for self-hosters. The changelog entry says what people and operators must do.
- **MINOR** — something new that keeps the contract: a feature, a setting, an additive migration.
- **PATCH** — fixes, performance, copy and security fixes that keep the contract.
- **Prerelease** (`1.3.0-rc.1`) — a candidate that runs in production but hasn't been verified enough
  to carry the plain number. GitHub marks it as a prerelease.

### Why the first release is `1.0.0-rc.1`

The product is feature-complete and the contract above holds, but passkeys are the only way into an
account and they unlock encrypted writing. That path has been tested with virtual authenticators and
real browsers, not yet on physical phones, platform authenticators and password managers
(`docs/PASSKEYS.md` §8). Losing access there means losing an account, so 1.0.0 waits for that device
check. Promoting is a normal release: `prepare 1.0.0`, a short changelog entry, tag.

## 3. Preparing a release

1. As changes land, add user-facing notes under `## [Unreleased]` in `CHANGELOG.md`: what people can
   now do, what got easier, what was fixed, and any action they must take. Leave out refactors,
   dependency updates, file names and commit hashes. Start the entry with a short paragraph, then
   `### Highlights`, `### Improved`, `### Fixed`, `### Breaking changes` — only the sections that help.
   The first section's bullets can lead with a **bold phrase**: the app shows those as highlights.
2. On a branch, choose the number (section 2) and run:

   ```bash
   node scripts/release.mjs prepare 1.2.0            # sets every version, dates the Unreleased notes
   node scripts/release.mjs check                    # versions, changelog
   node scripts/release.mjs notes v1.2.0             # preview the GitHub release body
   ```

   The date is today's (`--date YYYY-MM-DD` to set another: the day you'll tag).
3. If the app looks different enough, re-record the demo (`docs/demo/README.md`). Every release attaches
   `docs/demo/muni-demo.gif` and `.mp4` as they are committed; nothing is recorded during a release.
4. Open a pull request, let CI pass, merge.
5. Tag the merged commit on `main` and push the tag — this is the release:

   ```bash
   git switch main && git pull
   git tag -a v1.2.0 -m "Muni 1.2.0"
   git push origin v1.2.0
   ```

## 4. What the release workflow does

`.github/workflows/release.yml` runs on a pushed `v*` tag, one release at a time
(`concurrency: production-release`, never cancelled mid-deploy):

1. **check** (no secrets): the tag is `v` + the committed version, `CHANGELOG.md` has a dated entry for
   it, the demo files exist, and the tagged commit is on `main`. Then the web app's typecheck, lint,
   tests and build, and the Worker's typecheck and tests.
2. **deploy** (the `production` environment): asks production what it's running. If it's already this
   version *and* this commit, it skips to verification (a re-run). If it's a later version, it stops:
   going back is a rollback, not a release. Otherwise it builds the tagged commit, applies D1
   migrations (retrying once), and deploys the Worker — which serves the API and the app together, so
   they change in one step — stamped with the commit (`--var MUNI_COMMIT:<sha>`) and tagged with the
   version. Then it checks production from outside until `/api/version` reports this version and
   commit, `/api/health` reaches the database, and the page, its scripts and the service worker all
   belong to the same build (`scripts/verify-deploy.mjs`, up to 4 minutes).
3. **publish** (the only job that can write to the repository): builds the notes from the changelog
   entry, creates the release as a draft with the demo attached, then publishes it — marked prerelease
   for `-rc` versions, latest otherwise — and checks the demo's URL resolves. On a re-run it updates the
   existing release instead of creating another.

If a job fails, nothing after it runs: a release is never published for a deploy that didn't verify.

The marketing site (`site/`, munimuni.app) is separate: `pages.yml` publishes it to GitHub Pages
whenever `site/` changes on `main`. It has no version.

There is no preview deployment of the app. Pull requests get the full check suite in `ci.yml` with a
read-only token and no secrets; try a change locally against `wrangler dev` (README).

## 5. Configuration

### GitHub

- **Environment `production`** (Settings → Environments):
  - *Deployment branches and tags*: selected, with the tag rule `v*` only. The workflow's deploy job
    can't run for anything else.
  - *Secrets*: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
  - *Variables*: `MUNI_DOMAIN` (e.g. `act.munimuni.app`), `MUNI_D1_DATABASE_ID`, `MUNI_EMAIL_FROM` — the
    same values as the local production config (`worker/scripts/production-config.mjs`). They aren't
    secret.
  - Optional: *Required reviewers* (yourself) to approve each production deploy.
- Optional but recommended: a tag ruleset for `v*` (Settings → Rules) that only you can create, update
  or delete, so nobody else with write access can start a release.
- The workflow's own permissions are minimal: `contents: read` everywhere, `contents: write` only for
  the publish job. Pull requests never see the environment's secrets.

### Cloudflare

- An **API token** scoped to the one account (My Profile → API Tokens → Create Token): start from the
  *Edit Cloudflare Workers* template, restrict it to this account and the app's zone, and add
  *Account → D1 → Edit*. Not a Global API Key. Give it an expiry and rotate it with the GitHub secret.
- The **D1 database** and the Worker's **secrets** (`RESEND_API_KEY`) already exist from the first
  deployment (`docs/DEPLOYMENT.md`); a deploy keeps secrets as they are.
- Nothing else: the Durable Object class and the cron trigger come from the rendered Wrangler config.

## 6. Checking a release

The workflow does this, and anyone can repeat it:

```bash
node scripts/verify-deploy.mjs https://act.munimuni.app 1.2.0 <commit sha>
```

Then open the app: About shows the version and What's new shows the entry. The GitHub release has the
right title, prerelease flag and date, and the demo plays in its body.

## 7. When something goes wrong

- **`check` failed.** Nothing was deployed. If it was a flaky runner, re-run the job. If the tag was
  wrong (a mismatched version, a commit not on `main`), delete the tag
  (`git push --delete origin v1.2.0 && git tag -d v1.2.0`), fix it on `main` and tag again. Once a tag
  has been deployed or published, don't move it: release the fix as the next patch or `-rc.N+1`.
- **Missing configuration.** The deploy job says what's missing before touching anything. Add it (section
  5) and *Re-run failed jobs*.
- **Migrations failed.** The live Worker is untouched and already-applied migrations won't run again.
  Fix the cause (usually transient: re-run), or fix the migration on `main` and release the next patch.
- **Deployed, but verification failed.** Production may be running the new Worker. Read the failed
  check. If it's propagation, re-run: the deploy is skipped if it's live, and verification runs again.
  If the release is broken, roll back (below), then fix forward with a new patch tag. No GitHub release
  exists yet, so there's nothing to retract.
- **Publishing failed.** Production is fine. *Re-run failed jobs*: the deploy job sees the release is
  live and skips straight to verification; publish creates or updates the release.
- **Rolling back.** From a checkout with the production config (`worker/`):

  ```bash
  pnpm exec wrangler deployments list --config wrangler.production.jsonc
  pnpm exec wrangler rollback <version-id> --config wrangler.production.jsonc --message "Back to 1.1.3"
  ```

  or Cloudflare dashboard → Workers → muni → Deployments → Rollback. That restores the previous Worker
  *and* the app it served; D1 migrations are not reversed, which is fine because they're additive. Then
  mark the GitHub release as broken in its notes (or delete it) and release a fix. Restoring data with
  D1 Time Travel (`wrangler d1 time-travel restore`) loses everything written since; it's for
  emergencies only, and the bookmark to use is in the deployment's history.
- **A mistake in published notes.** Fix `CHANGELOG.md` on `main`, and edit the release body on GitHub
  to match. The app shows the corrected text from the next release on.

## 8. How people get the new version

The app is one content-hashed script and stylesheet, cached for good, plus a service worker checked
without cache (`web/public/_headers`). After a deploy, a person's open tab keeps working: its service
worker precached every asset its build needs. The new service worker waits; Muni offers *Update* when
it's safe, and holds it back during a live retro, while a thought is sending, or while unsent writing
exists only in that tab (`UpdateNotice` in `web/src/ui/status.tsx`). If a release raises the minimum
client revision, an old tab's requests are refused with a reload prompt, and its drafts and send queue
survive the reload. World fonts are fetched when a character is chosen; an old tab asking for a font a
new build renamed falls back to a system face until it updates.
