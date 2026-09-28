import { beforeEach, describe, expect, it } from 'vitest'
import { forgetSignedInState, keepsLocal, keptAccounts, readPrefs, rememberWorld, setKeepsLocal, worldFor, writePrefs } from './prefs'

// A minimal localStorage for node.
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  get length() { return this.m.size }
}

beforeEach(() => {
  const s = new MemStorage()
  // Object.keys(localStorage) must list stored keys, as it does in browsers.
  ;(globalThis as { localStorage?: Storage }).localStorage = new Proxy(s, { ownKeys: () => [...(s as unknown as { m: Map<string, string> }).m.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) }) as unknown as Storage
})

describe('keeping drafts on this device', () => {
  it('is one person’s choice, never the device’s', () => {
    setKeepsLocal('ana', true)
    expect(keepsLocal('ana')).toBe(true)
    expect(keepsLocal('ben')).toBe(false)
    expect(keepsLocal(null)).toBe(false)
    setKeepsLocal('ben', true)
    setKeepsLocal('ana', false)
    expect(keptAccounts()).toEqual(['ben'])
  })

})

describe('signing out', () => {
  it('forgets the last place and reveal flags, and keeps device preferences', () => {
    writePrefs({ lastWorkspace: 'w1', lastSprint: 's1', theme: 'dark' })
    setKeepsLocal('ana', true)
    localStorage.setItem('muni:revealed:s1', '1')
    forgetSignedInState()
    const p = readPrefs()
    expect(p.lastWorkspace).toBeUndefined()
    expect(p.lastSprint).toBeUndefined()
    expect(p.theme).toBe('dark')
    expect(keepsLocal('ana')).toBe(true)
    expect(localStorage.getItem('muni:revealed:s1')).toBeNull()
  })
})

describe('a character world remembered on this device', () => {
  it('belongs to one account: another person on the device never opens into it', () => {
    rememberWorld({ account: 'ana', avatar: 'bola', theme: true })
    expect(worldFor('ana')).toEqual({ account: 'ana', avatar: 'bola', theme: true })
    expect(worldFor('ben')).toBeNull()
    expect(worldFor(null)).toBeNull()
  })

  it('is forgotten on sign-out', () => {
    rememberWorld({ account: 'ana', avatar: 'pahina', theme: false })
    forgetSignedInState()
    expect(readPrefs().world).toBeUndefined()
    expect(worldFor('ana')).toBeNull()
  })

  it('keeps the rest of the device’s preferences when it changes', () => {
    writePrefs({ theme: 'dark' })
    rememberWorld({ account: 'ana', avatar: 'kape', theme: true })
    rememberWorld({ account: 'ana', avatar: 'sibol', theme: true })
    expect(readPrefs()).toMatchObject({ theme: 'dark', world: { avatar: 'sibol' } })
  })
})
