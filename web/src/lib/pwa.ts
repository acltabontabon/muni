/**
 * Installability and updates, as small shared state (no React needed to use it).
 *
 * Updates are never forced: a new service worker waits until the person chooses "Update", and the
 * UI only offers it at a safe moment (see UpdateNotice). A tab that did not ask for the update is
 * told another tab updated Muni, instead of being reloaded under someone's cursor.
 */
import { useSyncExternalStore } from 'react'

type State = {
  updateReady: boolean
  updatedElsewhere: boolean
  installable: boolean
  installed: boolean
  platform: 'ios' | 'android' | 'desktop'
  browser: 'safari' | 'firefox' | 'chromium' | 'other'
}
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const standalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
let state: State = {
  updateReady: false,
  updatedElsewhere: false,
  installable: false,
  installed: standalone(),
  platform: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop',
  browser: /Firefox\//.test(ua) ? 'firefox' : /Chrome\/|Chromium\/|Edg\//.test(ua) ? 'chromium' : /Safari\//.test(ua) ? 'safari' : 'other',
}
const listeners = new Set<() => void>()
const set = (p: Partial<State>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}
export const usePwa = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)

let deferred: InstallPrompt | null = null
let registration: ServiceWorkerRegistration | null = null
let requestedUpdate = false

export function initPwa() {
  if (typeof window === 'undefined') return
  // Capture the browser's install prompt so it only appears when the person asks for it.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPrompt
    set({ installable: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    set({ installable: false, installed: true })
  })
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  // An already-installed worker is registered at once (it serves this page); a first visit waits
  // until the page has loaded and gone idle, so installing — which downloads the whole app — never
  // competes with what the first screen is asking for.
  const register = () =>
    navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((reg) => {
      registration = reg
      const watch = (w: ServiceWorker | null) => {
        if (!w) return
        const check = () => w.state === 'installed' && navigator.serviceWorker.controller && set({ updateReady: true })
        check()
        w.addEventListener('statechange', check)
      }
      watch(reg.waiting)
      watch(reg.installing)
      reg.addEventListener('updatefound', () => watch(reg.installing))
      // Look for a new version when Muni comes back to the foreground (a small, cacheless fetch),
      // at most every quarter of an hour: a phone flicks between apps far more often than that.
      let checked = Date.now()
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - checked < 15 * 60_000) return
        checked = Date.now()
        reg.update().catch(() => {})
      })
    })
    .catch(() => {})
  if (navigator.serviceWorker.controller) register()
  else {
    // Safari has no requestIdleCallback: a short wait after load does the same job there.
    const later = () => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(() => register(), { timeout: 5000 }) : setTimeout(register, 2000))
    if (document.readyState === 'complete') later()
    else window.addEventListener('load', later, { once: true })
  }
  // The first worker taking control of a fresh visit is not an update; only a change of an
  // existing controller is.
  let hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (requestedUpdate) return window.location.reload()
    if (hadController) set({ updatedElsewhere: true, updateReady: false })
    hadController = true
  })
}

/** Activates the waiting version and reloads this tab. Call only at a safe moment. */
export function applyUpdate() {
  const w = registration?.waiting
  if (!w) return window.location.reload()
  requestedUpdate = true
  w.postMessage('muni:skip-waiting')
}

/** Shows the browser's install dialog when it offers one. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable'
  const d = deferred
  deferred = null
  set({ installable: false })
  await d.prompt()
  return (await d.userChoice).outcome
}

/** Plain instructions for browsers without a programmatic install prompt. */
export function installInstructions(s: State = state): string {
  if (s.platform === 'ios') return s.browser === 'safari' ? 'In Safari, tap Share, then “Add to Home Screen”.' : 'Open act.munimuni.app in Safari, tap Share, then “Add to Home Screen”. (Other browsers on iPhone and iPad can’t install apps.)'
  if (s.browser === 'safari') return 'In Safari on a Mac, choose File → “Add to Dock”.'
  if (s.browser === 'firefox') return s.platform === 'android' ? 'In Firefox, open the menu and choose “Install”.' : 'Firefox on desktop can’t install web apps. Use Chrome, Edge or Safari, or keep Muni as a bookmark.'
  if (s.browser === 'chromium') return 'Use the install icon at the right of the address bar, or the browser menu → “Install Muni”.'
  return 'Look for “Install” or “Add to Home Screen” in your browser’s menu.'
}
