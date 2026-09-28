/**
 * A sprint's lifecycle as people see it. The server keeps its states (draft, collecting,
 * preparing, ready, live, completed, archived); people see fewer:
 *
 *   Not open yet → Collecting → Closed → Retro → Done
 *
 * Setup is the sprint's settings, not a step. Grouping thoughts into themes is optional work while
 * collection is closed, not a stage anyone waits on ("ready" is only a closed sprint marked ready
 * to start). The outcomes are what a finished sprint is.
 *
 * For whoever is looking, `sprintPlan` answers: what's happening now, what can I do, what's the one
 * next action, and what will it change for everyone. A change of state is only ever offered when
 * the server lists it in `allowed_transitions` (empty for anyone but the facilitator); the server
 * checks every request again.
 */
import type { SprintDetail } from '@/api/types'
import { describeRetro } from './schedule'

export type Stage = 'thoughts' | 'retro' | 'outcomes'
export type Phase = 'draft' | 'collecting' | 'closed' | 'live' | 'done'

export const PHASE_OF: Record<string, Phase> = {
  draft: 'draft',
  collecting: 'collecting',
  preparing: 'closed',
  ready: 'closed',
  live: 'live',
  completed: 'done',
  archived: 'done',
}

/** A short, human status for lists, labels and the sprint bar. */
export const STATUS_PHRASE: Record<string, string> = {
  draft: 'Not open yet',
  collecting: 'Collecting thoughts',
  preparing: 'Collection closed',
  ready: 'Collection closed',
  live: 'Retro in progress',
  completed: 'Retro done',
  archived: 'Archived',
}

/** Consequential changes explain themselves before they happen. */
export type Confirm = 'close' | 'reopen' | 'start' | 'stop' | 'archive'
export type Action =
  | { kind: 'transition'; to: string; label: string; confirm?: Confirm; then?: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'invite'; label: string }

export type ProgressStop = { id: Stage; label: string; detail: string; state: 'done' | 'now' | 'next' }

export type Plan = {
  phase: Phase
  /** "Collecting thoughts". */
  status: string
  /** One sentence: what this means for the person looking. */
  line: string
  /**
   * The facilitator's next change (or, live, the way to the stage). Never anyone else's: what a
   * participant does next is on the page itself (the writer, joining the retro).
   */
  control: Action | null
  /** What that action changes, for everyone, in a line. */
  consequence: string | null
  /** Quieter actions that belong to this stage. */
  secondary: Action[]
  /** Routine and rare actions, kept in a menu. */
  more: Action[]
  /** Things worth knowing, each with what to do about it. */
  notes: string[]
  progress: ProgressStop[]
}

export type PlanInput = Pick<
  SprintDetail,
  'id' | 'status' | 'is_facilitator' | 'is_participant' | 'allowed_transitions' | 'retro_at' | 'timezone'
> &
  Partial<Pick<SprintDetail, 'entry_count' | 'theme_count' | 'collection_closed_at' | 'completed_at' | 'has_session' | 'session_cancelled' | 'facilitator_name'>> & {
    participant_count: number
    /** Experiments agreed, when known (the Outcomes stop says how many). */
    experiment_count?: number
  }

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : null)

export function sprintPlan(s: PlanInput, opts: { online?: boolean; now?: number } = {}): Plan {
  const online = opts.online ?? true
  const now = opts.now ?? Date.now()
  const base = `/sprints/${s.id}`
  const fac = s.is_facilitator
  const part = s.is_participant
  const phase = PHASE_OF[s.status] ?? 'draft'
  const can = (to: string) => s.allowed_transitions.includes(to)
  const r = describeRetro(s.retro_at, s.timezone, { now })
  const planned = `${r.date}, ${r.time}`
  const who = s.facilitator_name && !fac ? s.facilitator_name : 'The facilitator'
  const notes: string[] = []
  let line = ''
  let control: Action | null = null
  let consequence: string | null = null
  let secondary: Action[] = []
  let more: Action[] = []

  const invite: Action = { kind: 'invite', label: 'Invite people' }
  const edit: Action = { kind: 'link', href: `${base}/setup`, label: 'Edit sprint details' }

  switch (phase) {
    case 'draft':
      line = fac ? 'Nobody can write yet. Open collection when the team is ready; thoughts stay sealed, even from you, until you close it.' : `${who} hasn’t opened this sprint for thoughts yet.`
      if (can('collecting')) {
        control = { kind: 'transition', to: 'collecting', label: 'Open collection' }
        consequence = 'Everyone in the sprint can start adding thoughts.'
      }
      if (fac) {
        secondary = [invite]
        more = [edit]
        if (s.participant_count <= 1) notes.push('Only you are in this sprint so far. Invite your team, or add workspace members in the sprint’s details.')
      }
      break
    case 'collecting':
      line = fac
        ? 'The team is adding thoughts. Close collection whenever you’re ready. You don’t have to wait for the retro date.'
        : part
          ? 'Add thoughts as things happen. You can edit yours until collection closes.'
          : 'The team is adding thoughts. They’re revealed when collection closes.'
      if (can('preparing')) {
        control = { kind: 'transition', to: 'preparing', label: 'Close collection…', confirm: 'close' }
        consequence = 'Stops new thoughts and reveals them, without names, to everyone in the sprint.'
      }
      if (fac) more = [invite, edit]
      if (fac && s.participant_count <= 1) notes.push('Only you are in this sprint. Invite your team so there’s something to talk about.')
      if (fac && r.past) notes.push('The planned retro time has passed. Nothing changes by itself: collection stays open until you close it.')
      break
    case 'closed': {
      const n = s.entry_count
      if (fac) {
        line =
          n === 0
            ? 'Collection is closed and no thoughts were added.'
            : `${n === null || n === undefined ? 'The thoughts are' : n === 1 ? '1 thought is' : `${n} thoughts are`} in and visible to everyone in the sprint. Group them into themes if it helps, or start the retro when the team is together.`
      } else line = 'Thoughts are read-only now. Next is the retro, which starts when the facilitator begins it.'
      if (can('live')) {
        control = { kind: 'transition', to: 'live', label: 'Start the retro…', confirm: 'start', then: `${base}/stage` }
        consequence = 'Opens the retro on the shared screen and on everyone’s devices.'
      }
      if (fac) {
        secondary = [{ kind: 'link', href: `${base}/prepare`, label: s.theme_count ? 'Review themes' : 'Group into themes (optional)' }]
        more = [...(can('collecting') ? [{ kind: 'transition', to: 'collecting', label: 'Reopen collection…', confirm: 'reopen' } as Action] : []), invite, edit]
        if (n === 0) notes.push(can('collecting') ? 'You can reopen collection, or hold the retro anyway; talking about why is useful too.' : 'You can still hold the retro; talking about why is useful too.')
        if (s.has_session && !can('collecting')) notes.push('The retro has started once, so collection can’t be reopened.')
      }
      break
    }
    case 'live':
      line = fac ? 'The retro is running on the stage. Present it on the shared screen and guide the conversation from there.' : 'Follow the conversation and take part from this device.'
      if (fac) {
        control = { kind: 'link', href: `${base}/stage`, label: 'Open the stage' }
        secondary = [{ kind: 'link', href: `${base}/stage?mode=present`, label: 'Present on this screen' }]
        if (can('ready')) more = [{ kind: 'transition', to: 'ready', label: 'Pause the retro…', confirm: 'stop' }]
      }
      break
    case 'done':
      line = s.status === 'archived' ? 'This sprint is archived. What the team agreed to try is below.' : 'Here’s what the team agreed to try, and the recap once it’s published.'
      if (fac && can('archived')) more = [{ kind: 'transition', to: 'archived', label: 'Archive sprint…', confirm: 'archive' }]
      break
  }

  if (!online && control?.kind === 'transition') notes.push('Changing the sprint needs a connection.')

  // Three stops: the thoughts, the conversation, what came of it. The retro's date is the plan;
  // only the facilitator starting it makes it "now".
  const closedOn = day(s.collection_closed_at)
  const progress: ProgressStop[] = [
    {
      id: 'thoughts',
      label: 'Thoughts',
      state: phase === 'draft' || phase === 'collecting' ? 'now' : 'done',
      detail: phase === 'draft' ? 'Not open yet' : phase === 'collecting' ? 'Open now' : closedOn ? `Closed ${closedOn}` : 'Closed',
    },
    {
      id: 'retro',
      label: 'Retro',
      state: phase === 'live' ? 'now' : phase === 'done' ? 'done' : 'next',
      detail: phase === 'live' ? 'In progress' : phase === 'done' ? (day(s.completed_at) ? `Held ${day(s.completed_at)}` : 'Held') : s.session_cancelled && phase === 'closed' ? 'Paused' : `Planned ${planned}`,
    },
    {
      id: 'outcomes',
      label: 'Outcomes',
      state: phase === 'done' ? 'now' : 'next',
      detail: phase === 'done' ? (s.experiment_count === undefined ? 'Agreed' : s.experiment_count === 1 ? '1 to try' : s.experiment_count ? `${s.experiment_count} to try` : 'None agreed') : 'After the retro',
    },
  ]

  return { phase, status: STATUS_PHRASE[s.status] ?? s.status, line, control, consequence, secondary, more, notes, progress }
}

/** What a consequential change actually does, before it happens. */
export function confirmCopy(kind: Confirm, s: { retro_at: string; timezone: string; participant_count: number; theme_count?: number; entry_count?: number | null }): { title: string; body: string[]; confirm: string; cancel: string } {
  const r = describeRetro(s.retro_at, s.timezone)
  const people = s.participant_count === 1 ? 'the 1 person' : `all ${s.participant_count} people`
  switch (kind) {
    case 'close':
      return {
        title: 'Close collection now?',
        body: [
          `Every thought written so far is revealed, without names, to ${people} in this sprint, you included.`,
          'Nobody can add or edit thoughts after this. Anyone still writing keeps their text on their own device; it isn’t sent.',
          `This doesn’t start the retro: it stays planned for ${r.date}, ${r.time}. Until it starts, you can reopen collection.`,
        ],
        confirm: 'Close collection',
        cancel: 'Keep collecting',
      }
    case 'reopen':
      return {
        title: 'Reopen collection?',
        body: [
          'People can add and edit thoughts again. New ones stay sealed until you close collection again.',
          'What was already revealed stays visible. Reopening can’t make it private again.',
          'Themes are kept. An open vote is cancelled.',
        ],
        confirm: 'Reopen collection',
        cancel: 'Keep it closed',
      }
    case 'start':
      return {
        title: 'Start the retro?',
        body: [
          'The retro opens on the stage for the shared screen, and on everyone’s devices.',
          s.theme_count ? 'Collection can’t be reopened after this.' : 'Collection can’t be reopened after this. There are no themes: every thought is shown in the retro as it was written.',
        ],
        confirm: 'Start the retro',
        cancel: 'Not yet',
      }
    case 'stop':
      return {
        title: 'Pause the retro?',
        body: ['The stage closes for everyone and the sprint goes back to closed. Any open vote is cancelled.', 'You can start the retro again later. Collection stays closed.'],
        confirm: 'Pause the retro',
        cancel: 'Keep going',
      }
    case 'archive':
      return {
        title: 'Archive this sprint?',
        body: ['It moves to earlier sprints. Outcomes and the recap stay available.'],
        confirm: 'Archive',
        cancel: 'Cancel',
      }
  }
}
