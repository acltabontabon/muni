/**
 * Sprints: a place to find a sprint and open it. The current one is set large — its name, where it
 * is, and the way in — and everything you do with it happens on its own page. Beside it, quieter:
 * when the retro is planned, the sprint's dates and people, and experiments due for another look.
 * Below: other sprints in progress, then earlier ones as an aligned ledger.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Plus } from 'lucide-react'
import type { Experiment, Participant, SprintDetail, SprintSummary } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { OUTCOME_LABEL } from '@/lib/categories'
import { PHASE_OF, STATUS_PHRASE } from '@/lib/lifecycle'
import { useResource } from '@/lib/resource'
import { dateRange, describeRetro, shortDate } from '@/lib/schedule'
import { useDocumentTitle } from '@/ui'
import { Postcard } from '@/ui/art'
import { SectionActions, SectionError, SectionPending, useWorkspaceShell } from './Layout'
import { initials } from './People'

/** The order an open sprint is chosen as "the" current one. */
const ORDER = ['live', 'ready', 'preparing', 'collecting', 'draft']
const OPEN = ['live', 'ready', 'preparing', 'collecting']
const ARCHIVE_STEP = 8

export function WorkspaceSprints() {
  const { ws } = useWorkspaceShell()
  const { offline } = useAuth()
  useDocumentTitle(ws.name)
  const sprints = useResource<SprintSummary[]>(`/api/workspaces/${ws.id}/sprints`)
  const experiments = useResource<Experiment[]>(`/api/workspaces/${ws.id}/experiments`)
  const list = sprints.data
  const active = useMemo(() => (list ?? []).filter((s) => ORDER.includes(s.status)).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)), [list])
  const lead = active.find((s) => s.is_participant) ?? active[0] ?? null
  // Who's in the current sprint (the list only counts them).
  const detail = useResource<SprintDetail>(lead ? `/api/sprints/${lead.id}` : null)

  const newSprint = !offline ? (
    <Link to={`/workspaces/${ws.id}/sprints/new`} className="ws-btn ws-btn--secondary">
      <Plus className="size-4" aria-hidden /> New sprint
    </Link>
  ) : null

  if (sprints.error) return <SectionError error={sprints.error} onRetry={() => { void sprints.reload(); void experiments.reload() }} what="this workspace’s sprints" />
  // First visit: the page appears once, when the list and its experiments are both here.
  if (!list || experiments.loading) return <SectionPending label="Loading sprints" rows={5} />

  const exps = experiments.data ?? []
  const today = new Date().toISOString().slice(0, 10)
  const revisit = exps.filter((e) => e.status === 'accepted' || e.status === 'proposed').sort((a, b) => a.review_on.localeCompare(b.review_on))
  const others = active.filter((s) => s.id !== lead?.id)
  const open = others.filter((s) => OPEN.includes(s.status))
  const upcoming = others.filter((s) => s.status === 'draft')
  const past = list.filter((s) => s.status === 'completed' || s.status === 'archived')

  if (list.length === 0)
    return (
      <section className="ws-first" aria-labelledby="first">
        <div className="min-w-0">
          <h2 id="first" className="chapter-title">Set up your first <em>sprint</em></h2>
          <p className="chapter-body mt-3">A sprint gives the team a place to write thoughts as things happen, then a retro to talk them through. Setup takes a minute: a name, the dates, and who’s in.</p>
          {!offline ? (
            <Link to={`/workspaces/${ws.id}/sprints/new`} className="ws-btn ws-btn--primary mt-6">Set up a sprint <ArrowRight className="size-4" aria-hidden /></Link>
          ) : (
            <p className="mt-4 text-sm text-ink-soft">Setting up a sprint needs a connection.</p>
          )}
        </div>
        <Postcard framing="close" className="ws-first-art" />
      </section>
    )

  return (
    <>
      <SectionActions>{newSprint}</SectionActions>
      <div className="ws-sprints">
        {lead ? (
          <Chapter s={lead} people={detail.data?.id === lead.id ? detail.data.participants : undefined} />
        ) : (
          <section className="chapter" aria-labelledby="chapter-title">
            <p className="ws-eyebrow">Between sprints</p>
            <h2 id="chapter-title" className="chapter-title">No sprint is open right now</h2>
            <p className="chapter-body mt-3">When the next one starts, it opens here: a place to write thoughts as things happen, then the retro.</p>
            {!offline ? <Link to={`/workspaces/${ws.id}/sprints/new`} className="ws-btn ws-btn--primary mt-6">Set up the next sprint <ArrowRight className="size-4" aria-hidden /></Link> : null}
          </section>
        )}
        <aside className="chapter-aside" aria-label={lead ? 'Retro and sprint details' : 'Experiments to revisit'}>
          {lead ? <Appointment s={lead} /> : null}
          {revisit.length ? (
            <section className="aside-block" aria-labelledby="revisit">
              <h2 id="revisit" className="ws-eyebrow">To revisit</h2>
              <p className="aside-note">Experiments the team agreed to try. The next retro starts with these.</p>
              <ul className="revisit">
                {revisit.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <p className="revisit-change">{e.change_to_try}</p>
                    <p className="revisit-meta">
                      {e.status === 'proposed' ? <span className="text-warn">{e.owner_name ? `Waiting for ${e.owner_name}` : 'Needs an owner'} · </span> : e.owner_name ? `${e.owner_name} · ` : ''}
                      {e.review_on <= today ? <strong className="revisit-due">Due {shortDate(e.review_on)}</strong> : <>Revisit {shortDate(e.review_on)}</>}
                    </p>
                  </li>
                ))}
              </ul>
              {revisit.length > 4 ? <p className="aside-note mt-3">And {revisit.length - 4} more, in their sprints’ outcomes.</p> : null}
            </section>
          ) : lead && !exps.length ? (
            <section className="aside-block" aria-labelledby="revisit">
              <h2 id="revisit" className="ws-eyebrow">To revisit</h2>
              <p className="aside-note">What the team agrees to try in a retro comes back here, each with the day to look at it again.</p>
            </section>
          ) : null}
        </aside>
      </div>

      {open.length ? <Ledger id="open" title="Also in progress" rows={open} /> : null}
      {upcoming.length ? <Ledger id="upcoming" title="Upcoming" rows={upcoming} /> : null}
      {past.length ? (
        <Archive past={past} exps={exps} />
      ) : lead ? (
        <section className="ws-section ws-section--quiet" aria-labelledby="earlier">
          <div className="ws-section-head">
            <h2 id="earlier" className="ws-section-title">Earlier sprints</h2>
          </div>
          <p className="ws-section-note">The first chapter. When {lead.name} is done, it’s kept here with what the team agreed to try, and later, whether it helped.</p>
        </section>
      ) : null}
    </>
  )
}

/** The open chapter: the sprint's name, where it is, its days and its people, and the way in. */
function Chapter({ s, people }: { s: SprintSummary; people?: Participant[] }) {
  const href = `/sprints/${s.id}`
  return (
    <section className="chapter" aria-labelledby="chapter-title">
      <p className="ws-eyebrow">{s.status === 'draft' ? 'Next sprint' : 'Current sprint'}</p>
      <h2 id="chapter-title" className="chapter-title">
        <Link to={href}>{s.name}</Link>
      </h2>
      {s.goal ? <p className="chapter-goal">{s.goal}</p> : null}
      <p className="chapter-state" data-phase={PHASE_OF[s.status] ?? 'draft'}>
        <span className="sbar-dot" aria-hidden />
        <span>{stateOf(s)}</span>
        {s.is_facilitator ? <span className="chapter-role">You’re facilitating</span> : null}
      </p>
      <SprintDays s={s} />
      {people?.length ? <Crew people={people} /> : null}
      <div className="chapter-actions">
        <Link to={href} className="ws-btn ws-btn--primary">
          Open sprint <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  )
}

/** The retro as an appointment. */
function Appointment({ s }: { s: SprintSummary }) {
  const r = describeRetro(s.retro_at, s.timezone)
  return (
    <>
      <section className="aside-block" aria-labelledby="retro-when">
        <h2 id="retro-when" className="ws-eyebrow">Retro, planned</h2>
        <p className="aside-date">{r.date}</p>
        <p className="aside-line">
          <span className="tabular-nums">{r.time}</span> <span title={r.offset}>{r.zone}</span> · {s.retro_duration_min} min
        </p>
        <p className="aside-note">{r.relative}{r.yours ? ` · ${r.yours}` : ''}</p>
      </section>
    </>
  )
}

/** A calendar day ("2026-09-27") in a timezone, or on this device. */
function dayIn(tz: string, at = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
  } catch {
    return new Date(at).toISOString().slice(0, 10)
  }
}
const DAY = 86_400_000
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)

/**
 * The sprint's days on one line — the workspace's horizon again: the days gone inked in, today
 * standing up from it, and the retro as the sun resting on the line. A picture of where the team
 * is; it says the same in words underneath.
 */
function SprintDays({ s }: { s: SprintSummary }) {
  const today = dayIn(s.timezone)
  const retro = s.retro_local_date
  const last = retro > s.ends_on ? retro : s.ends_on
  const days: string[] = []
  for (let d = s.starts_on; d <= last && days.length < 60; d = addDay(d, 1)) days.push(d)
  const length = Math.round((Date.parse(`${s.ends_on}T12:00:00Z`) - Date.parse(`${s.starts_on}T12:00:00Z`)) / DAY) + 1
  const n = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${s.starts_on}T12:00:00Z`)) / DAY) + 1
  const where = n < 1 ? `Starts ${shortDate(s.starts_on)}` : n > length ? 'The sprint’s days are over' : `Day ${n} of ${length}`
  return (
    <figure className="days" aria-label={`${where}. ${dateRange(s.starts_on, s.ends_on)}; retro planned ${shortDate(retro)}.`}>
      <ol className="days-line" aria-hidden style={{ ['--n' as string]: days.length }}>
        {days.map((d) => {
          const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
          return (
            <li
              key={d}
              data-past={d < today || undefined}
              data-today={d === today || undefined}
              data-rest={wd === 0 || wd === 6 || undefined}
              data-after={d > s.ends_on || undefined}
              data-retro={d === retro || undefined}
            />
          )
        })}
      </ol>
      <figcaption className="days-caption">
        <span className="days-where">{where}</span>
        <span>{dateRange(s.starts_on, s.ends_on)}</span>
        <span className="days-retro">Retro, planned {shortDate(retro)}</span>
      </figcaption>
    </figure>
  )
}

/** The sprint's people, as the People page draws them; the facilitator marked. */
function Crew({ people }: { people: Participant[] }) {
  const shown = people.slice(0, 9)
  return (
    <div className="crew">
      <ul className="crew-marks" aria-label={`Who’s in: ${people.map((p) => p.display_name + (p.is_facilitator ? ' (facilitator)' : '')).join(', ')}`}>
        {shown.map((p) => (
          <li key={p.account_id} title={p.display_name + (p.is_facilitator ? ' · facilitator' : '') + (p.is_you ? ' · you' : '')} data-you={p.is_you || undefined} data-fac={p.is_facilitator || undefined}>
            <span className="person-mark" aria-hidden>{initials(p.display_name)}</span>
          </li>
        ))}
        {people.length > shown.length ? <li className="crew-more" aria-hidden>+{people.length - shown.length}</li> : null}
      </ul>
      <p className="crew-note">
        {people.length} {people.length === 1 ? 'person' : 'people'}
        {people.find((p) => p.is_facilitator) ? <> · facilitated by {people.find((p) => p.is_facilitator)!.is_you ? 'you' : people.find((p) => p.is_facilitator)!.display_name}</> : null}
      </p>
    </div>
  )
}

function stateOf(s: SprintSummary) {
  if (s.status === 'draft') return Date.parse(`${s.starts_on}T00:00:00`) > Date.now() ? `Starts ${shortDate(s.starts_on)}` : 'Setting up'
  return STATUS_PHRASE[s.status] ?? s.status
}

/** Sprints as a ledger: titles, dates and states on shared columns. */
function Ledger({ id, title, rows, note }: { id: string; title: string; rows: SprintSummary[]; note?: string }) {
  return (
    <section className="ws-section" aria-labelledby={id}>
      <div className="ws-section-head">
        <h2 id={id} className="ws-section-title">{title}</h2>
        {note ? <p className="ws-section-note">{note}</p> : null}
      </div>
      <SprintRows rows={rows} />
    </section>
  )
}

function SprintRows({ rows, meta }: { rows: SprintSummary[]; meta?: (s: SprintSummary) => string }) {
  return (
    <ul className="ledger">
      {rows.map((s) => (
        <li key={s.id}>
          <Link to={`/sprints/${s.id}`} className="ledger-row">
            <span className="ledger-name">{s.name}</span>
            <span className="ledger-meta">
              <span className="ledger-dates">{dateRange(s.starts_on, s.ends_on)}</span>
              <span className="ledger-state">{meta ? meta(s) : stateOf(s)}</span>
            </span>
            <ArrowRight className="ledger-go" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Earlier sprints, newest first, a page at a time; and, folded, what past experiments showed. */
function Archive({ past, exps }: { past: SprintSummary[]; exps: Experiment[] }) {
  const [shown, setShown] = useState(ARCHIVE_STEP)
  const tried = (id: string) => exps.filter((e) => e.sprint_id === id && e.status !== 'proposed').length
  const reviewed = exps.filter((e) => ['helped', 'did_not_help', 'inconclusive', 'not_tried'].includes(e.status))
  return (
    <section className="ws-section" aria-labelledby="earlier">
      <div className="ws-section-head">
        <h2 id="earlier" className="ws-section-title">Earlier sprints</h2>
        <p className="ws-section-note">{past.length} {past.length === 1 ? 'sprint' : 'sprints'}. Outcomes and recaps.</p>
      </div>
      <div className="min-w-0">
        <SprintRows
          rows={past.slice(0, shown)}
                    meta={(s) => {
            const n = tried(s.id)
            return `${s.status === 'archived' ? 'Archived' : 'Complete'}${n ? ` · ${n} ${n === 1 ? 'experiment' : 'experiments'}` : ''}`
          }}
        />
        {past.length > shown ? (
          <button type="button" className="ws-link mt-4" onClick={() => setShown((n) => n + ARCHIVE_STEP * 3)}>
            Show {Math.min(past.length - shown, ARCHIVE_STEP * 3)} more
          </button>
        ) : null}
        {reviewed.length ? (
          <details className="ws-details">
            <summary>What past experiments showed</summary>
            <ul className="ledger">
              {reviewed.map((e) => (
                <li key={e.id} className="ledger-note">
                  <span className="ledger-note-verdict">{OUTCOME_LABEL[e.status]}</span>
                  <span className="min-w-0">
                    <span className="block [overflow-wrap:anywhere]">{e.change_to_try}</span>
                    {e.outcome_note ? <span className="mt-1 block text-ink-soft [overflow-wrap:anywhere]">{e.outcome_note}</span> : null}
                    <span className="mt-1 block text-sm text-ink-faint">{e.sprint_name}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  )
}
