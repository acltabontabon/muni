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
}

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

export function applyTheme(theme: Prefs['theme'] | undefined, force?: 'dark' | 'light') {
  const t = force ?? theme ?? 'system'
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
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
  writePrefs({ lastWorkspace: undefined, lastSprint: undefined })
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('muni:revealed:')) localStorage.removeItem(k)
  } catch {
    /* private mode */
  }
}
