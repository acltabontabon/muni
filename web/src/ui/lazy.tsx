/**
 * Pages and parts of pages that load when they're first needed, so opening Muni on a phone doesn't
 * wait for the stage, the setup form or the account screens. The service worker keeps every part
 * with the rest of the build, so they open offline too.
 */
import { lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button, Spinner } from '@/ui'

/**
 * A component from a module loaded on first use. If it can't be loaded — this tab is older than
 * the Muni now served, or the connection dropped before this part was ever kept — it says so and
 * offers a reload instead of leaving a blank page. Nothing reloads by itself.
 */
export function lazyPart<M, P extends object>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>) {
  return lazy(async () => {
    try {
      return { default: pick(await load()) }
    } catch {
      return { default: Unavailable as unknown as ComponentType<P> }
    }
  })
}

function Unavailable() {
  return (
    <div className="mx-auto grid max-w-md place-items-center gap-4 px-4 py-20 text-center" role="alert">
      <p className="text-[15px] text-ink-soft">This part of Muni couldn’t be loaded. Muni may have been updated since this tab was opened, or the connection dropped. Reload to continue.</p>
      <Button onClick={() => window.location.reload()}><RefreshCw className="size-4" aria-hidden /> Reload</Button>
    </div>
  )
}

/** While a part loads: nothing for a moment (most loads are instant), then a quiet spinner. */
export function Loading({ page = false, children }: { page?: boolean; children?: ReactNode }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 250)
    return () => window.clearTimeout(t)
  }, [])
  return (
    <div className={page ? 'grid min-h-dvh place-items-center text-ink-soft' : 'grid place-items-center py-16 text-ink-soft'} role="status" aria-label="Loading">
      {shown ? (children ?? <Spinner />) : null}
    </div>
  )
}
