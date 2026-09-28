/**
 * The eight characters a person can choose (web/src/worlds/characters.ts has their words and
 * art). Ids are stable: they're stored on accounts and never renamed. A character is its person's
 * face beside their name in the retro (meeting attendance); it never travels with anything
 * anonymous. Whether their own pages wear its world is theirs alone (/api/auth/me).
 */
export const AVATAR_IDS = ['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol'] as const
export type AvatarId = (typeof AVATAR_IDS)[number]

export const isAvatarId = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v)

/** New accounts meet the chooser once ('choose'); after that, nothing more is asked ('done'). */
export const INTRO = { choose: 0, done: 2 } as const
export type AvatarIntro = keyof typeof INTRO
export const introName = (n: number | null | undefined): AvatarIntro => (n === INTRO.choose ? 'choose' : 'done')
