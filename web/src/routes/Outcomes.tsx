import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router'
import { Download } from 'lucide-react'
import { ApiError, get, patch, post, put } from '@/api/client'
import type { CheckinView, Experiment, GroupingView, Recap, SprintDetail, StageSnapshot, ThemeView } from '@/api/types'
import { OUTCOME_LABEL } from '@/lib/categories'
import { useKeysEpoch } from '@/lib/e2ee/E2eeProvider'
import { Button, Help, Select, Spinner, Textarea, useToast } from '@/ui'
import { ExperimentEditor } from '@/ui/experiments'
import { Face } from '@/ui/faces'
import { CheckinResult } from '@/ui/checkin'
import { shortDate } from '@/lib/schedule'
import { download, fileName, rawMarkdown, recapDraft, summaryCsv, summaryMarkdown } from '@/lib/e2ee/local-export'

/** The old address of a sprint's outcomes: a finished sprint's page is its outcomes now. */
export function OutcomesRedirect() {
  const { sprintId = '' } = useParams()
  return <Navigate to={`/sprints/${sprintId}`} replace />
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const minutesBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000))

/**
 * A finished sprint, as its recap: when the retro was and who was there; what the team will try
 * (the heart of it, each with its owner); what it talked about, topic by topic, in a line each;
 * and the facilitator's own recap. The same page for everyone — the facilitator also writes the
 * recap and can add an experiment; an owner says yes and later says what happened.
 */
export function OutcomesView({ s, onCount, refresh = 0 }: { s: SprintDetail; onCount?: (n: number) => void; /** Bumped by the page when the sprint says something changed. */ refresh?: number }) {
  const sprintId = s.id
  const [exps, setExps] = useState<Experiment[]>([])
  const [recap, setRecap] = useState<Recap | null>(null)
  const [themes, setThemes] = useState<ThemeView[]>([])
  const [meeting, setMeeting] = useState<StageSnapshot | null>(null)
  const [checkins, setCheckins] = useState<CheckinView[]>([])
  const [error, setError] = useState('')
  const countRef = useRef(onCount)
  countRef.current = onCount
  const load = useCallback(async () => {
    try {
      const [e, r] = await Promise.all([get<Experiment[]>(`/api/sprints/${sprintId}/experiments`), get<Recap>(`/api/sprints/${sprintId}/recap`)])
      setExps(e)
      setRecap(r)
      countRef.current?.(e.filter((x) => x.status !== 'proposed').length)
      // The retro's own record: optional (a sprint finished without a live retro has none, and
      // retention removes themes after a while), so each part simply stays out when it's missing.
      const [g, m, c] = await Promise.all([
        get<GroupingView>(`/api/sprints/${sprintId}/themes`).catch(() => null),
        get<StageSnapshot>(`/api/sprints/${sprintId}/meeting`).catch(() => null),
        get<CheckinView[]>(`/api/sprints/${sprintId}/checkins`).catch(() => []),
      ])
      setThemes((g?.themes ?? []).filter((t) => !t.parked))
      setMeeting(m && !m.cancelled ? m : null)
      setCheckins(c)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load the recap')
    }
  }, [sprintId])
  const keysEpoch = useKeysEpoch()
  useEffect(() => {
    load()
  }, [load, keysEpoch, refresh])
  if (error) return <p className="text-ink-soft" role="alert">{error}</p>
  if (!recap) return <div className="grid place-items-center py-16"><Spinner /></div>

  const fac = s.is_facilitator
  const talked = themes.filter((t) => t.discussed || t.takeaway || t.could_try)
  return (
    <div className="recap">
      <RecapHead s={s} meeting={meeting} topics={talked.length} experiments={exps.length} />

      <section className="recap-block" aria-labelledby="recap-try">
        <header className="recap-block-head">
          <h2 id="recap-try" className="recap-h">What we’ll <em>try</em></h2>
          <p className="recap-note">{exps.length ? `${exps.length === 1 ? 'One change' : `${exps.length} changes`} for the next sprint. Each comes back at the start of the next retro, to see if it helped.` : 'No experiments were agreed this time. Sometimes the conversation is the outcome.'}</p>
        </header>
        {exps.length ? (
          <ol className="recap-exps">
            {exps.map((e, i) => <ExperimentLine key={e.id} e={e} n={i + 1} s={s} onChange={load} />)}
          </ol>
        ) : null}
        {fac && s.status === 'completed' ? (
          <details className="recap-more">
            <summary>{exps.length ? 'Add another experiment' : 'Add an experiment'}</summary>
            <div className="mt-4"><ExperimentEditor sprintId={sprintId} participants={s.participants} themes={themes.map((t) => ({ id: t.id, title: t.title }))} existingCount={exps.length} onSaved={load} /></div>
          </details>
        ) : null}
      </section>

      {themes.length ? (
        <section className="recap-block" aria-labelledby="recap-talk">
          <header className="recap-block-head">
            <h2 id="recap-talk" className="recap-h">What we <em>talked about</em></h2>
            <p className="recap-note">{talked.length ? `${talked.length} of ${themes.length} ${themes.length === 1 ? 'topic' : 'topics'}, in the order the votes chose.` : 'The topics the team gathered, in the order the votes chose.'}</p>
          </header>
          <ol className="recap-topics">
            {themes.map((t, i) => <TopicLine key={t.id} t={t} n={i + 1} most={Math.max(1, ...themes.map((x) => x.votes ?? 0))} checkins={checkins.filter((c) => c.theme_id === t.id && c.status === 'shared' && c.results?.responded)} />)}
          </ol>
        </section>
      ) : null}

      <RecapText s={s} recap={recap} exps={exps} onSaved={setRecap} />

      <Downloads s={s} exps={exps} recap={recap} />
    </div>
  )
}

/** When, how long, and who was there — faces, lit for those who came. */
function RecapHead({ s, meeting, topics, experiments }: { s: SprintDetail; meeting: StageSnapshot | null; topics: number; experiments: number }) {
  const here = meeting ? meeting.attendance.filter((a) => a.present) : []
  const away = meeting ? meeting.attendance.filter((a) => !a.present) : []
  const people = meeting ? [...here, ...away] : s.participants.map((p) => ({ ...p, avatar_id: null, present: false, connected: false }))
  return (
    <header className="recap-head">
      <p className="recap-kicker">The retro{meeting ? <> · {longDate(meeting.started_at)}{meeting.ended_at ? <> · {((m) => `${m} ${m === 1 ? 'minute' : 'minutes'}`)(minutesBetween(meeting.started_at, meeting.ended_at))}</> : null}</> : null}</p>
      <h2 className="recap-title">{meeting ? <>{here.length} {here.length === 1 ? 'person' : 'people'} came. <em>Here’s what came of it.</em></> : <>Here’s what came of <em>the sprint</em>.</>}</h2>
      <ul className="recap-people" aria-label="Who was there">
        {people.map((a) => (
          <li key={a.account_id} data-here={a.present || undefined}>
            <Face a={a} state={a.present ? 'on' : 'away'} size="xl" />
            <span className="recap-person">{a.display_name.split(/\s+/)[0]}{a.is_facilitator ? <em>facilitated</em> : !a.present && meeting ? <em>couldn’t make it</em> : null}</span>
          </li>
        ))}
      </ul>
      <dl className="recap-stats">
        <div><dt>Thoughts</dt><dd>{s.entry_count ?? '—'}</dd></div>
        <div><dt>Topics talked about</dt><dd>{topics}</dd></div>
        <div><dt>Experiments</dt><dd>{experiments}</dd></div>
      </dl>
    </header>
  )
}

function ExperimentLine({ e, n, s, onChange }: { e: Experiment; n: number; s: SprintDetail; onChange: () => void }) {
  const toast = useToast()
  const owner = s.participants.find((p) => p.account_id === e.owner_account_id)
  const mine = !!owner?.is_you
  const decided = ['helped', 'did_not_help', 'inconclusive', 'not_tried'].includes(e.status)
  const answer = async (accept: boolean) => {
    try {
      await post(`/api/sprints/${s.id}/experiments/${e.id}/accept`, { accept })
      if (accept) toast('You own this experiment')
      onChange()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger')
    }
  }
  return (
    <li className="recap-exp" data-status={e.status}>
      <span className="recap-exp-n">{n}</span>
      <div className="recap-exp-body">
        <p className="recap-exp-change">{e.change_to_try}</p>
        <dl className="recap-exp-meta">
          {e.success_signal ? <div><dt>we’ll know it helped if</dt><dd>{e.success_signal}</dd></div> : null}
          <div><dt>back on</dt><dd>{shortDate(e.review_on)}</dd></div>
          {e.theme_title ? <div><dt>from</dt><dd>{e.theme_title}</dd></div> : null}
        </dl>
        {mine && !e.owner_accepted && e.status === 'proposed' ? (
          <div className="recap-ask">
            <p><strong>Will you own this?</strong> Saying yes means you keep it moving — not that you do it all yourself.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => answer(true)}>I’ll own this</Button>
              <Button size="sm" variant="ghost" onClick={() => answer(false)}>Not me</Button>
            </div>
          </div>
        ) : null}
        {e.outcome_note ? <p className="recap-exp-note">“{e.outcome_note}”</p> : null}
        {(s.is_facilitator || mine) && e.status !== 'proposed' ? (
          <details className="recap-more recap-more--small">
            <summary>{decided ? 'Change what happened' : 'Say what happened'}</summary>
            <OutcomeForm e={e} sprintId={s.id} onSaved={onChange} />
          </details>
        ) : null}
      </div>
      <div className="recap-owner">
        {owner ? <Face a={owner} state={e.owner_accepted ? 'on' : 'here'} size="lg" /> : <span className="recap-owner-none" aria-hidden>?</span>}
        <span>
          {owner ? (e.owner_accepted ? `${owner.display_name.split(/\s+/)[0]} owns this` : `Waiting for ${owner.display_name.split(/\s+/)[0]}`) : 'No owner yet'}
          <em data-status={e.status}>{decided ? OUTCOME_LABEL[e.status] : e.owner_accepted ? 'under way' : 'proposed'}</em>
        </span>
      </div>
    </li>
  )
}

/** One topic in a line: its votes, and what the room kept from it. */
function TopicLine({ t, n, most, checkins }: { t: ThemeView; n: number; most: number; checkins: CheckinView[] }) {
  const reached = t.discussed || !!t.takeaway || !!t.could_try
  return (
    <li className="recap-topic" data-reached={reached || undefined}>
      <span className="recap-topic-n">{n}</span>
      <div className="recap-topic-body">
        <p className="recap-topic-title">{t.title}{reached ? null : <em>not reached</em>}</p>
        {t.takeaway ? <p className="recap-topic-line"><i>we’ll remember</i>{t.takeaway}</p> : null}
        {t.could_try ? <p className="recap-topic-line"><i>we could try</i>{t.could_try}</p> : null}
        {checkins.map((c) => (
          <div key={c.id} className="recap-topic-check">
            <span>{c.kind === 'topic' ? 'how it showed up' : 'would trying it help?'}</span>
            <CheckinResult c={c} />
          </div>
        ))}
      </div>
      <span className="recap-topic-votes" aria-label={`${t.votes ?? 0} votes`}>
        <b>{t.votes ?? 0}</b>
        <i><span style={{ width: `${((t.votes ?? 0) / most) * 100}%` }} /></i>
      </span>
    </li>
  )
}

/**
 * The facilitator's recap: shown as written, set as text (paragraphs, lists, headings). The
 * facilitator writes it here — filled in from the retro's record, then theirs to edit — and
 * publishes it to everyone in the sprint.
 */
function RecapText({ s, recap, exps, onSaved }: { s: SprintDetail; recap: Recap; exps: Experiment[]; onSaved: (r: Recap) => void }) {
  const toast = useToast()
  const fac = s.is_facilitator
  const encrypted = s.encryption === 'e1'
  const [draft, setDraft] = useState(recap.body)
  const [open, setOpen] = useState(fac && !recap.published_at)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft((d) => d || recap.body), [recap.body])
  if (!fac && !recap.exists) return null
  const save = async (publish: boolean) => {
    setBusy(true)
    try {
      const r = await put<Recap>(`/api/sprints/${s.id}/recap`, { body: draft, publish: publish || undefined })
      onSaved(r)
      toast(publish ? 'Recap published to everyone in the sprint' : 'Saved')
      if (publish) setOpen(false)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger')
    } finally {
      setBusy(false)
    }
  }
  const fill = async () => {
    if (encrypted) {
      const g = await get<GroupingView>(`/api/sprints/${s.id}/themes`).catch(() => null)
      setDraft(recapDraft(s, g, exps))
      toast('Filled in from the retro’s record. Save to keep it.')
      return
    }
    const r = await put<Recap>(`/api/sprints/${s.id}/recap`, {})
    onSaved(r)
    setDraft(r.body)
    toast('Filled in from the retro’s record')
  }
  return (
    <section className="recap-block" aria-labelledby="recap-words">
      <header className="recap-block-head">
        <h2 id="recap-words" className="recap-h">In the facilitator’s <em>words</em></h2>
        <p className="recap-note">{recap.published_at ? `Published ${new Date(recap.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.` : fac ? 'Not published yet — only you can see it.' : ''}</p>
      </header>
      {recap.exists && recap.body.trim() && !open ? <div className="recap-letter"><Prose text={recap.published_at || fac ? recap.body : ''} /></div> : null}
      {fac ? (
        open ? (
          <div className="recap-write">
            <Textarea rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-sm" aria-label="Recap (Markdown)" placeholder="Start from the retro’s record, then make it yours." />
            <Help>Headings with #, lists with -. Publishing shows it to everyone in the sprint; nothing is emailed.</Help>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={fill}>Fill in from the record</Button>
              <span className="flex-1" />
              {recap.published_at ? <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button> : null}
              <Button size="sm" busy={busy} onClick={() => save(false)}>Save draft</Button>
              <Button size="sm" variant="primary" busy={busy} onClick={() => save(true)}>{recap.published_at ? 'Publish changes' : 'Publish'}</Button>
            </div>
          </div>
        ) : (
          <button className="recap-edit" onClick={() => setOpen(true)}>{recap.exists ? 'Edit the recap' : 'Write the recap'}</button>
        )
      ) : null}
    </section>
  )
}

/** Markdown, lightly: headings, lists and paragraphs — enough for a recap, and never raw HTML. */
function Prose({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.join(' ')}</p>)
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>)
    para = []
    list = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) flush()
    else if (/^#{1,3}\s/.test(line)) {
      flush()
      blocks.push(<h3 key={blocks.length}>{line.replace(/^#+\s*/, '')}</h3>)
    } else if (/^[-*]\s/.test(line)) {
      if (para.length) { const p = para; para = []; blocks.push(<p key={blocks.length}>{p.join(' ')}</p>) }
      list.push(line.replace(/^[-*]\s+/, ''))
    } else {
      if (list.length) { const l = list; list = []; blocks.push(<ul key={blocks.length}>{l.map((x, i) => <li key={i}>{x}</li>)}</ul>) }
      para.push(line)
    }
  }
  flush()
  return <>{blocks}</>
}

function Downloads({ s, exps, recap }: { s: SprintDetail; exps: Experiment[]; recap: Recap }) {
  const encrypted = s.encryption === 'e1'
  const themes = () => get<GroupingView>(`/api/sprints/${s.id}/themes`).catch(() => null)
  return (
    <footer className="recap-downloads">
      <span>Take it with you <em>— no names, times or votes{encrypted ? '; not encrypted once saved' : ''}</em></span>
      {encrypted ? (
        <>
          <button onClick={async () => download(fileName(s, 'summary', 'md'), summaryMarkdown(s, await themes(), exps, recap.exists ? recap.body : null))}><Download className="size-3.5" aria-hidden /> Summary .md</button>
          <button onClick={async () => download(fileName(s, 'summary', 'csv'), summaryCsv(await themes()), 'text/csv')}><Download className="size-3.5" aria-hidden /> Summary .csv</button>
          {s.is_facilitator ? <button onClick={async () => download(fileName(s, 'raw-notes', 'md'), rawMarkdown(s, await themes()))}><Download className="size-3.5" aria-hidden /> Raw notes .md</button> : null}
        </>
      ) : (
        <>
          <a href={`/api/sprints/${s.id}/export.md`} download><Download className="size-3.5" aria-hidden /> Summary .md</a>
          <a href={`/api/sprints/${s.id}/export.csv`} download><Download className="size-3.5" aria-hidden /> Summary .csv</a>
          {s.is_facilitator ? <a href={`/api/sprints/${s.id}/export.md?scope=raw`} download><Download className="size-3.5" aria-hidden /> Raw notes .md</a> : null}
        </>
      )}
    </footer>
  )
}

function OutcomeForm({ e, sprintId, onSaved }: { e: Experiment; sprintId: string; onSaved: () => void }) {
  const [status, setStatus] = useState(e.status)
  const [note, setNote] = useState(e.outcome_note ?? '')
  const toast = useToast()
  return (
    <form
      className="recap-outcome"
      onSubmit={async (ev) => {
        ev.preventDefault()
        await patch(`/api/sprints/${sprintId}/experiments/${e.id}`, { status: status === 'accepted' ? undefined : status, outcome_note: note })
        toast('Outcome saved')
        onSaved()
      }}
    >
      <div>
        <label className="block text-xs text-ink-soft" htmlFor={`st-${e.id}`}>What happened?</label>
        <Select id={`st-${e.id}`} value={status} onChange={(ev) => setStatus(ev.target.value)} className="h-9 py-1 text-sm">
          <option value="accepted">Still running</option>
          <option value="helped">Helped</option>
          <option value="did_not_help">Didn’t help</option>
          <option value="inconclusive">Inconclusive</option>
          <option value="not_tried">Not tried yet</option>
        </Select>
      </div>
      <div className="min-w-48 flex-1">
        <label className="block text-xs text-ink-soft" htmlFor={`nt-${e.id}`}>Short note</label>
        <input id={`nt-${e.id}`} className="h-9 w-full rounded-xl border border-line bg-card px-3 text-sm" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} placeholder="What did we learn, even if it failed?" />
      </div>
      <Button size="sm" type="submit">Save</Button>
    </form>
  )
}
