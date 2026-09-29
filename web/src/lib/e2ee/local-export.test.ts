import { describe, expect, it } from 'vitest'
import type { Experiment, GroupingView, SprintDetail } from '@/api/types'
import { parseMarkdown } from '@/lib/markdown'
import { endSentence, listTitles, recapDraft } from './local-export'
import { LOCKED } from './keyring'

const sprint = { name: 'Sprint 14' } as SprintDetail
const grouping = (titles: string[]) => ({ themes: titles.map((title, i) => ({ id: `t${i}`, title, discussed: true, takeaway: null, entries: [] })), ungrouped: [] }) as unknown as GroupingView

describe('sentence punctuation', () => {
  it('adds a full stop only when the text doesn’t already end a sentence', () => {
    expect(endSentence('Planning runs long')).toBe('Planning runs long.')
    expect(endSentence('Who owns staging?')).toBe('Who owns staging?')
    expect(endSentence('Ship it!')).toBe('Ship it!')
    expect(endSentence('Done.')).toBe('Done.')
    expect(endSentence('We said “no more Fridays.”')).toBe('We said “no more Fridays.”')
    expect(endSentence('Wait for it…  ')).toBe('Wait for it…')
  })

  it('lists titles as written, without a comma straight after a question', () => {
    expect(listTitles(['Reviews'])).toBe('Reviews')
    expect(listTitles(['Reviews', 'Planning'])).toBe('Reviews and Planning')
    expect(listTitles(['Who owns staging?', 'Reviews that wait', 'Planning runs long'])).toBe('Who owns staging? Reviews that wait and Planning runs long')
    expect(listTitles(['Reviews', 'Why so slow?', 'Hard to say!', 'Planning'])).toBe('Reviews, Why so slow? Hard to say! and Planning')
    expect(listTitles(['Reviews', 'Why so slow?', 'Planning'])).toBe('Reviews, Why so slow? and Planning')
  })
})

describe('recap draft', () => {
  it('never doubles the punctuation after a theme title, and keeps titles as written', () => {
    expect(recapDraft(sprint, grouping(['Who owns staging?']), [] as Experiment[])).toContain('We talked about Who owns staging?\n')
    const two = recapDraft(sprint, grouping(['Reviews that wait', 'Who owns staging?']), [])
    expect(two).toContain('We talked about Reviews that wait and Who owns staging?\n')
    expect(recapDraft(sprint, grouping(['Planning runs long']), [])).toContain('We talked about Planning runs long.\n')
    expect(two).not.toMatch(/[?!.]\.|\?,/)
  })

  it('reads on the recap page as it was meant: headings, what was kept, numbered experiments with owners', () => {
    const g = {
      themes: [
        { id: 't1', title: '*nix builds', discussed: true, takeaway: 'Cache the toolchain', could_try: 'a shared runner', parked: false, entries: [] },
        { id: 't2', title: 'Reviews that wait', discussed: true, takeaway: null, could_try: null, parked: false, entries: [] },
        { id: 't3', title: 'Staging owner', discussed: false, takeaway: null, could_try: null, parked: false, entries: [] },
        { id: 't4', title: 'Parked one', discussed: false, takeaway: null, could_try: null, parked: true, entries: [] },
      ],
      ungrouped: [],
    } as unknown as GroupingView
    const exps = [
      { id: 'e1', change_to_try: 'Pair on reviews', success_signal: 'PRs wait less than a day', owner_name: 'Ana Reyes', owner_accepted: true, review_on: '2026-10-12', status: 'accepted' },
      { id: 'e2', change_to_try: LOCKED, success_signal: 'Fewer surprises?', owner_name: null, owner_accepted: false, review_on: '2026-10-12', status: 'proposed' },
    ] as unknown as Experiment[]
    const draft = recapDraft({ name: 'Sprint 14', goal: 'Faster checkout' } as SprintDetail, g, exps)
    const blocks = parseMarkdown(draft)
    expect(blocks.map((b) => b.t + (b.t === 'h' ? b.level : ''))).toEqual(['h3', 'p', 'p', 'h3', 'ul', 'h3', 'ol', 'h3', 'ul'])
    // Someone's own asterisks stay theirs, not bold.
    expect(draft).toContain('- **\\*nix builds:** Cache the toolchain. We could try: a shared runner.')
    expect(draft).toMatch(/^1\. \*\*Pair on reviews\*\* — we’ll know it helped if PRs wait less than a day\. Owner: Ana Reyes\. Back on /m)
    expect(draft).toMatch(/^2\. \*\*\\\[not readable on this device\\\]\*\* — we’ll know it helped if Fewer surprises\? No owner yet\./m)
    expect(draft).toContain('## Not reached\n\n- Staging owner')
    expect(draft).not.toContain('Parked one')
    expect(draft).not.toContain('⁣')
  })
})
