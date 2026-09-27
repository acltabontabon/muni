import { describe, expect, it } from 'vitest'
import type { Experiment, GroupingView, SprintDetail } from '@/api/types'
import { endSentence, listTitles, recapDraft } from './local-export'

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
})
