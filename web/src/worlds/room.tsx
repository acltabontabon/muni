/**
 * The room: what every character's writing page shares. The sprint label and its details, the
 * writer (heading → field → optional details → one action), the sheet for the other sprint states,
 * one optional category from a short list, and the quiet empty collection. Each character's page
 * (worlds/rooms/<id>.tsx) only decides where these sit and what surrounds them.
 *
 * Behaviour is Muni's, from ui/capture.tsx: the writing itself lives in a WritingHost above the
 * page (drafts, the send queue, encryption, submission), and the collection is MyThoughts. So a
 * person can change character mid-sentence: the composition changes, the words don't.
 *
 * Every element carries a shared `room-*` class, styled once in worlds.css ("The room") and
 * adjusted per character inside that character's @scope. The same action has the same words in
 * every room.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { clsx } from 'clsx'
import * as Popover from '@radix-ui/react-popover'
import * as RDialog from '@radix-ui/react-dialog'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import type { Category, Me, Period } from '@/api/types'
import { CATEGORIES, categoryMeta, MEMORY_PROMPTS, PERIODS } from '@/lib/categories'
import type { Destination } from '@/lib/local/LocalProvider'
import { dateRange, describeRetro, retroShort } from '@/lib/schedule'
import { writePrefs } from '@/lib/prefs'
import { chooseWorkspace } from '@/lib/workspace'
import { Button, ErrorText, Kbd } from '@/ui'
import { CategoryField, Choices, CollectionLook, useWriting, Writing } from '@/ui/capture'
import { invitationFor } from './characters'
import { useWorld } from './world'

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
const periodOptions = PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))

export function useNarrow() {
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

// ─────────────────────────────────────────────────────────────── a character's page

/** What a character's page is given to arrange. */
export type RoomSlots = {
  /**
   * The sprint bar (ui/sprint-bar.tsx) on a sprint's own page: its name, where it is, and the
   * facilitator's next step. Each room sets it in its own place and draws it in its own manner.
   */
  bar?: ReactNode
  /** The sprint label (null when this room keeps it in the writer's head, or when there's a bar). */
  context: ReactNode
  /** The writer, or the sheet for another sprint state. */
  writing: ReactNode
  collection: ReactNode
  extras?: ReactNode
  notices?: ReactNode
  empty?: boolean
  mode: 'write' | 'state'
}

export type RoomDef = {
  Page: ComponentType<RoomSlots>
  /** The sprint label sits in the writer's head, just above the heading. */
  contextInHead?: boolean
  /** Group the collection under a heading per day (each thought then keeps only its time). */
  byDay?: boolean
  /** Decoration drawn just after the heading (never over it). */
  Accent?: ComponentType
  /** A small drawing beside the empty collection's line. */
  EmptyMark?: ComponentType
}

const RoomCtx = createContext<{ def: RoomDef; headContext: ReactNode } | null>(null)
const BY_DAY = { byDay: true }
const BY_THOUGHT = { byDay: false }
const categoryField = (f: { value: Category | null; onChange: (c: Category | null) => void }) => <CategoryPicker {...f} />

/** What every room provides to the shared pieces inside it. */
export function RoomProviders({ def, headContext, children }: { def: RoomDef; headContext: ReactNode; children: ReactNode }) {
  return (
    <RoomCtx.Provider value={{ def, headContext }}>
      <CollectionLook.Provider value={def.byDay ? BY_DAY : BY_THOUGHT}>
        <CategoryField.Provider value={categoryField}>{children}</CategoryField.Provider>
      </CollectionLook.Provider>
    </RoomCtx.Provider>
  )
}

/** A small panel beside its control; on a phone, a sheet from the bottom of the screen. */
export function Panel({ trigger, title, open, onOpenChange, children, align = 'start', initialFocus }: { trigger: ReactNode; title: string; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode; align?: 'start' | 'end'; initialFocus?: () => HTMLElement | null }) {
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
          <RDialog.Overlay className="room-veil" />
          <RDialog.Content className="room-drawer" aria-describedby={undefined} onOpenAutoFocus={focus}>
            <div className="room-drawer-head">
              <RDialog.Title className="room-panel-title">{title}</RDialog.Title>
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
        <Popover.Content className="room-pop" align={align} side="bottom" sideOffset={8} collisionPadding={12} aria-label={title} onOpenAutoFocus={focus}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ─────────────────────────────────────────────────────────────── the sprint label

export type TabSprint = { id: string; name: string; workspace_id: string; timezone: string; retro_at?: string; starts_on?: string; ends_on?: string; is_facilitator?: boolean; encryption?: 'e1' | null }
export type TabState = 'draft' | 'collecting' | 'closed-now' | 'closed' | 'live' | 'done' | 'none' | 'choose'
export const STATE_LABEL: Record<TabState, string> = {
  draft: 'Not open yet',
  collecting: 'Collecting',
  'closed-now': 'Collection just closed',
  closed: 'Collection closed',
  live: 'Retro live',
  done: 'Retro complete',
  none: 'Nothing collecting',
  choose: 'Several collecting',
}

/**
 * Which sprint this page is about: where a thought goes, the sprint's name, its state and the next
 * date worth knowing. The rest — the team, the sprint's dates, the retro's full time with its
 * timezone, the way to the sprint, other sprints to write for — is one press away, in the details. Choosing another sprint there
 * moves what's being written with it (the writing host's own move).
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
  const writing = useContext(Writing)
  const move = onSwitch ?? writing?.choose
  const when = s ? retroShort(s.retro_at, s.timezone) : null
  const kicker = state === 'collecting' || state === 'closed-now' ? 'Writing for' : state === 'none' || state === 'choose' ? null : 'Sprint'
  const body = (
    <>
      {kicker ? <span className="room-tab-kicker">{kicker}</span> : null}
      <span className="room-tab-name">
        {s?.name ?? title}
        {s ? <ChevronDown className="room-tab-chev" aria-hidden /> : null}
      </span>
      <span className="room-tab-meta">
        <span className="room-tab-state" data-state={state}>
          <span className="room-tab-dot" aria-hidden />
          {STATE_LABEL[state]}
        </span>
        {when ? (
          <>
            <span aria-hidden className="room-tab-sep"> · </span>
            <span>{when}</span>
          </>
        ) : null}
      </span>
    </>
  )
  if (!s) return <div className="room-tab" data-static>{body}</div>
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      title="Sprint details"
      trigger={
        <button type="button" className="room-tab" aria-describedby={`${uid}-hint`}>
          {body}
          <span id={`${uid}-hint`} className="sr-only">Sprint details</span>
        </button>
      }
    >
      <SprintDetails s={s} me={me} choices={choices} onSwitch={move} elsewhere={elsewhere} close={() => setOpen(false)} />
    </Panel>
  )
}

function SprintDetails({ s, me, choices, onSwitch, elsewhere, close }: { s: TabSprint; me: Me; choices: Destination[]; onSwitch?: (d: Destination) => void; elsewhere: TabSprint[]; close: () => void }) {
  const r = s.retro_at ? describeRetro(s.retro_at, s.timezone) : null
  const workspace = me.workspaces.find((w) => w.id === s.workspace_id)?.name
  const others = choices.filter((x) => x.sprintId !== s.id)
  // Other sprints collecting in other workspaces, grouped by team, in the order the teams are listed.
  const teams = me.workspaces.map((w) => ({ w, list: elsewhere.filter((o) => o.workspace_id === w.id) })).filter((g) => g.list.length)
  // The trigger already names the sprint and its phase; the details add what it can't fit.
  return (
    <div className="room-details">
      <dl className="room-details-list">
        {workspace ? (
          <div>
            <dt>Team</dt>
            <dd>{workspace}</dd>
          </div>
        ) : null}
        {s.starts_on && s.ends_on ? (
          <div>
            <dt>Sprint</dt>
            <dd>{dateRange(s.starts_on, s.ends_on)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Retro</dt>
          <dd>
            {r ? (
              <>
                <span className="room-details-strong">{r.date}, {r.time}</span> · {r.relative}
                <span className="block">{r.zone}{r.offset ? ` (${r.offset})` : ''}</span>
                {r.yours ? <span className="block">{r.yours}</span> : null}
              </>
            ) : (
              'Not scheduled yet'
            )}
          </dd>
        </div>
      </dl>
      {others.length && onSwitch ? (
        <div className="room-details-more">
          <p className="room-kicker">Write for another sprint{workspace ? ` in ${workspace}` : ''}</p>
          <ul>
            {others.map((o) => (
              <li key={o.sprintId}>
                <button
                  type="button"
                  className="room-row"
                  onClick={() => {
                    close()
                    onSwitch(o)
                  }}
                >
                  {o.sprintName}
                </button>
              </li>
            ))}
          </ul>
          <p className="room-details-sub">Anything you’ve written moves with you.</p>
        </div>
      ) : null}
      {teams.length ? (
        <div className="room-details-more">
          <p className="room-kicker">Also collecting in your other teams</p>
          {teams.map(({ w, list }) => (
            <div key={w.id} className="room-details-team">
              <p className="room-details-team-name">{w.name}</p>
              <ul>
                {list.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="room-row"
                      onClick={() => {
                        close()
                        chooseWorkspace(o.workspace_id)
                        writePrefs({ lastSprint: o.id })
                      }}
                    >
                      {o.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── optional details

/** One optional category, chosen from a short list; the same single choice as everywhere else. */
export function CategoryPicker({ value, onChange }: { value: Category | null; onChange: (c: Category | null) => void }) {
  const [open, setOpen] = useState(false)
  const list = useRef<HTMLUListElement>(null)
  const meta = value ? categoryMeta(value) : null
  const pick = (x: Category | null) => {
    onChange(x)
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
        <button type="button" className="room-opt" data-set={meta ? '' : undefined} style={meta ? { ['--c' as string]: meta.color } : undefined}>
          {meta ? (
            <>
              <span className="room-opt-dot" aria-hidden />
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
      <ul ref={list} className="room-cats" onKeyDown={move}>
        {CATEGORIES.map((x) => (
          <li key={x.id}>
            <button type="button" className="room-cat" aria-pressed={value === x.id} style={{ ['--c' as string]: x.color }} onClick={() => pick(value === x.id ? null : x.id)}>
              <span className="room-cat-dot" aria-hidden />
              <span className="room-cat-label">{x.label}</span>
              <span className="room-cat-hint">{x.hint}</span>
              {value === x.id ? <Check className="room-cat-check" aria-hidden /> : null}
            </button>
          </li>
        ))}
        {value ? (
          <li className="room-cats-clear">
            <button type="button" className="room-cat" onClick={() => pick(null)}>
              <span className="room-cat-dot room-cat-dot--none" aria-hidden />
              <span className="room-cat-label">No category</span>
              <span className="room-cat-hint">sort it later</span>
            </button>
          </li>
        ) : null}
      </ul>
    </Panel>
  )
}

/** "impact, mid sprint": what the folded context holds, in words. */
function contextSummary(p: { impact: string; might_help: string; period: Period | null }) {
  return [p.impact.trim() && 'impact', p.might_help.trim() && 'what might help', p.period && PERIODS.find((x) => x.id === p.period)?.label.toLowerCase()].filter(Boolean).join(', ')
}

/** One prompt at a time, in a fixed order that starts somewhere different each day. */
function promptFrom(day = new Date()) {
  return Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000) % MEMORY_PROMPTS.length
}

// ─────────────────────────────────────────────────────────────── the writer

const FALLBACK_HEADING = 'What’s worth remembering?'

/** The head every room shares: the sprint label (when this room keeps it here), the heading, the day's line. */
function Head({ children, lede }: { children: ReactNode; lede?: ReactNode }) {
  const room = useContext(RoomCtx)
  const Accent = room?.def.Accent
  return (
    <div className="room-head">
      {room?.headContext ? <div className="room-head-context">{room.headContext}</div> : null}
      {children}
      {Accent ? <Accent /> : null}
      {lede ? <p className="room-lede">{lede}</p> : null}
    </div>
  )
}

/**
 * The writer: the character's question (it labels the field), one calm field, the optional
 * details behind two named controls, and one action that says what it does. The state comes from
 * the WritingHost above the page.
 */
export function Writer({ closed, fieldId = 'thought-field', level = 1 }: { /** Shown when the sprint stopped collecting while text was still here. */ closed?: ReactNode; fieldId?: string; /** 2 under a page title (the sprint's name). */ level?: 1 | 2 }) {
  const H = level === 2 ? 'h2' : 'h1'
  const { voice } = useWorld()
  const { uid, p, set, submit, onKey, busy, error, notice, restored, typing, more, setMore, area, storage, dest, prompt, setPrompt } = useWriting()
  const ctxSummary = contextSummary(p)
  const fine = finePointer()
  const nextPrompt = () => setPrompt((i) => ((i ?? promptFrom() - 1) + 1) % MEMORY_PROMPTS.length)
  // The button pressed goes away with it: focus moves to the field, where the writing happens.
  const toField = () => requestAnimationFrame(() => area.current?.focus({ preventScroll: true }))
  const action = (
    <Button type="submit" variant="primary" busy={busy} disabled={busy || !p.body.trim() || !dest} className="room-save" aria-keyshortcuts="Meta+Enter Control+Enter">
      {busy ? 'Adding…' : 'Add to sprint'}
    </Button>
  )
  return (
    <form onSubmit={submit} aria-label={dest ? `Write a thought for ${dest.sprintName}` : 'Write a thought'} className="room-writer">
      <Head lede={voice ? invitationFor(voice) : null}>
        <H className="room-heading">
          <label htmlFor={fieldId}>{voice?.world.heading ?? FALLBACK_HEADING}</label>
        </H>
      </Head>
      <div className="room-sheet">
        {closed ? <div className="room-closed">{closed}</div> : null}

        {prompt !== null ? (
          <div className="room-prompt">
            <p aria-live="polite">
              <span className="room-prompt-lead">A starting point: </span>
              {MEMORY_PROMPTS[prompt]}
            </p>
            <span className="room-prompt-tools">
              <button type="button" className="room-link" onClick={nextPrompt}>Another</button>
              <button type="button" className="icon-btn room-prompt-x" aria-label="Hide the starting point" onClick={() => { setPrompt(null); toField() }}>
                <X className="size-4" aria-hidden />
              </button>
            </span>
          </div>
        ) : null}

        <textarea
          ref={area}
          id={fieldId}
          name="thought"
          data-guide="writer"
          className="room-field"
          value={p.body}
          onChange={(e) => set({ body: e.target.value })}
          onKeyDown={onKey}
          placeholder="Something that happened, helped, or got in the way…"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          maxLength={2000}
          enterKeyHint="enter"
        />
        <div className="room-under">
          {!typing && prompt === null ? (
            <button type="button" className="room-link" onClick={() => { nextPrompt(); toField() }}>Need a starting point?</button>
          ) : (
            <span />
          )}
          <p className="room-draft" aria-live="polite">
            {typing && dest ? (restored ? 'Draft restored' : 'Draft') + (storage === 'device' ? ' · on this device, not sent yet' : ' · in this tab, not sent yet') : null}
          </p>
        </div>

        {more ? (
          <div id={`${uid}-more`} className="room-context anim-rise">
            <div>
              <label htmlFor={`${uid}-impact`}>What was the impact?</label>
              <textarea id={`${uid}-impact`} className="room-field room-field--small" value={p.impact} onChange={(e) => set({ impact: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div>
              <label htmlFor={`${uid}-help`}>What might help?</label>
              <textarea id={`${uid}-help`} className="room-field room-field--small" value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div className="room-context-wide">
              <span className="room-context-label">When in the sprint?</span>
              <Choices value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="When in the sprint (optional)" allowNone />
            </div>
          </div>
        ) : null}

        <div className="room-actions">
          <div className="room-opts">
            <CategoryPicker value={p.category} onChange={(x) => set({ category: x })} />
            <button type="button" className="room-opt" data-set={!more && ctxSummary ? '' : undefined} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls={`${uid}-more`}>
              {more ? (
                <>
                  <X className="size-4" aria-hidden /> Fold context away
                </>
              ) : ctxSummary ? (
                <>
                  <span className="room-opt-dot room-opt-dot--ink" aria-hidden />
                  <span>
                    Context<span className="room-opt-sum">: {ctxSummary}</span>
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
                  <Tooltip.Content className="room-tip" side="top" sideOffset={8}>
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
          <p role="status" className="room-note" data-tone={notice.tone}>
            {notice.kind === 'submitted' ? <Check className="room-note-mark" aria-hidden /> : <span className={clsx('dot mt-1.5', notice.tone === 'warn' ? 'dot--attention' : 'dot--queued')} aria-hidden />}
            <span>
              {notice.kind === 'submitted' ? (
                <>
                  Added to <strong>{notice.sprintName}</strong>. Yours to edit until collection closes.
                </>
              ) : (
                notice.text
              )}
            </span>
          </p>
        ) : null}
      </div>
    </form>
  )
}

/**
 * The same head and surface with something other than writing on it (collection closed, the retro
 * live, nothing collecting): the state as its heading.
 */
export function StateWriter({ title, children, level = 1 }: { title: ReactNode; children?: ReactNode; level?: 1 | 2 }) {
  const H = level === 2 ? 'h2' : 'h1'
  return (
    <div className="room-writer room-writer--state">
      <Head>
        <H className="room-heading">{title}</H>
      </Head>
      <div className="room-sheet room-sheet--state">{children}</div>
    </div>
  )
}

/** An empty collection: the character's one line, and where thoughts will appear. */
export function RoomEmpty() {
  const { voice } = useWorld()
  const room = useContext(RoomCtx)
  const Mark = room?.def.EmptyMark
  return (
    <div className="room-empty">
      {Mark ? (
        <span className="room-empty-mark" aria-hidden>
          <Mark />
        </span>
      ) : null}
      <p className="room-empty-line">{voice?.world.empty ?? 'Nothing kept yet.'}</p>
      <p className="room-empty-sub">Your thoughts will settle here, in your own words.</p>
    </div>
  )
}

/**
 * The writer as a picture, for the chooser's miniature: the same classes and head, sample words,
 * nothing interactive (worlds/WorldPreview.tsx).
 */
export function PreviewWriter({ heading, lede }: { heading: string; lede: string }) {
  return (
    <div className="room-writer">
      <Head lede={lede}>
        <p className="room-heading">{heading}</p>
      </Head>
      <div className="room-sheet">
        <div className="room-field room-field--preview">Something that happened, helped, or got in the way…</div>
        <div className="room-actions">
          <span className="room-opts">
            <span className="room-opt"><Plus className="size-4" aria-hidden /> Category</span>
            <span className="room-opt"><Plus className="size-4" aria-hidden /> Context</span>
          </span>
          <span className="room-save room-save--preview">Add to sprint</span>
        </div>
      </div>
    </div>
  )
}
