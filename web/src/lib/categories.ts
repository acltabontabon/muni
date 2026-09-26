import type { Category } from '@/api/types'

/** The one place category wording lives. */
export const CATEGORIES: { id: Category; label: string; hint: string; color: string }[] = [
  { id: 'proud', label: 'Proud of', hint: 'something worth recognising', color: 'var(--cat-proud)' },
  { id: 'keep', label: 'Keep', hint: 'it helped; keep doing it', color: 'var(--cat-keep)' },
  { id: 'improve', label: 'Improve', hint: 'friction or an opportunity', color: 'var(--cat-improve)' },
  { id: 'stop', label: 'Stop', hint: 'a habit or process to drop', color: 'var(--cat-stop)' },
  { id: 'try', label: 'Try', hint: 'a suggestion or experiment', color: 'var(--cat-try)' },
]
export const UNSORTED = { id: 'unsorted', label: 'Unsorted', hint: 'sort it later', color: 'var(--cat-unsorted)' }

export function categoryMeta(id: string | null | undefined) {
  return CATEGORIES.find((c) => c.id === id) ?? UNSORTED
}

export const PERIODS = [
  { id: 'early', label: 'Early sprint' },
  { id: 'middle', label: 'Mid sprint' },
  { id: 'late', label: 'Late sprint' },
] as const

export const MEMORY_PROMPTS = [
  'What slowed you down this week?',
  'What saved you time?',
  'What did you notice that nobody mentioned?',
  'What would you tell a new teammate about this sprint?',
  'Which moment are you glad happened?',
  'What did you work around instead of fixing?',
]

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  collecting: 'Collecting',
  preparing: 'Preparing',
  ready: 'Ready',
  live: 'Live',
  completed: 'Completed',
  archived: 'Archived',
}

export const PHASE_LABEL: Record<string, string> = {
  arrive: 'Arrive',
  remember: 'Remember',
  discover: 'Discover',
  discuss: 'Discuss',
  decide: 'Decide',
  leave: 'Leave',
}

export const PHASE_HINT: Record<string, string> = {
  arrive: 'Settle in. Who’s here?',
  remember: 'Last time, we said…',
  discover: 'Here’s what this sprint left us.',
  discuss: 'One theme, enough room to think.',
  decide: 'What will we try next?',
  leave: 'Read it back, then go.',
}

export const OUTCOME_LABEL: Record<string, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  helped: 'Helped',
  did_not_help: 'Didn’t help',
  inconclusive: 'Inconclusive',
  not_tried: 'Not tried yet',
}
