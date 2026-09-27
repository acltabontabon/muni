/**
 * The signed-in person's character and world, and the one controller that dresses the page.
 *
 * A world is only ever the viewer's own preference: it's applied to their personal pages (writing
 * and their collection, and their account), never to anything shared with a team, and switching
 * it changes attributes and pictures only — what they're writing, their filters and focus stay put.
 */
import { createContext, startTransition, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { patch } from '@/api/client'
import type { Me } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { applyAppearance, rememberWorld } from '@/lib/prefs'
import { useToast } from '@/ui'
import { resolveAvatar, type AvatarId, type Character } from './characters'

/** Pages that belong to the person alone. Everything else is Muni's shared presentation. */
export const PERSONAL_PATHS = ['/', '/capture', '/account']
export const isPersonalPath = (p: string) => PERSONAL_PATHS.includes(p)

type Avatar = Me['avatar']
type WorldCtx = {
  /** Their character, whether or not its world is on. */
  character: Character | null
  themeOn: boolean
  intro: Avatar['intro']
  /** The world on this page right now (a personal page, a character, its theme on). */
  world: AvatarId | null
  /** The character whose words this page may use (the same condition as `world`). */
  voice: Character | null
  /** Personal page, character set: the header may show the portrait. */
  personal: boolean
  choose: (id: AvatarId | null) => Promise<boolean>
  setThemeOn: (on: boolean) => Promise<boolean>
  finishIntro: () => Promise<boolean>
  chooserOpen: boolean
  setChooserOpen: (open: boolean) => void
}

const Ctx = createContext<WorldCtx | null>(null)

export function useWorld(): WorldCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWorld outside WorldProvider')
  return c
}

/**
 * Starts fetching a world's display face, so choosing it doesn't flash a fallback. Resolves when
 * the face is ready, or after a short wait at most (the page then swaps it in when it arrives).
 */
export function warmWorld(c: Character): Promise<void> {
  navigator.serviceWorker?.controller?.postMessage({ type: 'muni:warm', world: c.id })
  try {
    const ready = document.fonts?.load(`1em "${c.world.font}"`).then(() => {}, () => {})
    return Promise.race([ready ?? Promise.resolve(), new Promise<void>((r) => setTimeout(r, 700))])
  } catch {
    return Promise.resolve() /* no font loading API */
  }
}

export function WorldProvider({ children }: { children: ReactNode }) {
  const { me, loading, offline, refresh } = useAuth()
  const toast = useToast()
  const { pathname } = useLocation()
  // Changes shown before the server confirms them; dropped once `me` catches up (or on failure).
  const [over, setOver] = useState<Partial<Avatar> | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)

  const avatar: Avatar = useMemo(() => ({ id: null, theme: true, intro: 'done' as const, ...me?.avatar, ...over }), [me?.avatar, over])
  const character = resolveAvatar(avatar.id)
  const personal = isPersonalPath(pathname)
  const world = personal && character && avatar.theme ? character.id : null

  // Dress the page before it paints. While the account is still loading, keep what boot.js applied.
  useLayoutEffect(() => {
    if (loading && !me) return
    applyAppearance({ world })
  }, [world, loading, me])

  // Remember this account's choice on the device (for boot.js), and get its world ready offline.
  useEffect(() => {
    if (!me || offline) return
    rememberWorld({ account: me.account_id, avatar: resolveAvatar(me.avatar?.id)?.id ?? null, theme: me.avatar?.theme ?? true })
  }, [me, offline])
  useEffect(() => {
    if (character && avatar.theme) void warmWorld(character)
  }, [character, avatar.theme])

  const save = useCallback(
    async (change: Partial<Avatar>, body: Record<string, unknown>) => {
      startTransition(() => setOver((o) => ({ ...o, ...change })))
      try {
        await patch('/api/auth/me', body)
        await refresh()
        return true
      } catch {
        toast('Couldn’t save that change — try again', 'danger')
        return false
      } finally {
        setOver(null)
      }
    },
    [refresh, toast],
  )
  const choose = useCallback(
    async (id: AvatarId | null) => {
      // The display face is ready before the page changes, so palette and type switch together.
      const next = resolveAvatar(id)
      if (next) await warmWorld(next)
      return save({ id, intro: 'done' }, { avatar_id: id })
    },
    [save],
  )
  const setThemeOn = useCallback(async (on: boolean) => {
    if (on && character) await warmWorld(character)
    return save({ theme: on }, { avatar_theme: on })
  }, [save, character])
  const finishIntro = useCallback(() => save({ intro: 'done' }, { avatar_intro: 'done' }), [save])

  const value = useMemo<WorldCtx>(
    () => ({ character, themeOn: avatar.theme, intro: avatar.intro, world, voice: world ? character : null, personal: personal && !!character, choose, setThemeOn, finishIntro, chooserOpen, setChooserOpen }),
    [character, avatar.theme, avatar.intro, world, personal, choose, setThemeOn, finishIntro, chooserOpen],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
