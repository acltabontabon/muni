/**
 * A person's face in the retro and its recap: their character if they chose one, else their
 * initials in their own ink. Lit while they're connected (`on`), softer when they were there
 * without a device (`here`), dim when they're away. Only ever beside a name — never with a thought,
 * a vote or an answer.
 */
import { Portrait } from '@/worlds/portraits'
import { AVATAR_IDS, type AvatarId } from '@/worlds/characters'

/** First letters of a name, for a small monogram. */
export const monogram = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() || '·'
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
/** Each face takes one of a few warm inks, so a room of monograms isn't one grey row. */
export const faceHue = (id: string) => ['#d6a452', '#c8674a', '#8fb3a4', '#a9b86a', '#e0c9a6', '#7fa0c8'][hash(id) % 6]

export interface FacePerson {
  account_id: string
  display_name: string
  avatar_id?: string | null
}

export function Face({ a, state = 'on', size }: { a: FacePerson; state?: 'on' | 'here' | 'away'; size?: 'lg' | 'xl' }) {
  const character = a.avatar_id && (AVATAR_IDS as readonly string[]).includes(a.avatar_id) ? (a.avatar_id as AvatarId) : null
  return (
    <span className="retro-face" data-state={state} data-size={size} data-portrait={character ? '' : undefined} style={{ ['--hue' as string]: faceHue(a.account_id) }} aria-hidden>
      {character ? <Portrait id={character} size={size === 'xl' ? 48 : size === 'lg' ? 36 : 28} /> : monogram(a.display_name)}
    </span>
  )
}
