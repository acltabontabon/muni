/** Per-device preferences only. Nothing here is a credential or the text of a thought. */
const KEY = 'muni.prefs'
type Prefs = {
  lastWorkspace?: string
  lastSprint?: string
  theme?: 'light' | 'dark' | 'system'
  companionFollow?: boolean
  /** Accounts that chose to keep drafts and unsent thoughts on this device (IndexedDB). Per person. */
  keepLocalFor?: string[]
  /** Legacy device-wide flag (before the choice was per account); adopted by the next account to sign in. */
  keepLocal?: boolean
  /** The install hint was dismissed; never shown again unprompted. */
  installHintDismissed?: boolean
  /** A passkey was used or added in this browser: the entrance offers it first. A hint, never proof. */
  passkeyHint?: boolean
  /** "Not now" to adding a passkey after an email sign-in, per account; not asked again here. */
  passkeyOfferDismissedFor?: string[]
  /**
   * The signed-in person's character world, remembered so the page is dressed before it paints
   * (public/boot.js). A copy of the account's own setting; cleared on sign-out.
   */
  world?: WorldCache
}
export type WorldCache = { account: string; avatar: string | null; theme: boolean }

export function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Prefs
  } catch {
    return {}
  }
}
export function writePrefs(p: Partial<Prefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...p }))
  } catch {
    /* private mode */
  }
}

type Appearance = { mode: NonNullable<Prefs['theme']>; world: string | null; force: 'light' | 'dark' | null }
// Starts from what public/boot.js already put on the page, so the first call never undoes it.
let appearance: Appearance | null = null

/**
 * The one place the page's look is set: light, dark or the device's choice (`mode`), a character
 * world on personal pages (`world`, or null for Muni's own look), and a page that insists on a
 * scheme (`force`: the stage). Also keeps the browser's theme colour in step with the page.
 */
export function applyAppearance(next: Partial<Appearance> = {}) {
  appearance = { ...(appearance ?? { mode: readPrefs().theme ?? 'system', world: document.documentElement.dataset.world ?? null, force: null }), ...next }
  const t = appearance.force ?? appearance.mode
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  if (appearance.world) root.dataset.world = appearance.world
  else delete root.dataset.world
  const paper = getComputedStyle(root).getPropertyValue('--paper').trim()
  if (paper) for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', paper)
}
export const currentAppearance = (): Readonly<Appearance> | null => appearance

/** This device's copy of an account's character, if it belongs to that account. */
export function worldFor(accountId: string | null | undefined): WorldCache | null {
  const w = readPrefs().world
  return w && accountId && w.account === accountId ? w : null
}
export function rememberWorld(w: WorldCache) {
  const cur = readPrefs().world
  if (cur && cur.account === w.account && cur.avatar === w.avatar && cur.theme === w.theme) return
  writePrefs({ world: w })
}

/** Whether this account chose to keep drafts on this device. One person's choice never applies to another. */
export function keepsLocal(accountId: string | null): boolean {
  return !!accountId && (readPrefs().keepLocalFor ?? []).includes(accountId)
}
export function keptAccounts(): string[] {
  return readPrefs().keepLocalFor ?? []
}
export function setKeepsLocal(accountId: string, on: boolean) {
  const cur = keptAccounts().filter((a) => a !== accountId)
  writePrefs({ keepLocalFor: on ? [...cur, accountId] : cur })
}
/** The old device-wide switch becomes the choice of whoever signs in next (it was theirs to make). */
export function adoptLegacyKeep(accountId: string): boolean {
  const p = readPrefs()
  if (p.keepLocalFor !== undefined || !p.keepLocal) return false
  writePrefs({ keepLocalFor: [accountId], keepLocal: undefined })
  return true
}

/** What the app remembers between visits about the signed-in person's navigation; cleared on sign-out. */
export function forgetSignedInState() {
  // The next person on this device never opens into the previous person's world.
  writePrefs({ lastWorkspace: undefined, lastSprint: undefined, world: undefined })
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('muni:revealed:')) localStorage.removeItem(k)
  } catch {
    /* private mode */
  }
}
