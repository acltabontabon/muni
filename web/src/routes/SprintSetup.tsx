import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Check, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { ApiError, del, get, patch, post } from '@/api/client'
import { useResources } from '@/lib/resource'
import type { SprintDetail, WorkspaceDetail } from '@/api/types'
import { resync } from '@/lib/forms'
import { dateRange, describeRetro, zoneName } from '@/lib/schedule'
import { planSetup, setupSteps, setupValues, type SetupValues } from '@/lib/setup-plan'
import { realDate, setupInstant, setupProblems, sprintLength } from '@/lib/sprint-setup'
import { useAuth } from '@/lib/auth'
import { accountFormDrafts } from '@/lib/form-drafts'
import { Button, ErrorText, Help, Input, Label, Select, Spinner, Switch, useDocumentTitle, useToast } from '@/ui'
import { AppShell } from '@/ui/shell'
import { isLocked, keyring } from '@/lib/e2ee/keyring'
import { b64u } from '@/lib/e2ee/crypto'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { DeviceKeyNotice } from '@/ui/keys'
import { useGuidePage } from '@/guide/GuideProvider'
import '@/workspace-ux.css'

const tzOptions = () => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'Asia/Manila', 'Europe/Berlin', 'America/New_York']
  }
}

/** A local calendar date n days from `d` (never shifted by UTC). */
function plusDays(d: Date, n: number) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

type Form = SetupValues & { encrypt: boolean }
/** Kept only in this tab's memory, per account and sprint/workspace. Never written to storage. */
const drafts = accountFormDrafts<{ form: Form; saved: SetupValues | null }>()

function Section({ n, title, lead, children }: { n: number; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={`setup-${n}`} className="setup-section grid gap-4 border-t border-line/70 pt-7 first:border-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10" aria-labelledby={`sec-${n}`}>
      <div>
        <p className="eyebrow">Step {n}</p>
        <h2 id={`sec-${n}`} className="font-display mt-1 text-lg">{title}</h2>
        {lead ? <p className="mt-1 text-sm text-ink-soft">{lead}</p> : null}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  )
}

/** A field's error, beside the field, announced when it appears. */
function Problem({ id, children }: { id: string; children?: string }) {
  if (!children) return null
  return <p id={id} className="mt-1.5 text-sm text-danger">{children}</p>
}

/** Create (workspace route) or edit (sprint route) a sprint. */
export function SprintSetup() {
  const { workspaceId, sprintId } = useParams()
  return <SprintSetupForm key={sprintId ?? workspaceId} />
}

function SprintSetupForm() {
  const { workspaceId: wsParam, sprintId } = useParams()
  const { me } = useAuth()
  const draftKey = `${me?.account_id}:${sprintId ?? `new:${wsParam}`}`
  const nav = useNavigate()
  const toast = useToast()
  const resources = useResources()
  const [ws, setWs] = useState<WorkspaceDetail | null>(null)
  const [existing, setExisting] = useState<SprintDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'draft' | 'open' | 'save' | null>(null)
  const [tried, setTried] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const waitingFocus = useRef<string | null>(null)
  useEffect(() => {
    if (advanced && waitingFocus.current) {
      document.getElementById(`f-${waitingFocus.current}`)?.focus()
      waitingFocus.current = null
    }
  }, [advanced])
  const kept = useRef(drafts.get(draftKey))
  const [resumed, setResumed] = useState(!!kept.current)
  const today = useMemo(() => new Date(), [])
  const freshSetup = useMemo<Form>(() => ({
    name: '',
    external_ref: '',
    goal: '',
    opening_question: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    starts_on: plusDays(today, 0),
    ends_on: plusDays(today, 13),
    retro_date: plusDays(today, 13),
    retro_time: '14:00',
    retro_duration_min: 45,
    facilitator_id: '',
    participant_ids: [],
    reminders_enabled: true,
    vote_budget: 3,
    encrypt: true,
  }), [today])
  const [f, setF] = useState<Form>(() => kept.current?.form ?? freshSetup)
  const initial = useRef<Form | null>(null)
  useDocumentTitle(existing ? `Setup · ${existing.name}` : 'New sprint')
  const { state: deviceKeys, keysEpoch } = useDeviceKeys()
  const [keyProblem, setKeyProblem] = useState('')
  /** The server's setup the form was last filled from: fields still as they were follow newer values. */
  const loaded = useRef<SetupValues | null>(kept.current?.saved ?? null)
  const loadSprint = useCallback(async (id: string) => {
    const s = await get<SprintDetail>(`/api/sprints/${id}`)
    const fresh = setupValues(s)
    const prev = loaded.current
    loaded.current = fresh
    setExisting(s)
    setF(({ encrypt: _encrypt, ...values }) => ({ ...(prev ? resync(values, prev, fresh) : fresh), encrypt: s.encryption === 'e1' }))
    return s
  }, [])
  useEffect(() => {
    ;(async () => {
      try {
        let wid = wsParam
        if (sprintId) wid = (await loadSprint(sprintId)).workspace_id
        const w = await get<WorkspaceDetail>(`/api/workspaces/${wid}`)
        setWs(w)
        if (!sprintId) {
          const me = w.members.find((m) => m.is_you)
          setF((p) => {
            const fresh = { ...freshSetup, facilitator_id: me?.account_id ?? '', participant_ids: w.members.map((m) => m.account_id) }
            initial.current = fresh
            return kept.current ? p : fresh
          })
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Couldn’t load')
      }
    })()
  }, [wsParam, sprintId, loadSprint, freshSetup])
  // This device just unlocked: an opening question it couldn't show can be shown (and edited) now.
  const epochSeen = useRef(keysEpoch)
  useEffect(() => {
    if (!sprintId || keysEpoch === epochSeen.current) return
    epochSeen.current = keysEpoch
    loadSprint(sprintId).catch(() => {})
  }, [sprintId, keysEpoch, loadSprint])

  const editForm = (change: Partial<Form>) => setF((p) => {
    const next = { ...p, ...change }
    drafts.set(draftKey, { form: next, saved: loaded.current })
    return next
  })
  const set = <K extends keyof Form>(k: K, v: Form[K]) => editForm({ [k]: v })
  // This device's zone, or the sprint's, may be spelled in a way the list doesn't carry (UTC,
  // Asia/Calcutta): it's added, so the select never shows a different zone than the one kept.
  const zones = useMemo(() => tzOptions(), [])
  const zoneList = useMemo(() => (zones.includes(f.timezone) ? zones : [...zones, f.timezone].sort()), [zones, f.timezone])
  const issues = setupProblems(f)
  const shown = (k: keyof SetupValues) => (tried ? issues[k] : undefined)
  const invalid = (k: keyof SetupValues) => (shown(k) ? { 'aria-invalid': true, 'aria-describedby': `p-${k}` } : {})
  const dirty = existing && loaded.current ? setupSteps(planSetup(loaded.current, f)).length > 0 : !!initial.current && JSON.stringify(f) !== JSON.stringify(initial.current)
  useEffect(() => {
    if (!dirty || busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])
  const focusProblem = (field: string) => {
    if (field === 'vote_budget' && !advanced) {
      waitingFocus.current = field
      setAdvanced(true)
    } else document.getElementById(`f-${field}`)?.focus()
  }

  const submit = async (mode: 'draft' | 'open' | 'save', e?: FormEvent) => {
    e?.preventDefault()
    // One sprint per press: while one is being made, the other button (and Enter) waits.
    if (busy) return
    setTried(true)
    if (Object.keys(issues).length) {
      const first = Object.keys(issues)[0]
      focusProblem(first)
      return
    }
    setBusy(mode)
    setError('')
    setKeyProblem('')
    try {
      const schedule = { timezone: f.timezone, starts_on: f.starts_on, ends_on: f.ends_on, retro_date: f.retro_date, retro_time: f.retro_time, retro_duration_min: Number(f.retro_duration_min) }
      if (existing) {
        const { encrypt: _encrypt, ...values } = f
        const plan = planSetup(loaded.current ?? setupValues(existing), values)
        const body: Record<string, unknown> = { ...plan.fields }
        const nameOf = (id: string) => ws?.members.find((m) => m.account_id === id)?.display_name ?? 'Someone'
        if (plan.handover && existing.encryption === 'e1') {
          // The sprint's key goes with the role, sealed on this device to the new facilitator — every
          // version it holds, the one still sealed included. Nothing is sent if that can't be done.
          const keys = await get<{ account_id: string; public_key: string }[]>(`/api/workspaces/${existing.workspace_id}/member-keys`)
          const theirs = keys.find((k) => k.account_id === plan.handover)
          if (!theirs) {
            setKeyProblem('They haven’t set up encryption yet, so they can’t hold this sprint’s key. Ask them to open Muni first, or keep the current facilitator.')
            return
          }
          try {
            body.key_wraps = await keyring.wrapAllFor(existing.id, { ...theirs, display_name: nameOf(theirs.account_id) })
          } catch (e) {
            setKeyProblem(e instanceof Error ? e.message : 'This device couldn’t pass on the sprint’s key.')
            return
          }
        }
        // One request at a time, in the order the server takes them (lib/setup-plan). If one fails,
        // what went through is said, and the next save starts from what's saved now.
        const done: string[] = []
        try {
          for (const step of setupSteps(plan)) {
            if (step.kind === 'add') {
              await post(`/api/sprints/${existing.id}/participants`, { account_id: step.accountId })
              done.push(`${nameOf(step.accountId)} was added`)
            } else if (step.kind === 'remove') {
              await del(`/api/sprints/${existing.id}/participants/${step.accountId}`)
              done.push(`${nameOf(step.accountId)} was taken off it`)
            } else {
              await patch(`/api/sprints/${existing.id}`, body)
              done.push(plan.handover ? `${nameOf(plan.handover)} facilitates it now` : 'the sprint’s details were saved')
            }
          }
        } catch (err) {
          const why = err instanceof ApiError ? sentence(err.message) : 'Something went wrong.'
          setError(done.length ? `Only part of this was saved: ${done.join(', ')}. ${why} Check the setup and save again.` : why)
          resources.invalidate(`/api/sprints/${existing.id}`)
          await loadSprint(existing.id).catch(() => {})
          return
        }
        toast(done.length ? 'Setup saved' : 'Nothing had changed')
        resources.invalidate(`/api/sprints/${existing.id}`)
        resources.invalidate(`/api/workspaces/${existing.workspace_id}`)
        drafts.delete(draftKey)
        nav(`/sprints/${existing.id}`)
      } else {
        let enc: Record<string, unknown> = {}
        let opening: string | undefined = f.opening_question || undefined
        if (f.encrypt) {
          // Created here: the sprint's id, its first key, and that key sealed to the facilitator.
          const me = keyring.accountId()
          const mine = keyring.publicKey()
          let facPk: string | undefined
          if (f.facilitator_id === me) facPk = mine && deviceKeys.kind === 'ready' ? b64u(mine) : undefined
          else facPk = (await get<{ account_id: string; public_key: string }[]>(`/api/workspaces/${wsParam}/member-keys`)).find((k) => k.account_id === f.facilitator_id)?.public_key
          if (!facPk) {
            setKeyProblem(f.facilitator_id === me ? 'Set up encryption on this device first (above), or create the sprint without encryption.' : 'The facilitator hasn’t set up encryption yet. Choose another facilitator, or create the sprint without encryption.')
            return
          }
          const id = crypto.randomUUID()
          enc = { id, encryption: 'e1', ...keyring.newSprintKey(id, 1, { account_id: f.facilitator_id, public_key: facPk }) }
          if (opening) opening = keyring.sealForNew(id, 1, 'opening_question', opening)
        }
        const s = await post<SprintDetail>(`/api/workspaces/${wsParam}/sprints`, { name: f.name, external_ref: f.external_ref || undefined, goal: f.goal || undefined, opening_question: opening, ...schedule, participant_ids: f.participant_ids, facilitator_id: f.facilitator_id, reminders_enabled: f.reminders_enabled, vote_budget: Number(f.vote_budget), ...enc })
        if (mode === 'open') {
          try {
            await post(`/api/sprints/${s.id}/transition`, { to: 'collecting' })
            toast('Sprint created — collection is open')
          } catch (err) {
            toast(`Sprint saved as a draft, but collection didn’t open: ${err instanceof ApiError ? err.message : 'try again from the sprint'}`, 'danger')
          }
        } else toast('Saved as a draft — open collection when you’re ready')
        resources.invalidate(`/api/workspaces/${wsParam}`)
        drafts.delete(draftKey)
        nav(`/sprints/${s.id}`)
      }
    } catch (err) {
      setError(err instanceof ApiError ? sentence(err.message) : 'Couldn’t save. Your setup is still here — try again.')
    } finally {
      setBusy(null)
    }
  }

  useGuidePage(ws && !sprintId ? { at: 'setup', workspaceId: ws.workspace.id, creating: true, online: typeof navigator === 'undefined' || navigator.onLine } : null)
  if (!ws)
    return (
      <AppShell>
        {error ? <ErrorText>{error}</ErrorText> : <div className="grid place-items-center py-20"><Spinner /></div>}
      </AppShell>
    )
  const retroAt = setupInstant(f.retro_date, f.retro_time, f.timezone)
  const preview = retroAt !== null ? describeRetro(retroAt, f.timezone) : null
  const facilitatorIsYou = ws.members.find((m) => m.is_you)?.account_id === f.facilitator_id
  // Whoever facilitates now stays in the sprint: handing over leaves them a participant (the new
  // facilitator can take them off it later).
  const current = existing ? loaded.current?.facilitator_id : undefined
  const handingOver = !!current && current !== f.facilitator_id
  const stays = (id: string) => id === f.facilitator_id || id === current
  const everyone = ws.members.every((m) => f.participant_ids.includes(m.account_id) || stays(m.account_id))
  const count = new Set([...f.participant_ids, f.facilitator_id, ...(current ? [current] : [])]).size
  const questionLocked = isLocked(f.opening_question)
  // Cancel goes back within Muni; opened straight from a link, it goes to the workspace instead.
  const cancelNew = () => ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0 ? nav(-1) : nav(`/workspaces/${ws.workspace.id}`, { replace: true })
  const openNote = 'Opening collection lets everyone in the sprint start writing. Thoughts stay hidden — from you too — until you close it.'
  const length = realDate(f.starts_on) && realDate(f.ends_on) ? Math.round((Date.parse(f.ends_on) - Date.parse(f.starts_on)) / 86_400_000) + 1 : null

  return (
    <AppShell>
      <div className="setup-head mb-8">
        <nav aria-label="You are here" className="text-sm text-ink-soft">
          <Link to={`/workspaces/${ws.workspace.id}`} className="hover:text-ink hover:underline">{ws.workspace.name}</Link>
          {existing ? <> <span aria-hidden className="text-ink-faint">/</span> <Link to={`/sprints/${existing.id}`} className="hover:text-ink hover:underline">{existing.name}</Link></> : null}
        </nav>
        <p className="ws-eyebrow mt-5">{existing ? 'Make room for the team' : 'Good retros begin here'}</p>
        <h1 className="setup-title">{existing ? 'Sprint setup' : <>A little space to <em>reflect.</em></>}</h1>
        <p className="setup-intro">{existing ? 'Update the plan, then save your changes. People already writing keep their thoughts.' : 'Give this sprint a home. Your team can keep thoughts as the work happens, then bring them to the retro.'}</p>
        <nav aria-label="Setup sections" className="setup-index">
          {['Name', 'When', 'Who’s in', ...(!existing ? ['Privacy'] : [])].map((label, i) => <a key={label} href={`#setup-${i + 1}`}><span>{String(i + 1).padStart(2, '0')}</span> {label}</a>)}
        </nav>
        {resumed ? <div className="setup-resumed" role="status"><Check className="size-4" aria-hidden /><p>Your unsaved setup is still here. Carry on where you left off.</p><button type="button" className="ws-link" onClick={() => { drafts.delete(draftKey); setF(existing ? { ...setupValues(existing), encrypt: existing.encryption === 'e1' } : initial.current ?? freshSetup); setResumed(false); setTried(false); setError('') }}>Discard edits</button></div> : null}
      </div>
      <form onSubmit={(e) => submit(existing ? 'save' : 'open', e)} noValidate className="sprint-setup space-y-8" aria-label={existing ? 'Sprint setup' : 'New sprint setup'} aria-busy={!!busy}>
        <fieldset disabled={!!busy} className="setup-fields space-y-8">
        <Section n={1} title="Name">
          <div>
            <Label htmlFor="f-name">Sprint name</Label>
            <Input id="f-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Sprint 42 — Billing export" maxLength={120} {...invalid('name')} />
            <Problem id="p-name">{shown('name')}</Problem>
            {!shown('name') ? <Help>Everyone in the sprint sees it. It’s a label, not a password — access comes from being in the sprint.</Help> : null}
          </div>
          <div>
            <Label htmlFor="f-goal" hint="optional">Sprint goal</Label>
            <Input id="f-goal" value={f.goal} onChange={(e) => set('goal', e.target.value)} maxLength={300} placeholder="One line the team is working toward" />
          </div>
        </Section>

        <Section n={2} title="When" lead="Write throughout the sprint. Meet for the retro when your team is ready.">
          {!existing ? <div className="setup-presets" role="group" aria-label="Sprint length"><span>Start with</span>{[1, 2, 3].map((weeks) => <button type="button" key={weeks} aria-pressed={length === weeks * 7} disabled={!realDate(f.starts_on)} onClick={() => editForm(sprintLength(f, weeks))}>{weeks} {weeks === 1 ? 'week' : 'weeks'}</button>)}</div> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="f-starts_on">Sprint starts</Label>
              <Input id="f-starts_on" type="date" value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} {...invalid('starts_on')} />
              <Problem id="p-starts_on">{shown('starts_on')}</Problem>
            </div>
            <div>
              <Label htmlFor="f-ends_on">Sprint ends</Label>
              <Input id="f-ends_on" type="date" min={f.starts_on || undefined} value={f.ends_on} onChange={(e) => editForm({ ends_on: e.target.value, ...(f.retro_date === f.ends_on ? { retro_date: e.target.value } : {}) })} {...invalid('ends_on')} />
              <Problem id="p-ends_on">{shown('ends_on')}</Problem>
            </div>
          </div>
          <fieldset className="setup-retro">
            <legend>Then, the conversation</legend>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
              <div>
                <Label htmlFor="f-retro_date">Retro day</Label>
                <Input id="f-retro_date" type="date" min={f.starts_on || undefined} value={f.retro_date} onChange={(e) => set('retro_date', e.target.value)} {...invalid('retro_date')} />
                <Problem id="p-retro_date">{shown('retro_date')}</Problem>
              </div>
              <div>
                <Label htmlFor="f-retro_time">Time</Label>
                <Input id="f-retro_time" type="time" value={f.retro_time} onChange={(e) => set('retro_time', e.target.value)} {...invalid('retro_time')} />
                <Problem id="p-retro_time">{shown('retro_time')}</Problem>
              </div>
              <div>
                <Label htmlFor="f-retro_duration_min">Length</Label>
                <Select id="f-retro_duration_min" value={String(f.retro_duration_min)} onChange={(e) => set('retro_duration_min', Number(e.target.value))} {...invalid('retro_duration_min')}>
                  {[...new Set([30, 45, 60, 75, 90, 120, f.retro_duration_min])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
                </Select>
                <Problem id="p-retro_duration_min">{shown('retro_duration_min')}</Problem>
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="f-timezone">Timezone</Label>
              <Select id="f-timezone" value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {zoneList.map((t) => (
                  <option key={t} value={t}>{zoneName(t)} ({t})</option>
                ))}
              </Select>
            </div>
            {preview ? (
              <p className="mt-3 text-sm" role="status">
                Retro <strong className="font-medium">{preview.date}, {preview.time}</strong> {preview.zone} ({preview.offset}){preview.yours ? <span className="text-ink-soft"> · {preview.yours}</span> : null}
                {preview.past ? <span className="text-warn"> · that’s in the past</span> : null}
              </p>
            ) : null}
          </fieldset>
        </Section>

        <Section n={3} title="Who’s in" lead="Only people in the sprint can write, see the revealed thoughts, and join the retro.">
          <div>
            <Label htmlFor="f-facilitator_id">Facilitator</Label>
            <Select id="f-facilitator_id" value={f.facilitator_id} onChange={(e) => set('facilitator_id', e.target.value)} {...invalid('facilitator_id')}>
              {ws.members.map((m) => (
                <option key={m.account_id} value={m.account_id}>{m.display_name}{m.is_you ? ' (you)' : ''}</option>
              ))}
            </Select>
            <Problem id="p-facilitator_id">{shown('facilitator_id')}</Problem>
            {keyProblem ? <p className="mt-1.5 text-sm text-danger" role="alert">{keyProblem}</p> : <Help>Opens and closes collection, prepares the discussion and runs the retro. They also write and vote like everyone else.{!facilitatorIsYou ? ' Only they will be able to manage this sprint.' : ''}{f.encrypt ? ' While collecting, only their devices hold the key that reveals thoughts.' : ''}{handingOver ? ' You stay in the sprint as a participant.' : ''}</Help>}
          </div>
          <fieldset className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <legend className="text-sm font-medium">Participants <span className="font-normal text-ink-soft">· {count}</span></legend>
              {ws.members.length > 2 ? (
                <button type="button" className="text-sm text-accent-ink hover:underline" onClick={() => set('participant_ids', everyone ? ws.members.map((m) => m.account_id).filter(stays) : ws.members.map((m) => m.account_id))}>
                  {everyone ? 'Clear' : 'Everyone'}
                </button>
              ) : null}
            </div>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-2xl bg-card p-1.5 shadow-[0_0_0_1px_var(--line)]">
              {ws.members.map((m) => (
                <li key={m.account_id}>
                  <label className="setup-person flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-ink/5">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.participant_ids.includes(m.account_id) || stays(m.account_id)} disabled={stays(m.account_id)} onChange={(e) => set('participant_ids', e.target.checked ? [...f.participant_ids, m.account_id] : f.participant_ids.filter((x) => x !== m.account_id))} />
                    <span className="min-w-0 flex-1 truncate">{m.display_name}{m.is_you ? <span className="text-ink-faint"> (you)</span> : null}</span>
                    {m.account_id === f.facilitator_id ? <span className="text-xs text-ink-faint">facilitator</span> : handingOver && m.account_id === current ? <span className="text-xs text-ink-faint">stays in</span> : null}
                  </label>
                </li>
              ))}
            </ul>
            <Help>{existing ? 'Someone missing from the workspace? Invite them from the sprint’s page — they join this sprint directly.' : ws.members.length <= 1 ? 'Just you so far. Once the sprint exists, invite your team from its page — they join this sprint directly.' : 'Someone missing? Invite them from the sprint’s page once it’s created.'}</Help>
          </fieldset>
        </Section>

        {!existing ? (
          <Section n={4} title="Privacy" lead="What Muni’s servers can read.">
            <Switch id="f-encrypt" checked={f.encrypt} onCheckedChange={(v) => set('encrypt', v)} label="Encrypt this sprint’s content" description="Thoughts, themes, notes, experiments and the recap are encrypted on participants’ devices before they reach Muni’s servers. The sprint’s name, goal, dates, people and categories stay readable — keep sensitive detail out of them." />
            {f.encrypt && facilitatorIsYou ? <DeviceKeyNotice need="write" /> : null}
          </Section>
        ) : existing.encryption === 'e1' ? (
          <p className="text-sm text-ink-soft">This sprint is encrypted: its content is sealed on participants’ devices.</p>
        ) : (
          <p className="text-sm text-ink-soft">This sprint was set up without encryption, so Muni’s servers can read its content.</p>
        )}

        <section className="border-t border-line/70 pt-6">
          <button type="button" className="flex flex-wrap items-center gap-x-2 text-left text-[15px] font-medium text-ink" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} aria-controls="advanced">
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <ChevronDown className={clsx('size-4 transition-transform', advanced && 'rotate-180')} aria-hidden /> More options
            </span>
            <span className="pl-6 font-normal text-ink-soft sm:pl-0">— reminders, voting, opening question</span>
          </button>
          {advanced ? (
            <div id="advanced" className="anim-rise mt-5 grid gap-5 md:ml-[calc(13rem+2.5rem)]">
              <Switch id="f-reminders" checked={f.reminders_enabled} onCheckedChange={(v) => set('reminders_enabled', v)} label="Send two gentle reminder emails" description="Mid-sprint and the day before the retro, to everyone who hasn’t turned them off. Never based on who has or hasn’t written." />
              <div>
                <Label htmlFor="f-opening_question" hint="optional">Opening question for the retro</Label>
                {/* One this device can't show yet stays as it is: it's never copied back over the real one. */}
                <Input id="f-opening_question" value={questionLocked ? '' : f.opening_question} disabled={questionLocked} onChange={(e) => set('opening_question', e.target.value)} placeholder={questionLocked ? 'Can’t be shown on this device' : 'What’s one thing from this sprint you’d want a new teammate to know?'} maxLength={200} />
                <Help>{questionLocked ? 'This device doesn’t have the sprint’s key yet, so the question can’t be shown or changed here. Saving leaves it as it is.' : 'Shown on the stage’s first step, while people arrive. Leave it empty if the room doesn’t need one.'}</Help>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="f-vote_budget">Votes per person</Label>
                  <Input id="f-vote_budget" type="number" min={1} max={10} value={f.vote_budget} onChange={(e) => set('vote_budget', Number(e.target.value))} {...invalid('vote_budget')} />
                  <Problem id="p-vote_budget">{shown('vote_budget')}</Problem>
                  {!shown('vote_budget') ? <Help>The most anyone gets. A retro never gives more than half its topics, so voting always means leaving some out.</Help> : null}
                </div>
                <div>
                  <Label htmlFor="f-ref" hint="optional">Tracker id</Label>
                  <Input id="f-ref" value={f.external_ref} onChange={(e) => set('external_ref', e.target.value)} placeholder="PROJ-42" maxLength={60} />
                </div>
              </div>
            </div>
          ) : null}
        </section>
        </fieldset>
        <section className="setup-review" aria-labelledby="setup-review-title">
          <div>
            <p className="ws-eyebrow">The plan at a glance</p>
            <h2 id="setup-review-title">{f.name.trim() || 'Your next sprint'}</h2>
          </div>
          <dl>
            <div><dt>Sprint</dt><dd>{length && length > 0 ? <>{dateRange(f.starts_on, f.ends_on)} <span>· {length} days</span></> : 'Choose the sprint dates'}</dd></div>
            <div><dt>Retro</dt><dd>{preview ? <>{preview.date}, {preview.time} <span>· {preview.zone}</span></> : 'Choose the retro time'}</dd></div>
            <div><dt>Team</dt><dd>{count} {count === 1 ? 'person' : 'people'} <span>· {ws.members.find((m) => m.account_id === f.facilitator_id)?.display_name ?? 'Choose a facilitator'} facilitates</span></dd></div>
          </dl>
          <p>{dirty ? 'Unsaved setup is kept while you move around Muni in this tab.' : existing ? 'The saved plan. Change something above to update it.' : 'You can change the plan later. Invite more people from the sprint once it’s created.'}</p>
        </section>
        {/* On a phone the note sits here, at the end of the form, so the actions below stay small. */}
        {!existing ? <p className="text-sm text-ink-soft sm:hidden">{openNote}</p> : null}

        <div className="sticky bottom-0 z-10 -mx-4 border-t border-line/70 bg-paper/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <ErrorText>{error}</ErrorText>
          {tried && Object.keys(issues).length ? <div className="setup-errors" role="alert"><p>{Object.keys(issues).length === 1 ? 'One thing needs fixing' : `${Object.keys(issues).length} things need fixing`}</p><ul>{Object.entries(issues).map(([field, message]) => <li key={field}><button type="button" onClick={() => focusProblem(field)}>{message}</button></li>)}</ul></div> : null}
          {/* A phone: the main action across the width, then Cancel and "Save as draft" on one row. */}
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            {existing ? (
              <>
                <Button type="button" variant="ghost" onClick={() => nav(`/sprints/${existing.id}`)} disabled={!!busy}>Back to sprint</Button>
                <Button type="submit" variant="primary" size="lg" busy={busy === 'save'} disabled={!dirty || !!busy} className="ml-auto max-sm:h-11!">Save changes</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" className="order-2 max-sm:px-2! sm:order-none" onClick={cancelNew} disabled={!!busy}>Back</Button>
                <span className="hidden text-sm text-ink-soft sm:ml-auto sm:inline">{count} {count === 1 ? 'person' : 'people'}{preview ? ` · retro ${preview.date}` : ''}</span>
                <Button type="button" className="order-3 ml-auto sm:order-none sm:ml-0" busy={busy === 'draft'} disabled={!!busy} onClick={() => submit('draft')}>Save as draft</Button>
                <Button type="submit" variant="primary" size="lg" className="order-1 w-full max-sm:h-11! sm:order-none sm:w-auto" busy={busy === 'open'} disabled={!!busy} data-guide="create-open">Create and open collection</Button>
              </>
            )}
          </div>
          {!existing ? <p className="mt-2 hidden text-xs text-ink-soft sm:block sm:text-right">{openNote}</p> : null}
        </div>
      </form>
    </AppShell>
  )
}

function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
