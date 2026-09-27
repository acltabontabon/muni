/**
 * Sprints: the current sprint is the open chapter — its name, where it is, and the next useful
 * step, set directly on the page. Beside it, quieter: when the retro is, the sprint's dates and
 * people, and experiments due for another look. Below: other sprints in progress, then earlier
 * ones as an aligned ledger.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Info, Lock, Plus } from 'lucide-react'
import type { Experiment, SprintDetail, SprintSummary } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { OUTCOME_LABEL } from '@/lib/categories'
import { STATUS_PHRASE, STEPS, sprintGuide, type Step } from '@/lib/lifecycle'
import { useResource } from '@/lib/resource'
import { dateRange, describeRetro, shortDate } from '@/lib/schedule'
import { useDocumentTitle } from '@/ui'
import { Postcard } from '@/ui/art'
import { SectionActions, SectionError, SectionPending, useWorkspaceShell } from './Layout'

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
  // The full record adds only the notes worth knowing (e.g. no thoughts were added); the chapter
  // itself reads from the list.
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
          <Chapter s={lead} detail={detail.data?.id === lead.id ? detail.data : undefined} online={!offline} />
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
          ) : null}
        </aside>
      </div>

      {open.length ? <Ledger id="open" title="Also in progress" rows={open} /> : null}
      {upcoming.length ? <Ledger id="upcoming" title="Upcoming" rows={upcoming} /> : null}
      {past.length ? <Archive past={past} exps={exps} /> : null}
    </>
  )
}

/** The open chapter: name, where it is, the next step — and the facilitator's own, kept apart. */
function Chapter({ s, detail, online }: { s: SprintSummary; detail?: SprintDetail; online: boolean }) {
  // Counts only come with the full record; until then no note is drawn from them (-1 is "unknown").
  const g = sprintGuide({ ...s, entry_count: detail?.entry_count ?? null, theme_count: detail?.theme_count ?? -1, reopened_count: detail?.reopened_count ?? 0 }, { online })
  const primary = g.actions[0]
  const facNext = g.facilitator?.actions[0]
  const guide = `/sprints/${s.id}`
  return (
    <section className="chapter" aria-labelledby="chapter-title">
      <p className="ws-eyebrow">{s.status === 'draft' ? 'Next sprint' : 'Current sprint'}</p>
      <h2 id="chapter-title" className="chapter-title">
        <Link to={guide}>{s.name}</Link>
      </h2>
      {s.goal ? <p className="chapter-goal">{s.goal}</p> : null}
      <Lifecycle step={g.step} />
      <div className="chapter-now">
        <h3 className="chapter-phase">{g.title}</h3>
        <p className="chapter-body">{g.body}</p>
        {g.notes.length ? (
          <ul className="chapter-notes">
            {g.notes.map((n) => (
              <li key={n}><Info className="size-4 shrink-0" aria-hidden /> {n}</li>
            ))}
          </ul>
        ) : null}
        <div className="chapter-actions">
          {primary?.kind === 'write' ? <Link to={`/?sprint=${s.id}`} className="ws-btn ws-btn--primary">Write a thought <ArrowRight className="size-4" aria-hidden /></Link> : null}
          {primary?.kind === 'link' ? <Link to={primary.href} className={`ws-btn ${facNext ? 'ws-btn--secondary' : 'ws-btn--primary'}`}>{primary.label}</Link> : null}
          {!primary && !g.facilitator ? <Link to={guide} className="ws-btn ws-btn--secondary">Open the sprint guide</Link> : null}
          {primary || g.facilitator ? <Link to={guide} className="ws-link">Sprint guide</Link> : null}
        </div>
      </div>
      {g.facilitator ? (
        <div className="chapter-fac" role="group" aria-labelledby="fac-title">
          <p id="fac-title" className="ws-eyebrow">Facilitator · only you see this</p>
          <p className="chapter-fac-body">{g.facilitator.body}</p>
          {facNext ? (
            <Link to={facNext.kind === 'link' ? facNext.href : guide} className={`ws-btn ${primary ? 'ws-btn--secondary' : 'ws-btn--primary'} mt-4`}>
              {facNext.kind === 'link' ? facNext.label : `Next: ${facNext.label.replace('…', '')}`} <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Set up → Collect → Prepare → Retro → Outcomes, as a line through the chapter. Done steps are
 * ticked, the current one is filled and says "Now", the rest are open rings: shape and words, not
 * colour alone. Not links: the steps describe; the actions below act. On a phone the line
 * becomes a short bar with one sentence, rather than five labels in tiny type.
 */
export function Lifecycle({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step)
  const next = STEPS[at + 1]
  return (
    <div className="life">
      <ol className="life-steps" aria-label="Where the sprint is">
        {STEPS.map((s, i) => {
          const state = i < at ? 'done' : i === at ? 'now' : 'next'
          return (
            <li key={s.id} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="life-mark" aria-hidden>{state === 'done' ? <Check className="size-2.5" strokeWidth={3.5} /> : null}</span>
              <span className="life-label">{s.label}</span>
              <span className="life-state">{state === 'done' ? <span className="sr-only">done</span> : state === 'now' ? 'Now' : null}</span>
            </li>
          )
        })}
      </ol>
      <p className="life-compact" aria-hidden>
        <span>Step {at + 1} of {STEPS.length}</span> <strong>{STEPS[at].label}</strong>
        {next ? <span className="life-then">Next: {next.label}</span> : null}
      </p>
    </div>
  )
}

/** The retro as an appointment, and the sprint's plain facts. */
function Appointment({ s }: { s: SprintSummary }) {
  const r = describeRetro(s.retro_at, s.timezone)
  return (
    <>
      <section className="aside-block" aria-labelledby="retro-when">
        <h2 id="retro-when" className="ws-eyebrow">Retro</h2>
        <p className="aside-date">{r.date}</p>
        <p className="aside-line">
          <span className="tabular-nums">{r.time}</span> <span title={r.offset}>{r.zone}</span> · {s.retro_duration_min} min
        </p>
        <p className="aside-note">{r.relative}{r.yours ? ` · ${r.yours}` : ''}</p>
      </section>
      <section className="aside-block" aria-labelledby="sprint-facts">
        <h2 id="sprint-facts" className="ws-eyebrow">Sprint</h2>
        <p className="aside-line">{dateRange(s.starts_on, s.ends_on)}</p>
        <p className="aside-line">
          {s.participant_count} {s.participant_count === 1 ? 'person' : 'people'}
          {s.facilitator_name ? <> · facilitated by {s.is_facilitator ? 'you' : s.facilitator_name}</> : null}
        </p>
        {s.encryption === 'e1' ? (
          <p className="aside-note aside-lock"><Lock className="size-3.5 shrink-0" aria-hidden /> <span>Thoughts are encrypted on each writer’s device. <Link to="/privacy#encryption" className="underline underline-offset-2">What that covers</Link></span></p>
        ) : null}
      </section>
    </>
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

function SprintRows({ rows, meta, href }: { rows: SprintSummary[]; meta?: (s: SprintSummary) => string; href?: (s: SprintSummary) => string }) {
  return (
    <ul className="ledger">
      {rows.map((s) => (
        <li key={s.id}>
          <Link to={href ? href(s) : `/sprints/${s.id}`} className="ledger-row">
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
          href={(s) => `/sprints/${s.id}/outcomes`}
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
