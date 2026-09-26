import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, CalendarClock, Lock, Presentation, Settings2, Users } from 'lucide-react'
import { ApiError, get, patch, post } from '@/api/client'
import type { Experiment, SprintDetail } from '@/api/types'
import { OUTCOME_LABEL, STATUS_LABEL } from '@/lib/categories'
import { useLive } from '@/lib/live'
import { writePrefs } from '@/lib/prefs'
import { Badge, Button, Dialog, EmptyState, ErrorText, Help, SectionTitle, Spinner, Switch, useDocumentTitle, useToast } from '@/ui'
import { Composer, MyThoughts } from '@/ui/capture'
import { AppShell, PageTitle } from '@/ui/shell'

export function SprintHome() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [s, setS] = useState<SprintDetail | null>(null)
  const [prev, setPrev] = useState<Experiment[]>([])
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const [reopening, setReopening] = useState(false)
  useDocumentTitle(s?.name ?? 'Sprint')
  const load = useCallback(async () => {
    try {
      const d = await get<SprintDetail>(`/api/sprints/${sprintId}`)
      setS(d)
      writePrefs({ lastSprint: d.status === 'collecting' ? sprintId : undefined, lastWorkspace: d.workspace_id })
      get<Experiment[]>(`/api/sprints/${sprintId}/experiments/previous`).then(setPrev).catch(() => {})
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load this sprint')
    }
  }, [sprintId])
  useEffect(() => {
    load()
  }, [load])
  useLive(sprintId, (r) => { if (r === 'sprint' || r === 'commitments' || r === 'all') load() }, () => nav('/'))

  const transition = async (to: string, confirm?: boolean) => {
    try {
      const d = await post<SprintDetail>(`/api/sprints/${sprintId}/transition`, { to, confirm })
      setS(d)
      setClosing(false)
      setReopening(false)
      if (to === 'preparing') nav(`/sprints/${sprintId}/prepare`)
      if (to === 'live') nav(`/sprints/${sprintId}/stage`)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t change the sprint', 'danger')
    }
  }

  if (error)
    return (
      <AppShell>
        <EmptyState title="Can’t open this sprint">{error}</EmptyState>
      </AppShell>
    )
  if (!s)
    return (
      <AppShell>
        <div className="grid place-items-center py-20"><Spinner /></div>
      </AppShell>
    )
  const fac = s.is_facilitator
  const collecting = s.status === 'collecting'
  const retroPast = new Date(s.retro_at).getTime() < Date.now()
  return (
    <AppShell>
      <PageTitle
        eyebrow={<Link to={`/workspaces/${s.workspace_id}`} className="hover:underline">{s.workspace_name}</Link>}
        title={s.name}
        actions={
          <>
            {fac && !['completed', 'archived'].includes(s.status) ? <Button size="sm" onClick={() => nav(`/sprints/${sprintId}/setup`)}><Settings2 className="size-4" /> Setup</Button> : null}
            {['preparing', 'ready', 'live'].includes(s.status) && fac ? <Button size="sm" onClick={() => nav(`/sprints/${sprintId}/prepare`)}>Prepare</Button> : null}
            {s.status === 'live' ? <Button size="sm" variant="primary" onClick={() => nav(`/sprints/${sprintId}/${fac ? 'stage' : 'room'}`)}><Presentation className="size-4" /> {fac ? 'Open the stage' : 'Join the room'}</Button> : null}
            {['completed', 'archived', 'live'].includes(s.status) ? <Button size="sm" onClick={() => nav(`/sprints/${sprintId}/outcomes`)}>Outcomes</Button> : null}
          </>
        }
      >
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={collecting ? 'accent' : s.status === 'live' ? 'ok' : 'neutral'}>{STATUS_LABEL[s.status]}</Badge>
          <span className="inline-flex items-center gap-1"><CalendarClock className="size-4" /> Retro {s.retro_local}{retroPast && !['completed', 'archived'].includes(s.status) ? ' (scheduled time has passed)' : ''}</span>
          <span className="inline-flex items-center gap-1"><Users className="size-4" /> {s.participants.length} people</span>
          {s.goal ? <span className="text-ink">Goal: {s.goal}</span> : null}
        </span>
      </PageTitle>

      {fac ? <FacilitatorBar s={s} onTransition={(to) => (to === 'preparing' ? setClosing(true) : to === 'collecting' && s.status === 'preparing' ? setReopening(true) : transition(to))} /> : null}

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-8">
          {collecting ? (
            <>
              <Composer dest={{ workspaceId: s.workspace_id, sprintId, sprintName: s.name }} choices={[]} onChoose={() => {}} />
            </>
          ) : s.status === 'draft' ? (
            <EmptyState title="Not collecting yet" action={fac ? <Button variant="primary" onClick={() => transition('collecting')}>Open this sprint for thoughts</Button> : undefined}>
              {fac ? 'Open collection when the sprint starts. Participants get a place to write; nobody, including you, sees anyone else’s entries until you close it.' : 'The facilitator hasn’t opened collection yet. You’ll be able to add thoughts here as soon as they do.'}
            </EmptyState>
          ) : (
            <div className="card flex items-start gap-3 p-5">
              <Lock className="mt-0.5 size-5 shrink-0 text-ink-faint" />
              <div>
                <div className="font-medium">Collection closed{s.collection_closed_at ? ` on ${new Date(s.collection_closed_at).toLocaleDateString()}` : ''}</div>
                <p className="text-sm text-ink-soft">
                  {s.entry_count ?? 0} entries were revealed to the {s.participants.length} participants as one anonymous batch.
                  {s.reopened_count ? ` Collection was reopened ${s.reopened_count}×; anything revealed before stays visible in history.` : ''}
                  {s.status === 'live' ? ' The retro is live.' : s.status === 'completed' ? ' The retro is done — see the outcomes.' : ' The retro is being prepared.'}
                </p>
              </div>
            </div>
          )}
          <MyThoughts sprintId={sprintId} editable={collecting} moveChoices={[]} online />
        </div>
        <div className="space-y-8">
          <section>
            <SectionTitle>Last time, we said…</SectionTitle>
            {prev.length === 0 ? (
              <p className="text-ink-soft">This is the first retro here, so there’s nothing to revisit yet. Next time, the experiments you agree on show up here first.</p>
            ) : (
              <ul className="space-y-2">
                {prev.slice(0, 4).map((e) => (
                  <li key={e.id} className="card p-4">
                    <p className="font-medium">{e.change_to_try}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                      <Badge tone={e.status === 'helped' ? 'ok' : e.status === 'did_not_help' ? 'danger' : 'neutral'}>{OUTCOME_LABEL[e.status]}</Badge>
                      {e.owner_name ? <span>owner {e.owner_name}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <SectionTitle>Who’s in</SectionTitle>
            <ul className="card divide-y divide-line">
              {s.participants.map((p) => (
                <li key={p.account_id} className="flex items-center justify-between p-3 text-sm">
                  <span>{p.display_name}{p.is_you ? <span className="text-ink-faint"> (you)</span> : null}</span>
                  {p.is_facilitator ? <Badge>facilitator</Badge> : null}
                </li>
              ))}
            </ul>
            <Help>No per-person activity is shown here or anywhere else. Entries are counted, never attributed.</Help>
          </section>
          <section>
            <SectionTitle>Privacy & reminders</SectionTitle>
            <div className="card p-4 text-sm text-ink-soft">
              <p>Thoughts stay hidden from everyone, the facilitator included, until collection closes. Then the sprint sees them in random order, without names. Muni’s servers do record who wrote each one, and your wording can still give you away. <Link to="/privacy#visibility" className="underline underline-offset-2">How privacy works</Link></p>
              <p className="mt-2">
                AI assistance for this sprint: <strong className="text-ink">{s.ai_processing ? `on (${s.ai_provider})` : 'off'}</strong>{s.ai_locked ? ' — decided before collection started.' : '.'} <Link to="/privacy#ai" className="underline underline-offset-2">About AI</Link>
              </p>
              {s.reminders_enabled ? (
                <div className="mt-2">
                  <Switch id="opt" checked={!s.my_reminders_opt_out} onCheckedChange={async (v) => { await patch(`/api/sprints/${sprintId}/me`, { reminders_opt_out: !v }); load() }} label="Email me the two reminders" description="Mid-sprint and the day before the retro. Neutral links only." />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <Dialog open={closing} onOpenChange={setClosing} title="Close collection?" description="This reveals every entry, without names, to all participants and to you. Entries become read-only; later clarification happens in the retro.">
        <p className="text-sm text-ink-soft">Anyone mid-save right now still gets included. Anything saved after this point is refused with a clear message.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setClosing(false)}>Not yet</Button>
          <Button variant="primary" onClick={() => transition('preparing', true)}>Close and reveal</Button>
        </div>
      </Dialog>
      <Dialog open={reopening} onOpenChange={setReopening} title="Reopen collection?" description="Participants already saw the revealed batch. Reopening lets people add or edit again, but it can’t make what was seen secret. Any open vote round is cancelled and readiness is reset.">
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setReopening(false)}>Keep it closed</Button>
          <Button variant="primary" onClick={() => transition('collecting', true)}>Reopen</Button>
        </div>
      </Dialog>
    </AppShell>
  )
}

function FacilitatorBar({ s, onTransition }: { s: SprintDetail; onTransition: (to: string) => void }) {
  const steps = ['draft', 'collecting', 'preparing', 'ready', 'live', 'completed']
  const idx = steps.indexOf(s.status)
  const next = s.allowed_transitions.find((t) => steps.indexOf(t) > idx)
  const back = s.allowed_transitions.find((t) => steps.indexOf(t) < idx)
  const labels: Record<string, string> = { collecting: 'Open this sprint for thoughts', preparing: 'Close collection', ready: 'Mark themes ready', live: 'Start the retro', completed: 'Complete the retro', archived: 'Archive' }
  const backLabels: Record<string, string> = { collecting: 'Reopen collection', preparing: 'Back to preparing', ready: 'Cancel the session' }
  return (
    <div className="card mb-8 flex flex-wrap items-center justify-between gap-3 p-4">
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {steps.map((st, i) => (
          <li key={st} className="flex items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 ${i === idx ? 'bg-accent text-white' : i < idx ? 'bg-ink/10 text-ink' : 'text-ink-faint'}`}>{STATUS_LABEL[st]}</span>
            {i < steps.length - 1 ? <span className="text-ink-faint">›</span> : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {back && backLabels[back] ? <Button size="sm" variant="ghost" onClick={() => onTransition(back)}>{backLabels[back]}</Button> : null}
        {next ? (
          <Button size="sm" variant="primary" onClick={() => onTransition(next)}>
            {labels[next] ?? next} <ArrowRight className="size-4" />
          </Button>
        ) : null}
        {s.status === 'collecting' && (s.entry_count ?? null) !== null ? null : null}
      </div>
      {s.status === 'preparing' && s.theme_count === 0 ? <ErrorText>{''}</ErrorText> : null}
    </div>
  )
}
