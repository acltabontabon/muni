/*
 * Before the first paint: light or dark as chosen on this device, and the signed-in person's
 * character world on their own pages. A classic script in <head> (CSP script-src 'self'), so the
 * page never flashes the wrong scheme or world while the app loads. The app takes over from here
 * (lib/prefs.ts applyAppearance). Reads only this device's preferences; sends nothing anywhere.
 */
;(function () {
  try {
    var p = JSON.parse(localStorage.getItem('muni.prefs') || '{}') || {}
    var root = document.documentElement
    var mode = p.theme || 'system'
    if (mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) root.classList.add('dark')
    // Personal pages only: shared pages and the sign-in never take someone's world.
    var path = location.pathname
    var personal = path === '/' || path === '/capture' || path === '/account' || /^\/sprints\/[^/]+\/?$/.test(path)
    var w = p.world
    var known = ['kape', 'guhit', 'biyahe', 'bola', 'pahina', 'himig', 'porma', 'sibol']
    if (personal && w && w.theme && known.indexOf(w.avatar) !== -1) root.setAttribute('data-world', w.avatar)
  } catch (e) {
    /* storage unavailable: the app applies the defaults */
  }
})()
