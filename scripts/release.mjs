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
import { compare } from './verify-deploy.mjs'

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
  return { version: pkg.version, repo, app: pkg.config?.appUrl, site: pkg.homepage, tagline: pkg.description }
}

/**
 * The link references Keep a Changelog ends with, for these versions (newest first): Unreleased
 * compares the newest tag with HEAD, each release compares with the one before it, and the first
 * release links to its tag.
 */
export function changelogLinks(repo, versions) {
  const gh = `https://github.com/${repo}`
  return {
    unreleased: versions.length ? `${gh}/compare/v${versions[0]}...HEAD` : `${gh}/commits/HEAD`,
    ...Object.fromEntries(versions.map((v, i) => [v, versions[i + 1] ? `${gh}/compare/v${versions[i + 1]}...v${v}` : `${gh}/releases/tag/v${v}`])),
  }
}
const linkBlock = (links) => Object.entries(links).map(([k, url]) => `[${k}]: ${url}`).join('\n')

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
  else if (log.releases[0]?.version !== version) out.push(`CHANGELOG.md: ${version} should be the newest release (first below Unreleased)`)
  if (!/keepachangelog\.com\/en\/1\.1\.0/.test(log.preamble) || !/semver\.org\/spec\/v2\.0\.0/.test(log.preamble)) out.push('CHANGELOG.md: keep the standard preamble (Keep a Changelog 1.1.0, Semantic Versioning 2.0.0)')
  const versions = log.releases.map((r) => r.version)
  for (let i = 1; i < versions.length; i++) if (compare(versions[i - 1], versions[i]) <= 0 || log.releases[i - 1].date < log.releases[i].date) out.push(`CHANGELOG.md: ${versions[i - 1]} must be newer than the ${versions[i]} below it`)
  const want = changelogLinks(repo, versions)
  for (const [k, url] of Object.entries(want)) if (log.links[k.toLowerCase()] !== url) out.push(`CHANGELOG.md: the link reference for [${k}] should be ${url}`)
  for (const k of Object.keys(log.links)) if (!(k in want) && !Object.keys(want).some((w) => w.toLowerCase() === k)) out.push(`CHANGELOG.md: [${k}] links to a version that isn’t in the file`)
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

/**
 * The GitHub release body: the demo, what Muni is and where to go, a note when it's a prerelease,
 * then the version's CHANGELOG entry as written — Added, Changed, … — and the comparison with the
 * release before. One paragraph per line: GitHub turns every newline in a release body into a break.
 */
export function releaseNotes(tag) {
  const { version, repo, app, site, tagline } = project()
  if (tag !== `v${version}`) throw new Error(`tag ${tag} doesn’t match the committed version ${version}`)
  const log = parseChangelog(readFileSync(path('CHANGELOG.md'), 'utf8'))
  const i = log.releases.findIndex((r) => r.version === version)
  if (i === -1) throw new Error(`CHANGELOG.md has no entry for ${version}`)
  const entry = log.releases[i]
  const previous = log.releases[i + 1]?.version
  const gh = `https://github.com/${repo}`
  const asset = (name) => `${gh}/releases/download/${tag}/${name}`
  const stable = version.replace(/-.*$/, '')
  const sep = ' &nbsp;·&nbsp; '
  return [
    `<p align="center"><a href="${asset('muni-demo.mp4')}"><img src="${asset('muni-demo.gif')}" alt="Muni in 52 seconds: thoughts written on a laptop and a phone, the same page in four characters’ rooms, the facilitator closing collection and gathering thoughts into themes, everyone’s thoughts revealed without names, the live retro, and the experiments agreed." width="720"></a></p>`,
    '',
    '<h3 align="center">Keep the thought. Bring it to the conversation.</h3>',
    `<p align="center">${tagline}</p>`,
    `<p align="center"><a href="${app}"><b>Open Muni</b></a>${sep}<a href="${site}">Website</a>${sep}<a href="${gh}/blob/${tag}/CHANGELOG.md">Changelog</a>${sep}<a href="${gh}/blob/${tag}/README.md#known-limitations">Known limitations</a></p>`,
    '',
    ...(entry.prerelease
      ? ['> [!NOTE]', `> A release candidate for Muni ${stable}. It’s what runs at ${app.replace(/^https:\/\//, '')} now; ${stable} follows once it has passed its final checks.`, '']
      : []),
    ...entry.sections.flatMap((sec) => [`### ${sec.title}`, '', ...sec.items.map((item) => `- ${markdown(item)}`), '']),
    '---',
    '',
    previous ? `**Full changelog:** [v${previous}...${tag}](${gh}/compare/v${previous}...${tag})` : `**First release.** Everything since the beginning: [${tag}](${gh}/commits/${tag}).`,
    '',
    `<sub>Every app frame in the demo is real Muni with a made-up team; the titles and framing are added. Full quality: [muni-demo.mp4](${asset('muni-demo.mp4')}).</sub>`,
    '',
  ].join('\n')
}

/** Sets every version to `v` and dates the Unreleased notes as that release. */
function prepare(v, date) {
  if (!SEMVER.test(v)) throw new Error(`“${v}” isn’t a semantic version`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`“${date}” isn’t a date as YYYY-MM-DD`)
  // Everything is checked before anything is written.
  const log = readFileSync(path('CHANGELOG.md'), 'utf8')
  const { unreleased, releases } = parseChangelog(log)
  const has = releases.some((r) => r.version === v)
  if (!has && !unreleased.length) throw new Error('CHANGELOG.md: write the release under “## [Unreleased]” first')
  if (!has && releases[0] && compare(v, releases[0].version) <= 0) throw new Error(`${v} isn’t newer than ${releases[0].version}`)
  for (const f of ['package.json', ...SYNCED]) {
    const text = readFileSync(path(f), 'utf8')
    writeFileSync(path(f), text.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`))
  }
  const lockPath = 'web/package-lock.json'
  const lock = readJson(lockPath)
  lock.version = v
  if (lock.packages?.['']) lock.packages[''].version = v
  writeFileSync(path(lockPath), JSON.stringify(lock, null, 2) + '\n')
  if (has) return console.log(`CHANGELOG.md already has ${v}; versions set.`)
  const dated = log.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n## [${v}] - ${date}\n`)
  const body = dated.replace(/^\[[^\]]+\]:\s+\S+\s*$\n?/gm, '').trimEnd()
  writeFileSync(path('CHANGELOG.md'), `${body}\n\n${linkBlock(changelogLinks(project().repo, [v, ...releases.map((r) => r.version)]))}\n`)
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
