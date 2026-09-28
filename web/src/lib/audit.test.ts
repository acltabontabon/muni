import { describe, expect, it } from 'vitest'
import { describeAction, describeEvent } from './audit'
import type { AuditEvent } from '@/api/types'

const ev = (action: string, meta: Record<string, unknown> = {}, extra: Partial<AuditEvent> = {}): AuditEvent => ({ id: 1, sprint_id: null, actor_name: 'Maya', actor_gone: false, action, meta, created_at: '2026-09-27T00:00:00Z', ...extra })

describe('activity wording', () => {
  it('turns lifecycle transitions into what happened', () => {
    expect(describeAction(ev('sprint.transition', { from: 'collecting', to: 'preparing' }))).toBe('closed collection')
    expect(describeAction(ev('sprint.transition', { from: 'preparing', to: 'collecting' }))).toBe('reopened collection')
    expect(describeAction(ev('sprint.transition', { from: 'ready', to: 'live' }))).toBe('started the retro')
    expect(describeAction(ev('sprint.transition', { from: 'x', to: 'y' }))).toBe('changed the sprint’s stage')
  })

  it('never shows a raw event label', () => {
    for (const a of ['sprint.created', 'invitation.sent', 'membership.revoked', 'meeting.phase_changed', 'recap.published', 'join_link.created', 'join_link.revoked', 'join_link.redeemed', 'join_request.created', 'join_request.approved', 'join_request.declined', 'keys.replaced', 'something.brand_new']) {
      const text = describeAction(ev(a))
      expect(text, a).not.toMatch(/[._]/)
    }
    // Every action the server records is known by name, not humanized.
    for (const a of ['join_link.created', 'join_link.revoked', 'join_link.redeemed', 'join_request.created', 'join_request.approved', 'join_request.declined', 'keys.replaced']) expect(describeAction(ev(a)), a).not.toMatch(/\(/)
    expect(describeAction(ev('join_link.created', { mode: 'direct' }))).toBe('made a personal invite link')
  })

  it('names the sprint, and never an id from the metadata', () => {
    const e = ev('membership.revoked', { account_id: 'acc-123' }, { sprint_id: 's1' })
    const d = describeEvent(e, (id) => (id === 's1' ? 'Sprint 42' : undefined))
    expect(d).toEqual({ who: 'Maya', what: 'removed a member', where: 'Sprint 42' })
    expect(JSON.stringify(d)).not.toContain('acc-123')
  })

  it('attributes system actions to Muni, and a deleted account’s to someone', () => {
    expect(describeEvent(ev('retention.purged', {}, { actor_name: null })).who).toBe('Muni')
    expect(describeEvent(ev('account.deleted', {}, { actor_name: null, actor_gone: true })).who).toBe('Someone')
  })
})
