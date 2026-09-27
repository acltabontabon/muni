/**
 * The sprint lifecycle in plain language. The server's states (draft, collecting, preparing, ready,
 * live, completed, archived) stay exactly as they are; this maps each one, for the person looking,
 * to: where the sprint is, what that means, what they can do next, and anything in the way.
 *
 * Changing state is only ever offered when the server says this person may make that transition
 * (`allowed_transitions`, which is empty for anyone but the sprint's facilitator). Everything here
 * is guidance; the server still checks every request.
 */
import type { SprintDetail } from '@/api/types'

export type Step = 'setup' | 'collect' | 'prepare' | 'retro' | 'wrapup'
export const STEPS: { id: Step; label: string }[] = [
  { id: 'setup', label: 'Set up' },
  { id: 'collect', label: 'Collect' },
  { id: 'prepare', label: 'Prepare' },
  { id: 'retro', label: 'Retro' },
  { id: 'wrapup', label: 'Outcomes' },
]

export const STEP_OF: Record<string, Step> = {
  draft: 'setup',
  collecting: 'collect',
  preparing: 'prepare',
  ready: 'retro',
  live: 'retro',
  completed: 'wrapup',
  archived: 'wrapup',
}

/** A short, human status for lists and pills. */
export const STATUS_PHRASE: Record<string, string> = {
  draft: 'Setting up',
  collecting: 'Collecting thoughts',
  preparing: 'Preparing the discussion',
  ready: 'Ready for the retro',
  live: 'Retro in progress',
  completed: 'Retro complete',
  archived: 'Archived',
}

/** Consequential transitions explain themselves before they happen. */
export type Confirm = 'close' | 'reopen' | 'stop' | 'archive'
export type Tone = 'primary' | 'secondary' | 'quiet'
export type Action =
  | { kind: 'transition'; to: string; label: string; tone: Tone; confirm?: Confirm; then?: string }
  | { kind: 'link'; href: string; label: string; tone: Tone }
  | { kind: 'invite'; label: string; tone: Tone }
  | { kind: 'write'; label: string; tone: Tone }

export type Guide = {
  step: Step
  /** "Collecting thoughts". */
  title: string
  /** One or two sentences, only what this person needs. */
  body: string
  /** What everyone in the sprint can do (write, join, read the outcomes). */
  actions: Action[]
  /** The facilitator's area: kept apart from writing a thought. Empty for everyone else. */
  facilitator: { body: string; actions: Action[] } | null
  /** Real blockers or things worth knowing, each with how to resolve it. */
  notes: string[]
}

export type GuideInput = Pick<
  SprintDetail,
  'id' | 'status' | 'is_facilitator' | 'is_participant' | 'allowed_transitions' | 'entry_count' | 'theme_count' | 'retro_at' | 'reopened_count'
> & { participant_count: number }

/** Only transitions the server allows this person survive. */
function allowed(s: GuideInput, actions: Action[]) {
  return actions.filter((a) => a.kind !== 'transition' || s.allowed_transitions.includes(a.to))
}

export function sprintGuide(s: GuideInput, opts: { online?: boolean; now?: number } = {}): Guide {
  const online = opts.online ?? true
  const now = opts.now ?? Date.now()
  const base = `/sprints/${s.id}`
  const fac = s.is_facilitator
  const part = s.is_participant
  const retroPast = Date.parse(s.retro_at) < now
  const notes: string[] = []
  const step = STEP_OF[s.status] ?? 'setup'
  let title = STATUS_PHRASE[s.status] ?? s.status
  let body = ''
  let actions: Action[] = []
  let facBody = ''
  let facActions: Action[] = []

  switch (s.status) {
    case 'draft':
      body = part ? 'This sprint isn’t open for thoughts yet. You can write here as soon as the facilitator opens collection.' : 'This sprint isn’t open for thoughts yet.'
      facBody = 'Opening collection gives everyone in the sprint a place to write. Nobody — you included — sees anyone else’s thoughts until you close it.'
      facActions = [
        { kind: 'transition', to: 'collecting', label: 'Open collection', tone: 'primary' },
        { kind: 'invite', label: 'Invite people', tone: 'secondary' },
        { kind: 'link', href: `${base}/setup`, label: 'Edit setup', tone: 'quiet' },
      ]
      if (fac && s.participant_count <= 1) notes.push('Only you are in this sprint so far. Invite your team, or add workspace members in setup.')
      break
    case 'collecting':
      body = part ? 'Add thoughts as things happen. You can edit them until collection closes.' : 'Participants are adding thoughts. They appear here when collection closes.'
      if (part) actions = [{ kind: 'write', label: 'Write a thought', tone: 'primary' }]
      facBody = 'When the sprint wraps up, close collection to start preparing the discussion.'
      facActions = [
        { kind: 'transition', to: 'preparing', label: 'Close collection…', tone: 'secondary', confirm: 'close', then: `${base}/prepare` },
        { kind: 'invite', label: 'Invite people', tone: 'quiet' },
        { kind: 'link', href: `${base}/setup`, label: 'Edit setup', tone: 'quiet' },
      ]
      if (fac && s.participant_count <= 1) notes.push('Only you are in this sprint. Invite your team so there’s something to talk about.')
      break
    case 'preparing':
      title = fac ? 'Preparing the discussion' : 'Collection closed'
      body = fac ? 'Group thoughts into themes so the conversation has a shape. The original notes stay as written.' : 'Thoughts are read-only now. The facilitator is preparing the discussion.'
      facBody = 'Organize thoughts into themes, then mark the sprint ready.'
      facActions = [
        { kind: 'link', href: `${base}/prepare`, label: 'Organize thoughts', tone: 'primary' },
        { kind: 'transition', to: 'ready', label: 'Mark ready for the retro', tone: 'secondary' },
        { kind: 'transition', to: 'collecting', label: 'Reopen collection…', tone: 'quiet', confirm: 'reopen' },
      ]
      if (fac && s.entry_count === 0) notes.push('No thoughts were added before collection closed. You can reopen collection, or hold the retro anyway — talking about why is useful too.')
      else if (fac && s.theme_count === 0) notes.push('No themes yet. Grouping is optional: without themes, every thought is still readable in the retro.')
      break
    case 'ready':
      title = 'Ready for the retro'
      body = fac ? 'Themes are set. Start the retro when everyone’s gathered.' : 'The retro starts when the facilitator begins it. Your phone can follow along.'
      if (part && !fac) actions = [{ kind: 'link', href: `${base}/room`, label: 'Open the room', tone: 'secondary' }]
      facBody = 'Starting opens the shared stage for the room and each person’s companion on their device.'
      facActions = [
        { kind: 'transition', to: 'live', label: 'Start the retro', tone: 'primary', then: `${base}/stage` },
        { kind: 'link', href: `${base}/prepare`, label: 'Review themes', tone: 'secondary' },
        { kind: 'transition', to: 'preparing', label: 'Back to preparation', tone: 'quiet' },
      ]
      break
    case 'live':
      title = 'The retro is live'
      body = fac ? 'The stage is running. Present it on the shared screen and guide the conversation from here.' : 'Follow the conversation and take part from your device.'
      if (part && !fac) actions = [{ kind: 'link', href: `${base}/room`, label: 'Join the retro', tone: 'primary' }]
      facBody = 'Run the discussion from the stage. Presenting hides every control from the shared screen.'
      facActions = [
        { kind: 'link', href: `${base}/stage`, label: 'Open the stage', tone: 'primary' },
        { kind: 'link', href: `${base}/stage?mode=present`, label: 'Present on this screen', tone: 'secondary' },
        { kind: 'transition', to: 'ready', label: 'Stop the session…', tone: 'quiet', confirm: 'stop' },
      ]
      break
    case 'completed':
    case 'archived':
      title = s.status === 'archived' ? 'Archived' : 'Retro complete'
      body = 'Here’s what the team agreed to try, and the recap once the facilitator publishes it.'
      actions = [{ kind: 'link', href: `${base}/outcomes`, label: 'Outcomes and recap', tone: 'primary' }]
      if (s.status === 'completed') {
        facBody = 'Outcomes stay editable. Archive the sprint once there’s nothing left to record.'
        facActions = [{ kind: 'transition', to: 'archived', label: 'Archive sprint…', tone: 'quiet', confirm: 'archive' }]
      }
      break
  }

  if (retroPast && (s.status === 'draft' || s.status === 'collecting')) notes.push('The scheduled retro time has passed. Update the date in setup, or carry on.')
  facActions = allowed(s, facActions)
  if (!online && facActions.some((a) => a.kind === 'transition')) notes.push('Changing the sprint needs a connection.')
  const facilitator = fac && (facBody || facActions.length) ? { body: facBody, actions: facActions } : null
  return { step, title, body, actions, facilitator, notes: fac ? notes : notes.filter((n) => n.startsWith('The scheduled')) }
}

/** What a consequential transition actually does, before it happens. */
export const CONFIRM_COPY: Record<Confirm, { title: string; body: string[]; confirm: string; cancel: string }> = {
  close: {
    title: 'Close collection?',
    body: [
      'Every thought in this sprint is revealed, without names, to all participants and to you.',
      'Thoughts become read-only. Anything saved after this point is refused with a clear message, and kept on the writer’s device.',
    ],
    confirm: 'Close and reveal',
    cancel: 'Not yet',
  },
  reopen: {
    title: 'Reopen collection?',
    body: [
      'People can add and edit thoughts again. What participants already saw stays visible to them — reopening can’t make it secret.',
      'Any open vote is cancelled and readiness is reset.',
    ],
    confirm: 'Reopen',
    cancel: 'Keep it closed',
  },
  stop: {
    title: 'Stop the live session?',
    body: ['The sprint goes back to Ready. Any open vote is cancelled. You can start a fresh session later.'],
    confirm: 'Stop the session',
    cancel: 'Keep going',
  },
  archive: {
    title: 'Archive this sprint?',
    body: ['It moves to your previous sprints. Outcomes and the recap stay available.'],
    confirm: 'Archive',
    cancel: 'Cancel',
  },
}
