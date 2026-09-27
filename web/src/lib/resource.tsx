/**
 * What the workspace pages have already read, kept in memory while Muni is open: coming back to a
 * section shows it at once and checks it again quietly, instead of taking the page down to a
 * spinner. Never written to storage.
 *
 * Scope. The store lives in a provider keyed by account (App), so another person signing in on
 * this device starts with nothing, and signing out drops it. Keys are API paths, which carry the
 * workspace or sprint, so a response can only ever appear under the path it was asked for: rapid
 * switching between sections or workspaces can't show one place's data in another.
 *
 * Freshness. A read shows what's kept and asks again when it is older than `maxAge` (a few
 * seconds, so quick back-and-forth doesn't repeat requests). Requests for the same path share one
 * flight. A change made here invalidates what it affects; a response that left before that change
 * is not kept, and the path is read again.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { get } from '@/api/client'

export type Entry<T = unknown> = {
  data?: T
  error?: unknown
  /** When `data` was last confirmed by the server (0: never, or invalidated). */
  at: number
  /** A request is under way. */
  fetching: boolean
}
const EMPTY: Entry = { at: 0, fetching: false }

export class ResourceStore {
  private entries = new Map<string, Entry>()
  private flights = new Map<string, Promise<unknown>>()
  /** Bumped by `invalidate`: a response that left before it is stale on arrival. */
  private gens = new Map<string, number>()
  private subs = new Map<string, Set<() => void>>()
  constructor(private fetcher: (path: string) => Promise<unknown> = get, private now: () => number = Date.now) {}

  read<T>(key: string): Entry<T> {
    return (this.entries.get(key) ?? EMPTY) as Entry<T>
  }
  subscribe(key: string, fn: () => void) {
    let s = this.subs.get(key)
    if (!s) this.subs.set(key, (s = new Set()))
    s.add(fn)
    return () => {
      s.delete(fn)
    }
  }
  private write(key: string, patch: Partial<Entry>) {
    this.entries.set(key, { ...this.read(key), ...patch })
    this.subs.get(key)?.forEach((f) => f())
  }
  /** Whether what's kept is recent enough to show without asking again. */
  fresh(key: string, maxAge: number) {
    const e = this.read(key)
    return e.at > 0 && this.now() - e.at < maxAge
  }
  /** Ask the server (or join the request already under way). Resolves with the data; rejects on error. */
  load<T>(key: string): Promise<T> {
    const flying = this.flights.get(key)
    if (flying) return flying as Promise<T>
    const gen = this.gens.get(key) ?? 0
    this.write(key, { fetching: true })
    const p = this.fetcher(key).then(
      (data) => {
        this.flights.delete(key)
        if ((this.gens.get(key) ?? 0) !== gen) return this.load<T>(key)
        this.write(key, { data, error: undefined, at: this.now(), fetching: false })
        return data as T
      },
      (error) => {
        this.flights.delete(key)
        if ((this.gens.get(key) ?? 0) !== gen) return this.load<T>(key)
        // What was shown stays; the error is there for a retry.
        this.write(key, { error, fetching: false })
        throw error
      },
    )
    this.flights.set(key, p)
    return p
  }
  /** Read unless recent: for intent (hovering a section) and for mounting. Never rejects. */
  prefetch(key: string, maxAge = 5000) {
    if (this.fresh(key, maxAge) || this.flights.has(key)) return
    this.load(key).catch(() => {})
  }
  /** Replace what's kept with a response the page already has (e.g. after a change). */
  set<T>(key: string, data: T) {
    this.gens.set(key, (this.gens.get(key) ?? 0) + 1)
    this.write(key, { data, error: undefined, at: this.now() })
  }
  /**
   * Mark paths out of date (those starting with `prefix`). Paths on screen are read again now;
   * the rest the next time they're shown.
   */
  invalidate(prefix: string) {
    for (const key of new Set([...this.entries.keys(), ...this.flights.keys()])) {
      if (!key.startsWith(prefix)) continue
      this.gens.set(key, (this.gens.get(key) ?? 0) + 1)
      if (this.entries.has(key)) this.write(key, { at: 0 })
      if (this.subs.get(key)?.size && !this.flights.has(key)) this.load(key).catch(() => {})
    }
  }
  /** Forget paths entirely (lost access to a workspace). */
  drop(prefix: string) {
    for (const key of [...this.entries.keys()]) {
      if (!key.startsWith(prefix)) continue
      this.gens.set(key, (this.gens.get(key) ?? 0) + 1)
      this.entries.delete(key)
      this.subs.get(key)?.forEach((f) => f())
    }
  }
}

const Ctx = createContext<ResourceStore | null>(null)

export function ResourceProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new ResourceStore(), [])
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useResources(): ResourceStore {
  const s = useContext(Ctx)
  if (!s) throw new Error('useResources outside ResourceProvider')
  return s
}

export type Resource<T> = {
  data: T | undefined
  error: unknown
  /** Nothing to show yet, and a request is under way. */
  loading: boolean
  /** Showing kept data while asking again. */
  refreshing: boolean
  reload: () => Promise<T | undefined>
}

/**
 * Data for `path` (null: nothing yet). Shows what's kept for that exact path, and reads it again
 * when older than `maxAge`. `focus`: also on returning to the tab (for things other people change).
 */
export function useResource<T>(path: string | null, { maxAge = 4000, focus = false }: { maxAge?: number; focus?: boolean } = {}): Resource<T> {
  const store = useResources()
  const key = path ?? ''
  const subscribe = useCallback((fn: () => void) => (path ? store.subscribe(path, fn) : () => {}), [store, path])
  const entry = useSyncExternalStore(subscribe, () => (path ? store.read<T>(path) : (EMPTY as Entry<T>)))
  useEffect(() => {
    if (!path) return
    store.prefetch(path, maxAge)
    if (!focus) return
    const on = () => !document.hidden && store.prefetch(path, maxAge)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [store, path, maxAge, focus])
  const reload = useCallback(() => (key ? store.load<T>(key).catch(() => undefined) : Promise.resolve(undefined)), [store, key])
  return {
    data: entry.data,
    error: entry.data === undefined ? entry.error : undefined,
    loading: entry.data === undefined && !entry.error,
    refreshing: entry.data !== undefined && entry.fetching,
    reload,
  }
}
