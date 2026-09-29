/**
 * The facilitator's cue: at any moment of the retro, one line to say and one thing to do. A
 * first-time facilitator shouldn't have to know the retro's machinery — check-ins, sharing, notes,
 * ideas, when to move on — to run a good one: the cue reads the room's state and suggests the next
 * move, and everything else on the stage stays where it is for when they want it. Nothing here
 * decides anything; skipping a cue is always fine.
 */

export type CueAction = 'next' | 'end' | 'ask_topic' | 'share_topic' | 'ask_action' | 'share_action' | 'release' | 'write_remember' | 'write_try' | 'more_time'

export interface Cue {
  /** A line to say aloud (shown in quotes; the facilitator's own words are just as good). */
  say: string | null
  /** Why now, or what to look for, in a short line. */
  hint: string | null
  /** The one thing to do. Null when the thing to do is already on the screen (a verdict, the talk itself). */
  act: { do: CueAction; label: string } | null
  /** A quieter way on, when there's a real alternative. */
  alt: { do: CueAction; label: string } | null
}

interface Asked {
  status: 'open' | 'shared'
  /** How many have answered so far (while open). */
  answers: number | null
}

export type CueState =
  | { phase: 'look_back'; undecided: string[]; decided: number; here: number; total: number; next: string | null }
  | { phase: 'choose'; topics: number; votes: number; voters: number | null; people: number; counted: boolean; top: string | null; next: string | null }
  | {
      phase: 'talk'
      /** A theme (false: the thoughts nobody grouped, which take no notes or check-ins). */
      grouped: boolean
      question: string | null
      takeaway: string
      couldTry: string
      /** "How did this show up for you?", if asked. */
      topicCheck: Asked | null
      /** "Would trying this help?", if asked about the idea as it's worded now. */
      actionCheck: Asked | null
      /** Something added from a phone waits to be shared. */
      waiting: boolean
      /** The topic's time is up. */
      over: boolean
      /** The next topic's title, or null on the last one. */
      nextTopic: string | null
      /** The step after the talk. */
      next: string | null
    }
  | { phase: 'agree'; experiments: number; ideas: number; ownerless: number }

/** A title quoted at the end of a sentence: no full stop after its own ? or !. */
const end = (title: string) => `‘${title}’${/[?!.]$/.test(title) ? '' : '.'}`
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
const word = (k: number) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][k] ?? String(k)
/** Enough have voted to move on: most of the room, and at least one. */
export const mostVoted = (voters: number, people: number) => voters >= Math.max(1, Math.ceil(people * 0.75))

export function cueFor(s: CueState): Cue {
  const next = (label: string | null, fallback = 'Next') => ({ do: 'next' as const, label: label ? `Next: ${label}` : fallback })
  switch (s.phase) {
    case 'look_back': {
      const arriving = s.total > 1 && s.here < s.total ? `${s.here} of ${s.total} here so far.` : null
      if (s.undecided.length)
        return {
          say: s.decided ? `And ‘${s.undecided[0]}’ — did that one help?` : `Last time we said we’d try ‘${s.undecided[0]}’. Did it help?`,
          hint: ['Tap an answer beside it. “Not tried yet” is an honest one.', arriving].filter(Boolean).join(' '),
          act: null,
          alt: null,
        }
      if (s.decided)
        return { say: 'Thanks. Now let’s choose what to talk about.', hint: arriving, act: next(s.next), alt: null }
      return {
        say: 'This is our first retro here. What we agree to try today comes back here next time, to see if it helped.',
        hint: arriving ? `Start when most people are here — ${arriving.toLowerCase()}` : 'Start when most people are here.',
        act: next(s.next),
        alt: null,
      }
    }
    case 'choose': {
      if (s.topics <= 1) return { say: 'There’s one topic, so nothing to choose. Let’s talk about it.', hint: null, act: next(s.next), alt: null }
      if (s.counted) return { say: s.top ? `The votes are in. We start with ${end(s.top)}` : 'The votes are in.', hint: null, act: next(s.next), alt: null }
      const voters = s.voters ?? 0
      const ask = `Vote on your phone: ${n(s.votes, 'vote', 'votes')} each, for what you most want to talk about. Nobody sees whose are whose.`
      if (mostVoted(voters, s.people))
        return { say: 'Looks like most of us have voted. Let’s see what came first.', hint: `${voters} of ${s.people} have voted. Moving on counts the votes.`, act: next(s.next), alt: null }
      return {
        say: ask,
        hint: `${voters} of ${s.people} have voted.${s.votes < s.topics ? ` ${word(s.votes)[0].toUpperCase()}${word(s.votes).slice(1)} of ${s.topics} topics: choosing means leaving some out.` : ''}`,
        act: null,
        alt: voters ? next(s.next, 'Move on') : null,
      }
    }
    case 'talk': {
      const moveOn = s.nextTopic ? { do: 'next' as const, label: 'Next topic' } : next(s.next)
      const onward = s.nextTopic ? `Let’s move on to ${end(s.nextTopic)}` : 'That’s the last topic. Let’s agree what to try.'
      if (s.waiting)
        return { say: null, hint: 'Someone added to this from their phone, without a name. Share it when it fits the conversation.', act: { do: 'release', label: 'Share it with the room' }, alt: null }
      if (!s.grouped) return { say: 'These are the thoughts nobody grouped. Anything here we haven’t covered?', hint: null, act: moveOn, alt: null }
      if (s.topicCheck?.status === 'open')
        return {
          say: 'Take a moment on your phone: did this show up in your work?',
          hint: `${s.topicCheck.answers ? n(s.topicCheck.answers, 'answer', 'answers') : 'No answers'} so far. Share when most are in — or keep talking; it stays open.`,
          act: { do: 'share_topic', label: 'Share the answers' },
          alt: null,
        }
      if (s.actionCheck?.status === 'open')
        return {
          say: `Would trying ‘${s.couldTry}’ help? Answer on your phone.`,
          hint: `${s.actionCheck.answers ? n(s.actionCheck.answers, 'answer', 'answers') : 'No answers'} so far. A concern is worth hearing out, not outvoting.`,
          act: { do: 'share_action', label: 'Share the answers' },
          alt: null,
        }
      if (!s.takeaway && !s.couldTry) {
        if (s.over) return { say: 'We’re out of time on this one. What do we take from it?', hint: 'A line under We’ll remember is enough — or give it two more minutes.', act: { do: 'write_remember', label: 'Write what we’ll remember' }, alt: { do: 'more_time', label: '+2 minutes' } }
        if (s.topicCheck?.status === 'shared')
          return { say: 'So what do we take from this?', hint: 'When the room lands on something, write it in a line.', act: { do: 'write_remember', label: 'Write what we’ll remember' }, alt: null }
        return {
          say: s.question ?? 'What stands out for you in these?',
          hint: 'Give everyone a minute to read first. If only a few people talk, ask the whole room privately.',
          act: null,
          alt: { do: 'ask_topic', label: 'Ask how it showed up' },
        }
      }
      if (!s.couldTry)
        return { say: 'Is there something small we could try next sprint?', hint: 'Not every topic needs one — moving on is fine.', act: { do: 'write_try', label: 'Write an idea to try' }, alt: moveOn }
      if (!s.actionCheck && !s.over)
        return { say: 'Would that help? Let’s check with everyone.', hint: 'Or just move on: the idea waits for Agree either way.', act: { do: 'ask_action', label: 'Check it with the room' }, alt: moveOn }
      return { say: onward, hint: s.takeaway ? null : 'Nothing noted under We’ll remember — fine if the idea says it all.', act: moveOn, alt: null }
    }
    case 'agree': {
      if (!s.experiments)
        return s.ideas
          ? { say: 'Which of these do we actually want to try? One to three, each with someone who owns it.', hint: 'Start from an idea on the right — “Use this idea” — then name who owns it.', act: null, alt: null }
          : { say: 'What’s one small thing we’ll do differently next sprint?', hint: 'Small and specific, with a when. Someone owns it and says yes on their phone.', act: null, alt: null }
      if (s.experiments < 3)
        return {
          say: 'Anything else we want to try — or is this enough?',
          hint: [s.ownerless ? `${n(s.ownerless, 'experiment has', 'experiments have')} no owner yet.` : null, 'Fewer is better: they come back next time.'].filter(Boolean).join(' '),
          act: null,
          alt: { do: 'end', label: 'End the retro' },
        }
      return { say: 'That’s plenty for one sprint. Thanks, everyone.', hint: s.ownerless ? `${n(s.ownerless, 'experiment has', 'experiments have')} no owner yet.` : null, act: { do: 'end', label: 'End the retro' }, alt: null }
    }
  }
}
