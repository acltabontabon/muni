import { describe, expect, it } from 'vitest'
import { cueFor, mostVoted, type CueState } from './cue'

const talk = (over: Partial<Extract<CueState, { phase: 'talk' }>> = {}): CueState => ({
  phase: 'talk', grouped: true, question: 'What would get a first review the same day?', takeaway: '', couldTry: '', topicCheck: null, actionCheck: null, waiting: false, over: false, nextTopic: 'Who owns staging?', next: 'Agree', ...over,
})

describe('the facilitator’s cue', () => {
  it('walks a topic: the question, a note, an idea, a check, then on', () => {
    const open = cueFor(talk())
    expect(open.say).toBe('What would get a first review the same day?')
    expect(open.act).toBeNull() // the talk is the thing to do
    expect(open.alt?.do).toBe('ask_topic')
    expect(cueFor(talk({ topicCheck: { status: 'open', answers: 3 } }))).toMatchObject({ act: { do: 'share_topic' }, hint: expect.stringContaining('3 answers') })
    expect(cueFor(talk({ topicCheck: { status: 'shared', answers: null } })).act?.do).toBe('write_remember')
    expect(cueFor(talk({ takeaway: 'Reviews wait on standup' }))).toMatchObject({ act: { do: 'write_try' }, alt: { do: 'next', label: 'Next topic' } })
    expect(cueFor(talk({ takeaway: 'x', couldTry: 'Twenty minutes after standup' })).act?.do).toBe('ask_action')
    expect(cueFor(talk({ takeaway: 'x', couldTry: 'y', actionCheck: { status: 'open', answers: 0 } })).act?.do).toBe('share_action')
    const done = cueFor(talk({ takeaway: 'x', couldTry: 'y', actionCheck: { status: 'shared', answers: null } }))
    expect(done).toMatchObject({ say: 'Let’s move on to ‘Who owns staging?’', act: { do: 'next', label: 'Next topic' } })
    expect(cueFor(talk({ takeaway: 'x', couldTry: 'y', actionCheck: { status: 'shared', answers: null }, nextTopic: 'Planning' })).say).toBe('Let’s move on to ‘Planning’.')
    expect(cueFor(talk({ takeaway: 'x', couldTry: 'y', actionCheck: { status: 'shared', answers: null }, nextTopic: null })).act).toEqual({ do: 'next', label: 'Next: Agree' })
  })

  it('puts something added from a phone first, and time’s up before the question', () => {
    expect(cueFor(talk({ waiting: true, topicCheck: { status: 'open', answers: 1 } })).act?.do).toBe('release')
    expect(cueFor(talk({ over: true }))).toMatchObject({ act: { do: 'write_remember' }, alt: { do: 'more_time' } })
    // An idea with its time up isn't checked: the room moves on.
    expect(cueFor(talk({ couldTry: 'y', over: true })).act?.do).toBe('next')
  })

  it('asks about each of last time’s experiments, then moves on', () => {
    expect(cueFor({ phase: 'look_back', undecided: ['Pair on the checklist'], decided: 0, here: 3, total: 6, next: 'Choose' })).toMatchObject({ say: expect.stringContaining('Pair on the checklist'), act: null, hint: expect.stringContaining('3 of 6 here') })
    expect(cueFor({ phase: 'look_back', undecided: [], decided: 1, here: 6, total: 6, next: 'Choose' })).toMatchObject({ act: { do: 'next', label: 'Next: Choose' }, hint: null })
    expect(cueFor({ phase: 'look_back', undecided: [], decided: 0, here: 2, total: 5, next: 'Choose' }).say).toContain('first retro')
  })

  it('says when enough have voted, and how many votes there are', () => {
    const base = { phase: 'choose' as const, topics: 5, votes: 2, people: 4, counted: false, top: null, next: 'Talk' }
    expect(cueFor({ ...base, voters: 1 })).toMatchObject({ say: expect.stringContaining('2 votes each'), act: null, alt: { do: 'next' }, hint: expect.stringContaining('Two of 5 topics') })
    expect(cueFor({ ...base, voters: 0 }).alt).toBeNull()
    expect(cueFor({ ...base, voters: 3 }).act).toEqual({ do: 'next', label: 'Next: Talk' })
    expect(mostVoted(2, 4)).toBe(false)
    expect(mostVoted(1, 1)).toBe(true)
  })

  it('keeps Agree to a few experiments, and ends', () => {
    expect(cueFor({ phase: 'agree', experiments: 0, ideas: 2, ownerless: 0 }).say).toContain('Which of these')
    expect(cueFor({ phase: 'agree', experiments: 1, ideas: 2, ownerless: 1 })).toMatchObject({ alt: { do: 'end' }, hint: expect.stringContaining('1 experiment has no owner') })
    expect(cueFor({ phase: 'agree', experiments: 3, ideas: 2, ownerless: 0 }).act?.do).toBe('end')
  })
})
