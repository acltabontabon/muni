import { describe, expect, it } from 'vitest'
import pkg from '../../../package.json'
import { APP_VERSION, RELEASES, releaseDate } from './release'

describe('release data built into the app', () => {
  it('is the root package.json version, with its changelog entry first', () => {
    expect(APP_VERSION).toBe(pkg.version)
    expect(RELEASES[0]?.version).toBe(APP_VERSION)
    expect(RELEASES[0]?.sections.length).toBeGreaterThan(0)
  })

  it('carries released notes only: no Unreleased section, no maintainer comments, no raw markdown', () => {
    const shipped = JSON.stringify(RELEASES)
    expect(shipped).not.toMatch(/Unreleased|<!--|Maintainers:/)
    expect(RELEASES.every((r) => !('markdown' in r))).toBe(true)
    for (const r of RELEASES) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('shows dates as the calendar day written, in any timezone', () => {
    expect(releaseDate('2026-09-28', 'en-GB')).toBe('28 September 2026')
  })
})
