/**
 * Each world's illustration lives in its own module (./art/<id>.tsx), loaded only when that world is
 * shown. The pieces are decoration placed in fixed slots beside the page's real content — never
 * wrapping it — so switching worlds swaps pictures without touching what someone is writing.
 *
 * No Suspense: a slot renders nothing until its module arrives (the slot's size is fixed in CSS,
 * so nothing shifts), and a module that can't load (offline, never cached) simply stays empty.
 */
import { useEffect, useState, type ComponentType } from 'react'
import { onKept } from '@/lib/kept'
import type { AvatarId } from './characters'

export type SceneState = { empty: boolean; done: boolean }
export interface WorldArt {
  /** The header band's picture (the `.journal-art` box, right of the heading). */
  Header?: ComponentType<{ state: SceneState }>
  /** A flourish that belongs to the heading itself, placed just after it (never over it). */
  Title?: ComponentType
  /** Beside the composer, outside the writing field. */
  Compose?: ComponentType
  /** Beside the collection. */
  Collection?: ComponentType
  /** The empty collection's picture. */
  Empty?: ComponentType
  /** Across the page body (behind or around both columns, never under text). */
  Page?: ComponentType
}

const loaders: Record<AvatarId, () => Promise<{ default: WorldArt }>> = {
  kape: () => import('./art/kape'),
  guhit: () => import('./art/guhit'),
  biyahe: () => import('./art/biyahe'),
  bola: () => import('./art/bola'),
  pahina: () => import('./art/pahina'),
  himig: () => import('./art/himig'),
  porma: () => import('./art/porma'),
  sibol: () => import('./art/sibol'),
}
const loaded = new Map<AvatarId, WorldArt>()
const pending = new Map<AvatarId, Promise<WorldArt | null>>()

/** Loads a world's art once; resolves null if it can't be fetched (it isn't retried until asked again). */
export function loadWorldArt(id: AvatarId): Promise<WorldArt | null> {
  const have = loaded.get(id)
  if (have) return Promise.resolve(have)
  let p = pending.get(id)
  if (!p) {
    p = loaders[id]()
      .then((m) => {
        loaded.set(id, m.default)
        return m.default
      })
      .catch(() => null)
      .finally(() => pending.delete(id))
    pending.set(id, p)
  }
  return p
}

export function useWorldArt(id: AvatarId | null): WorldArt | null {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!id || loaded.has(id)) return
    let live = true
    loadWorldArt(id).then(() => live && setTick((n) => n + 1))
    return () => {
      live = false
    }
  }, [id])
  return id ? loaded.get(id) ?? null : null
}

/**
 * A number that changes once per confirmed save, then returns to 0 after `ms`: key an element on
 * it to play a world's small signature exactly once. Nothing stays animated.
 */
export function useKeptMoment(ms = 1600): number {
  const [n, setN] = useState(0)
  useEffect(() => onKept(() => setN((x) => x + 1)), [])
  useEffect(() => {
    if (!n) return
    const t = window.setTimeout(() => setN(0), ms)
    return () => window.clearTimeout(t)
  }, [n, ms])
  return n
}
