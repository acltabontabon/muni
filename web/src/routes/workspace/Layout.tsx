/**
 * The workspace: a shared journal, each sprint an open chapter. One opening stays in place while
 * you move between Sprints, People and Settings — the workspace's name set large, a fine rule
 * that is also the evening's horizon (the sun, or the moon, setting on it at the far edge), and the
 * sections hanging from that rule. Only the section below it changes.
 *
 * The opening needs no request: the name and your role come from who you are (`me`), so switching
 * sections never takes it down. Each section reads its own data through the account's memory cache
 * (lib/resource), shows what it already has at once, and checks again quietly.
 */
import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, Outlet, useParams } from 'react-router'
import { clsx } from 'clsx'
import type { Me } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { useResources } from '@/lib/resource'
import { chooseWorkspace } from '@/lib/workspace'
import { Spinner } from '@/ui'
import { AppShell } from '@/ui/shell'
import { HorizonMark } from '@/ui/art'

type Summary = Me['workspaces'][number]
type Ctx = { ws: Summary; slot: HTMLElement | null }
const WorkspaceCtx = createContext<Ctx | null>(null)

export function useWorkspaceShell(): Ctx {
  const c = useContext(WorkspaceCtx)
  if (!c) throw new Error('useWorkspaceShell outside WorkspaceLayout')
  return c
}

/** A section's own actions, set on the opening's rule beside the navigation. */
export function SectionActions({ children }: { children: ReactNode }) {
  const { slot } = useWorkspaceShell()
  return slot ? createPortal(children, slot) : null
}

/** What each section reads first, asked for when someone points at (or focuses) its link. */
export const SECTION_DATA = {
  sprints: (id: string) => [`/api/workspaces/${id}/sprints`, `/api/workspaces/${id}/experiments`],
  people: (id: string) => [`/api/workspaces/${id}`, `/api/workspaces/${id}/join-requests`, `/api/workspaces/${id}/join-links`, `/api/workspaces/${id}/sprints`],
  settings: (id: string) => [`/api/workspaces/${id}`, `/api/workspaces/${id}/audit`],
}

export function WorkspaceLayout() {
  const { workspaceId = '' } = useParams()
  const { me, refresh, offline } = useAuth()
  const store = useResources()
  const ws = me?.workspaces.find((w) => w.id === workspaceId) ?? null
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // A workspace missing from `me` may be one just joined in another tab: ask once before saying so.
  const [checked, setChecked] = useState<string | null>(null)
  const asking = useRef<string | null>(null)
  useEffect(() => {
    if (ws || offline || asking.current === workspaceId) return
    asking.current = workspaceId
    void refresh().finally(() => setChecked(workspaceId))
  }, [ws, offline, workspaceId, refresh])

  // This is the workspace being looked at, on this device, from now on.
  const found = ws?.id ?? null
  useEffect(() => {
    if (found) chooseWorkspace(found)
  }, [found])

  // A change of role (or of membership) changes what the server shows: read this workspace again.
  // Losing it drops what was kept.
  const role = ws?.role ?? null
  const seen = useRef<{ id: string; role: string | null } | null>(null)
  useEffect(() => {
    const prev = seen.current
    seen.current = { id: workspaceId, role }
    if (!prev || prev.id !== workspaceId || prev.role === role) return
    if (role === null) store.drop(`/api/workspaces/${workspaceId}`)
    else store.invalidate(`/api/workspaces/${workspaceId}`)
  }, [workspaceId, role, store])

  if (!ws) {
    const waiting = !offline && checked !== workspaceId
    return (
      <AppShell>
        {waiting ? (
          <div className="grid place-items-center py-20 text-ink-soft"><Spinner /></div>
        ) : (
          <div className="ws-missing">
            <h1 className="font-display text-2xl">Can’t open this workspace</h1>
            <p className="mt-2 max-w-prose text-ink-soft">{offline ? 'You’re offline, and this device hasn’t kept this workspace.' : 'You’re not a member of it, or it no longer exists. If someone invited you, open their link again.'}</p>
            <Link to="/" className="mt-5 inline-block text-sm underline underline-offset-4">Back to Muni</Link>
          </div>
        )}
      </AppShell>
    )
  }

  const owner = ws.role === 'owner'
  const sections = [
    { key: 'sprints' as const, label: 'Sprints', to: `/workspaces/${ws.id}`, end: true },
    { key: 'people' as const, label: 'People', to: `/workspaces/${ws.id}/people`, end: false },
    ...(owner ? [{ key: 'settings' as const, label: 'Settings', to: `/workspaces/${ws.id}/settings`, end: false }] : []),
  ]
  const intent = (key: keyof typeof SECTION_DATA) => () => {
    if (!offline) SECTION_DATA[key](ws.id).forEach((p) => store.prefetch(p))
  }
  return (
    <AppShell workspace={ws}>
      <WorkspaceCtx.Provider value={{ ws, slot }}>
        <div className="ws">
          <header className="ws-head">
            <p className="ws-kicker">
              {ws.is_demo ? 'Demo workspace · a fictional team' : owner ? 'Workspace · you’re an owner' : 'Workspace'}
            </p>
            <h1 className="ws-title">{ws.name}</h1>
            <div className="ws-rule" aria-hidden>
              <HorizonMark className="ws-mark" />
            </div>
            <div className="ws-navrow">
              <nav aria-label="Workspace" className="ws-nav">
                {sections.map((s) => (
                  <NavLink key={s.key} to={s.to} end={s.end} data-label={s.label} className={({ isActive }) => clsx('ws-tab', isActive && 'is-current')} onPointerEnter={intent(s.key)} onFocus={intent(s.key)}>
                    {s.label}
                  </NavLink>
                ))}
              </nav>
              <div ref={setSlot} className="ws-actions" />
            </div>
          </header>
          <div className="ws-body">
            {/* A section loaded on first use (People, Settings) waits inside the opening, which stays put. */}
            <Suspense fallback={<SectionPending label="Loading" />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </WorkspaceCtx.Provider>
    </AppShell>
  )
}

/** A section that couldn't load: said plainly where the content would be, with a way to try again. */
export function SectionError({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const status = (error as { status?: number })?.status
  const message =
    status === 0 ? 'Muni can’t be reached. Check your connection.' : status === 403 || status === 404 ? 'You don’t have access to this any more.' : 'Something went wrong on our side.'
  return (
    <div className="ws-error" role="alert">
      <p className="font-medium">Couldn’t load {what}.</p>
      <p className="mt-1 text-sm text-ink-soft">{message}</p>
      <button type="button" className="ws-link mt-3" onClick={onRetry}>Try again</button>
    </div>
  )
}

/** First visit only: quiet lines where the content will be, shown only if it takes a moment. */
/** Two letters from a name, for its monogram. */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w))
  const first = (w: string | undefined) => (w ? ([...w].find((c) => /\p{L}/u.test(c)) ?? '') : '')
  return (first(words[0]) + (words.length > 1 ? first(words[1]) : '')).toUpperCase() || '·'
}

export function SectionPending({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="ws-pending" role="status" aria-label={label}>
      <span className="ws-pending-line" style={{ width: '42%', height: '1.6rem' }} />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="ws-pending-line" style={{ width: `${88 - i * 11}%` }} />
      ))}
    </div>
  )
}
