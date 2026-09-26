import { Link } from 'react-router'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { Wordmark, Mark } from '@/brand/Mark'
import type { Me } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { useCurrentWorkspace } from '@/lib/workspace'
import { AccountMenu, WorkspaceSwitcher } from '@/ui/menus'
import { SessionBanner, SyncChip, UpdateNotice } from '@/ui/status'

/**
 * One header everywhere: Muni, the workspace you're in, a quiet sync state when there is one, and
 * you. Everything administrative lives in those two menus, not on the page.
 */
export function AppShell({ children, wide, workspace }: { children: ReactNode; wide?: boolean; workspace?: Me['workspaces'][number] | null }) {
  const { me } = useAuth()
  const fallback = useCurrentWorkspace(me)
  const current = workspace === undefined ? fallback : workspace
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <div className={clsx('mx-auto flex h-14 items-center gap-1 px-3 sm:gap-2 sm:px-4', wide ? 'max-w-7xl' : 'max-w-5xl')}>
          <Link to="/" className="shrink-0 rounded-md px-1 text-ink" aria-label="Muni home">
            <span className="hidden sm:inline-flex"><Wordmark size={20} /></span>
            <span className="sm:hidden"><Mark size={26} /></span>
          </Link>
          {me ? (
            <>
              <span aria-hidden className="mx-1 h-5 w-px bg-line" />
              <WorkspaceSwitcher current={current} />
              <div className="ml-auto flex items-center gap-2">
                <SyncChip />
                <AccountMenu />
              </div>
            </>
          ) : null}
        </div>
      </header>
      <SessionBanner />
      <main className={clsx('pb-safe mx-auto w-full flex-1 px-4 pt-6 sm:pt-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</main>
      <UpdateNotice />
    </div>
  )
}

export function PageTitle({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm text-ink-soft">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl leading-tight [overflow-wrap:anywhere] sm:text-3xl">{title}</h1>
        {children ? <div className="mt-2 text-ink-soft measure">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
