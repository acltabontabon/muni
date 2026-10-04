import { afterEach, describe, expect, it } from 'vitest'
import { setExpectedAccount } from '@/api/client'
import { accountFormDrafts, clearFormDrafts } from './form-drafts'

afterEach(() => setExpectedAccount(null))

describe('account form drafts', () => {
  it('keeps an unfinished form while the same account moves between pages', () => {
    setExpectedAccount('mara')
    const drafts = accountFormDrafts<{ question: string }>()
    drafts.set('mara:sprint-1', { question: 'What surprised you?' })
    expect(drafts.get('mara:sprint-1')).toEqual({ question: 'What surprised you?' })
    expect(drafts.get('ben:sprint-1')).toBeUndefined()
  })

  it('clears plaintext forms on sign-out, even when the same account signs in again', () => {
    setExpectedAccount('mara')
    const drafts = accountFormDrafts<string>()
    drafts.set('mara:sprint-1', 'Private opening question')
    setExpectedAccount(null)
    // A late update from the view being torn down must not restore the discarded words.
    drafts.set('mara:sprint-1', 'Late edit')
    setExpectedAccount('mara')
    expect(drafts.get('mara:sprint-1')).toBeUndefined()
  })

  it('drops all form scopes on an account switch and when local data is cleared', () => {
    setExpectedAccount('mara')
    const setup = accountFormDrafts<string>()
    const settings = accountFormDrafts<string>()
    setup.set('mara:sprint-1', 'One')
    settings.set('mara:workspace-1', 'Two')
    setExpectedAccount('ben')
    setup.set('mara:sprint-1', 'Stale edit')
    setExpectedAccount('mara')
    expect(setup.get('mara:sprint-1')).toBeUndefined()
    expect(settings.get('mara:workspace-1')).toBeUndefined()
    setup.set('mara:sprint-1', 'New edits')
    clearFormDrafts()
    expect(setup.get('mara:sprint-1')).toBeUndefined()
  })
})
