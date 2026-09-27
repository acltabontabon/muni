/**
 * The eight characters a person can choose (web/src/worlds/characters.ts has their words and
 * art). Ids are stable: they're stored on accounts and never renamed. A character is private to
 * its owner — only /api/auth/me ever returns it.
 */
export const AVATAR_IDS = ['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol'] as const
export type AvatarId = (typeof AVATAR_IDS)[number]

export const isAvatarId = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v)

export const INTRO = { choose: 0, note: 1, done: 2 } as const
export type AvatarIntro = keyof typeof INTRO
export const introName = (n: number | null | undefined): AvatarIntro => (n === INTRO.choose ? 'choose' : n === INTRO.note ? 'note' : 'done')
