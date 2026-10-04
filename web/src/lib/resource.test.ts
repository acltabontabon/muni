import { describe, expect, it } from 'vitest'
import { ResourceStore } from './resource'
import { ApiError } from '@/api/client'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}

/** A store whose requests the test answers by hand. */
function setup() {
  let t = 1000
  const calls: { path: string; d: ReturnType<typeof deferred<unknown>> }[] = []
  const store = new ResourceStore((path) => {
    const d = deferred<unknown>()
    calls.push({ path, d })
    return d.promise
  }, () => t)
  return { store, calls, tick: (ms: number) => (t += ms) }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('resource store', () => {
  it('shares one request between readers of the same path', async () => {
    const { store, calls } = setup()
    const a = store.load('/api/workspaces/w1')
    const b = store.load('/api/workspaces/w1')
    store.prefetch('/api/workspaces/w1')
    expect(calls).toHaveLength(1)
    calls[0].d.resolve({ n: 1 })
    expect(await a).toEqual({ n: 1 })
    expect(await b).toEqual({ n: 1 })
    expect(store.read('/api/workspaces/w1').data).toEqual({ n: 1 })
  })

  it('keeps data per path, so one workspace never shows another’s', async () => {
    const { store, calls } = setup()
    const one = store.load('/api/workspaces/w1')
    const two = store.load('/api/workspaces/w2')
    // The second answers first: each lands only under its own path.
    calls[1].d.resolve({ name: 'Two' })
    calls[0].d.resolve({ name: 'One' })
    await Promise.all([one, two])
    expect(store.read('/api/workspaces/w1').data).toEqual({ name: 'One' })
    expect(store.read('/api/workspaces/w2').data).toEqual({ name: 'Two' })
  })

  it('shows what it has and asks again only when older than maxAge', async () => {
    const { store, calls, tick } = setup()
    store.prefetch('/p')
    calls[0].d.resolve('v1')
    await flush()
    tick(1000)
    store.prefetch('/p', 4000)
    expect(calls).toHaveLength(1)
    tick(4000)
    store.prefetch('/p', 4000)
    expect(calls).toHaveLength(2)
    // Still showing v1 while v2 is on its way.
    expect(store.read('/p')).toMatchObject({ data: 'v1', fetching: true })
    calls[1].d.resolve('v2')
    await flush()
    expect(store.read('/p')).toMatchObject({ data: 'v2', fetching: false })
  })

  it('discards a response that left before a change, and reads again', async () => {
    const { store, calls } = setup()
    const off = store.subscribe('/api/workspaces/w1', () => {})
    const p = store.load('/api/workspaces/w1')
    store.invalidate('/api/workspaces/w1')
    calls[0].d.resolve({ members: 3 })
    await flush()
    expect(calls).toHaveLength(2)
    expect(store.read('/api/workspaces/w1').data).toBeUndefined()
    calls[1].d.resolve({ members: 2 })
    expect(await p).toEqual({ members: 2 })
    expect(store.read('/api/workspaces/w1').data).toEqual({ members: 2 })
    off()
  })

  it('invalidates by prefix: paths on screen are read again, others when next shown', async () => {
    const { store, calls } = setup()
    store.prefetch('/api/workspaces/w1')
    store.prefetch('/api/workspaces/w1/join-links')
    store.prefetch('/api/workspaces/w2')
    calls.forEach((c, i) => c.d.resolve(i))
    await flush()
    const off = store.subscribe('/api/workspaces/w1', () => {})
    store.invalidate('/api/workspaces/w1')
    expect(calls.map((c) => c.path).slice(3)).toEqual(['/api/workspaces/w1'])
    expect(store.fresh('/api/workspaces/w1/join-links', 60_000)).toBe(false)
    expect(store.fresh('/api/workspaces/w2', 60_000)).toBe(true)
    off()
  })

  it('keeps shown data when a refresh fails, and reports the error when there is nothing to show', async () => {
    const { store, calls, tick } = setup()
    store.prefetch('/p')
    calls[0].d.resolve('kept')
    await flush()
    tick(10_000)
    store.prefetch('/p')
    calls[1].d.reject(new Error('offline'))
    await flush()
    expect(store.read('/p')).toMatchObject({ data: 'kept', fetching: false })
    store.prefetch('/q')
    calls[2].d.reject(new Error('offline'))
    await flush()
    expect(store.read('/q').data).toBeUndefined()
    expect(store.read('/q').error).toBeInstanceOf(Error)
  })

  it('forgets a workspace entirely when access is lost', async () => {
    const { store, calls } = setup()
    store.prefetch('/api/workspaces/w1')
    store.prefetch('/api/workspaces/w1/sprints')
    calls.forEach((c) => c.d.resolve('x'))
    await flush()
    store.drop('/api/workspaces/w1')
    expect(store.read('/api/workspaces/w1').data).toBeUndefined()
    expect(store.read('/api/workspaces/w1/sprints').data).toBeUndefined()
  })

  it('never restores or rereads dropped content when an old request completes', async () => {
    const { store, calls } = setup()
    const pending = store.load('/api/workspaces/w1/sprints')
    const rejected = expect(pending).rejects.toThrow('forgotten')
    store.drop('/api/workspaces/w1')
    calls[0].d.resolve('content from before access ended')
    await rejected
    expect(calls).toHaveLength(1)
    expect(store.read('/api/workspaces/w1/sprints').data).toBeUndefined()
  })

  it('keeps a new request independent of a dropped request that answers later', async () => {
    const { store, calls } = setup()
    const pending = store.load('/p')
    const rejected = expect(pending).rejects.toThrow('forgotten')
    store.drop('/p')
    const current = store.load('/p')
    calls[0].d.reject(new Error('old failure'))
    await rejected
    expect(store.load('/p')).toBe(current)
    expect(calls).toHaveLength(2)
    calls[1].d.resolve('new content')
    expect(await current).toBe('new content')
    expect(store.read('/p').data).toBe('new content')
  })

  it('removes kept content when a refresh says access ended', async () => {
    for (const status of [401, 403, 404]) {
      const { store, calls } = setup()
      store.set('/p', 'previously visible content')
      const refresh = store.load('/p')
      const error = new ApiError(status, 'forbidden', 'Access ended')
      calls[0].d.reject(error)
      await expect(refresh).rejects.toBe(error)
      expect(store.read('/p')).toMatchObject({ data: undefined, error, fetching: false, at: 0 })
    }
  })
})
