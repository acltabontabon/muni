/**
 * Workspace activity in plain words. Audit events record who changed what, by id; they never hold
 * entry text or link a person to an entry. This only turns their labels into sentences, and never
 * shows the ids in their metadata.
 */
import type { AuditEvent } from '@/api/types'

const TRANSITION: Record<string, string> = {
  'draft>collecting': 'opened collection',
  'collecting>preparing': 'closed collection',
  'preparing>collecting': 'reopened collection',
  'preparing>ready': 'marked the sprint ready',
  'ready>preparing': 'moved the sprint back to preparation',
  'ready>live': 'started the retro',
  'live>ready': 'stopped the live session',
  'live>completed': 'completed the retro',
  'completed>archived': 'archived the sprint',
}

const ACTIONS: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'workspace.settings_updated': 'changed workspace settings',
  'membership.revoked': 'removed a member',
  'invitation.sent': 'sent an invitation',
  'invitation.accepted': 'joined the workspace',
  'sprint.created': 'set up a sprint',
  'sprint.updated': 'changed a sprint’s setup',
  'grouping.changed': 'reorganized themes',
  'themes.reordered': 'reordered themes',
  'ai.grouping_requested': 'asked for an AI theme draft',
  'ai.proposal_applied': 'used an AI theme draft',
  'votes.round_opened': 'opened voting',
  'votes.round_closed': 'closed voting',
  'meeting.command': 'used a retro control',
  'meeting.control_taken': 'took control of the stage',
  'meeting.phase_changed': 'moved the retro to another stage',
  'meeting.topic_changed': 'changed the discussion topic',
  'meeting.agenda_changed': 'set the agenda',
  'meeting.quiet_reading': 'started a quiet reading minute',
  'meeting.speaking_started': 'invited voices one at a time',
  'meeting.context_released': 'released written context',
  'experiment.proposed': 'proposed an experiment',
  'experiment.updated': 'updated an experiment',
  'recap.published': 'published a recap',
  'retention.purged': 'removed sprint notes after the retention period',
  'demo.seeded': 'set up the demo workspace',
}

/** "sprint.some_thing" → "some thing (sprint)" for labels this file doesn't know yet. */
function humanize(action: string) {
  const [area, what] = action.includes('.') ? action.split('.', 2) : ['', action]
  const words = what.replace(/[_-]+/g, ' ').trim()
  return area ? `${words} (${area})` : words
}

export function describeAction(e: Pick<AuditEvent, 'action' | 'meta'>): string {
  if (e.action === 'sprint.transition') {
    const key = `${String(e.meta?.from ?? '')}>${String(e.meta?.to ?? '')}`
    return TRANSITION[key] ?? 'changed the sprint’s stage'
  }
  return ACTIONS[e.action] ?? humanize(e.action)
}

/** "Maya closed collection · Sprint 42". Muni itself acts only for retention and scheduled jobs. */
export function describeEvent(e: AuditEvent, sprintName?: (id: string) => string | undefined): { who: string; what: string; where: string | null } {
  return { who: e.actor_name ?? 'Muni', what: describeAction(e), where: e.sprint_id ? sprintName?.(e.sprint_id) ?? null : null }
}
