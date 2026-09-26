import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ApiError, del, get, patch, post } from '@/api/client'
import type { SprintDetail, WorkspaceDetail } from '@/api/types'
import { Button, ErrorText, Help, Input, Label, Select, Spinner, Switch, useDocumentTitle, useToast } from '@/ui'
import { AppShell, PageTitle } from '@/ui/shell'

const tzOptions = () => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'Asia/Manila', 'Europe/Berlin', 'America/New_York']
  }
}

function plusDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x.toISOString().slice(0, 10)
}

/** Create (workspace route) or edit (sprint route) a sprint. One tall form, not a wizard. */
export function SprintSetup() {
  const { workspaceId: wsParam, sprintId } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [ws, setWs] = useState<WorkspaceDetail | null>(null)
  const [existing, setExisting] = useState<SprintDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const today = useMemo(() => new Date(), [])
  const [f, setF] = useState({
    name: '',
    external_ref: '',
    goal: '',
    opening_question: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    starts_on: plusDays(today, 0),
    ends_on: plusDays(today, 13),
    retro_date: plusDays(today, 14),
    retro_time: '14:00',
    retro_duration_min: 45,
    facilitator_id: '',
    participant_ids: [] as string[],
    ai_processing: false,
    reminders_enabled: true,
    vote_budget: 3,
    include_facilitator_in_rotation: false,
  })
  useDocumentTitle(existing ? `Edit ${existing.name}` : 'New sprint')
  useEffect(() => {
    ;(async () => {
      try {
        let wid = wsParam
        if (sprintId) {
          const s = await get<SprintDetail>(`/api/sprints/${sprintId}`)
          setExisting(s)
          wid = s.workspace_id
          const local = s.retro_local // "Mon 3 Nov 2026, 14:00 PHT"
          const timeMatch = local.match(/(\d{2}):(\d{2})/)
          setF((p) => ({
            ...p,
            name: s.name,
            external_ref: s.external_ref ?? '',
            goal: s.goal ?? '',
            opening_question: s.opening_question ?? '',
            timezone: s.timezone,
            starts_on: s.starts_on,
            ends_on: s.ends_on,
            retro_date: new Date(s.retro_at).toLocaleDateString('en-CA', { timeZone: s.timezone }),
            retro_time: timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : p.retro_time,
            retro_duration_min: s.retro_duration_min,
            facilitator_id: s.participants.find((x) => x.is_facilitator)?.account_id ?? '',
            participant_ids: s.participants.map((x) => x.account_id),
            ai_processing: s.ai_processing,
            reminders_enabled: s.reminders_enabled,
            vote_budget: s.vote_budget,
            include_facilitator_in_rotation: s.include_facilitator_in_rotation,
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

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const schedule = { timezone: f.timezone, starts_on: f.starts_on, ends_on: f.ends_on, retro_date: f.retro_date, retro_time: f.retro_time, retro_duration_min: Number(f.retro_duration_min) }
      if (existing) {
        const body: Record<string, unknown> = { name: f.name, external_ref: f.external_ref, goal: f.goal, opening_question: f.opening_question, schedule, facilitator_id: f.facilitator_id, reminders_enabled: f.reminders_enabled, vote_budget: Number(f.vote_budget), include_facilitator_in_rotation: f.include_facilitator_in_rotation }
        if (existing.status === 'draft') body.ai_processing = f.ai_processing
        await patch(`/api/sprints/${existing.id}`, body)
        // participants: add any newly ticked
        for (const id of f.participant_ids) if (!existing.participants.some((p) => p.account_id === id)) await post(`/api/sprints/${existing.id}/participants`, { account_id: id })
        for (const p of existing.participants) if (!f.participant_ids.includes(p.account_id) && !p.is_facilitator) await del(`/api/sprints/${existing.id}/participants/${p.account_id}`)
        toast('Sprint updated')
        nav(`/sprints/${existing.id}`)
      } else {
        const s = await post<SprintDetail>(`/api/workspaces/${wsParam}/sprints`, { name: f.name, external_ref: f.external_ref || undefined, goal: f.goal || undefined, opening_question: f.opening_question || undefined, ...schedule, participant_ids: f.participant_ids, facilitator_id: f.facilitator_id, ai_processing: f.ai_processing, reminders_enabled: f.reminders_enabled, vote_budget: Number(f.vote_budget), include_facilitator_in_rotation: f.include_facilitator_in_rotation })
        toast('Sprint created')
        nav(`/sprints/${s.id}`)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save')
    } finally {
      setBusy(false)
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
  return (
    <AppShell>
      <PageTitle eyebrow={ws.workspace.name} title={existing ? 'Sprint setup' : 'Set up a sprint'}>
        Dates, the retro slot, who’s in, and the privacy choices. Sprint names are labels, not passwords: access comes from membership.
      </PageTitle>
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <h2 className="font-display text-xl">Basics</h2>
            <div>
              <Label htmlFor="name">Sprint name</Label>
              <Input id="name" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Sprint 42 — Billing export" maxLength={120} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ref" hint="optional">External id</Label>
                <Input id="ref" value={f.external_ref} onChange={(e) => set('external_ref', e.target.value)} placeholder="PROJ-42" maxLength={60} />
              </div>
              <div>
                <Label htmlFor="dur">Retro length (minutes)</Label>
                <Input id="dur" type="number" min={10} max={240} value={f.retro_duration_min} onChange={(e) => set('retro_duration_min', Number(e.target.value))} />
              </div>
            </div>
            <div>
              <Label htmlFor="goal" hint="optional, one line">Sprint goal</Label>
              <Input id="goal" value={f.goal} onChange={(e) => set('goal', e.target.value)} maxLength={300} />
            </div>
            <div>
              <Label htmlFor="oq" hint="optional">Opening question for the retro</Label>
              <Input id="oq" value={f.opening_question} onChange={(e) => set('opening_question', e.target.value)} placeholder="What’s one thing from this sprint you’d want a new teammate to know?" maxLength={200} />
              <Help>Shown for a minute while people arrive. Skip it and the team goes straight to the conversation.</Help>
            </div>
          </section>
          <section className="card space-y-4 p-5">
            <h2 className="font-display text-xl">When</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="starts">Sprint starts</Label>
                <Input id="starts" type="date" required value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ends">Sprint ends</Label>
                <Input id="ends" type="date" required value={f.ends_on} onChange={(e) => set('ends_on', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="rdate">Retro date</Label>
                <Input id="rdate" type="date" required value={f.retro_date} onChange={(e) => set('retro_date', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="rtime">Retro time</Label>
                <Input id="rtime" type="time" required value={f.retro_time} onChange={(e) => set('retro_time', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="tz">Timezone</Label>
                <Select id="tz" value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {tzOptions().map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
                <Help>Retro time is stored against this timezone, so daylight-saving changes don’t move it.</Help>
              </div>
            </div>
          </section>
        </div>
        <div className="space-y-6">
          <section className="card space-y-3 p-5">
            <h2 className="font-display text-xl">Who</h2>
            <div>
              <Label htmlFor="fac">Facilitator</Label>
              <Select id="fac" value={f.facilitator_id} onChange={(e) => set('facilitator_id', e.target.value)}>
                {ws.members.map((m) => (
                  <option key={m.account_id} value={m.account_id}>{m.display_name}</option>
                ))}
              </Select>
              <Help>The facilitator also contributes and votes like everyone else.</Help>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">Participants</legend>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {ws.members.map((m) => (
                  <li key={m.account_id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink/5">
                      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={f.participant_ids.includes(m.account_id) || m.account_id === f.facilitator_id} disabled={m.account_id === f.facilitator_id} onChange={(e) => set('participant_ids', e.target.checked ? [...f.participant_ids, m.account_id] : f.participant_ids.filter((x) => x !== m.account_id))} />
                      <span>{m.display_name}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <Help>Not here yet? Invite them from the workspace page; you can add them to this sprint in the invitation.</Help>
            </fieldset>
          </section>
          <section className="card space-y-1 p-5">
            <h2 className="font-display text-xl">Privacy & assistance</h2>
            <p className="text-sm text-ink-soft">
              Entries stay sealed until you close collection; then they’re revealed to participants as one anonymous batch. Your identity as facilitator is visible; authorship never is.
            </p>
            <Switch id="ai" checked={f.ai_processing} onCheckedChange={(v) => set('ai_processing', v)} disabled={!aiAvailable || locked} label="Use AI to draft themes after collection closes" description={!aiAvailable ? 'No AI provider is configured on this server, so grouping is manual.' : locked ? 'Locked once collection has started. Changes apply to the next sprint.' : `Entry text and opaque ids go to the configured provider (${ws.workspace.ai_provider}); never names, emails or authorship. Participants can see this choice on the sprint page.`} />
            <Switch id="rem" checked={f.reminders_enabled} onCheckedChange={(v) => set('reminders_enabled', v)} label="Send two gentle reminders" description="Mid-sprint and the day before the retro, to everyone who hasn’t opted out. Never based on who has or hasn’t written." />
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="vb">Votes per person</Label>
                <Input id="vb" type="number" min={1} max={10} value={f.vote_budget} onChange={(e) => set('vote_budget', Number(e.target.value))} />
              </div>
            </div>
            <Switch id="rot" checked={f.include_facilitator_in_rotation} onCheckedChange={(v) => set('include_facilitator_in_rotation', v)} label="Include the facilitator in the speaking rotation" />
          </section>
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="lg" busy={busy}>{existing ? 'Save changes' : 'Create sprint'}</Button>
            <Button type="button" variant="ghost" onClick={() => nav(-1)}>Cancel</Button>
          </div>
        </div>
      </form>
    </AppShell>
  )
}
