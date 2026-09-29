/**
 * The small vocabulary for where a thought is. One motif: the dot from the Muni mark. Hollow
 * while it only exists on this device, filled once it has reached the sprint.
 */
import { clsx } from 'clsx'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { onUpgradeRequired } from '@/api/client'
import { useAuth } from '@/lib/auth'
import { useLocal } from '@/lib/local/LocalProvider'
import { applyUpdate, usePwa } from '@/lib/pwa'
import { isComposerDirty } from '@/lib/dirty'
import { Button } from '@/ui'
import { EntranceShell, Step } from '@/ui/entrance'

export type ThoughtState = 'draft' | 'queued' | 'sending' | 'submitted' | 'attention'
export const STATE_LABEL: Record<ThoughtState, string> = {
  draft: 'Draft on this device',
  queued: 'Waiting to send',
  sending: 'Sending…',
  submitted: 'Submitted',
  attention: 'Needs attention',
}

export function StatusDot({ state, className }: { state: ThoughtState; className?: string }) {
  return <span aria-hidden className={clsx('dot', `dot--${state}`, className)} />
}

export function StatusLabel({ state, children }: { state: ThoughtState; children?: React.ReactNode }) {
  // (children overrides the words, e.g. “Waiting for this device’s key”.)
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs', state === 'attention' ? 'text-warn' : state === 'submitted' ? 'text-ink-faint' : 'text-status-ink')}>
      <StatusDot state={state} />
      {children ?? STATE_LABEL[state]}
    </span>
  )
}

/** Header indicator: silent when all is well; says so plainly when it isn't. */
export function SyncChip() {
  const { offline } = useAuth()
  const { sync, unsentCount, retry, items } = useLocal()
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  const isOffline = offline || !online || sync === 'offline'
  const attention = items.filter((i) => i.status === 'attention').length
  const waiting = unsentCount - attention
  if (!isOffline && unsentCount === 0 && sync !== 'sending') return null
  const label = isOffline ? 'Offline' : sync === 'sending' ? 'Sending…' : waiting ? `${waiting} waiting` : `${attention} to review`
  return (
    <button
      type="button"
      onClick={() => retry()}
      className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium', isOffline ? 'border-line text-ink-soft' : !waiting && attention ? 'border-warn/40 text-warn' : 'border-status/30 text-status-ink')}
      title={isOffline ? 'No connection. Thoughts you save stay on this device until Muni reconnects.' : 'Send waiting thoughts now'}
      aria-label={`${label}. ${isOffline ? 'Thoughts you save wait on this device.' : 'Send now.'}`}
    >
      {isOffline ? <CloudOff className="size-3.5" /> : <RefreshCw className={clsx('size-3.5', sync === 'sending' && 'opacity-60')} />}
      <span>{label}</span>
      {isOffline && waiting > 0 ? <span className="text-ink-faint">· {waiting} waiting</span> : null}
    </button>
  )
}

/** The session ended while someone was using Muni: ask them to sign in, keep what they wrote. */
export function SessionBanner() {
  const { sessionEnded } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  if (!sessionEnded) return null
  return (
    <div role="status" className="border-b border-warn/30 bg-[color-mix(in_oklab,var(--warn)_10%,var(--paper))]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <span>Your session ended. Sign in again to send — what you’ve written stays here.</span>
        <Button size="sm" variant="primary" onClick={() => nav(`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`)}>Sign in</Button>
      </div>
    </div>
  )
}

/**
 * A new version is waiting. Offered quietly; never applied while someone is typing, while a
 * thought is being sent, during a live retro, or when unsent work exists only in this tab.
 */
export function UpdateNotice() {
  const pwa = usePwa()
  const local = useLocal()
  const loc = useLocation()
  const [mustReload, setMustReload] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  useEffect(() => {
    const off = onUpgradeRequired(() => setMustReload(true))
    return () => { off() }
  }, [])
  if (!pwa.updateReady && !pwa.updatedElsewhere && !mustReload) return null
  const reason = (): string | null => {
    if (/\/(stage|room)$/.test(loc.pathname)) return 'Muni will update after the retro — reload then.'
    if (local.items.some((i) => i.status === 'sending')) return 'A thought is being sent. Update in a moment.'
    if (local.kind === 'memory' && (isComposerDirty() || local.unsentCount > 0)) return 'You have unsent writing that is only kept in this tab. Send it first, or turn on “Keep drafts on this device”.'
    return null
  }
  const text = mustReload ? 'Muni has been updated. Reload to continue.' : pwa.updatedElsewhere ? 'Muni was updated in another tab.' : 'A new version of Muni is ready.'
  return (
    <div className="fixed bottom-[max(16px,env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto flex max-w-md flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-card px-4 py-3 text-sm shadow-[var(--shadow-float)] anim-rise sm:left-6 sm:right-auto" role="status">
      <span className="flex-1">{blocked ?? text}</span>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          const r = reason()
          if (r && !blocked) return setBlocked(r)
          if (pwa.updatedElsewhere || mustReload) window.location.reload()
          else applyUpdate()
        }}
      >
        {blocked ? 'Update anyway' : pwa.updatedElsewhere || mustReload ? 'Reload' : 'Update'}
      </Button>
    </div>
  )
}

/** Opening Muni with no connection and nothing kept on this device. */
export function OfflineStart() {
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  return (
    <EntranceShell>
      <Step describedBy="offline-start" title="You’re offline." lead="Muni needs a connection to sign in, and to open for the first time on this device. Nothing was sent.">
        <Button
          className="mt-7 w-full"
          size="lg"
          variant="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await refresh()
            } finally {
              setBusy(false)
            }
          }}
        >
          Try again
        </Button>
        <p className="quiet mt-4">Once you’re signed in, “Keep drafts on this device” lets you write and queue thoughts without a connection.</p>
      </Step>
    </EntranceShell>
  )
}

/** A live retro whose room can't be reached right now. Nothing on screen should pass for live. */
export function ReconnectingBar({ status }: { status: 'connecting' | 'live' | 'reconnecting' }) {
  if (status !== 'reconnecting') return null
  return (
    <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-warn/40 bg-[color-mix(in_oklab,var(--warn)_10%,var(--card))] px-3.5 py-2.5 text-sm">
      <span className="dot dot--attention mt-1.5" aria-hidden />
      <span><strong className="font-medium">Reconnecting to the retro…</strong> What you see may be out of date. Votes and other live actions wait until Muni is back — nothing is sent later on its own.</span>
    </div>
  )
}
