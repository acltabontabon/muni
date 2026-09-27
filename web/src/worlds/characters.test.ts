import { describe, expect, it } from 'vitest'
import workerIds from '../../../worker/src/lib/avatars.ts?raw'
import bootScript from '../../public/boot.js?raw'
import { AVATAR_IDS, CHARACTERS, DEFAULT_AVATAR, invitationFor, resolveAvatar } from './characters'

const quoted = (list: string) => (list.match(/'([a-z]+)'/g) ?? []).map((x: string) => x.slice(1, -1))
const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z“])/).filter(Boolean).length

describe('the characters', () => {
  it('are eight, with stable ids the Worker and the boot script agree on', () => {
    expect(AVATAR_IDS).toHaveLength(8)
    expect(new Set(AVATAR_IDS).size).toBe(8)
    expect(quoted(workerIds.match(/AVATAR_IDS = \[([^\]]+)\]/)![1])).toEqual([...AVATAR_IDS])
    expect(quoted(bootScript.match(/known = \[([^\]]+)\]/)![1])).toEqual([...AVATAR_IDS])
    expect(AVATAR_IDS).toContain(DEFAULT_AVATAR)
  })

  it('each have their words: a line, a two-or-three-sentence story, a fact, and a world', () => {
    for (const id of AVATAR_IDS) {
      const c = CHARACTERS[id]
      expect(c.id).toBe(id)
      for (const field of [c.name, c.title, c.line, c.bio, c.funFact, c.meaning, c.portrait, c.context, c.world.name, c.world.summary, c.world.empty, c.world.font]) expect(field.trim().length, `${id}`).toBeGreaterThan(2)
      expect(sentences(c.bio), `${id} bio`).toBeGreaterThanOrEqual(2)
      expect(sentences(c.bio), `${id} bio`).toBeLessThanOrEqual(3)
      expect(c.world.invitations).toHaveLength(3)
      expect(c.line.length, `${id} line`).toBeLessThan(140)
      expect(c.themeColor.light).toMatch(/^#[0-9a-f]{6}$/)
      expect(c.themeColor.dark).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('are nicknames: the words about them never assess the person who chose them', () => {
    const all = AVATAR_IDS.flatMap((id) => {
      const c = CHARACTERS[id]
      return [c.line, c.bio, c.funFact, c.world.empty, ...c.world.invitations]
    }).join(' ')
    expect(all).not.toMatch(/\byou are\b|\byour personality\b|\byou('re| are) (a|an|the)\b/i)
  })

  it('resolves only real characters; anything else is Muni’s own look', () => {
    expect(resolveAvatar('kape')?.name).toBe('Kape')
    for (const x of [null, undefined, '', 'KAPE', 'kopi', '__proto__', 'constructor', 'toString', 42, {}, ['kape']]) expect(resolveAvatar(x)).toBeNull()
  })

  it('offers one invitation a day, the same however often the page renders', () => {
    const c = CHARACTERS.himig
    const morning = new Date(2026, 8, 27, 7, 0)
    const night = new Date(2026, 8, 27, 23, 30)
    expect(invitationFor(c, morning)).toBe(invitationFor(c, night))
    const week = new Set(Array.from({ length: 7 }, (_, i) => invitationFor(c, new Date(2026, 8, 21 + i))))
    expect(week.size).toBe(3)
  })
})
