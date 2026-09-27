#!/usr/bin/env node
/**
 * Release helpers. The version lives in one place — the root package.json — and everything else is
 * checked against it or derived from it. See docs/RELEASING.md.
 *
 *   node scripts/release.mjs check [--tag vX.Y.Z]   versions agree, CHANGELOG has the entry (and the
 *                                                    tag matches, the demo exists, when --tag is given)
 *   node scripts/release.mjs prepare X.Y.Z [--date YYYY-MM-DD]
 *                                                    sets every version and turns Unreleased into X.Y.Z
 *   node scripts/release.mjs notes vX.Y.Z           the GitHub release notes, from the CHANGELOG entry
 *   node scripts/release.mjs version                prints the version
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isPrerelease, markdown, parseChangelog, SEMVER } from './changelog.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const path = (p) => `${root}${p}`
const readJson = (p) => JSON.parse(readFileSync(path(p), 'utf8'))

/** Files whose version must equal the root package.json's. */
export const SYNCED = ['web/package.json', 'worker/package.json']
/** The demo attached to every release (docs/demo/README.md explains how it's made). */
export const DEMO = { gif: 'docs/demo/muni-demo.gif', mp4: 'docs/demo/muni-demo.mp4' }
const DEMO_MAX_BYTES = 10 * 1024 * 1024

export function project() {
  const pkg = readJson('package.json')
  const repo = String(pkg.repository ?? '').replace(/^github:/, '')
  return { version: pkg.version, repo, app: pkg.config?.appUrl }
}

/** Every problem that would make this checkout unfit to release (or, with a tag, to release as that tag). */
export function problems({ tag } = {}) {
  const out = []
  const { version, repo, app } = project()
  if (!SEMVER.test(version ?? '')) out.push(`package.json version “${version}” isn’t a semantic version (MAJOR.MINOR.PATCH)`)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) out.push('package.json needs "repository": "github:owner/name"')
  if (!/^https:\/\//.test(app ?? '')) out.push('package.json needs "config": { "appUrl": "https://…" }')
  for (const f of SYNCED) {
    const v = readJson(f).version
    if (v !== version) out.push(`${f} has version ${v}; the root package.json has ${version} (run: node scripts/release.mjs prepare ${version})`)
  }
  const lock = readJson('web/package-lock.json')
  if (lock.version !== version || lock.packages?.['']?.version !== version) out.push(`web/package-lock.json still says ${lock.version}; run npm install --package-lock-only in web/`)
  let log
  try {
    log = parseChangelog(readFileSync(path('CHANGELOG.md'), 'utf8'))
  } catch (e) {
    out.push(e.message)
    return out
  }
  const entry = log.releases.find((r) => r.version === version)
  if (!entry) out.push(`CHANGELOG.md has no “## [${version}] - YYYY-MM-DD” entry`)
  else {
    if (!entry.intro.length) out.push(`CHANGELOG.md: ${version} needs an introduction paragraph`)
    if (!entry.sections.some((s) => s.items.length)) out.push(`CHANGELOG.md: ${version} lists no changes`)
    if (log.releases[0]?.version !== version) out.push(`CHANGELOG.md: ${version} should be the newest release (first below Unreleased)`)
  }
  const dates = log.releases.map((r) => r.date)
  if (dates.some((d, i) => i && d > dates[i - 1])) out.push('CHANGELOG.md: releases must be newest first')
  if (tag !== undefined) {
    if (!/^v\d/.test(tag) || !SEMVER.test(tag.slice(1))) out.push(`tag “${tag}” isn’t vMAJOR.MINOR.PATCH`)
    else if (tag !== `v${version}`) out.push(`tag ${tag} doesn’t match the committed version ${version}`)
    if (entry && entry.date > new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10)) out.push(`CHANGELOG.md dates ${version} ${entry.date}, which hasn’t happened yet`)
    for (const f of Object.values(DEMO)) {
      if (!existsSync(path(f))) out.push(`${f} is missing (docs/demo/README.md)`)
      else if (statSync(path(f)).size > DEMO_MAX_BYTES) out.push(`${f} is over ${DEMO_MAX_BYTES / 1024 / 1024} MB`)
    }
  }
  return out
}

/** The GitHub release body: the CHANGELOG entry, with the demo and the way to the app. */
export function releaseNotes(tag) {
  const { version, repo, app } = project()
  if (tag !== `v${version}`) throw new Error(`tag ${tag} doesn’t match the committed version ${version}`)
  const entry = parseChangelog(readFileSync(path('CHANGELOG.md'), 'utf8')).releases.find((r) => r.version === version)
  if (!entry) throw new Error(`CHANGELOG.md has no entry for ${version}`)
  const asset = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`
  return [
    `<p align="center"><a href="${asset('muni-demo.mp4')}"><img src="${asset('muni-demo.gif')}" alt="A short walkthrough of Muni: writing a thought during the sprint, then the team’s retro." width="720"></a></p>`,
    '',
    ...entry.intro.flatMap((p) => [markdown(p), '']),
    ...entry.sections.flatMap((sec) => [`### ${sec.title}`, '', ...sec.items.map((i) => `- ${markdown(i)}`), '']),
    `**Open Muni:** ${app}  `,
    `**Every release:** [CHANGELOG.md](https://github.com/${repo}/blob/${tag}/CHANGELOG.md)`,
    '',
  ].join('\n')
}

/** Sets every version to `v` and dates the Unreleased notes as that release. */
function prepare(v, date) {
  if (!SEMVER.test(v)) throw new Error(`“${v}” isn’t a semantic version`)
  for (const f of ['package.json', ...SYNCED]) {
    const text = readFileSync(path(f), 'utf8')
    writeFileSync(path(f), text.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`))
  }
  const lockPath = 'web/package-lock.json'
  const lock = readJson(lockPath)
  lock.version = v
  if (lock.packages?.['']) lock.packages[''].version = v
  writeFileSync(path(lockPath), JSON.stringify(lock, null, 2) + '\n')
  const log = readFileSync(path('CHANGELOG.md'), 'utf8')
  const { unreleased, releases } = parseChangelog(log)
  if (releases.some((r) => r.version === v)) return console.log(`CHANGELOG.md already has ${v}; versions set.`)
  if (!unreleased.trim()) throw new Error('CHANGELOG.md: write the release under “## [Unreleased]” first')
  writeFileSync(path('CHANGELOG.md'), log.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n## [${v}] - ${date}\n`))
  console.log(`Set ${v} everywhere and dated it ${date}. Review, commit, then tag v${v} (docs/RELEASING.md).`)
}

const [cmd, ...args] = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === 'check') {
      const tag = flag('--tag')
      const list = problems({ tag })
      if (list.length) {
        for (const p of list) console.error(`✗ ${p}`)
        process.exit(1)
      }
      const { version } = project()
      console.log(`✓ ${version}${isPrerelease(version) ? ' (prerelease)' : ''}: versions agree and CHANGELOG.md has the entry${tag ? `; ${tag} matches` : ''}`)
    } else if (cmd === 'notes') process.stdout.write(releaseNotes(args[0] ?? `v${project().version}`))
    else if (cmd === 'prepare') prepare(args[0], flag('--date') ?? new Date().toISOString().slice(0, 10))
    else if (cmd === 'version') console.log(project().version)
    else {
      console.error('usage: release.mjs check [--tag vX.Y.Z] | prepare X.Y.Z [--date YYYY-MM-DD] | notes vX.Y.Z | version')
      process.exit(2)
    }
  } catch (e) {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  }
}
