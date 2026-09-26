/** Per-device conveniences only. Nothing here is a credential or a draft of sensitive text. */
const KEY = 'muni.prefs'
type Prefs = { lastWorkspace?: string; lastSprint?: string; theme?: 'light' | 'dark' | 'system'; companionFollow?: boolean }

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
