import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Download } from 'lucide-react'
import { ApiError, get, patch, post, put } from '@/api/client'
import type { CheckinView, Experiment, GroupingView, Recap, SprintDetail, StageSnapshot, ThemeView } from '@/api/types'
import { OUTCOME_LABEL } from '@/lib/categories'
import { useKeysEpoch } from '@/lib/e2ee/E2eeProvider'
import { hasPlaceholder, isLocked, LOCKED } from '@/lib/e2ee/keyring'
import { follow } from '@/lib/forms'
import { parseMarkdown, type Inline } from '@/lib/markdown'
import { Button, Dialog, ErrorText, Help, Select, Spinner, Textarea, useToast } from '@/ui'
import { ExperimentEditor } from '@/ui/experiments'
import { Face } from '@/ui/faces'
import { CheckinResult } from '@/ui/checkin'
import { shortDate } from '@/lib/schedule'
import { download, fileName, rawMarkdown, recapDraft, summaryCsv, summaryMarkdown } from '@/lib/e2ee/local-export'

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const minutesBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 60000))
/** The longest recap the server keeps. */
const RECAP_MAX = 20_000
const DECIDED = ['helped', 'did_not_help', 'inconclusive', 'not_tried']

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
  /** The last read failed. With nothing shown yet it takes the page; otherwise it's a line above what was read before. */
  const [error, setError] = useState('')
  const countRef = useRef(onCount)
  countRef.current = onCount
  // Reads overlap (hints, unlocking): only the newest one's answer is shown.
  const seq = useRef(0)
  const load = useCallback(async () => {
    const my = ++seq.current
    try {
      // The retro's own record is optional (a sprint finished without a live retro has none, and
      // retention removes themes after a while): each part simply stays out when it's missing.
      const record = Promise.all([
        get<GroupingView>(`/api/sprints/${sprintId}/themes`).catch(() => null),
        get<StageSnapshot>(`/api/sprints/${sprintId}/meeting`).catch(() => null),
        get<CheckinView[]>(`/api/sprints/${sprintId}/checkins`).catch(() => []),
      ])
      const [e, r] = await Promise.all([get<Experiment[]>(`/api/sprints/${sprintId}/experiments`), get<Recap>(`/api/sprints/${sprintId}/recap`)])
      if (my !== seq.current) return
      setExps(e)
      setRecap(r)
      setError('')
      countRef.current?.(e.filter((x) => x.status !== 'proposed').length)
      const [g, m, c] = await record
      if (my !== seq.current) return
      setThemes((g?.themes ?? []).filter((t) => !t.parked))
      setMeeting(m && !m.cancelled ? m : null)
      setCheckins(c)
    } catch (err) {
      if (my === seq.current) setError(err instanceof ApiError ? err.message : 'Couldn’t load the recap')
    }
  }, [sprintId])
  const keysEpoch = useKeysEpoch()
  useEffect(() => {
    load()
  }, [load, keysEpoch, refresh])
  if (!recap) return error ? <p className="text-ink-soft" role="alert">{error}</p> : <div className="grid place-items-center py-16"><Spinner /></div>

  const fac = s.is_facilitator
  const talked = themes.filter((t) => t.discussed || t.takeaway || t.could_try)
  return (
    <div className="recap">
      {error ? (
        <p className="text-sm text-ink-soft" role="status">
          Couldn’t check for changes just now, so this may be out of date. <button type="button" className="underline underline-offset-2" onClick={() => void load()}>Try again</button>
        </p>
      ) : null}
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
  const decided = DECIDED.includes(e.status)
  /** The answer on its way (one at a time: a second press never sends twice). */
  const [answering, setAnswering] = useState<boolean | null>(null)
  const answer = async (accept: boolean) => {
    if (answering !== null) return
    setAnswering(accept)
    try {
      await post(`/api/sprints/${s.id}/experiments/${e.id}/accept`, { accept })
      if (accept) toast('You own this experiment')
      onChange()
    } catch (err) {
      toast(err instanceof ApiError ? (err.status === 0 ? 'You’re offline, so your answer wasn’t sent.' : sentence(err.message)) : 'Couldn’t save', 'danger')
    } finally {
      setAnswering(null)
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
              <Button size="sm" variant="primary" busy={answering === true} disabled={answering !== null} onClick={() => answer(true)}>I’ll own this</Button>
              <Button size="sm" variant="ghost" busy={answering === false} disabled={answering !== null} onClick={() => answer(false)}>Not me</Button>
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
  const votes = t.votes ?? 0
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
      <span className="recap-topic-votes">
        <b>{votes}<span className="sr-only"> {votes === 1 ? 'vote' : 'votes'}</span></b>
        <i aria-hidden><span style={{ width: `${(votes / most) * 100}%` }} /></i>
      </span>
    </li>
  )
}

/**
 * The facilitator's recap: shown as written, set as text (lib/markdown.ts). The facilitator writes
 * it here and publishes it to everyone in the sprint. "Fill in from the record" drafts it on this
 * device, for every sprint, and never saves by itself; it asks before replacing what's written.
 */
function RecapText({ s, recap, exps, onSaved }: { s: SprintDetail; recap: Recap; exps: Experiment[]; onSaved: (r: Recap) => void }) {
  const toast = useToast()
  const fac = s.is_facilitator
  const [draft, setDraft] = useState(recap.body)
  const [open, setOpen] = useState(fac && !recap.published_at)
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'fill'>(null)
  const [replacing, setReplacing] = useState(false)
  // What the draft was last filled from: a draft still as it was follows newer text (another tab,
  // or this device unlocking), and one showing "can't be shown" always does.
  const loaded = useRef(recap.body)
  useEffect(() => {
    const prev = loaded.current
    loaded.current = recap.body
    setDraft((d) => follow(d, prev, recap.body))
  }, [recap.body])
  if (!fac && !recap.exists) return null
  const unreadable = hasPlaceholder(draft)
  const save = async (publish: boolean) => {
    setBusy(publish ? 'publish' : 'save')
    try {
      const r = await put<Recap>(`/api/sprints/${s.id}/recap`, { body: draft, publish: publish || undefined })
      // What was sent is what's saved now (as the server keeps it, trimmed).
      loaded.current = draft
      onSaved(r)
      toast(publish ? 'Recap published to everyone in the sprint' : 'Saved')
      if (publish) setOpen(false)
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Couldn’t save', 'danger')
    } finally {
      setBusy(null)
    }
  }
  const fill = async () => {
    setReplacing(false)
    setBusy('fill')
    try {
      // The record this device can read; without themes (none, or retention removed them) the draft is shorter.
      const g = await get<GroupingView>(`/api/sprints/${s.id}/themes`).catch((e) => {
        if (e instanceof ApiError && e.status === 0) throw e
        return null
      })
      setDraft(recapDraft(s, g, exps))
      toast('Filled in from the retro’s record. Save to keep it.')
    } catch (err) {
      toast(err instanceof ApiError && err.status === 0 ? 'You’re offline, so it couldn’t be filled in. What’s written is unchanged.' : 'Couldn’t fill it in just now. What’s written is unchanged.', 'danger')
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="recap-block" aria-labelledby="recap-words">
      <header className="recap-block-head">
        <h2 id="recap-words" className="recap-h">In the facilitator’s <em>words</em></h2>
        <p className="recap-note">{recap.published_at ? `Published ${new Date(recap.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.` : fac ? 'Not published yet — only you can see it.' : ''}</p>
      </header>
      {recap.exists && recap.body.trim() && !open ? (
        isLocked(recap.body) ? <p className="recap-letter italic text-ink-soft">{LOCKED.slice(1)}</p> : <div className="recap-letter"><Prose text={recap.body} /></div>
      ) : null}
      {fac ? (
        open ? (
          unreadable ? (
            <div className="recap-write">
              <p className="text-sm text-ink-soft" role="status">This device can’t show the recap yet — it doesn’t have the sprint’s key. Once it’s unlocked, the recap appears here to edit.</p>
              {recap.published_at ? <Button size="sm" variant="ghost" className="mt-3" onClick={() => setOpen(false)}>Cancel</Button> : null}
            </div>
          ) : (
            <div className="recap-write">
              <Textarea rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={RECAP_MAX} className="font-mono text-sm" aria-label="Recap (Markdown)" placeholder="Start from the retro’s record, then make it yours." />
              <Help>Headings with #, lists with - or 1., **bold** and _italics_. Publishing shows it to everyone in the sprint; nothing is emailed.</Help>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="ghost" busy={busy === 'fill'} disabled={!!busy} onClick={() => (draft.trim() ? setReplacing(true) : void fill())}>Fill in from the record</Button>
                <span className="flex-1" />
                {recap.published_at ? <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button> : null}
                <Button size="sm" busy={busy === 'save'} disabled={!!busy} onClick={() => save(false)}>Save draft</Button>
                <Button size="sm" variant="primary" busy={busy === 'publish'} disabled={!!busy} onClick={() => save(true)}>{recap.published_at ? 'Publish changes' : 'Publish'}</Button>
              </div>
            </div>
          )
        ) : (
          <button className="recap-edit" onClick={() => setOpen(true)}>{recap.exists ? 'Edit the recap' : 'Write the recap'}</button>
        )
      ) : null}
      <Dialog open={replacing} onOpenChange={(o) => !o && setReplacing(false)} title="Replace what’s written?" description="Filling in from the retro’s record replaces the text in the box with a fresh draft. Nothing is saved until you save it.">
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setReplacing(false)}>Keep what’s written</Button>
          <Button variant="primary" onClick={() => void fill()}>Replace it</Button>
        </div>
      </Dialog>
    </section>
  )
}

/** A recap, as text: never raw HTML, and only web links are followed. */
function Prose({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) =>
        b.t === 'h' ? (
          b.level === 3 ? <h3 key={i}><Inlines c={b.c} /></h3> : <h4 key={i}><Inlines c={b.c} /></h4>
        ) : b.t === 'p' ? (
          <p key={i}><Inlines c={b.c} /></p>
        ) : b.t === 'hr' ? (
          <hr key={i} />
        ) : b.t === 'ul' ? (
          <ul key={i}>{b.items.map((c, j) => <li key={j}><Inlines c={c} /></li>)}</ul>
        ) : (
          <ol key={i} start={b.start === 1 ? undefined : b.start}>{b.items.map((c, j) => <li key={j}><Inlines c={c} /></li>)}</ol>
        ),
      )}
    </>
  )
}

function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((n, i) =>
        n.t === 'text' ? <Fragment key={i}>{n.v}</Fragment>
        : n.t === 'br' ? <br key={i} />
        : n.t === 'code' ? <code key={i}>{n.v}</code>
        : n.t === 'strong' ? <strong key={i}><Inlines c={n.c} /></strong>
        : n.t === 'em' ? <em key={i}><Inlines c={n.c} /></em>
        : <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow"><Inlines c={n.c} /></a>,
      )}
    </>
  )
}

function Downloads({ s, exps, recap }: { s: SprintDetail; exps: Experiment[]; recap: Recap }) {
  const encrypted = s.encryption === 'e1'
  const themes = () => get<GroupingView>(`/api/sprints/${s.id}/themes`).catch(() => null)
  return (
    <footer className="recap-downloads">
      <span>Take it with you <em>— no authors, times or individual votes: only totals, and experiment owners by name{encrypted ? '. Not encrypted once saved' : ''}</em></span>
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

/**
 * What happened with an experiment: a verdict and a short note. Only what was changed here is sent,
 * so a newer note (the owner's, another tab's) is never overwritten by an older copy. A verdict
 * can't be taken back to "still running" (the server keeps it once given), so that isn't offered
 * after one.
 */
function OutcomeForm({ e, sprintId, onSaved }: { e: Experiment; sprintId: string; onSaved: () => void }) {
  const toast = useToast()
  const decided = DECIDED.includes(e.status)
  const noteLocked = isLocked(e.outcome_note)
  const [status, setStatus] = useState(e.status)
  const [note, setNote] = useState(e.outcome_note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const loaded = useRef({ status: e.status, note: e.outcome_note ?? '' })
  useEffect(() => {
    const prev = loaded.current
    const fresh = { status: e.status, note: e.outcome_note ?? '' }
    loaded.current = fresh
    setStatus((v) => follow(v, prev.status, fresh.status))
    setNote((v) => follow(v, prev.note, fresh.note))
  }, [e.status, e.outcome_note])
  const changes: Record<string, string> = {}
  if (status !== e.status && status !== 'accepted') changes.status = status
  if (!noteLocked && note !== (e.outcome_note ?? '')) changes.outcome_note = note
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy || !Object.keys(changes).length) return
    setBusy(true)
    setError('')
    try {
      await patch(`/api/sprints/${sprintId}/experiments/${e.id}`, changes)
      toast(changes.status ? 'Outcome saved' : 'Note saved')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 0 ? 'You’re offline, so it wasn’t saved. It’s still here.' : sentence(err.message)) : 'Couldn’t save it — try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <form className="recap-outcome" onSubmit={submit}>
        <div>
          <label className="block text-xs text-ink-soft" htmlFor={`st-${e.id}`}>What happened?</label>
          {/* As tall as the note beside it; the field's own padding would otherwise clip the words. */}
          <Select id={`st-${e.id}`} value={status} onChange={(ev) => setStatus(ev.target.value)} style={{ height: '2.25rem', paddingBlock: 0, fontSize: 14 }}>
            {decided ? null : <option value="accepted">Still running</option>}
            <option value="helped">Helped</option>
            <option value="did_not_help">Didn’t help</option>
            <option value="inconclusive">Inconclusive</option>
            <option value="not_tried">Not tried yet</option>
          </Select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="block text-xs text-ink-soft" htmlFor={`nt-${e.id}`}>Short note</label>
          <input id={`nt-${e.id}`} className="h-9 w-full rounded-xl border border-line bg-card px-3 text-sm disabled:opacity-60" value={noteLocked ? '' : note} disabled={noteLocked} onChange={(ev) => setNote(ev.target.value)} maxLength={500} placeholder={noteLocked ? 'Can’t be shown on this device' : 'What did we learn, even if it failed?'} />
        </div>
        <Button size="sm" type="submit" busy={busy} disabled={!Object.keys(changes).length}>Save</Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </>
  )
}

/** Server messages are lower-case fragments; show them as sentences. */
function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
