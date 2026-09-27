import { Link, useLocation } from 'react-router'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { Wordmark, Mark } from '@/brand/Mark'
import type { Me } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { useCurrentWorkspace } from '@/lib/workspace'
import { AccountMenu, WorkspaceSwitcher } from '@/ui/menus'
import { SessionBanner, SyncChip, UpdateNotice } from '@/ui/status'
import { CharacterDialog } from '@/worlds/Character'

/**
 * One header everywhere: Muni, the workspace you're in, the way to write (a shortcut to the sprint
 * that's collecting) and the workspace's sprints, a quiet sync state when there is one, and you. Administration lives in
 * the workspace's People and Settings pages and the two menus, not on the page you work on.
 */
export function AppShell({ children, wide, workspace }: { children: ReactNode; wide?: boolean; workspace?: Me['workspaces'][number] | null }) {
  const { me } = useAuth()
  const fallback = useCurrentWorkspace(me)
  const current = workspace === undefined ? fallback : workspace
  const { pathname } = useLocation()
  const nav = 'inline-flex h-9 items-center rounded-full px-3 text-sm text-ink-soft hover:bg-ink/5 hover:text-ink aria-[current=page]:bg-card aria-[current=page]:font-medium aria-[current=page]:text-ink aria-[current=page]:shadow-[0_0_0_1px_var(--line)]'
  return (
    <div className="app-bg flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-30 border-b border-line/60 bg-paper/80 backdrop-blur-md">
        <div className={clsx('mx-auto flex h-14 items-center gap-1 px-3 sm:gap-2 sm:px-4', wide ? 'max-w-7xl' : 'max-w-5xl')}>
          <Link to="/" className="shrink-0 rounded-md px-1 text-ink" aria-label="Muni: your current sprint">
            <span className="hidden sm:inline-flex"><Wordmark size={20} /></span>
            <span className="sm:hidden"><Mark size={26} /></span>
          </Link>
          {me ? (
            <>
              <span aria-hidden className="mx-1 h-5 w-px bg-line" />
              <WorkspaceSwitcher current={current} />
              {current ? (
                <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
                  {/* A shortcut to the sprint that's collecting, with the field in reach: the same page as opening the sprint. */}
                  <Link to="/" state={{ write: true }} className={nav}>Write</Link>
                  <Link to={`/workspaces/${current.id}`} className={nav} aria-current={pathname.startsWith(`/workspaces/${current.id}`) || pathname.startsWith('/sprints/') ? 'page' : undefined}>Sprints</Link>
                </nav>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                <SyncChip />
                <AccountMenu />
              </div>
            </>
          ) : null}
        </div>
      </header>
      <SessionBanner />
      <main className={clsx('pb-safe mx-auto w-full flex-1 px-4 pb-16 pt-6 sm:px-6 sm:pt-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</main>
      <UpdateNotice />
      {me ? <CharacterDialog /> : null}
    </div>
  )
}

export function PageTitle({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm text-ink-soft">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl leading-tight [overflow-wrap:anywhere] sm:text-[30px]">{title}</h1>
        {children ? <div className="mt-2 max-w-prose text-ink-soft">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * A page anyone can read, signed in or not (Privacy, About): inside the app's header when signed
 * in; otherwise a quiet header with the wordmark and a way to sign in.
 */
export function InfoShell({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  if (me) return <AppShell>{children}</AppShell>
  return (
    <div className="app-bg min-h-dvh">
      <header className="pt-safe border-b border-line/70">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="rounded-md px-1 text-ink" aria-label="Muni home"><Wordmark size={20} /></Link>
          <Link to="/signin" className="rounded-full px-3 py-1.5 text-sm font-medium text-ink hover:bg-ink/5">Sign in</Link>
        </div>
      </header>
      <main className="pb-safe px-4 pt-8">{children}</main>
    </div>
  )
}
