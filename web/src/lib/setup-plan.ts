/**
 * Saving an existing sprint's setup, as the server will take it. Several requests, in an order that
 * works: people are added first (a facilitator must already be in the sprint); the sprint's own
 * fields go next, and only those that changed (so an open vote doesn't refuse a save that leaves the
 * budget alone, and an opening question this device can't show is never sent back); people are
 * removed last. A handover changes that: afterwards this person can't change who's in any more, so
 * with one, people are removed before it.
 */
import type { SprintDetail } from '@/api/types'

/** What the setup page edits. */
export type SetupValues = {
  name: string
  external_ref: string
  goal: string
  opening_question: string
  timezone: string
  starts_on: string
  ends_on: string
  retro_date: string
  retro_time: string
  retro_duration_min: number
  facilitator_id: string
  participant_ids: string[]
  reminders_enabled: boolean
  vote_budget: number
}

/** The setup of a sprint as the server has it. */
export function setupValues(s: SprintDetail): SetupValues {
  return {
    name: s.name,
    external_ref: s.external_ref ?? '',
    goal: s.goal ?? '',
    opening_question: s.opening_question ?? '',
    timezone: s.timezone,
    starts_on: s.starts_on,
    ends_on: s.ends_on,
    retro_date: s.retro_local_date,
    retro_time: s.retro_local_time,
    retro_duration_min: s.retro_duration_min,
    facilitator_id: s.participants.find((p) => p.is_facilitator)?.account_id ?? '',
    participant_ids: s.participants.map((p) => p.account_id),
    reminders_enabled: s.reminders_enabled,
    vote_budget: s.vote_budget,
  }
}

export type SetupPlan = {
  add: string[]
  /** The sprint's own fields that changed (the handover's key wraps are added by the caller). */
  fields: Record<string, unknown>
  /** The new facilitator, when facilitation changes hands. */
  handover: string | null
  remove: string[]
}
export type SetupStep = { kind: 'add' | 'remove'; accountId: string } | { kind: 'save' }

const SCHEDULE = ['timezone', 'starts_on', 'ends_on', 'retro_date', 'retro_time', 'retro_duration_min'] as const

export function planSetup(saved: SetupValues, next: SetupValues): SetupPlan {
  const fields: Record<string, unknown> = {}
  for (const k of ['name', 'external_ref', 'goal', 'opening_question', 'reminders_enabled'] as const) if (next[k] !== saved[k]) fields[k] = next[k]
  if (Number(next.vote_budget) !== Number(saved.vote_budget)) fields.vote_budget = Number(next.vote_budget)
  // The schedule is checked as a whole: any part of it changing sends all of it.
  if (SCHEDULE.some((k) => String(next[k]) !== String(saved[k])))
    fields.schedule = { timezone: next.timezone, starts_on: next.starts_on, ends_on: next.ends_on, retro_date: next.retro_date, retro_time: next.retro_time, retro_duration_min: Number(next.retro_duration_min) }
  const handover = next.facilitator_id && next.facilitator_id !== saved.facilitator_id ? next.facilitator_id : null
  if (handover) fields.facilitator_id = handover
  // Whoever facilitates now stays in: they can't take themselves out here, before a handover or after.
  const wanted = new Set([...(handover ? [handover] : []), ...next.participant_ids, next.facilitator_id, saved.facilitator_id].filter(Boolean))
  const had = new Set(saved.participant_ids)
  return {
    add: [...wanted].filter((id) => !had.has(id)),
    fields,
    handover,
    remove: saved.participant_ids.filter((id) => !wanted.has(id)),
  }
}

/** The requests, in order. The save is left out when no field changed. */
export function setupSteps(plan: SetupPlan): SetupStep[] {
  const add = plan.add.map((accountId) => ({ kind: 'add' as const, accountId }))
  const remove = plan.remove.map((accountId) => ({ kind: 'remove' as const, accountId }))
  const save: SetupStep[] = Object.keys(plan.fields).length ? [{ kind: 'save' }] : []
  return plan.handover ? [...add, ...remove, ...save] : [...add, ...save, ...remove]
}
