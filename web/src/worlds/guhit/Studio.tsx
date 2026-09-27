/**
 * Guhit's studio: the writing page and collection as Guhit's working sketchbook, open on a desk.
 *
 * This is a layout, not a skin. It composes the page differently from Muni's journal — the sprint
 * is the index tab on the current section, the heading and the field share one sheet, optional
 * details wait behind two named controls, and saved thoughts are the pages already filled — while
 * every behaviour comes from the shared pieces: drafts, the send queue, encryption, what
 * "submitted" means, editing and deleting (ui/capture.tsx), sprint rules (routes/Home.tsx).
 *
 * Character lives in the empty state and a few marks in the margin; labels stay plain. Decoration
 * is aria-hidden and still; the only motion is the heading's underline inked once (CSS), a confirmation tick after
 * a save, and a new page settling into the collection — none of it touches focus or the caret.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import * as Popover from '@radix-ui/react-popover'
import * as RDialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronDown, Plus, X } from 'lucide-react'
import type { Category, Me, Period } from '@/api/types'
import { CATEGORIES, categoryMeta, MEMORY_PROMPTS, PERIODS } from '@/lib/categories'
import type { Destination } from '@/lib/local/LocalProvider'
import { describeRetro, retroShort } from '@/lib/schedule'
import { writePrefs } from '@/lib/prefs'
import { chooseWorkspace } from '@/lib/workspace'
import { Button, ErrorText, Kbd } from '@/ui'
import { CategoryField, Choices, useComposer } from '@/ui/capture'
import { invitationFor } from '../characters'
import { Portrait } from '../portraits'
import { useWorld } from '../world'
import { MasterPlan } from './MasterPlan'

const HAND = "'Caveat Variable', 'Caveat', cursive"
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
const periodOptions = PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))

function useNarrow() {
  const q = '(max-width: 639px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

/** A small panel beside its control; on a phone, a sheet from the bottom of the screen. */
function Panel({ trigger, title, open, onOpenChange, children, align = 'start', initialFocus }: { trigger: ReactNode; title: string; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode; align?: 'start' | 'end'; initialFocus?: () => HTMLElement | null }) {
  const narrow = useNarrow()
  const focus = (e: Event) => {
    const el = initialFocus?.()
    if (el) {
      e.preventDefault()
      el.focus()
    }
  }
  if (narrow)
    return (
      <RDialog.Root open={open} onOpenChange={onOpenChange}>
        <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>
        <RDialog.Portal>
          <RDialog.Overlay className="guhit-veil" />
          <RDialog.Content className="guhit-drawer" aria-describedby={undefined} onOpenAutoFocus={focus}>
            <div className="guhit-drawer-head">
              <RDialog.Title className="guhit-panel-title">{title}</RDialog.Title>
              <RDialog.Close className="icon-btn" aria-label="Close">
                <X className="size-4" aria-hidden />
              </RDialog.Close>
            </div>
            {children}
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    )
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="guhit-pop" align={align} side="bottom" sideOffset={8} collisionPadding={12} aria-label={title} onOpenAutoFocus={focus}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ─────────────────────────────────────────────────────────────── marks (decoration)

/** A registration mark, as on a proof: Guhit's signature at the sheet's corners. */
function Reg({ className }: { className?: string }) {
  return (
    <svg className={clsx('guhit-reg', className)} viewBox="-8 -8 16 16" aria-hidden focusable="false">
      <circle r="3.6" fill="none" />
      <path d="M-7 0H7M0 -7V7" />
    </svg>
  )
}

/** The pencil from behind Guhit's ear, left on the desk above the sheet. */
function Pencil() {
  return (
    <svg className="guhit-pencil" viewBox="0 0 220 26" aria-hidden focusable="false">
      <g transform="rotate(-4 110 13)">
        <path d="M20 6h150v14H20z" fill="var(--g-yellow)" />
        <path d="M20 10.7h150M20 15.3h150" stroke="var(--g-ink)" strokeOpacity="0.18" strokeWidth="0.8" />
        <path d="M170 6h14v14h-14z" fill="var(--g-metal)" />
        <path d="M174 6v14M179 6v14" stroke="var(--g-ink)" strokeOpacity="0.25" strokeWidth="0.8" />
        <path d="M184 6h12a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-12z" fill="var(--accent)" />
        <path d="M20 6L2 13l18 7z" fill="var(--g-wood)" />
        <path d="M8 10.6L2 13l6 2.4z" fill="var(--g-ink)" />
      </g>
    </svg>
  )
}

/** The tick after a save: drawn once, by hand. */
function Tick() {
  return (
    <svg className="guhit-tick" viewBox="0 0 24 20" aria-hidden focusable="false">
      <path d="M3 11.5c2.2 1.4 4 3.3 5.4 5.6C11.6 10 15.8 5 21 2.5" pathLength={1} />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────── the sprint's index tab

export type TabSprint = { id: string; name: string; workspace_id: string; timezone: string; retro_at?: string; is_facilitator?: boolean; encryption?: 'e1' | null }
export type TabState = 'collecting' | 'closed-now' | 'closed' | 'live' | 'done' | 'none' | 'choose'
const STATE_LABEL: Record<TabState, string> = {
  collecting: 'Collecting',
  'closed-now': 'Collection just closed',
  closed: 'Collection closed',
  live: 'Retro live',
  done: 'Retro complete',
  none: 'Nothing collecting',
  choose: 'Several collecting',
}

/**
 * Which sprint this page is about, as the label on the notebook's current section: the name first,
 * then its state and the next date worth knowing. The rest — the full time in both timezones, who
 * can read what, other sprints to write for — is one press away, in the details.
 */
export function SprintTab({
  s,
  state,
  title,
  me,
  choices = [],
  onSwitch,
  elsewhere = [],
}: {
  s: TabSprint | null
  state: TabState
  /** Shown instead of a sprint's name (no sprint, or one still to choose). */
  title?: string
  me: Me
  choices?: Destination[]
  onSwitch?: (d: Destination) => void
  elsewhere?: TabSprint[]
}) {
  const [open, setOpen] = useState(false)
  const uid = useId()
  const when = s ? retroShort(s.retro_at, s.timezone) : null
  const workspace = s ? me.workspaces.find((w) => w.id === s.workspace_id)?.name : null
  const others = choices.filter((c) => c.sprintId !== s?.id)
  const body = (
    <>
      <span className="guhit-tab-name">{s?.name ?? title}</span>
      <span className="guhit-tab-meta">
        <span className="guhit-tab-state" data-state={state}>
          <span className="guhit-tab-dot" aria-hidden />
          {STATE_LABEL[state]}
        </span>
        {when ? (
          <>
            <span aria-hidden> · </span>
            <span>{when}</span>
          </>
        ) : null}
      </span>
    </>
  )
  if (!s) return <div className="guhit-tab" data-static>{body}</div>
  const r = s.retro_at ? describeRetro(s.retro_at, s.timezone) : null
  const encrypted = s.encryption === 'e1'
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      title="Sprint details"
      trigger={
        <button type="button" className="guhit-tab" aria-describedby={`${uid}-hint`}>
          {body}
          <ChevronDown className="guhit-tab-chev" aria-hidden />
          <span id={`${uid}-hint`} className="sr-only">Sprint details</span>
        </button>
      }
    >
      <div className="guhit-details">
        {state === 'collecting' ? <p className="guhit-kicker">Your thought goes to</p> : null}
        <p className="guhit-details-name">{s.name}</p>
        {workspace ? <p className="guhit-details-sub">{workspace}</p> : null}
        <dl className="guhit-details-list">
          <div>
            <dt>{STATE_LABEL[state]}</dt>
            <dd>
              {state === 'collecting' || state === 'closed-now'
                ? 'Nobody on your team — the facilitator included — can read your thoughts until collection closes. Then the sprint sees them in random order, without your name. Muni still records who wrote each one.'
                : state === 'closed'
                  ? 'Thoughts are read-only now, and shared with the sprint without names.'
                  : state === 'live'
                    ? 'The team is discussing what was collected.'
                    : 'The retro is done.'}
            </dd>
          </div>
          {r ? (
            <div>
              <dt>Retro</dt>
              <dd>
                {r.date}, {r.time} <span title={r.offset}>{r.zone}</span> · {r.relative}
                {r.yours ? <span className="block">{r.yours}</span> : null}
              </dd>
            </div>
          ) : (
            <div>
              <dt>Retro</dt>
              <dd>Not scheduled here yet.</dd>
            </div>
          )}
          <div>
            <dt>{encrypted ? 'Encrypted sprint' : 'Protection'}</dt>
            <dd>
              {encrypted
                ? 'Thoughts are encrypted on this device before they’re sent. Muni’s servers store them unreadable and don’t hold the key.'
                : 'This sprint was set up before on-device encryption. Thoughts are protected on their way to Muni and in its storage, but Muni’s servers can read them.'}
            </dd>
          </div>
        </dl>
        <p className="guhit-details-links">
          <Link to={`/sprints/${s.id}`}>Sprint guide</Link>
          <Link to="/privacy#visibility">Who sees what</Link>
          <Link to="/privacy#encryption">{encrypted ? 'What encryption covers' : 'About encryption'}</Link>
        </p>
        {others.length && onSwitch ? (
          <div className="guhit-details-more">
            <p className="guhit-kicker">Write for another sprint instead</p>
            <ul>
              {others.map((o) => (
                <li key={o.sprintId}>
                  <button
                    type="button"
                    className="guhit-row"
                    onClick={() => {
                      setOpen(false)
                      onSwitch(o)
                    }}
                  >
                    {o.sprintName}
                  </button>
                </li>
              ))}
            </ul>
            <p className="guhit-details-sub">Anything you’ve written moves with you.</p>
          </div>
        ) : null}
        {elsewhere.length ? (
          <div className="guhit-details-more">
            <p className="guhit-kicker">Also collecting in your other workspaces</p>
            <ul>
              {elsewhere.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="guhit-row"
                    onClick={() => {
                      setOpen(false)
                      chooseWorkspace(o.workspace_id)
                      writePrefs({ lastSprint: o.id })
                    }}
                  >
                    {o.name} <span className="guhit-details-sub">in {me.workspaces.find((w) => w.id === o.workspace_id)?.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

// ─────────────────────────────────────────────────────────────── optional details

/** One optional category, chosen from a short list; the same single choice as everywhere else. */
export function CategoryPicker({ value, onChange }: { value: Category | null; onChange: (c: Category | null) => void }) {
  const [open, setOpen] = useState(false)
  const list = useRef<HTMLUListElement>(null)
  const meta = value ? categoryMeta(value) : null
  const pick = (c: Category | null) => {
    onChange(c)
    setOpen(false)
  }
  const move = (e: React.KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (to === null) return
    e.preventDefault()
    items[(to + items.length) % items.length]?.focus()
  }
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      title="Category (optional)"
      initialFocus={() => list.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? list.current?.querySelector<HTMLElement>('button') ?? null}
      trigger={
        <button type="button" className="guhit-opt" data-set={meta ? '' : undefined} style={meta ? { ['--c' as string]: meta.color } : undefined}>
          {meta ? (
            <>
              <span className="guhit-opt-dot" aria-hidden />
              <span className="sr-only">Category: </span>
              {meta.label}
            </>
          ) : (
            <>
              <Plus className="size-4" aria-hidden /> Category<span className="sr-only"> (optional)</span>
            </>
          )}
        </button>
      }
    >
      <ul ref={list} className="guhit-cats" onKeyDown={move}>
        {CATEGORIES.map((c) => (
          <li key={c.id}>
            <button type="button" className="guhit-cat" aria-pressed={value === c.id} style={{ ['--c' as string]: c.color }} onClick={() => pick(value === c.id ? null : c.id)}>
              <span className="guhit-cat-dot" aria-hidden />
              <span className="guhit-cat-label">{c.label}</span>
              <span className="guhit-cat-hint">{c.hint}</span>
            </button>
          </li>
        ))}
        {value ? (
          <li className="guhit-cats-clear">
            <button type="button" className="guhit-cat" onClick={() => pick(null)}>
              <span className="guhit-cat-dot guhit-cat-dot--none" aria-hidden />
              <span className="guhit-cat-label">No category</span>
              <span className="guhit-cat-hint">sort it later</span>
            </button>
          </li>
        ) : null}
      </ul>
    </Panel>
  )
}

/** "Impact · Mid sprint": what the folded context holds, in words. */
function contextSummary(p: { impact: string; might_help: string; period: Period | null }) {
  return [p.impact.trim() && 'impact', p.might_help.trim() && 'what might help', p.period && PERIODS.find((x) => x.id === p.period)?.label.toLowerCase()].filter(Boolean).join(', ')
}

/** One prompt at a time, in a fixed order that starts somewhere different each day. */
function promptFrom(day = new Date()) {
  return Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000) % MEMORY_PROMPTS.length
}

// ─────────────────────────────────────────────────────────────── the writing sheet

/**
 * The composer, as a sheet in Guhit's sketchbook. The same behaviour as Muni's composer
 * (useComposer): only what's on the sheet, and where, differs.
 */
export function GuhitComposer({
  dest,
  choices,
  onChoose,
  tab,
  closed,
  fieldId = 'thought-field',
}: {
  dest: Destination | null
  choices: Destination[]
  onChoose: (d: Destination) => void
  /** The index tab, given this composer's own way to move the draft to another sprint. */
  tab: (onSwitch: (d: Destination) => void) => ReactNode
  closed?: ReactNode
  fieldId?: string
}) {
  const { voice } = useWorld()
  const [prompt, setPrompt] = useState<number | null>(null)
  const { uid, p, set, submit, onKey, busy, error, notice, restored, typing, more, setMore, area, choose, storage } = useComposer({ dest, choices, onChoose, onSaved: () => setPrompt(null) })
  const ctxSummary = contextSummary(p)
  const fine = finePointer()
  const privacyId = `${uid}-privacy`
  const privacy = (
    <>
      Hidden from your team until collection closes, then shared without your name.
      {dest?.encrypted ? ' Encrypted on this device before it’s sent.' : ''}
    </>
  )
  const nextPrompt = () => setPrompt((i) => ((i ?? promptFrom() - 1) + 1) % MEMORY_PROMPTS.length)
  // The button pressed goes away with it: focus moves to the field, where the writing happens.
  const toField = () => requestAnimationFrame(() => area.current?.focus({ preventScroll: true }))
  const action = (
    <Button type="submit" variant="primary" busy={busy} disabled={busy || !p.body.trim() || !dest} className="guhit-save" aria-keyshortcuts="Meta+Enter Control+Enter" aria-describedby={privacyId}>
      {busy ? 'Adding…' : 'Add to sprint'}
    </Button>
  )
  return (
    <form onSubmit={submit} aria-label={dest ? `Write a thought for ${dest.sprintName}` : 'Write a thought'} className="guhit-book">
      <div className="guhit-book-top">
        {tab(choose)}
        <Pencil />
      </div>
      <div className="guhit-sheet">
        <Reg className="guhit-reg--tr" />
        <Reg className="guhit-reg--bl" />
        <h1 className="guhit-title">
          <label htmlFor={fieldId}>
            What’s worth{' '}
            <em>remembering</em>?
          </label>
        </h1>
        {voice ? <p className="guhit-invite">{invitationFor(voice)}</p> : null}
        {closed ? <div className="guhit-closed">{closed}</div> : null}

        {prompt !== null ? (
          <div className="guhit-prompt">
            <p aria-live="polite">
              <span className="guhit-prompt-lead">A starting point: </span>
              {MEMORY_PROMPTS[prompt]}
            </p>
            <span className="guhit-prompt-tools">
              <button type="button" className="guhit-link" onClick={nextPrompt}>Another</button>
              <button type="button" className="icon-btn guhit-prompt-x" aria-label="Hide the starting point" onClick={() => { setPrompt(null); toField() }}>
                <X className="size-4" aria-hidden />
              </button>
            </span>
          </div>
        ) : null}

        <textarea
          ref={area}
          id={fieldId}
          name="thought"
          className="guhit-field"
          value={p.body}
          onChange={(e) => set({ body: e.target.value })}
          onKeyDown={onKey}
          placeholder="Something that happened, helped, or got in the way…"
          aria-describedby={privacyId}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          maxLength={2000}
          enterKeyHint="enter"
        />
        <div className="guhit-under">
          {!typing && prompt === null ? (
            <button type="button" className="guhit-link" onClick={() => { nextPrompt(); toField() }}>Need a starting point?</button>
          ) : (
            <span />
          )}
          <p className="guhit-draft" aria-live="polite">
            {typing && dest ? (restored ? 'Draft restored' : 'Draft') + (storage === 'device' ? ' · on this device, not sent yet' : ' · in this tab, not sent yet') : null}
          </p>
        </div>

        {more ? (
          <div id={`${uid}-more`} className="guhit-context">
            <div>
              <label htmlFor={`${uid}-impact`}>What was the impact?</label>
              <textarea id={`${uid}-impact`} className="guhit-field guhit-field--small" value={p.impact} onChange={(e) => set({ impact: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div>
              <label htmlFor={`${uid}-help`}>What might help?</label>
              <textarea id={`${uid}-help`} className="guhit-field guhit-field--small" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div className="guhit-context-wide">
              <span className="guhit-context-label" id={`${uid}-when`}>When in the sprint?</span>
              <Choices value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="When in the sprint (optional)" allowNone />
            </div>
          </div>
        ) : null}

        <div className="guhit-actions">
          <div className="guhit-opts">
            <CategoryPicker value={p.category} onChange={(c) => set({ category: c })} />
            <button type="button" className="guhit-opt" data-set={!more && ctxSummary ? '' : undefined} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls={`${uid}-more`}>
              {more ? (
                <>
                  <X className="size-4" aria-hidden /> Fold context away
                </>
              ) : ctxSummary ? (
                <>
                  <span className="guhit-opt-dot guhit-opt-dot--ink" aria-hidden />
                  <span>
                    Context<span className="guhit-opt-sum">: {ctxSummary}</span>
                  </span>
                </>
              ) : (
                <>
                  <Plus className="size-4" aria-hidden /> Context<span className="sr-only"> (optional)</span>
                </>
              )}
            </button>
          </div>
          {fine ? (
            <Tooltip.Provider delayDuration={500}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>{action}</Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="guhit-tip" side="top" sideOffset={8}>
                    Add to sprint <Kbd>{MOD}</Kbd> <Kbd>Enter</Kbd>
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          ) : (
            action
          )}
        </div>

        <ErrorText>{error}</ErrorText>
        {notice ? (
          <p role="status" className="guhit-note" data-tone={notice.tone}>
            {notice.kind === 'submitted' ? <Tick /> : <span className={clsx('dot mt-1.5', notice.tone === 'warn' ? 'dot--attention' : 'dot--queued')} aria-hidden />}
            <span>{notice.kind === 'submitted' ? <>Added to <strong>{notice.sprintName}</strong>. Yours to edit until collection closes.</> : notice.text}</span>
          </p>
        ) : (
          <p className="guhit-fine" aria-hidden>{privacy}</p>
        )}
        <span id={privacyId} className="sr-only">{privacy}</span>
      </div>
    </form>
  )
}

/**
 * A sheet with something other than the composer on it (collection closed, the retro live, nothing
 * collecting): the same tab and paper, the state as its heading.
 */
export function GuhitSheet({ tab, title, children }: { tab: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="guhit-book">
      <div className="guhit-book-top">
        {tab}
        <Pencil />
      </div>
      <div className="guhit-sheet guhit-sheet--state">
        <Reg className="guhit-reg--tr" />
        <Reg className="guhit-reg--bl" />
        <h1 className="guhit-title">{title}</h1>
        <div className="guhit-state-body">{children}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── the collection

const categoryField = (f: { value: Category | null; onChange: (c: Category | null) => void }) => <CategoryPicker {...f} />

/** An empty collection: Guhit, considering whether one small note needs a floor plan. */
export function GuhitEmpty() {
  const { voice } = useWorld()
  return (
    <div className="guhit-empty">
      <div className="w-empty-art guhit-empty-art" aria-hidden>
        <Portrait id="guhit" size={76} />
        <svg viewBox="0 0 150 84" className="guhit-empty-plan" focusable="false">
          <g className="guhit-empty-note">
            <rect x="6" y="36" width="30" height="26" />
            <path d="M12 45h17M12 51h12" />
          </g>
          <path className="guhit-empty-arrow" d="M42 48c14-8 26-9 38-4M76 39l5 5-7 2" />
          <g className="guhit-empty-floor">
            <rect x="88" y="24" width="54" height="42" />
            <path d="M106 24v14M106 48v18M88 44h12M112 44h30M124 44v-8" />
          </g>
          <text x="84" y="16" fontFamily={HAND} fontSize="15">floor plan?</text>
          <text x="2" y="80" fontFamily={HAND} fontSize="13">one note</text>
        </svg>
      </div>
      <p className="guhit-empty-text">
        <span className="w-joke">{voice?.world.empty ?? 'A blank page.'}</span>
        <span className="guhit-empty-sub">Your thoughts will settle here, in your own words.</span>
      </p>
    </div>
  )
}

/**
 * The page: notices, then the sketchbook, with the collection beside it on a wide screen and
 * after it on a narrow one.
 */
export function GuhitStudio({ notices, book, collection, extras, empty, count }: { notices?: ReactNode; book: ReactNode; collection: ReactNode; extras?: ReactNode; empty?: boolean; /** Thoughts in the collection, once known: the master plan on the desk follows it. */ count?: number | null }) {
  return (
    <CategoryField.Provider value={categoryField}>
      <div className="guhit-studio" data-empty={empty || undefined}>
        <div className="guhit-desk">
          {notices ? <div className="guhit-notices">{notices}</div> : null}
          {book}
          {count != null ? <MasterPlan count={count} /> : null}
        </div>
        <div className="guhit-shelf">
          {collection}
          {extras}
        </div>
      </div>
    </CategoryField.Provider>
  )
}
