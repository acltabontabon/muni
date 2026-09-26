import { describe, expect, it } from 'vitest'
import { splitLinks } from './text'

describe('splitLinks', () => {
  it('leaves plain text alone', () => {
    expect(splitLinks('Staging was down on Wednesday.')).toEqual([{ text: 'Staging was down on Wednesday.' }])
  })
  it('finds links and keeps sentence punctuation outside them', () => {
    expect(splitLinks('See https://example.com/runbook, then retry.')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/runbook', href: 'https://example.com/runbook' },
      { text: ', then retry.' },
    ])
  })
  it('keeps balanced parentheses', () => {
    expect(splitLinks('(https://en.wikipedia.org/wiki/Duyan_(hammock))')[1]).toEqual({ text: 'https://en.wikipedia.org/wiki/Duyan_(hammock)', href: 'https://en.wikipedia.org/wiki/Duyan_(hammock)' })
  })
  it('only links http and https', () => {
    expect(splitLinks('javascript:alert(1) and ftp://x').every((r) => !r.href)).toBe(true)
  })
})
