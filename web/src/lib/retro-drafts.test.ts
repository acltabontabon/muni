import { afterEach, describe, expect, it } from 'vitest'
import { setExpectedAccount } from '@/api/client'
import { clearRetroDrafts, readRetroDraft, writeRetroDraft } from './retro-drafts'

afterEach(() => {
  setExpectedAccount(null)
  clearRetroDrafts()
})

describe('unsent retro words', () => {
  it('are kept for the person who wrote them', () => {
    setExpectedAccount('ana')
    writeRetroDraft('note:c1', 'Synthetic note', 'ana')
    expect(readRetroDraft('note:c1', 'ana')).toBe('Synthetic note')
  })

  it('go when that person signs out, and never reach the next person in the tab', () => {
    setExpectedAccount('ana')
    writeRetroDraft('add:s1', 'Synthetic addition', 'ana')
    setExpectedAccount(null)
    setExpectedAccount('ben')
    expect(readRetroDraft('add:s1', 'ben')).toBe('')
    setExpectedAccount('ana')
    expect(readRetroDraft('add:s1', 'ana')).toBe('')
  })

  it('go when someone else signs in without signing out first', () => {
    setExpectedAccount('ana')
    writeRetroDraft('note:c1', 'Synthetic note', 'ana')
    setExpectedAccount('ben')
    setExpectedAccount('ana')
    expect(readRetroDraft('note:c1', 'ana')).toBe('')
  })

  it('are never read or written for an account this tab isn’t acting for', () => {
    setExpectedAccount('ben')
    writeRetroDraft('note:c1', 'Written with a stale account', 'ana')
    expect(readRetroDraft('note:c1', 'ben')).toBe('')
    writeRetroDraft('note:c1', 'Ben’s own', 'ben')
    expect(readRetroDraft('note:c1', 'ana')).toBe('')
    setExpectedAccount(null)
    expect(readRetroDraft('note:c1', null)).toBe('')
  })

  it('go with “Clear local data”', () => {
    setExpectedAccount('ana')
    writeRetroDraft('note:c1', 'Synthetic note', 'ana')
    clearRetroDrafts()
    expect(readRetroDraft('note:c1', 'ana')).toBe('')
  })
})
