/**
 * The sprint bar: the same place at the top of every page of a sprint. The sprint's name and where
 * it is, one sentence on what that means for you, the three stops of its story (thoughts → retro →
 * outcomes, with the retro's planned date apart from the session actually starting), and — for the
 * facilitator — the one change of state that comes next, with what it will do for everyone. Routine
 * things (inviting, editing details) stay quiet, in a menu.
 *
 * The words and rules are in lib/lifecycle.ts; the server checks every change again.
 */
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import { ArrowRight, Check, Info, MoreHorizontal } from 'lucide-react'
import { ApiError, post } from '@/api/client'
import type { SprintDetail } from '@/api/types'
import { confirmCopy, type Action, type Confirm, type Plan, type ProgressStop } from '@/lib/lifecycle'
import { dateRange, retroShort } from '@/lib/schedule'
import { useResources } from '@/lib/resource'
import { keyring } from '@/lib/e2ee/keyring'
import { b64u } from '@/lib/e2ee/crypto'
import { Button, Dialog, useToast } from '@/ui'

/** What the bar needs to know about the sprint (a cached copy is enough offline). */
export type BarSprint = {
  id: string
  name: string
  workspace_id: string
  workspace_name?: string
  starts_on?: string
  ends_on?: string
  participant_count?: number
  goal?: string | null
  retro_at: string
  timezone: string
  is_facilitator?: boolean
  encryption?: 'e1' | null
  theme_count?: number
  entry_count?: number | null
}

type Transition = Action & { kind: 'transition' }

/** What a change of state tells the person who made it, once the server has it. */
const DONE: Record<string, string> = {
  collecting: 'Collection is open. Everyone in the sprint can add thoughts.',
  preparing: 'Collection is closed. Thoughts are revealed to everyone in the sprint.',
  archived: 'Sprint archived.',
  ready: 'The retro is paused.',
}

/**
 * Runs the bar's actions: links navigate, inviting opens its dialog, and a change of state asks
 * first when it matters. One change at a time: while one is on its way, every other waits (and the
 * server treats a repeat as already done).
 */
export function useSprintControl(s: Pick<BarSprint, 'id' | 'encryption'> & { status?: string }, opts: { online: boolean; onChanged: (d: SprintDetail) => void; onInvite?: () => void }) {
  const nav = useNavigate()
  const toast = useToast()
  const resources = useResources()
  const [confirming, setConfirming] = useState<Transition | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const transition = async (a: Transition) => {
    if (busy) return
    setBusy(a.to)
    try {
      const extra = s.encryption === 'e1' ? await encryptedTransition(s.id, s.status ?? '', a.to) : {}
      const d = await post<SprintDetail>(`/api/sprints/${s.id}/transition`, { to: a.to, confirm: !!a.confirm, ...extra })
      keyring.forgetSprint(s.id)
      // Lists elsewhere show this sprint's state: read them again when next shown.
      resources.invalidate(`/api/sprints/${s.id}`)
      resources.invalidate(`/api/workspaces/${d.workspace_id}`)
      setConfirming(null)
      opts.onChanged(d)
      if (DONE[a.to]) toast(DONE[a.to])
      if (a.then) nav(a.then)
    } catch (err) {
      toast(err instanceof ApiError ? sentence(err.message) : err instanceof Error ? err.message : 'Couldn’t change the sprint', 'danger')
    } finally {
      setBusy(null)
    }
  }
  const run = (a: Action) => {
    if (a.kind === 'link') return nav(a.href)
    if (a.kind === 'invite') return opts.onInvite?.()
    if (a.confirm) return setConfirming(a)
    return transition(a)
  }
  return { run, busy, confirming, transition, cancel: () => setConfirming(null), online: opts.online }
}
export type SprintControl = ReturnType<typeof useSprintControl>

/**
 * Encrypted sprints: closing collection is the reveal — this device seals the sprint's secret to
 * each participant. Reopening starts a fresh key version that only the facilitator holds.
 */
async function encryptedTransition(sprintId: string, from: string, to: string): Promise<Record<string, unknown>> {
  if (from === 'collecting' && to === 'preparing') {
    const k = await keyring.sprint(sprintId, true)
    if (!k?.view.sealed_version || !k.keys.has(k.view.sealed_version)) throw new Error('This device doesn’t have the sprint’s key, so it can’t reveal the thoughts. Unlock your writing on this device first (with your passkey, or your recovery key), then try again.')
    return { key_wraps: await keyring.missingWraps(sprintId, { reveal: true }) }
  }
  if ((from === 'preparing' || from === 'ready') && to === 'collecting') {
    const k = await keyring.sprint(sprintId, true)
    const me = keyring.accountId()
    const pk = keyring.publicKey()
    if (!me || !pk || !k) throw new Error('Unlock this device first.')
    const latest = k.view.versions?.at(-1)?.version ?? 0
    return keyring.newSprintKey(sprintId, latest + 1, { account_id: me, public_key: b64u(pk) })
  }
  return {}
}

export function SprintBar({
  s,
  plan,
  control,
  view = 'sprint',
  extra,
  compact,
  slim,
}: {
  s: BarSprint
  plan: Plan
  control: SprintControl
  /** A page inside the sprint (its themes) names the sprint as a way back rather than as its title. */
  view?: 'sprint' | 'themes'
  /** Facilitator-only facts under the controls (who can't read yet). */
  extra?: ReactNode
  /**
   * While writing on a phone the bar folds to two lines — the name with the facilitator's next
   * change, then where the sprint is and the planned retro — so the words stay in the first
   * screen. "Details" unfolds the rest.
   */
  compact?: boolean
  /** Two lines at every width, until Details unfolds it (a working surface like Themes). */
  slim?: boolean
}) {
  const [open, setOpen] = useState(false)
  const when = retroShort(s.retro_at, s.timezone)
  const fac = !!s.is_facilitator
  const facts = [s.starts_on && s.ends_on ? dateRange(s.starts_on, s.ends_on) : null, s.participant_count !== undefined ? `${s.participant_count} ${s.participant_count === 1 ? 'person' : 'people'}` : null].filter(Boolean)
  // On the themes page, the way to it would point at itself.
  const secondary = view === 'themes' ? plan.secondary.filter((a) => !(a.kind === 'link' && a.href.endsWith('/prepare'))) : plan.secondary
  const hasControl = !!(plan.control || secondary.length || plan.more.length)
  const Name = view === 'sprint' ? 'h1' : 'p'
  return (
    <section className="sbar" aria-labelledby={`sbar-${s.id}`} data-phase={plan.phase} data-compact={compact || slim || undefined} data-slim={slim || undefined} data-open={open || undefined}>
      <div className="sbar-top">
        <div className="sbar-id">
          <p className="sbar-kicker">
            <Link to={`/workspaces/${s.workspace_id}`}>{s.workspace_name || 'Sprints'}</Link>
          </p>
          <Name id={`sbar-${s.id}`} className="sbar-name">
            {view === 'sprint' ? s.name : <Link to={`/sprints/${s.id}`}>{s.name}</Link>}
          </Name>
          <p className="sbar-status">
            <span className="sbar-state">
              <span className="sbar-dot" aria-hidden />
              {plan.status}
            </span>
            {facts.length ? <span className="sbar-facts">{facts.join(' · ')}</span> : null}
            {(compact || slim) && when && plan.phase !== 'live' && plan.phase !== 'done' ? <span className="sbar-when">{when.replace(/^retro /, 'retro planned ')}</span> : null}
            {compact || slim ? (
              <button type="button" className="sbar-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? 'Less' : 'Details'}
              </button>
            ) : null}
          </p>
          {view === 'sprint' ? <p className="sbar-line">{plan.line}</p> : null}
          {plan.notes.length ? (
            <ul className="sbar-notes">
              {plan.notes.map((n) => (
                <li key={n}>
                  <Info className="size-4 shrink-0" aria-hidden /> {n}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {hasControl ? (
          <div className="sbar-control" role="group" aria-label={fac ? 'Facilitator controls' : 'Next step'}>
            {fac ? <p className="sbar-role">You’re facilitating</p> : null}
            {plan.control ? <ActionButton a={plan.control} control={control} primary /> : null}
            {plan.consequence ? <p className="sbar-consequence">{plan.consequence}</p> : null}
            {secondary.length || plan.more.length ? (
              <div className="sbar-quiet">
                {secondary.map((a) => (
                  <QuietAction key={a.label} a={a} control={control} />
                ))}
                {plan.more.length ? <MoreMenu actions={plan.more} control={control} /> : null}
              </div>
            ) : null}
            {extra}
          </div>
        ) : null}
      </div>
      <Progress stops={plan.progress} />
      {control.confirming ? <ConfirmDialog kind={control.confirming.confirm!} s={s} busy={!!control.busy} onCancel={control.cancel} onConfirm={() => control.transition(control.confirming!)} /> : null}
    </section>
  )
}

function ActionButton({ a, control, primary }: { a: Action; control: SprintControl; primary?: boolean }) {
  const isTransition = a.kind === 'transition'
  // Going somewhere is a link, so it opens in a new tab and reads as one.
  if (a.kind === 'link')
    return (
      <Link to={a.href} className={`ws-btn ${primary ? 'ws-btn--primary' : 'ws-btn--secondary'} sbar-button`}>
        {a.label} <ArrowRight className="size-4" aria-hidden />
      </Link>
    )
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      className="sbar-button"
      busy={isTransition && control.busy === a.to}
      disabled={(isTransition && !control.online) || (!!control.busy && isTransition)}
      onClick={() => control.run(a)}
    >
      {a.label}
    </Button>
  )
}

function QuietAction({ a, control }: { a: Action; control: SprintControl }) {
  if (a.kind === 'link') return <Link to={a.href} className="sbar-link">{a.label}</Link>
  return (
    <button type="button" className="sbar-link" disabled={a.kind === 'transition' && (!control.online || !!control.busy)} onClick={() => control.run(a)}>
      {a.label}
    </button>
  )
}

/** Routine and rare actions: one quiet control, every action named. Touch and keyboard. */
function MoreMenu({ actions, control }: { actions: Action[]; control: SprintControl }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="sbar-link sbar-more" aria-haspopup="menu">
          <MoreHorizontal className="size-4" aria-hidden /> More
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={12} className="menu-panel anim-rise" role="menu" aria-label="More for this sprint">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={a.kind === 'transition' && (!control.online || !!control.busy)}
              onClick={() => {
                setOpen(false)
                control.run(a)
              }}
            >
              {a.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * Three stops, not a wizard: done stops are ticked, the current one is filled and says so, the
 * rest are open. Describes; never navigates, so looking at it can't change anything.
 */
export function Progress({ stops }: { stops: ProgressStop[] }) {
  return (
    <ol className="sbar-progress" aria-label="Where this sprint is">
      {stops.map((p) => (
        <li key={p.id} data-state={p.state} aria-current={p.state === 'now' ? 'step' : undefined}>
          <span className="sbar-mark" aria-hidden>{p.state === 'done' ? <Check className="size-2.5" strokeWidth={3.5} /> : null}</span>
          <span className="sbar-stop">
            {p.label}
            <span className="sr-only">{p.state === 'done' ? ', done' : p.state === 'now' ? ', now' : ''}: </span>
          </span>
          <span className="sbar-detail">{p.detail}</span>
        </li>
      ))}
    </ol>
  )
}

export function ConfirmDialog({ kind, s, onConfirm, onCancel, busy }: { kind: Confirm; s: BarSprint; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const c = confirmCopy(kind, { retro_at: s.retro_at, timezone: s.timezone, participant_count: s.participant_count ?? 0, theme_count: s.theme_count, entry_count: s.entry_count })
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()} title={c.title} description={c.body[0]}>
      {c.body.slice(1).map((b) => (
        <p key={b} className="mt-2 text-sm text-ink-soft">{b}</p>
      ))}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{c.cancel}</Button>
        <Button variant={kind === 'stop' ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{c.confirm}</Button>
      </div>
    </Dialog>
  )
}

function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
