import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inline, isPrerelease, parseChangelog, plain } from './changelog.mjs'
import { problems, project, releaseNotes } from './release.mjs'

const sample = `# Changelog

Intro for maintainers.

<!-- a maintainer note that must never be shown -->

## [Unreleased]

- a draft note that isn't released yet

## [1.1.0] - 2026-11-03

A short introduction
over two lines.

### Added

- **Exports.** Download a sprint as a file.
  It wraps onto a second line.
- Plain item with a [link](https://example.com).

### Fixed

- A fix.

## [1.0.0] - 2026-10-01

First.

### Highlights

- One.

[1.1.0]: https://github.com/o/r/releases/tag/v1.1.0
`

test('reads releases newest first, without Unreleased or comments', () => {
  const { unreleased, releases } = parseChangelog(sample)
  assert.match(unreleased, /draft note/)
  assert.deepEqual(releases.map((r) => [r.version, r.date]), [['1.1.0', '2026-11-03'], ['1.0.0', '2026-10-01']])
  const [r] = releases
  assert.equal(plain(r.intro[0]), 'A short introduction over two lines.')
  assert.deepEqual(r.sections.map((s) => [s.title, s.items.length]), [['Added', 2], ['Fixed', 1]])
  assert.equal(plain(r.sections[0].items[0]), 'Exports. Download a sprint as a file. It wraps onto a second line.')
  assert.ok(!JSON.stringify(releases).includes('maintainer note'))
  assert.ok(!JSON.stringify(releases).includes('draft note'))
  assert.ok(!r.markdown.includes('releases/tag'), 'link definitions stay out of the notes')
})

test('inline formatting and safe links only', () => {
  assert.deepEqual(inline('a **b** *c* [d](/privacy)'), [
    { t: 'text', v: 'a ' },
    { t: 'strong', v: 'b' },
    { t: 'text', v: ' ' },
    { t: 'em', v: 'c' },
    { t: 'text', v: ' ' },
    { t: 'link', v: 'd', href: '/privacy' },
  ])
  assert.throws(() => inline('[x](javascript:alert(1))'), /must be https/)
  assert.throws(() => inline('[x](//evil.example)'), /must be https/)
})

test('rejects entries that would publish badly', () => {
  assert.throws(() => parseChangelog('## [1.0] - 2026-01-01\n'), /semantic version/)
  assert.throws(() => parseChangelog('## [1.0.0]\n'), /release date/)
  assert.throws(() => parseChangelog('## [1.0.0] - 2026-13-45\n'), /release date/)
  assert.throws(() => parseChangelog('## [1.0.0] - 2026-01-01\n\n- bullet without a section\n'), /needs a “### Section”/)
  assert.throws(() => parseChangelog('## [1.0.0] - 2026-01-01\n\n## [1.0.0] - 2026-01-01\n'), /twice/)
})

test('prereleases are recognised by semver rules', () => {
  assert.equal(isPrerelease('1.0.0-rc.1'), true)
  assert.equal(isPrerelease('1.0.0'), false)
})

test('this checkout is releasable as its own version, and only that', () => {
  const { version } = project()
  assert.deepEqual(problems(), [])
  assert.ok(problems({ tag: 'v9.9.9' }).some((p) => /doesn’t match/.test(p)))
  assert.ok(problems({ tag: version }).some((p) => /isn’t vMAJOR/.test(p)))
})

test('release notes are the changelog entry, with the demo and the app', () => {
  const { version, app } = project()
  const notes = releaseNotes(`v${version}`)
  const entry = parseChangelog(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')).releases.find((r) => r.version === version)
  assert.ok(entry)
  assert.ok(notes.includes(`/releases/download/v${version}/muni-demo.gif`))
  assert.ok(notes.includes(app))
  for (const s of entry.sections) assert.ok(notes.includes(`### ${s.title}`))
  assert.ok(!/<!--|\[Unreleased\]/.test(notes))
  assert.throws(() => releaseNotes('v0.0.1'), /doesn’t match/)
})

test('versions compare by semver precedence', async () => {
  const { compare } = await import('./verify-deploy.mjs')
  const order = ['0.9.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0']
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(compare(order[i], order[i + 1]), -1, `${order[i]} < ${order[i + 1]}`)
    assert.equal(compare(order[i + 1], order[i]), 1)
  }
  assert.equal(compare('1.0.0-rc.1', '1.0.0-rc.1'), 0)
})
