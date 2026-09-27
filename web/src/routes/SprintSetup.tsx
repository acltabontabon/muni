import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { SprintDetail, WorkspaceDetail } from '@/api/types'
import { describeRetro, zoneName } from '@/lib/schedule'
import { Button, ErrorText, Help, Input, Label, Select, Spinner, Switch, useDocumentTitle, useToast } from '@/ui'
import { AppShell } from '@/ui/shell'
import { keyring } from '@/lib/e2ee/keyring'
import { b64u } from '@/lib/e2ee/crypto'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { DeviceKeyNotice } from '@/ui/keys'

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

/** A wall time in a timezone → an instant (for the preview only; the server resolves the real one). */
function instant(date: string, time: string, tz: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const guess = Date.parse(`${date}T${time}:00Z`)
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess))
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'))
    return guess - (asUtc - guess)
  } catch {
    return guess
  }
}

type Form = {
  name: string
  external_ref: string
  goal: string
  opening_question: string
  timezone: string
  starts_on: string
  ends_on: string
  retro_date: string
  retro_time: string
  retro_duration_min: number
  facilitator_id: string
  participant_ids: string[]
  ai_processing: boolean
  reminders_enabled: boolean
  vote_budget: number
  include_facilitator_in_rotation: boolean
  encrypt: boolean
}

/** What's missing or inconsistent, by field — the same rules the server applies. */
function problems(f: Form): Partial<Record<keyof Form, string>> {
  const p: Partial<Record<keyof Form, string>> = {}
  if (!f.name.trim()) p.name = 'Give the sprint a name people will recognise.'
  if (!f.starts_on) p.starts_on = 'Choose when the sprint starts.'
  if (!f.ends_on) p.ends_on = 'Choose when it ends.'
  else if (f.starts_on && f.ends_on < f.starts_on) p.ends_on = 'The sprint can’t end before it starts.'
  if (!f.retro_date) p.retro_date = 'Choose a day for the retro.'
  else if (f.starts_on && f.retro_date < f.starts_on) p.retro_date = 'The retro can’t be before the sprint starts.'
  if (!f.retro_time) p.retro_time = 'Choose a time.'
  if (!(f.retro_duration_min >= 10 && f.retro_duration_min <= 240)) p.retro_duration_min = 'Between 10 and 240 minutes.'
  if (!(f.vote_budget >= 1 && f.vote_budget <= 10)) p.vote_budget = 'Between 1 and 10.'
  return p
}

function Section({ n, title, lead, children }: { n: number; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line/70 pt-7 first:border-0 first:pt-0 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10" aria-labelledby={`sec-${n}`}>
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
  const { workspaceId: wsParam, sprintId } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [ws, setWs] = useState<WorkspaceDetail | null>(null)
  const [existing, setExisting] = useState<SprintDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'draft' | 'open' | 'save' | null>(null)
  const [tried, setTried] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const today = useMemo(() => new Date(), [])
  const [f, setF] = useState<Form>({
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
    ai_processing: false,
    reminders_enabled: true,
    vote_budget: 3,
    include_facilitator_in_rotation: false,
    encrypt: true,
  })
  useDocumentTitle(existing ? `Setup · ${existing.name}` : 'New sprint')
  const { state: deviceKeys } = useDeviceKeys()
  const [keyProblem, setKeyProblem] = useState('')
  useEffect(() => {
    ;(async () => {
      try {
        let wid = wsParam
        if (sprintId) {
          const s = await get<SprintDetail>(`/api/sprints/${sprintId}`)
          setExisting(s)
          wid = s.workspace_id
          setF((p) => ({
            ...p,
            name: s.name,
            external_ref: s.external_ref ?? '',
            goal: s.goal ?? '',
            opening_question: s.opening_question ?? '',
            timezone: s.timezone,
            starts_on: s.starts_on,
            ends_on: s.ends_on,
            retro_date: s.retro_local_date,
            retro_time: s.retro_local_time,
            retro_duration_min: s.retro_duration_min,
            facilitator_id: s.participants.find((x) => x.is_facilitator)?.account_id ?? '',
            participant_ids: s.participants.map((x) => x.account_id),
            ai_processing: s.ai_processing,
            reminders_enabled: s.reminders_enabled,
            vote_budget: s.vote_budget,
            include_facilitator_in_rotation: s.include_facilitator_in_rotation,
            encrypt: s.encryption === 'e1',
          }))
        }
        const w = await get<WorkspaceDetail>(`/api/workspaces/${wid}`)
        setWs(w)
        if (!sprintId) {
          const me = w.members.find((m) => m.is_you)
          setF((p) => ({ ...p, facilitator_id: me?.account_id ?? '', participant_ids: w.members.map((m) => m.account_id), ai_processing: w.workspace.ai_enabled_default && w.workspace.ai_provider !== 'none' }))
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Couldn’t load')
      }
    })()
  }, [wsParam, sprintId])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }))
  const issues = problems(f)
  const shown = (k: keyof Form) => (tried ? issues[k] : undefined)
  const invalid = (k: keyof Form) => (shown(k) ? { 'aria-invalid': true, 'aria-describedby': `p-${k}` } : {})

  const submit = async (mode: 'draft' | 'open' | 'save', e?: FormEvent) => {
    e?.preventDefault()
    setTried(true)
    if (Object.keys(issues).length) {
      const first = Object.keys(issues)[0]
      document.getElementById(`f-${first}`)?.focus()
      if (['vote_budget'].includes(first)) setAdvanced(true)
      return
    }
    setBusy(mode)
    setError('')
    setKeyProblem('')
    try {
      const schedule = { timezone: f.timezone, starts_on: f.starts_on, ends_on: f.ends_on, retro_date: f.retro_date, retro_time: f.retro_time, retro_duration_min: Number(f.retro_duration_min) }
      if (existing) {
        const body: Record<string, unknown> = { name: f.name, external_ref: f.external_ref, goal: f.goal, opening_question: f.opening_question, schedule, facilitator_id: f.facilitator_id, reminders_enabled: f.reminders_enabled, vote_budget: Number(f.vote_budget), include_facilitator_in_rotation: f.include_facilitator_in_rotation }
        if (existing.status === 'draft' && existing.encryption !== 'e1') body.ai_processing = f.ai_processing
        const oldFac = existing.participants.find((p) => p.is_facilitator)?.account_id
        if (existing.encryption === 'e1' && f.facilitator_id !== oldFac) {
          // The sprint's key goes with the role, sealed on this device to the new facilitator.
          const keys = await get<{ account_id: string; public_key: string }[]>(`/api/workspaces/${existing.workspace_id}/member-keys`)
          const theirs = keys.find((k) => k.account_id === f.facilitator_id)
          if (!theirs) {
            setKeyProblem('They haven’t set up encryption yet, so they can’t hold this sprint’s key. Ask them to open Muni first, or keep the current facilitator.')
            return
          }
          body.key_wraps = await keyring.wrapAllFor(existing.id, theirs)
        }
        await patch(`/api/sprints/${existing.id}`, body)
        for (const id of f.participant_ids) if (!existing.participants.some((p) => p.account_id === id)) await post(`/api/sprints/${existing.id}/participants`, { account_id: id })
        for (const p of existing.participants) if (!f.participant_ids.includes(p.account_id) && !p.is_facilitator) await del(`/api/sprints/${existing.id}/participants/${p.account_id}`)
        toast('Setup saved')
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
        const s = await post<SprintDetail>(`/api/workspaces/${wsParam}/sprints`, { name: f.name, external_ref: f.external_ref || undefined, goal: f.goal || undefined, opening_question: opening, ...schedule, participant_ids: f.participant_ids, facilitator_id: f.facilitator_id, ai_processing: f.ai_processing && !f.encrypt, reminders_enabled: f.reminders_enabled, vote_budget: Number(f.vote_budget), include_facilitator_in_rotation: f.include_facilitator_in_rotation, ...enc })
        if (mode === 'open') {
          try {
            await post(`/api/sprints/${s.id}/transition`, { to: 'collecting' })
            toast('Sprint created — collection is open')
          } catch (err) {
            toast(`Sprint saved as a draft, but collection didn’t open: ${err instanceof ApiError ? err.message : 'try again from the sprint'}`, 'danger')
          }
        } else toast('Saved as a draft — open collection when you’re ready')
        nav(`/sprints/${s.id}`)
      }
    } catch (err) {
      setError(err instanceof ApiError ? sentence(err.message) : 'Couldn’t save. Your setup is still here — try again.')
    } finally {
      setBusy(null)
    }
  }

  if (!ws)
    return (
      <AppShell>
        {error ? <ErrorText>{error}</ErrorText> : <div className="grid place-items-center py-20"><Spinner /></div>}
      </AppShell>
    )
  const aiAvailable = ws.workspace.ai_provider !== 'none'
  const locked = !!existing && existing.status !== 'draft'
  const retroAt = instant(f.retro_date, f.retro_time, f.timezone)
  const preview = retroAt ? describeRetro(retroAt, f.timezone) : null
  const facilitatorIsYou = ws.members.find((m) => m.is_you)?.account_id === f.facilitator_id
  const everyone = ws.members.every((m) => f.participant_ids.includes(m.account_id) || m.account_id === f.facilitator_id)
  const count = new Set([...f.participant_ids, f.facilitator_id]).size

  return (
    <AppShell>
      <div className="mb-8">
        <nav aria-label="You are here" className="text-sm text-ink-soft">
          <Link to={`/workspaces/${ws.workspace.id}`} className="hover:text-ink hover:underline">{ws.workspace.name}</Link>
          {existing ? <> <span aria-hidden className="text-ink-faint">/</span> <Link to={`/sprints/${existing.id}`} className="hover:text-ink hover:underline">{existing.name}</Link></> : null}
        </nav>
        <h1 className="font-display mt-1 text-2xl leading-tight sm:text-[30px]">{existing ? 'Sprint setup' : <>Set up a <em>sprint</em></>}</h1>
        <p className="mt-2 max-w-prose text-ink-soft">{existing ? 'Changes apply straight away. People already writing keep their thoughts.' : 'Three things: a name, the dates, and who’s in. You can open collection now or save it as a draft.'}</p>
      </div>
      <form onSubmit={(e) => submit(existing ? 'save' : 'open', e)} noValidate className="space-y-8">
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

        <Section n={2} title="When" lead="The retro time is kept in the timezone you choose, so daylight-saving changes don’t move it.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="f-starts_on">Sprint starts</Label>
              <Input id="f-starts_on" type="date" value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} {...invalid('starts_on')} />
              <Problem id="p-starts_on">{shown('starts_on')}</Problem>
            </div>
            <div>
              <Label htmlFor="f-ends_on">Sprint ends</Label>
              <Input id="f-ends_on" type="date" value={f.ends_on} onChange={(e) => set('ends_on', e.target.value)} {...invalid('ends_on')} />
              <Problem id="p-ends_on">{shown('ends_on')}</Problem>
            </div>
          </div>
          <fieldset className="rounded-2xl bg-card-2/60 p-4">
            <legend className="sr-only">Retro</legend>
            <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
              <div>
                <Label htmlFor="f-retro_date">Retro day</Label>
                <Input id="f-retro_date" type="date" value={f.retro_date} onChange={(e) => set('retro_date', e.target.value)} {...invalid('retro_date')} />
                <Problem id="p-retro_date">{shown('retro_date')}</Problem>
              </div>
              <div>
                <Label htmlFor="f-retro_time">Time</Label>
                <Input id="f-retro_time" type="time" value={f.retro_time} onChange={(e) => set('retro_time', e.target.value)} {...invalid('retro_time')} />
                <Problem id="p-retro_time">{shown('retro_time')}</Problem>
              </div>
              <div>
                <Label htmlFor="f-retro_duration_min">Length</Label>
                <Select id="f-retro_duration_min" value={String(f.retro_duration_min)} onChange={(e) => set('retro_duration_min', Number(e.target.value))}>
                  {[...new Set([30, 45, 60, 75, 90, 120, f.retro_duration_min])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="f-timezone">Timezone</Label>
              <Select id="f-timezone" value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {tzOptions().map((t) => (
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
            <Select id="f-facilitator_id" value={f.facilitator_id} onChange={(e) => set('facilitator_id', e.target.value)}>
              {ws.members.map((m) => (
                <option key={m.account_id} value={m.account_id}>{m.display_name}{m.is_you ? ' (you)' : ''}</option>
              ))}
            </Select>
            {keyProblem ? <p className="mt-1.5 text-sm text-danger" role="alert">{keyProblem}</p> : <Help>Opens and closes collection, prepares the discussion and runs the retro. They also write and vote like everyone else.{!facilitatorIsYou ? ' Only they will be able to manage this sprint.' : ''}{f.encrypt ? ' While collecting, only their devices hold the key that reveals thoughts.' : ''}</Help>}
          </div>
          <fieldset>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <legend className="text-sm font-medium">Participants <span className="font-normal text-ink-soft">· {count}</span></legend>
              {ws.members.length > 2 ? (
                <button type="button" className="text-sm text-accent-ink hover:underline" onClick={() => set('participant_ids', everyone ? [f.facilitator_id] : ws.members.map((m) => m.account_id))}>
                  {everyone ? 'Clear' : 'Everyone'}
                </button>
              ) : null}
            </div>
            <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-2xl bg-card p-1.5 shadow-[0_0_0_1px_var(--line)]">
              {ws.members.map((m) => (
                <li key={m.account_id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-ink/5">
                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.participant_ids.includes(m.account_id) || m.account_id === f.facilitator_id} disabled={m.account_id === f.facilitator_id} onChange={(e) => set('participant_ids', e.target.checked ? [...f.participant_ids, m.account_id] : f.participant_ids.filter((x) => x !== m.account_id))} />
                    <span className="min-w-0 flex-1 truncate">{m.display_name}{m.is_you ? <span className="text-ink-faint"> (you)</span> : null}</span>
                    {m.account_id === f.facilitator_id ? <span className="text-xs text-ink-faint">facilitator</span> : null}
                  </label>
                </li>
              ))}
            </ul>
            <Help>{ws.members.length <= 1 ? 'Just you so far. After creating the sprint, invite your team from its guide — they join this sprint directly.' : 'Someone missing? Invite them from the sprint’s guide once it’s created.'}</Help>
          </fieldset>
        </Section>

        {!existing ? (
          <Section n={4} title="Privacy" lead="What Muni’s servers can read.">
            <Switch id="f-encrypt" checked={f.encrypt} onCheckedChange={(v) => set('encrypt', v)} label="Encrypt this sprint’s content" description="Thoughts, themes, notes, experiments and the recap are encrypted on participants’ devices before they reach Muni’s servers. The sprint’s name, goal, dates, people and categories stay readable — keep sensitive detail out of them. AI theme drafts aren’t available for encrypted sprints." />
            {f.encrypt && facilitatorIsYou ? <DeviceKeyNotice need="write" /> : null}
          </Section>
        ) : existing.encryption === 'e1' ? (
          <p className="text-sm text-ink-soft">This sprint is encrypted: its content is sealed on participants’ devices.</p>
        ) : (
          <p className="text-sm text-ink-soft">This sprint isn’t encrypted — it was set up before encryption was available.</p>
        )}

        <section className="border-t border-line/70 pt-6">
          <button type="button" className="inline-flex items-center gap-2 text-[15px] font-medium text-ink" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} aria-controls="advanced">
            <ChevronDown className={clsx('size-4 transition-transform', advanced && 'rotate-180')} aria-hidden /> More options
            <span className="font-normal text-ink-soft">— reminders, voting, opening question{aiAvailable ? ', AI' : ''}</span>
          </button>
          {advanced ? (
            <div id="advanced" className="anim-rise mt-5 grid gap-5 md:ml-[calc(13rem+2.5rem)]">
              <Switch id="f-reminders" checked={f.reminders_enabled} onCheckedChange={(v) => set('reminders_enabled', v)} label="Send two gentle reminder emails" description="Mid-sprint and the day before the retro, to everyone who hasn’t turned them off. Never based on who has or hasn’t written." />
              <div>
                <Label htmlFor="f-opening_question" hint="optional">Opening question for the retro</Label>
                <Input id="f-opening_question" value={f.opening_question} onChange={(e) => set('opening_question', e.target.value)} placeholder="What’s one thing from this sprint you’d want a new teammate to know?" maxLength={200} />
                <Help>Shown for a minute while people arrive. Skip it to go straight to the conversation.</Help>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="f-vote_budget">Votes per person</Label>
                  <Input id="f-vote_budget" type="number" min={1} max={10} value={f.vote_budget} onChange={(e) => set('vote_budget', Number(e.target.value))} {...invalid('vote_budget')} />
                  <Problem id="p-vote_budget">{shown('vote_budget')}</Problem>
                </div>
                <div>
                  <Label htmlFor="f-ref" hint="optional">Tracker id</Label>
                  <Input id="f-ref" value={f.external_ref} onChange={(e) => set('external_ref', e.target.value)} placeholder="PROJ-42" maxLength={60} />
                </div>
              </div>
              <Switch id="f-rot" checked={f.include_facilitator_in_rotation} onCheckedChange={(v) => set('include_facilitator_in_rotation', v)} label="Include the facilitator when inviting voices" description="Otherwise the facilitator guides and isn’t invited to speak in turn." />
              {aiAvailable && !f.encrypt && existing?.encryption !== 'e1' ? (
                <Switch id="f-ai" checked={f.ai_processing} onCheckedChange={(v) => set('ai_processing', v)} disabled={locked} label="Offer AI theme drafts after collection closes" description={locked ? 'Decided before collection opened; it applies to the next sprint.' : `Thought text and opaque ids go to ${ws.workspace.ai_provider} — never names, emails or who wrote what. Participants can see this choice.`} />
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="sticky bottom-0 z-10 -mx-4 border-t border-line/70 bg-paper/90 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <ErrorText>{error}</ErrorText>
          {tried && Object.keys(issues).length ? <p className="mb-3 text-sm text-danger" role="alert">{Object.keys(issues).length === 1 ? 'One thing needs fixing' : `${Object.keys(issues).length} things need fixing`} — see the highlighted fields.</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {existing ? (
              <>
                <Button type="button" variant="ghost" onClick={() => nav(`/sprints/${existing.id}`)}>Cancel</Button>
                <Button type="submit" variant="primary" size="lg" busy={busy === 'save'} className="sm:ml-auto">Save changes</Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => nav(-1)}>Cancel</Button>
                <span className="hidden text-sm text-ink-soft sm:ml-auto sm:inline">{count} {count === 1 ? 'person' : 'people'}{preview ? ` · retro ${preview.date}` : ''}</span>
                <Button type="button" busy={busy === 'draft'} onClick={() => submit('draft')}>Save as draft</Button>
                <Button type="submit" variant="primary" size="lg" busy={busy === 'open'}>Create and open collection</Button>
              </>
            )}
          </div>
          {!existing ? <p className="mt-2 text-xs text-ink-soft sm:text-right">Opening collection lets everyone in the sprint start writing. Thoughts stay hidden — from you too — until you close it.</p> : null}
        </div>
      </form>
    </AppShell>
  )
}

function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
