import { beforeEach, describe, expect, it } from 'vitest'
import { csrfToken } from '@/api/client'
import { clearPendingSignOut, hasPendingSignOut, markSignedOutLocally } from './signout'

describe('csrfToken', () => {
  it('over HTTPS uses only the __Host- cookie, never a leftover plain one listed first', () => {
    // A browser signed in before the prefix: the old readable cookie comes first (older cookies are listed first).
    expect(csrfToken('muni_csrf=plain; __Host-muni_csrf=current', true)).toBe('current')
    expect(csrfToken('__Host-muni_csrf=current; muni_csrf=plain', true)).toBe('current')
    expect(csrfToken('muni_csrf=plain', true)).toBe('')
  })
  it('over plain HTTP (development) uses the plain cookie, which is the server’s there', () => {
    expect(csrfToken('theme=dark; muni_csrf=dev-token', false)).toBe('dev-token')
    expect(csrfToken('__Host-muni_csrf=leftover; muni_csrf=dev-token', false)).toBe('dev-token')
  })
  it('never matches a cookie that merely ends with the name', () => {
    expect(csrfToken('x_muni_csrf=nope', true)).toBe('')
    expect(csrfToken('', false)).toBe('')
  })
})

describe('pending sign-out', () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    ;(globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    } as unknown as Storage
  })
  it('is remembered until cleared (a refresh stays signed out)', () => {
    expect(hasPendingSignOut()).toBe(false)
    markSignedOutLocally()
    expect(hasPendingSignOut()).toBe(true)
    clearPendingSignOut()
    expect(hasPendingSignOut()).toBe(false)
  })
})
