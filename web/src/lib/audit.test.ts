import { describe, expect, it } from 'vitest'
import { describeAction, describeEvent } from './audit'
import type { AuditEvent } from '@/api/types'

const ev = (action: string, meta: Record<string, unknown> = {}, extra: Partial<AuditEvent> = {}): AuditEvent => ({ id: 1, sprint_id: null, actor_name: 'Maya', action, meta, created_at: '2026-09-27T00:00:00Z', ...extra })

describe('activity wording', () => {
  it('turns lifecycle transitions into what happened', () => {
    expect(describeAction(ev('sprint.transition', { from: 'collecting', to: 'preparing' }))).toBe('closed collection')
    expect(describeAction(ev('sprint.transition', { from: 'preparing', to: 'collecting' }))).toBe('reopened collection')
    expect(describeAction(ev('sprint.transition', { from: 'ready', to: 'live' }))).toBe('started the retro')
    expect(describeAction(ev('sprint.transition', { from: 'x', to: 'y' }))).toBe('changed the sprint’s stage')
  })

  it('never shows a raw event label', () => {
    for (const a of ['sprint.created', 'invitation.sent', 'membership.revoked', 'meeting.phase_changed', 'recap.published', 'something.brand_new']) {
      const text = describeAction(ev(a))
      expect(text, a).not.toMatch(/[._]/)
    }
  })

  it('names the sprint, and never an id from the metadata', () => {
    const e = ev('membership.revoked', { account_id: 'acc-123' }, { sprint_id: 's1' })
    const d = describeEvent(e, (id) => (id === 's1' ? 'Sprint 42' : undefined))
    expect(d).toEqual({ who: 'Maya', what: 'removed a member', where: 'Sprint 42' })
    expect(JSON.stringify(d)).not.toContain('acc-123')
  })

  it('attributes system actions to Muni', () => {
    expect(describeEvent(ev('retention.purged', {}, { actor_name: null })).who).toBe('Muni')
  })
})
