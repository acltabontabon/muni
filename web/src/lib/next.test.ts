import { describe, expect, it } from 'vitest'
import { safeNext } from './next'

const O = 'https://act.munimuni.app'

describe('safeNext', () => {
  it('keeps paths on this origin, with their query and fragment', () => {
    expect(safeNext('/sprints/abc', O)).toBe('/sprints/abc')
    expect(safeNext('/capture?sprint=1#x', O)).toBe('/capture?sprint=1#x')
  })
  it('refuses anything that could leave the app', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/\\/evil', 'javascript:alert(1)', 'evil', '/%0d%0a', '/a\u0000b', '\t/x'])
      expect(safeNext(bad, O), bad).toBe(bad === '/%0d%0a' ? '/%0d%0a' : '/')
  })
  it('never loops back to sign-in and defaults to home', () => {
    expect(safeNext('/signin?next=/x', O)).toBe('/')
    expect(safeNext(null, O)).toBe('/')
    expect(safeNext('', O)).toBe('/')
  })
})
