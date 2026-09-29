/**
 * The first evening: a new account's guide through its team's first sprint, up to the end of the
 * first retro. It never holds a control or a status of its own. At any moment it points at the one
 * real control that comes next (a firefly settles beside it) with a line saying what it's for, and
 * it says nothing when the page already does: waiting while others write, reading before the retro.
 * Everything is read from what the page already knows, so it's right on any device, and skipping it
 * is always fine.
 *
 * On the stage the facilitator's cue (lib/cue.ts) takes over; the guide stays off the stage, the
 * phone's room and the themes table.
 */
import type { GuideStage, GuideView, Milestone } from '@/api/types'
import type { Phase } from './lifecycle'

export type Step = 'team' | 'sprint' | 'create-open' | 'invite' | 'open' | 'write' | 'close' | 'themes' | 'start' | 'stage' | 'join'
/** The real controls the firefly can settle on: each carries `data-guide="<spot>"`. */
export type Spot = 'new-workspace' | 'setup-sprint' | 'create-open' | 'invite' | 'details' | 'more' | 'sprint-primary' | 'writer' | 'prepare' | 'join-retro'

/** What a page publishes about itself: only what it has already loaded. */
export type GuidePage =
  | { at: 'welcome' }
  | { at: 'workspace'; workspaceId: string; sprints: number | null; online: boolean }
  | { at: 'setup'; workspaceId: string; creating: boolean; online: boolean }
  | {
      at: 'sprint'
      workspaceId: string
      phase: Phase
      fac: boolean
      participant: boolean
      /** People in the sprint, the facilitator included. */
      people: number
      /** Whether this person has written in this sprint (null: not known yet). */
      wrote: boolean | null
      themes: number
      can: { open: boolean; close: boolean; start: boolean }
      /** The sprint's last day (YYYY-MM-DD) and the planned retro. */
      endsOn: string
      retroAt: string
      online: boolean
    }

export interface GuideState {
  stage: GuideStage
  page: GuidePage | null
  /** The page's workspace is the demo team. */
  demo: boolean
  /** Steps put off for now ("Later"). */
  later: readonly Step[]
  now: number
}

export interface Firefly {
  step: Step
  /** Where to settle, in order: the first that's on screen wins. */
  spots: Spot[]
  /** The line, set in italic. */
  line: string
  /** What it does, in a sentence. */
  text: string
  /** Putting it off moves on to the next thing (an optional step). */
  optional?: boolean
  /** It waits as a light, its note folded: the page already asks the question (the writing field). */
  rest?: boolean
}

const DAY = 86_400_000

const WORDS: Record<Step, Omit<Firefly, 'step' | 'spots'>> = {
  team: { line: 'Start with your team.', text: 'A workspace is where your team’s sprints live. Call it what the team calls itself.' },
  sprint: { line: 'Set up your first sprint.', text: 'A name, the dates, and when you’ll hold the retro. It takes a minute.' },
  'create-open': { line: 'A name is all it needs.', text: 'The dates and the retro can stay as they are for now. Open it, and everyone in it has a place to write from today.' },
  invite: { line: 'Bring your team in.', text: 'A retro needs more than one voice. Invite the people who work on this sprint with you.' },
  open: { line: 'Open collection when you’re ready.', text: 'From then on, everyone in the sprint writes down what happens, as it happens.' },
  write: { line: 'Write the first thing on your mind.', text: 'One line is enough — something that went well, or didn’t. You can change it until collection closes.', rest: true },
  close: { line: 'The sprint is ending. Close collection.', text: 'What everyone wrote is revealed, without names, so the team can read it before the retro.' },
  themes: { line: 'Group what the team wrote.', text: 'Thoughts that belong together become one topic for the retro. Anything you leave out becomes a topic of its own.', optional: true },
  start: { line: 'When everyone’s here, start the retro.', text: 'The stage opens for you: put it on the shared screen. A cue in its corner says what to do next.' },
  stage: { line: 'The retro is on. Go to the stage.', text: 'Your cue on the stage takes it from here.' },
  join: { line: 'The retro has started. Join in.', text: 'Vote, answer and add from this device while the team talks.' },
}

const fly = (step: Step, spots: Spot[]): Firefly => ({ step, spots, ...WORDS[step] })

/** The next step, or null when there's nothing to point at (or the page says it already). */
export function guideFor(s: GuideState): Firefly | null {
  if ((s.stage !== 'on' && s.stage !== 'prologue') || !s.page || s.demo) return null
  const next = (...candidates: (Firefly | null)[]) => candidates.find((c) => c && !s.later.includes(c.step)) ?? null
  const p = s.page
  switch (p.at) {
    case 'welcome':
      return next(fly('team', ['new-workspace']))
    case 'workspace':
      return p.online && p.sprints === 0 ? next(fly('sprint', ['setup-sprint'])) : null
    case 'setup':
      return p.creating && p.online ? next(fly('create-open', ['create-open'])) : null
    case 'sprint': {
      if (!p.online) return null
      if (p.fac) {
        const alone = p.people <= 1
        if (p.phase === 'draft') return next(alone ? fly('invite', ['invite', 'details', 'more']) : null, p.can.open ? fly('open', ['sprint-primary', 'details']) : null)
        if (p.phase === 'collecting') {
          if (p.wrote === null) return null
          // Never a nudge to close early: only once the sprint's last day has come, or the retro is near.
          const ending = s.now >= Date.parse(`${p.endsOn}T00:00:00`) || Date.parse(p.retroAt) - s.now < DAY
          return next(alone ? fly('invite', ['invite', 'details', 'more']) : null, p.participant && !p.wrote ? fly('write', ['writer']) : null, ending && p.can.close ? fly('close', ['sprint-primary', 'details']) : null)
        }
        if (p.phase === 'closed') return next(p.themes === 0 ? fly('themes', ['prepare', 'details']) : null, p.can.start ? fly('start', ['sprint-primary', 'details']) : null)
        if (p.phase === 'live') return next(fly('stage', ['sprint-primary', 'details']))
        return null
      }
      if (!p.participant) return null
      if (p.phase === 'collecting') return p.wrote === false ? next(fly('write', ['writer'])) : null
      if (p.phase === 'live') return next(fly('join', ['join-retro']))
      return null
    }
  }
}

// ── The sky.

export const MILESTONES: Record<Milestone, string> = {
  team: 'Your team',
  sprint: 'A first sprint',
  people: 'People to talk with',
  thought: 'A first thought',
  reveal: 'Everyone’s thoughts, revealed',
  retro: 'The retro',
  agreed: 'One thing to try',
}

const STARTER: Milestone[] = ['team', 'sprint', 'people', 'thought', 'reveal', 'retro', 'agreed']
const MEMBER: Milestone[] = ['thought', 'reveal', 'retro', 'agreed']

/**
 * Where each star comes to rest when the evening closes: points on Muni's mark (brand/Mark.tsx,
 * 64 units), in the order the pen draws it. The last is always the dot — the path forward.
 */
const ON_MARK: Record<'starter' | 'member', [number, number][]> = {
  starter: [[10, 40], [10, 28], [18, 20], [26, 32], [34, 20], [42, 40], [52, 40]],
  member: [[10, 40], [18, 20], [34, 20], [52, 40]],
}
/** Where each star sits in the open sky before then: scattered, loosely the mark's shape. */
const IN_SKY: Record<'starter' | 'member', [number, number][]> = {
  starter: [[5, 40], [13, 31], [22, 35], [30, 24], [41, 17], [50, 27], [59, 19]],
  member: [[8, 38], [22, 30], [37, 19], [55, 27]],
}

export interface Star {
  id: Milestone
  label: string
  lit: boolean
  /** The next star to light. */
  next: boolean
  sky: [number, number]
  mark: [number, number]
}

export function starsFor(v: GuideView): Star[] {
  const order = v.track === 'starter' ? STARTER : MEMBER
  const firstDark = order.find((m) => !v.reached.includes(m))
  return order.map((id, i) => ({ id, label: MILESTONES[id], lit: v.reached.includes(id), next: id === firstDark, sky: IN_SKY[v.track][i], mark: ON_MARK[v.track][i] }))
}
