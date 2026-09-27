/**
 * Lifecycle guidance on screen: a compact progress line, the plain-language status with the next
 * step for you, and — kept visibly apart — the facilitator's area. Consequential changes explain
 * their real effect before they happen (lib/lifecycle.ts holds the words and the rules).
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, Info } from 'lucide-react'
import { ApiError, post } from '@/api/client'
import type { SprintDetail } from '@/api/types'
import { CONFIRM_COPY, STEPS, type Action, type Confirm, type Guide, type Step } from '@/lib/lifecycle'
import { Button, Dialog, useToast } from '@/ui'
import { keyring } from '@/lib/e2ee/keyring'
import { b64u } from '@/lib/e2ee/crypto'

export function StepPips({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step)
  return (
    <ol className="steps flex-wrap" aria-label="Sprint progress">
      {STEPS.map((s, i) => (
        <li key={s.id} data-done={i < at || undefined} aria-current={i === at ? 'step' : undefined}>
          <span className="pip" aria-hidden />
          <span className={i === at ? '' : 'hidden sm:inline'}>{s.label}</span>
          {i < at ? <span className="sr-only"> (done)</span> : null}
        </li>
      ))}
    </ol>
  )
}

const variant = (a: Action) => (a.tone === 'primary' ? 'primary' : a.tone === 'secondary' ? 'secondary' : 'ghost') as 'primary' | 'secondary' | 'ghost'

/** Runs an action: links navigate, writing focuses the composer, transitions confirm first when they matter. */
export function useActionRunner(s: Pick<SprintDetail, 'id'> & Partial<Pick<SprintDetail, 'status' | 'encryption'>>, opts: { onChanged: (d: SprintDetail) => void; onInvite?: () => void; online: boolean }) {
  const nav = useNavigate()
  const toast = useToast()
  const [confirming, setConfirming] = useState<(Action & { kind: 'transition' }) | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const transition = async (a: Action & { kind: 'transition' }) => {
    setBusy(a.to)
    try {
      const extra = s.encryption === 'e1' ? await encryptedTransition(s.id, s.status ?? '', a.to) : {}
      const d = await post<SprintDetail>(`/api/sprints/${s.id}/transition`, { to: a.to, confirm: !!a.confirm, ...extra })
      keyring.forgetSprint(s.id)
      setConfirming(null)
      opts.onChanged(d)
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
    if (a.kind === 'write') {
      const el = document.querySelector<HTMLTextAreaElement>('textarea[name="thought"]')
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus({ preventScroll: true })
      return
    }
    if (a.confirm) return setConfirming(a)
    return transition(a)
  }
  const button = (a: Action, key?: string | number, size: 'sm' | 'md' = 'md') => (
    <Button key={key ?? a.label} size={size} variant={variant(a)} busy={a.kind === 'transition' && busy === a.to} disabled={a.kind === 'transition' && !opts.online} onClick={() => run(a)}>
      {a.label}
      {a.tone === 'primary' && a.kind !== 'write' ? <ArrowRight className="size-4" aria-hidden /> : null}
    </Button>
  )
  const dialog = confirming ? <ConfirmDialog kind={confirming.confirm!} busy={!!busy} onCancel={() => setConfirming(null)} onConfirm={() => transition(confirming)} /> : null
  return { run, button, dialog }
}

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
  if (from === 'preparing' && to === 'collecting') {
    const k = await keyring.sprint(sprintId, true)
    const me = keyring.accountId()
    const pk = keyring.publicKey()
    if (!me || !pk || !k) throw new Error('Unlock this device first.')
    const latest = k.view.versions?.at(-1)?.version ?? 0
    return keyring.newSprintKey(sprintId, latest + 1, { account_id: me, public_key: b64u(pk) })
  }
  return {}
}

export function ConfirmDialog({ kind, onConfirm, onCancel, busy }: { kind: Confirm; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  const c = CONFIRM_COPY[kind]
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()} title={c.title} description={c.body[0]}>
      {c.body.slice(1).map((b) => <p key={b} className="text-sm text-ink-soft">{b}</p>)}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{c.cancel}</Button>
        <Button variant={kind === 'stop' ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{c.confirm}</Button>
      </div>
    </Dialog>
  )
}

/** The status block at the top of a sprint: where it is, what it means, what you can do. */
export function GuidePanel({ g, runner, extra, composerShown }: { g: Guide; runner: ReturnType<typeof useActionRunner>; extra?: React.ReactNode; composerShown?: boolean }) {
  const actions = composerShown ? g.actions.filter((a) => a.kind !== 'write') : g.actions
  return (
    <section aria-labelledby="guide-title" className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Where things are</p>
          <h2 id="guide-title" className="font-display mt-1 text-xl leading-tight">{g.title}</h2>
          <p className="mt-1 max-w-prose text-ink-soft">{g.body}</p>
        </div>
        {actions.length ? <div className="flex shrink-0 flex-wrap gap-2">{actions.map((a) => runner.button(a))}</div> : null}
      </div>
      {g.notes.length ? (
        <ul className="space-y-2">
          {g.notes.map((n) => (
            <li key={n} className="flex items-start gap-2 rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> {n}</li>
          ))}
        </ul>
      ) : null}
      {g.facilitator ? (
        <div className="fac-area p-4 sm:p-5" role="group" aria-labelledby="fac-title">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p id="fac-title" className="eyebrow">Facilitator · only you see this</p>
              <p className="mt-1 max-w-prose text-[15px]">{g.facilitator.body}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">{g.facilitator.actions.map((a) => runner.button(a, a.label, 'sm'))}</div>
          </div>
          {extra}
        </div>
      ) : null}
      {runner.dialog}
    </section>
  )
}

export function GuideLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">{children} <ArrowRight className="size-4" aria-hidden /></Link>
}

function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
