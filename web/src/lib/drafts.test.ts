import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftKeeper, type DraftSink } from './drafts'
import { emptyPayload, type Payload } from '@/lib/local/store'

const text = (body: string): Payload => ({ ...emptyPayload(), body })

function sink() {
  const drafts = new Map<string, Payload>()
  const s: DraftSink & { drafts: Map<string, Payload> } = {
    drafts,
    saveDraft: async (id, p) => void drafts.set(id, p),
    clearDraft: async (id) => void drafts.delete(id),
  }
  return s
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('draft keeper', () => {
  it('saves after a pause, and clears when the text is emptied', async () => {
    const s = sink()
    const k = draftKeeper(s, 'A', { delay: 400 })
    k.update(text('Staging broke'))
    expect(s.drafts.size).toBe(0)
    await vi.advanceTimersByTimeAsync(400)
    expect(s.drafts.get('A')?.body).toBe('Staging broke')
    k.update(text('   '))
    await vi.advanceTimersByTimeAsync(400)
    expect(s.drafts.has('A')).toBe(false)
  })

  it('keeps the last words when the composer goes away mid-sentence', async () => {
    const s = sink()
    const k = draftKeeper(s, 'A')
    k.update(text('The on-call rota for sta'))
    await k.dispose() // navigating, switching workspace, collection closing
    expect(s.drafts.get('A')?.body).toBe('The on-call rota for sta')
    k.update(text('ignored after dispose'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.drafts.get('A')?.body).toBe('The on-call rota for sta')
  })

  it('never moves a draft to another sprint on its own', async () => {
    const s = sink()
    // Writing for sprint A in one workspace…
    const a = draftKeeper(s, 'A')
    a.update(text('For A only'))
    // …then switching workspace mounts a composer for sprint B and retires A's.
    const b = draftKeeper(s, 'B')
    await a.dispose()
    expect(s.drafts.get('A')?.body).toBe('For A only')
    expect(s.drafts.has('B')).toBe(false)
    await b.dispose()
    expect(s.drafts.has('B')).toBe(false)
  })

  it('moves it when the writer explicitly picks another destination', async () => {
    const s = sink()
    const a = draftKeeper(s, 'A')
    a.update(text('Belongs to B after all'))
    await a.moveTo('B', text('Belongs to B after all'))
    expect(s.drafts.has('A')).toBe(false)
    expect(s.drafts.get('B')?.body).toBe('Belongs to B after all')
    // The pending save for A was dropped, not replayed later.
    await vi.advanceTimersByTimeAsync(1000)
    expect(s.drafts.has('A')).toBe(false)
  })

  it('writes nothing back once local data has been cleared', async () => {
    const s = sink()
    let generation = 0
    const k = draftKeeper(s, 'A', { generation: () => generation })
    k.update(text('Private'))
    generation++ // "Clear local data" / sign out
    await k.dispose()
    expect(s.drafts.size).toBe(0)
  })

  it('discard drops a pending save (the thought was just saved)', async () => {
    const s = sink()
    const k = draftKeeper(s, 'A')
    k.update(text('Saved as a thought'))
    k.discard()
    await k.dispose()
    expect(s.drafts.size).toBe(0)
  })

  it('without a destination there is nowhere to keep it', async () => {
    const s = sink()
    const k = draftKeeper(s, null)
    k.update(text('No sprint yet'))
    await k.dispose()
    expect(s.drafts.size).toBe(0)
  })
})

describe('draft keeper: what a save actually did', () => {
  it('reports saved, failed, skipped, or nothing pending', async () => {
    const s = sink()
    const k = draftKeeper(s, 'A')
    expect(await k.flush()).toBeNull()
    k.update(text('words'))
    expect(await k.flush()).toBe('saved')
    const broken = draftKeeper({ saveDraft: async () => { throw new Error('quota') }, clearDraft: async () => {} }, 'A')
    broken.update(text('words'))
    expect(await broken.flush()).toBe('failed')
    const nowhere = draftKeeper(s, null)
    nowhere.update(text('words'))
    expect(await nowhere.flush()).toBe('skipped')
    let gen = 0
    const cleared = draftKeeper(s, 'B', { generation: () => gen })
    gen++
    cleared.update(text('after sign-out'))
    expect(await cleared.flush()).toBe('skipped')
    expect(s.drafts.has('B')).toBe(false)
  })
})
