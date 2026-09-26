import { Link, NavLink, useNavigate } from 'react-router'
import { Wordmark } from '@/brand/Mark'
import { useAuth } from '@/lib/auth'
import { post } from '@/api/client'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { PenLine, Settings2 } from 'lucide-react'

export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { me, signOutLocal } = useAuth()
  const nav = useNavigate()
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur">
        <div className={clsx('mx-auto flex h-14 items-center justify-between gap-3 px-4', wide ? 'max-w-7xl' : 'max-w-5xl')}>
          <Link to="/" className="rounded-md text-ink">
            <Wordmark size={20} />
          </Link>
          {me ? (
            <nav className="flex items-center gap-1 text-sm">
              <NavLink to="/capture" className={({ isActive }) => clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium', isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:text-ink')}>
                <PenLine className="size-4" /> <span className="hidden sm:inline">Capture</span>
              </NavLink>
              <NavLink to="/account" className={({ isActive }) => clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5', isActive ? 'bg-accent-soft text-accent-ink' : 'text-ink-soft hover:text-ink')} aria-label="Account and privacy">
                <Settings2 className="size-4" /> <span className="hidden sm:inline">{me.display_name}</span>
              </NavLink>
              <button
                className="rounded-full px-3 py-1.5 text-ink-soft hover:text-ink"
                onClick={async () => {
                  try {
                    await post('/api/auth/logout')
                  } finally {
                    signOutLocal()
                    nav('/signin')
                  }
                }}
              >
                Sign out
              </button>
            </nav>
          ) : null}
        </div>
      </header>
      <main className={clsx('mx-auto w-full flex-1 px-4 py-6 sm:py-8', wide ? 'max-w-7xl' : 'max-w-5xl')}>{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-xs text-ink-faint">
        <span className="font-wordmark italic">A moment to reflect. A chance to improve.</span> · <Link to="/about" className="hover:text-ink">Privacy &amp; how Muni works</Link>
      </footer>
    </div>
  )
}

export function PageTitle({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="mb-1 text-sm text-ink-soft">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl leading-tight sm:text-3xl">{title}</h1>
        {children ? <div className="mt-2 text-ink-soft measure">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
