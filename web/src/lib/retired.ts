/**
 * Caches that earlier versions of Muni created and nothing uses any more: voice transcription's
 * runtime, its speech model's partial downloads, and the model itself (Transformers.js's default
 * cache, about 250 MB). Removed by the page when it starts and by the service worker when it takes
 * over, so a device that once used voice gets its space back. Drafts, queued thoughts and keys live
 * in IndexedDB and the app shell and world fonts in their own caches; none of those is touched.
 */
export const RETIRED_CACHES = ['muni-voice', 'muni-voice-parts', 'transformers-cache'] as const

export async function dropRetiredCaches(store: Pick<CacheStorage, 'delete'> | null = typeof caches === 'undefined' ? null : caches): Promise<void> {
  if (!store) return
  await Promise.all(RETIRED_CACHES.map((name) => store.delete(name).catch(() => false)))
}
