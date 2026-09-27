/**
 * The parts a world with its own writing page shares (Guhit's sketchbook, Kape's café table): the
 * sprint label and its details, one optional category from a short list, the composer's layout of
 * heading → field → options → one action, a sheet for the other sprint states, and the page grid.
 *
 * Behaviour is Muni's, from ui/capture.tsx (drafts, the send queue, encryption, submission,
 * editing). What differs per world is composition and material: every element here carries a
 * class in the world's own namespace (`<ns>-sheet`, `<ns>-tab`…), set once by <Desk ns>, so each
 * world styles it inside its own @scope in worlds.css and never touches another's.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
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
import { CategoryField, Choices, CollectionLook, useComposer, type Notice } from '@/ui/capture'

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
const periodOptions = PERIODS.map((p) => ({ id: p.id, label: p.label, color: 'var(--ink-faint)' }))

const Ns = createContext('desk')
/** `<ns>-name` for each name: this world's class for a shared element. */
export function useCls() {
  const ns = useContext(Ns)
  return (...names: (string | false | null | undefined)[]) => names.filter(Boolean).map((n) => `${ns}-${n}`).join(' ')
}

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

/**
 * A world's scene plays its moment once per visit, the first time it's seen, and then rests.
 * `armed`: waiting to be seen (drawn in its first pose, so nothing jumps when it starts); `play`:
 * running; `rest`: the finished picture — always, under reduced motion. `paused` while the tab is
 * hidden. Observers and listeners are cleaned up; nothing runs once it has played.
 */
const playedScenes = new Set<string>()
export function useOncePlay(ref: React.RefObject<Element | null>, id: string) {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [phase, setPhase] = useState<'armed' | 'play' | 'rest'>(() => (playedScenes.has(id) || reduce || typeof IntersectionObserver === 'undefined' ? 'rest' : 'armed'))
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (phase !== 'armed' || !el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        playedScenes.add(id)
        setPhase('play')
        io.disconnect()
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [phase, ref, id])
  useEffect(() => {
    if (phase !== 'play') return
    const on = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [phase])
  return { phase, paused }
}

/** A small panel beside its control; on a phone, a sheet from the bottom of the screen. */
export function Panel({ trigger, title, open, onOpenChange, children, align = 'start', initialFocus }: { trigger: ReactNode; title: string; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode; align?: 'start' | 'end'; initialFocus?: () => HTMLElement | null }) {
  const narrow = useNarrow()
  const c = useCls()
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
          <RDialog.Overlay className={c('veil')} />
          <RDialog.Content className={c('drawer')} aria-describedby={undefined} onOpenAutoFocus={focus}>
            <div className={c('drawer-head')}>
              <RDialog.Title className={c('panel-title')}>{title}</RDialog.Title>
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
        <Popover.Content className={c('pop')} align={align} side="bottom" sideOffset={8} collisionPadding={12} aria-label={title} onOpenAutoFocus={focus}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ─────────────────────────────────────────────────────────────── the sprint label

export type TabSprint = { id: string; name: string; workspace_id: string; timezone: string; retro_at?: string; is_facilitator?: boolean; encryption?: 'e1' | null }
export type TabState = 'collecting' | 'closed-now' | 'closed' | 'live' | 'done' | 'none' | 'choose'
export const STATE_LABEL: Record<TabState, string> = {
  collecting: 'Collecting',
  'closed-now': 'Collection just closed',
  closed: 'Collection closed',
  live: 'Retro live',
  done: 'Retro complete',
  none: 'Nothing collecting',
  choose: 'Several collecting',
}

/**
 * Which sprint this page is about: the name first, then its state and the next date worth knowing.
 * The rest — the full time in both timezones, who can read what, other sprints to write for,
 * grouped by team — is one press away, in the details. `kicker` is a world's small printed line
 * above the name; it must stay literal about where a thought goes.
 */
export function SprintTab({
  s,
  state,
  title,
  me,
  choices = [],
  onSwitch,
  elsewhere = [],
  kicker,
}: {
  s: TabSprint | null
  state: TabState
  /** Shown instead of a sprint's name (no sprint, or one still to choose). */
  title?: string
  me: Me
  choices?: Destination[]
  onSwitch?: (d: Destination) => void
  elsewhere?: TabSprint[]
  kicker?: string
}) {
  const [open, setOpen] = useState(false)
  const uid = useId()
  const c = useCls()
  const when = s ? retroShort(s.retro_at, s.timezone) : null
  const body = (
    <>
      {kicker ? <span className={c('tab-kicker')}>{kicker}</span> : null}
      <span className={c('tab-name')}>{s?.name ?? title}</span>
      <span className={c('tab-meta')}>
        <span className={c('tab-state')} data-state={state}>
          <span className={c('tab-dot')} aria-hidden />
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
  if (!s) return <div className={c('tab')} data-static>{body}</div>
  return (
    <Panel
      open={open}
      onOpenChange={setOpen}
      title="Sprint details"
      trigger={
        <button type="button" className={c('tab')} aria-describedby={`${uid}-hint`}>
          {body}
          <ChevronDown className={c('tab-chev')} aria-hidden />
          <span id={`${uid}-hint`} className="sr-only">Sprint details</span>
        </button>
      }
    >
      <SprintDetails s={s} state={state} me={me} choices={choices} onSwitch={onSwitch} elsewhere={elsewhere} close={() => setOpen(false)} />
    </Panel>
  )
}

function SprintDetails({ s, state, me, choices, onSwitch, elsewhere, close }: { s: TabSprint; state: TabState; me: Me; choices: Destination[]; onSwitch?: (d: Destination) => void; elsewhere: TabSprint[]; close: () => void }) {
  const c = useCls()
  const r = s.retro_at ? describeRetro(s.retro_at, s.timezone) : null
  const encrypted = s.encryption === 'e1'
  const workspace = me.workspaces.find((w) => w.id === s.workspace_id)?.name
  const others = choices.filter((x) => x.sprintId !== s.id)
  // Other sprints collecting in other workspaces, grouped by team, in the order the teams are listed.
  const teams = me.workspaces.map((w) => ({ w, list: elsewhere.filter((o) => o.workspace_id === w.id) })).filter((g) => g.list.length)
  return (
    <div className={c('details')}>
      {state === 'collecting' ? <p className={c('kicker')}>Your thought goes to</p> : null}
      <p className={c('details-name')}>{s.name}</p>
      {workspace ? <p className={c('details-sub')}>{workspace}</p> : null}
      <dl className={c('details-list')}>
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
        <div>
          <dt>Retro</dt>
          <dd>
            {r ? (
              <>
                {r.date}, {r.time} <span title={r.offset}>{r.zone}</span> · {r.relative}
                {r.yours ? <span className="block">{r.yours}</span> : null}
              </>
            ) : (
              'Not scheduled here yet.'
            )}
          </dd>
        </div>
        <div>
          <dt>{encrypted ? 'Encrypted sprint' : 'Protection'}</dt>
          <dd>
            {encrypted
              ? 'Thoughts are encrypted on this device before they’re sent. Muni’s servers store them unreadable and don’t hold the key.'
              : 'This sprint was set up before on-device encryption. Thoughts are protected on their way to Muni and in its storage, but Muni’s servers can read them.'}
          </dd>
        </div>
      </dl>
      <p className={c('details-links')}>
        <Link to={`/sprints/${s.id}`}>Sprint guide</Link>
        <Link to="/privacy#visibility">Who sees what</Link>
        <Link to="/privacy#encryption">{encrypted ? 'What encryption covers' : 'About encryption'}</Link>
      </p>
      {others.length && onSwitch ? (
        <div className={c('details-more')}>
          <p className={c('kicker')}>Write for another sprint{workspace ? ` in ${workspace}` : ''}</p>
          <ul>
            {others.map((o) => (
              <li key={o.sprintId}>
                <button
                  type="button"
                  className={c('row')}
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
          <p className={c('details-sub')}>Anything you’ve written moves with you.</p>
        </div>
      ) : null}
      {teams.length ? (
        <div className={c('details-more')}>
          <p className={c('kicker')}>Also collecting in your other teams</p>
          {teams.map(({ w, list }) => (
            <div key={w.id} className={c('details-team')}>
              <p className={c('details-team-name')}>{w.name}</p>
              <ul>
                {list.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className={c('row')}
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
  const c = useCls()
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
        <button type="button" className={c('opt')} data-set={meta ? '' : undefined} style={meta ? { ['--c' as string]: meta.color } : undefined}>
          {meta ? (
            <>
              <span className={c('opt-dot')} aria-hidden />
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
      <ul ref={list} className={c('cats')} onKeyDown={move}>
        {CATEGORIES.map((x) => (
          <li key={x.id}>
            <button type="button" className={c('cat')} aria-pressed={value === x.id} style={{ ['--c' as string]: x.color }} onClick={() => pick(value === x.id ? null : x.id)}>
              <span className={c('cat-dot')} aria-hidden />
              <span className={c('cat-label')}>{x.label}</span>
              <span className={c('cat-hint')}>{x.hint}</span>
            </button>
          </li>
        ))}
        {value ? (
          <li className={c('cats-clear')}>
            <button type="button" className={c('cat')} onClick={() => pick(null)}>
              <span className={c('cat-dot', 'cat-dot--none')} aria-hidden />
              <span className={c('cat-label')}>No category</span>
              <span className={c('cat-hint')}>sort it later</span>
            </button>
          </li>
        ) : null}
      </ul>
    </Panel>
  )
}

const BY_DAY = { byDay: true }
const BY_THOUGHT = { byDay: false }
const categoryField = (f: { value: Category | null; onChange: (c: Category | null) => void }) => <CategoryPicker {...f} />

/** "impact, mid sprint": what the folded context holds, in words. */
function contextSummary(p: { impact: string; might_help: string; period: Period | null }) {
  return [p.impact.trim() && 'impact', p.might_help.trim() && 'what might help', p.period && PERIODS.find((x) => x.id === p.period)?.label.toLowerCase()].filter(Boolean).join(', ')
}

/** One prompt at a time, in a fixed order that starts somewhere different each day. */
function promptFrom(day = new Date()) {
  return Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / 86_400_000) % MEMORY_PROMPTS.length
}

// ─────────────────────────────────────────────────────────────── the writing surface

export type ComposerLook = {
  /** Above the surface (Guhit: beside the tab). Decoration only. */
  topDecor?: ReactNode
  /** Inside the surface, around its edges. Decoration only; never over the field. */
  decor?: ReactNode
  /** The heading's words; it labels the field. */
  heading: ReactNode
  /** One supporting line under the heading. */
  subline?: ReactNode
  /** Shown beside a confirmed "added" note (a tick, a stamp). */
  addedMark?: ReactNode
  /** The words of a confirmed save. */
  added?: (n: Notice) => ReactNode
}

/**
 * The composer, laid out for a world's own page. The same behaviour as Muni's composer
 * (useComposer): only what's on the surface, and where, differs.
 */
export function DeskComposer({ dest, choices, onChoose, tab, closed, fieldId = 'thought-field', look }: { dest: Destination | null; choices: Destination[]; onChoose: (d: Destination) => void; /** The sprint label, given this composer's own way to move the draft to another sprint. */ tab: (onSwitch: (d: Destination) => void) => ReactNode; closed?: ReactNode; fieldId?: string; look: ComposerLook }) {
  const c = useCls()
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
    <Button type="submit" variant="primary" busy={busy} disabled={busy || !p.body.trim() || !dest} className={c('save')} aria-keyshortcuts="Meta+Enter Control+Enter" aria-describedby={privacyId}>
      {busy ? 'Adding…' : 'Add to sprint'}
    </Button>
  )
  return (
    <form onSubmit={submit} aria-label={dest ? `Write a thought for ${dest.sprintName}` : 'Write a thought'} className={c('book')}>
      <div className={c('book-top')}>
        {tab(choose)}
        {look.topDecor}
      </div>
      <div className={c('sheet')}>
        {look.decor}
        <h1 className={c('title')}>
          <label htmlFor={fieldId}>{look.heading}</label>
        </h1>
        {look.subline ? <p className={c('invite')}>{look.subline}</p> : null}
        {closed ? <div className={c('closed')}>{closed}</div> : null}

        {prompt !== null ? (
          <div className={c('prompt')}>
            <p aria-live="polite">
              <span className={c('prompt-lead')}>A starting point: </span>
              {MEMORY_PROMPTS[prompt]}
            </p>
            <span className={c('prompt-tools')}>
              <button type="button" className={c('link')} onClick={nextPrompt}>Another</button>
              <button type="button" className={clsx('icon-btn', c('prompt-x'))} aria-label="Hide the starting point" onClick={() => { setPrompt(null); toField() }}>
                <X className="size-4" aria-hidden />
              </button>
            </span>
          </div>
        ) : null}

        <textarea
          ref={area}
          id={fieldId}
          name="thought"
          className={c('field')}
          value={p.body}
          onChange={(e) => set({ body: e.target.value })}
          onKeyDown={onKey}
          placeholder="Something that happened, helped, or got in the way…"
          aria-describedby={privacyId}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          maxLength={2000}
          enterKeyHint="enter"
        />
        <div className={c('under')}>
          {!typing && prompt === null ? (
            <button type="button" className={c('link')} onClick={() => { nextPrompt(); toField() }}>Need a starting point?</button>
          ) : (
            <span />
          )}
          <p className={c('draft')} aria-live="polite">
            {typing && dest ? (restored ? 'Draft restored' : 'Draft') + (storage === 'device' ? ' · on this device, not sent yet' : ' · in this tab, not sent yet') : null}
          </p>
        </div>

        {more ? (
          <div id={`${uid}-more`} className={c('context')}>
            <div>
              <label htmlFor={`${uid}-impact`}>What was the impact?</label>
              <textarea id={`${uid}-impact`} className={c('field', 'field--small')} value={p.impact} onChange={(e) => set({ impact: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div>
              <label htmlFor={`${uid}-help`}>What might help?</label>
              <textarea id={`${uid}-help`} className={c('field', 'field--small')} value={p.might_help} onChange={(e) => set({ might_help: e.target.value })} onKeyDown={onKey} maxLength={2000} />
            </div>
            <div className={c('context-wide')}>
              <span className={c('context-label')}>When in the sprint?</span>
              <Choices value={p.period} onChange={(v) => set({ period: v as Period | null })} options={periodOptions} label="When in the sprint (optional)" allowNone />
            </div>
          </div>
        ) : null}

        <div className={c('actions')}>
          <div className={c('opts')}>
            <CategoryPicker value={p.category} onChange={(x) => set({ category: x })} />
            <button type="button" className={c('opt')} data-set={!more && ctxSummary ? '' : undefined} onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls={`${uid}-more`}>
              {more ? (
                <>
                  <X className="size-4" aria-hidden /> Fold context away
                </>
              ) : ctxSummary ? (
                <>
                  <span className={c('opt-dot', 'opt-dot--ink')} aria-hidden />
                  <span>
                    Context<span className={c('opt-sum')}>: {ctxSummary}</span>
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
                  <Tooltip.Content className={c('tip')} side="top" sideOffset={8}>
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
          <p role="status" className={c('note')} data-tone={notice.tone}>
            {notice.kind === 'submitted' ? look.addedMark : <span className={clsx('dot mt-1.5', notice.tone === 'warn' ? 'dot--attention' : 'dot--queued')} aria-hidden />}
            <span>
              {notice.kind === 'submitted' ? (look.added?.(notice) ?? <>Added to <strong>{notice.sprintName}</strong>. Yours to edit until collection closes.</>) : notice.text}
            </span>
          </p>
        ) : (
          <p className={c('fine')} aria-hidden>{privacy}</p>
        )}
        <span id={privacyId} className="sr-only">{privacy}</span>
      </div>
    </form>
  )
}

/**
 * A surface with something other than the composer on it (collection closed, the retro live,
 * nothing collecting): the same label and paper, the state as its heading.
 */
export function DeskSheet({ tab, title, children, topDecor, decor }: { tab: ReactNode; title: ReactNode; children?: ReactNode; topDecor?: ReactNode; decor?: ReactNode }) {
  const c = useCls()
  return (
    <div className={c('book')}>
      <div className={c('book-top')}>
        {tab}
        {topDecor}
      </div>
      <div className={c('sheet', 'sheet--state')}>
        {decor}
        <h1 className={c('title')}>{title}</h1>
        <div className={c('state-body')}>{children}</div>
      </div>
    </div>
  )
}

/**
 * The page: notices and the writing surface; the collection beside it on a wide screen and after
 * it on a narrow one; and the world's scene — under the writing on a wide screen, after the
 * collection on a narrow one, so nobody scrolls past a picture to reach their thoughts.
 */
export function Desk({ ns, notices, book, collection, extras, empty, scene, byDay = false }: { ns: string; notices?: ReactNode; book: ReactNode; collection: ReactNode; extras?: ReactNode; empty?: boolean; scene?: ReactNode; /** Group the collection under a heading per day. */ byDay?: boolean }) {
  return (
    <Ns.Provider value={ns}>
      <CollectionLook.Provider value={byDay ? BY_DAY : BY_THOUGHT}>
      <CategoryField.Provider value={categoryField}>
        <div className={`${ns}-studio`} data-empty={empty || undefined}>
          <div className={`${ns}-desk`}>
            {notices ? <div className={`${ns}-notices`}>{notices}</div> : null}
            {book}
          </div>
          <div className={`${ns}-shelf`}>
            {collection}
            {extras}
          </div>
          {scene ? <div className={`${ns}-scene`}>{scene}</div> : null}
        </div>
      </CategoryField.Provider>
      </CollectionLook.Provider>
    </Ns.Provider>
  )
}
