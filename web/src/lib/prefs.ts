/** Per-device preferences only. Nothing here is a credential or the text of a thought. */
const KEY = 'muni.prefs'
type Prefs = {
  lastWorkspace?: string
  lastSprint?: string
  theme?: 'light' | 'dark' | 'system'
  companionFollow?: boolean
  /** The person chose to keep drafts and unsent thoughts on this device (IndexedDB). */
  keepLocal?: boolean
  /** The install hint was dismissed; never shown again unprompted. */
  installHintDismissed?: boolean
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
