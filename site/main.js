/* Muni marketing site. No dependencies. Everything that moves is driven by
   scroll or by an element being on screen; nothing runs while it's hidden. */
;(() => {
  const root = document.documentElement
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  // WebKit flickers while an SVG filter on HTML animates; hold the water ripple still there.
  if (root.classList.contains('webkit')) document.querySelector('svg.defs')?.pauseAnimations()

  /* ── App link: "Coming soon" until data-app-url is set on <html>. ── */
  const appUrl = root.dataset.appUrl
  for (const a of document.querySelectorAll('.app-link')) {
    if (appUrl) a.href = appUrl
    else {
      a.classList.add('is-soon')
      a.removeAttribute('href')
      a.setAttribute('role', 'link')
      a.setAttribute('aria-disabled', 'true')
      a.textContent = a.dataset.soon || 'Coming soon'
    }
  }

  /* ── The sprint's thoughts: the demo team's 25, as the app stores them.
        [author, category, when in the sprint, theme] — authors exist only
        until the reveal, exactly as in the product. ─────────────────── */
  const PEOPLE = [
    ['A', '#6d5efc'], ['J', '#0e9f6e'], ['L', '#e0782f'], ['M', '#d9467a'],
    ['P', '#2f7fe0'], ['S', '#9a55e6'], ['T', '#c19a14'],
  ]
  const E = [
    [0, 'proud', 'late', null], [1, 'keep', 'middle', null], [2, 'improve', 'middle', 'review'],
    [3, 'improve', 'late', 'review'], [4, 'keep', 'late', null], [5, 'stop', 'early', 'planning'],
    [6, 'improve', 'middle', 'staging'], [0, 'try', 'early', 'planning'], [1, 'improve', 'late', 'planning'],
    [2, 'proud', 'early', null], [3, 'keep', null, null], [4, 'stop', 'middle', 'pipeline'],
    [5, 'improve', 'middle', 'review'], [6, 'try', null, 'review'], [0, 'improve', 'middle', 'staging'],
    [1, null, 'early', null], [2, 'keep', null, null], [3, 'try', null, null],
    [4, 'improve', 'early', 'planning'], [5, 'proud', 'late', null], [6, 'improve', null, 'planning'],
    [0, 'stop', 'early', null], [1, 'keep', 'late', 'review'], [2, 'improve', 'late', 'review'],
    [3, null, 'middle', 'tone'],
  ]
  const THEMES = [
    ['review', 'PR review turnaround', 'PRs sat waiting for review for two or three days.'],
    ['tone', 'Review comment tone', 'A comment in a PR review read as dismissive.'],
    ['planning', 'Planning and sprint goal clarity', 'I only understood the sprint goal at the demo.'],
    ['staging', 'Staging environment ownership', 'Staging was down most of Wednesday. Nobody knew who owned it.'],
    ['pipeline', 'Merging on a red pipeline', 'It happened twice and both times we had to revert.'],
    [null, 'Ungrouped', ''],
  ]
  const CAT = (c) => `var(--c-${c || 'none'})`

  // Deterministic randomness: the scene looks the same on every visit.
  let seed = 11
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

  const notes = E.map(([who, cat, when, theme], i) => {
    const span = when === 'early' ? [0, 3] : when === 'middle' ? [3, 7] : when === 'late' ? [6, 10] : [0, 10]
    const day = Math.min(9, Math.floor(span[0] + rand() * (span[1] - span[0])))
    return { i, who, cat, theme, day, t: (day + rand() * 0.9) / 10, jx: rand() - 0.5, rot: (rand() - 0.5) * 10, rot2: (rand() - 0.5) * 16, cx: rand(), cy: rand() }
  })
  // The reveal order: a shuffle unrelated to author or time.
  const order = notes.map((n) => n.i).map((i) => ({ i, k: rand() })).sort((a, b) => a.k - b.k).map((o) => o.i)

  /* ── Hero: thoughts dropping onto the water. ───────────────────── */
  const drops = document.querySelector('.drops')
  const hero = document.querySelector('.hero')
  let heroVisible = true
  if (drops && !reduced) {
    const cats = ['proud', 'keep', 'improve', 'stop', 'try', 'improve', 'keep']
    // A dozen thoughts land, then the water is still: nothing on the page moves forever.
    let left = 12
    const spawn = () => {
      if (left <= 0) return clearInterval(dropping)
      if (!heroVisible || document.hidden) return
      left--
      const d = document.createElement('span')
      d.className = 'drop'
      const x = 6 + Math.random() * 88
      const t = 3 + Math.random() * 1.4
      d.style.left = `${x}%`
      d.style.setProperty('--t', `${t}s`)
      d.style.setProperty('--from', `${34 + Math.random() * 16}vh`)
      d.style.setProperty('--sway', `${(Math.random() - 0.5) * 60}px`)
      d.style.setProperty('--r0', `${(Math.random() - 0.5) * 50}deg`)
      d.style.setProperty('--r1', `${(Math.random() - 0.5) * 30}deg`)
      d.style.setProperty('--cat', CAT(cats[Math.floor(Math.random() * cats.length)]))
      drops.appendChild(d)
      setTimeout(() => {
        for (const late of [false, true]) {
          const r = document.createElement('span')
          r.className = late ? 'ripple late' : 'ripple'
          r.style.left = `${x}%`
          drops.appendChild(r)
          setTimeout(() => r.remove(), 3000)
        }
      }, t * 940)
      setTimeout(() => d.remove(), t * 1000 + 100)
    }
    setTimeout(spawn, 900)
    const dropping = setInterval(spawn, 2600)
    new IntersectionObserver(([e]) => (heroVisible = e.isIntersecting)).observe(hero)
  }

  /* ── The scene ─────────────────────────────────────────────────── */
  const scene = document.querySelector('.scene')
  const field = scene.querySelector('.field')
  const notesEl = field.querySelector('.notes')
  const tilesEl = field.querySelector('.tiles')
  const axis = field.querySelector('.axis')
  const statusText = field.querySelector('.field-status-text')
  const lock = field.querySelector('.lock')
  const captions = [...scene.querySelectorAll('.caption')]
  const railTicks = [...scene.querySelectorAll('.rail i')]

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const daysEl = axis.querySelector('.axis-days')
  daysEl.innerHTML = dayNames.map((d) => `<span>${d}</span>`).join('')
  const daySpans = [...daysEl.children]

  const els = notes.map((n) => {
    const el = document.createElement('div')
    el.className = 'note'
    el.style.setProperty('--cat', CAT(n.cat))
    const [initial, color] = PEOPLE[n.who]
    el.innerHTML = `<i></i><i></i><i></i><span class="fold"></span><span class="seal"></span><span class="who" style="--who:${color}">${initial}</span>`
    notesEl.appendChild(el)
    return el
  })

  const tiles = THEMES.map(([key, title, excerpt]) => {
    const members = notes.filter((n) => n.theme === key)
    const cats = [...new Set(members.map((n) => n.cat).filter(Boolean))].slice(0, 3)
    const el = document.createElement('div')
    el.className = key ? 'tile' : 'tile ungrouped'
    const count = `${members.length} ${members.length === 1 ? 'thought' : 'thoughts'}`
    el.innerHTML = `<b>${key ? title : `${members.length} ungrouped`}</b><span>${key ? count : 'still readable on stage'}${key ? cats.map((c) => `<i style="--c:${CAT(c)}"></i>`).join('') : ''}</span>${excerpt ? `<q>${excerpt}</q>` : ''}`
    tilesEl.appendChild(el)
    return { key, el, members }
  })

  let L = null // layout, recomputed on resize
  const layout = () => {
    const W = field.clientWidth
    const H = field.clientHeight
    const small = W < 560
    const nw = Math.round(Math.max(26, Math.min(64, W / 15)))
    const nh = Math.round(nw * 0.72)
    field.style.setProperty('--nw', `${nw}px`)
    field.style.setProperty('--nh', `${nh}px`)
    const base = H * 0.92 - 44 // top of the axis
    const col = W / 10
    const stacks = new Array(10).fill(0)
    const A = notes.map((n) => {
      const k = stacks[n.day]++
      return { x: col * (n.day + 0.5) - nw / 2 + n.jx * col * 0.35, y: base - nh - 10 - k * nh * 0.66, r: n.rot }
    })
    // Revealed: an even, loose field in random order — position says nothing about who or when.
    const cols = small ? 5 : 7
    const rows = Math.ceil(notes.length / cols)
    const cw = (W * 0.92) / cols
    const rh = (H * 0.62) / rows
    const C = []
    order.forEach((idx, k) => {
      const n = notes[idx]
      const cx = k % cols
      const cy = Math.floor(k / cols)
      C[idx] = { x: W * 0.04 + cx * cw + cw / 2 - nw / 2 + (n.cx - 0.5) * cw * 0.35, y: H * 0.16 + cy * rh + (n.cy - 0.5) * rh * 0.3, r: n.rot2 }
    })
    // Themes: a stable 3×2 grid (2×3 on phones). Each theme's notes grow into sheets of paper
    // stacked under its tile, edges peeking out — the tile is literally made of its thoughts.
    // Ungrouped thoughts stay small and loose inside a dashed tile.
    const gc = small ? 2 : 3
    const gr = Math.ceil(tiles.length / gc)
    const gap = small ? 14 : 26
    const tw = Math.min((W - gap * (gc - 1)) / gc, 280)
    const th = small ? 86 : 118
    const gridW = tw * gc + gap * (gc - 1)
    const gridH = th * gr + (gap + 10) * (gr - 1)
    const ox = (W - gridW) / 2
    const oy = Math.max(H * 0.1, (H * 0.9 - gridH) / 2)
    const D = []
    const T = tiles.map((t, ti) => {
      const tx = ox + (ti % gc) * (tw + gap)
      const ty = oy + Math.floor(ti / gc) * (th + gap + 10)
      t.members.forEach((n, k) => {
        if (t.key) {
          const depth = Math.min(3, t.members.length - 1 - k)
          D[n.i] = { x: tx + depth * 5, y: ty + depth * 5, r: depth ? (k % 2 ? 0.9 : -1.1) * depth : 0, w: tw, h: th, z: 10 - depth }
        } else {
          const per = Math.max(1, Math.floor((tw - 24 - nw * 0.7) / (nw * 0.5)) + 1)
          D[n.i] = { x: tx + 12 + (k % per) * nw * 0.5, y: ty + th * 0.52 + Math.floor(k / per) * nh * 0.36, r: ((k * 37) % 9) - 4, w: nw * 0.7, h: nh * 0.7, z: 20 }
        }
      })
      return { x: tx, y: ty, w: tw, h: th }
    })
    L = { W, H, nw, nh, A, C, D, T }
    T.forEach((p, ti) => {
      const el = tiles[ti].el
      el.style.width = `${p.w}px`
      el.style.height = `${p.h}px`
      el.style.left = `${p.x}px`
      el.style.top = `${p.y}px`
    })
  }

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  const seg = (p, a, b) => clamp((p - a) / (b - a))
  const lerp = (a, b, t) => a + (b - a) * t
  const step = (t) => (reduced ? (t < 0.5 ? 0 : 1) : t)

  let lastStep = -1
  let lastSky = ''
  const themeColor = document.querySelector('meta[name="theme-color"]')
  const setSky = (sky) => {
    if (sky === lastSky) return
    lastSky = sky
    root.dataset.sky = sky
    // The browser's chrome follows once the sky has finished changing (read once, not every frame).
    clearTimeout(setSky.t)
    setSky.t = setTimeout(() => (themeColor.content = getComputedStyle(root).getPropertyValue('--bg').trim()), 950)
  }

  const renderScene = (p) => {
    if (!L) layout()
    const { A, C, D, nw, nh } = L
    // Phases of the scroll: the sprint plays, seals, opens, and gathers.
    const capture = seg(p, 0.02, 0.3)
    const seal = step(seg(p, 0.32, 0.4))
    const open = step(seg(p, 0.47, 0.62))
    const gather = step(seg(p, 0.7, 0.84))

    notes.forEach((n, i) => {
      const el = els[i]
      const stagger = (i % 7) * 0.04
      const o = ease(clamp(open * 1.25 - stagger))
      const g = ease(clamp(gather * 1.25 - ((order.indexOf(i) % 9) * 0.03)))
      // Dropping in, on its day of the sprint.
      const appear = reduced ? (capture >= n.t ? 1 : 0) : ease(clamp((capture - n.t) * 9))
      let x = lerp(A[i].x, C[i].x, o)
      let y = lerp(A[i].y - (1 - appear) * nh * 2.2, C[i].y, o)
      let r = lerp(A[i].r, C[i].r, o)
      x = lerp(x, D[i].x, g)
      y = lerp(y, D[i].y, g)
      r = lerp(r, D[i].r, g)
      const sealed = seal * (1 - o)
      const sy = 1 - sealed * 0.42
      const s = 1 + o * (1 - g) * 0.12
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(3)}, ${(s * sy).toFixed(3)})`
      el.style.width = `${lerp(nw, D[i].w, g).toFixed(1)}px`
      el.style.height = `${lerp(nh, D[i].h, g).toFixed(1)}px`
      el.style.opacity = String(appear)
      el.style.setProperty('--seal', sealed.toFixed(3))
      el.style.setProperty('--lines', ((1 - sealed) * (n.theme ? 1 - g : 1)).toFixed(3))
      el.style.setProperty('--whoOp', (1 - ease(clamp(open * 1.6))).toFixed(3))
      el.style.zIndex = String(g > 0.5 ? D[i].z : i)
    })

    // Days light up as the sprint passes; the axis leaves when time stops mattering.
    const today = Math.min(9, Math.floor(capture * 10))
    daySpans.forEach((d, k) => d.classList.toggle('now', k === today && capture < 1))
    axis.style.opacity = String(1 - open)

    tiles.forEach((t) => t.el.classList.toggle('on', gather > 0.85))

    const s = p < 0.31 ? 0 : p < 0.46 ? 1 : p < 0.69 ? 2 : 3
    if (s !== lastStep) {
      lastStep = s
      captions.forEach((c, k) => c.classList.toggle('on', k === s))
      railTicks.forEach((r, k) => r.classList.toggle('on', k === s))
    }
    const shown = notes.filter((n) => capture >= n.t).length
    statusText.textContent =
      s === 0 ? `Day ${today + 1} of 10 · ${shown} ${shown === 1 ? 'thought' : 'thoughts'} set down` :
      s === 1 ? '25 thoughts · sealed until collection closes' :
      s === 2 ? '25 thoughts · one batch, random order' :
      '25 thoughts · 5 themes · 10 ungrouped'
    lock.style.opacity = s === 1 ? '1' : '0.35'

    // The sky follows the sprint into the evening.
    setSky(p < 0.44 ? 'day' : p < 0.8 ? 'dusk' : 'night')
  }

  /* ── The room: a slight tilt that settles as it comes into view. ─ */
  const stage = document.querySelector('.stage')
  const renderStage = (r) => {
    const t = clamp(1 - (r.top - innerHeight * 0.15) / (innerHeight * 0.75))
    stage.style.setProperty('--tilt', `${((1 - t) * 10).toFixed(2)}deg`)
    stage.style.setProperty('--sc', (0.94 + t * 0.06).toFixed(4))
  }

  // A check-in: asked on everyone's phone, then shared — counts and lines, never names.
  const moment = document.querySelector('.moment')
  let stageVisible = false
  new IntersectionObserver(([e]) => (stageVisible = e.isIntersecting), { threshold: 0.3 }).observe(stage)
  if (!reduced && moment) {
    const turn = () => {
      const asked = moment.dataset.moment === 'asked'
      if (stageVisible && !document.hidden) moment.dataset.moment = asked ? 'shared' : 'asked'
      setTimeout(turn, moment.dataset.moment === 'asked' ? 2600 : 5600)
    }
    setTimeout(turn, 5600)
  }

  /* ── The problem, and the phone: each little scene plays once, as it comes into view. ─ */
  const scenes = [...document.querySelectorAll('.woe, .phone')]
  if (reduced) scenes.forEach((el) => el.classList.add('in', 'still'))
  else {
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.add('in')
          seen.unobserve(e.target)
        }
      },
      { threshold: 0.45 },
    )
    scenes.forEach((el) => seen.observe(el))
  }
  // The timer counts down from a deadline, like the real one.
  const timerEl = document.querySelector('[data-timer]')
  const deadline = Date.now() + (12 * 60 + 40) * 1000
  setInterval(() => {
    if (!stageVisible) return
    const s = Math.max(0, Math.round((deadline - Date.now()) / 1000))
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }, 1000)

  /* ── Agree: what the room will remember is written, then becomes an experiment. ─ */
  const exp = document.querySelector('.experiment')
  const typed = exp.querySelector('.typed')
  const full = typed.dataset.text
  new IntersectionObserver(
    ([e], obs) => {
      if (!e.isIntersecting) return
      obs.disconnect()
      if (reduced) return exp.classList.add('in')
      typed.textContent = ''
      exp.classList.add('typing')
      let k = 0
      const tick = () => {
        typed.textContent = full.slice(0, ++k)
        if (k < full.length) setTimeout(tick, 26 + Math.random() * 40)
        else setTimeout(() => { exp.classList.remove('typing'); exp.classList.add('in') }, 350)
      }
      setTimeout(tick, 300)
    },
    { threshold: 0.5 },
  ).observe(exp)

  /* ── Skies for everything outside the scene. ────────────────────── */
  const skied = [...document.querySelectorAll('main > section[data-sky], footer[data-sky]')]
  const skyAt = () => {
    const mid = innerHeight * 0.5
    for (const s of skied) {
      const r = s.getBoundingClientRect()
      if (r.top <= mid && r.bottom > mid) return s.dataset.sky
    }
    return null
  }

  /* ── One scroll loop for all of it. ─────────────────────────────── */
  let queued = false
  const frame = () => {
    queued = false
    // Every layout read first, then every write: one layout per frame, never a forced one.
    const r = scene.getBoundingClientRect()
    const sr = stage.getBoundingClientRect()
    const total = r.height - innerHeight
    const inScene = r.top <= innerHeight * 0.5 && r.bottom >= innerHeight * 0.5
    const sky = inScene ? null : skyAt()
    if (r.bottom > 0 && r.top < innerHeight) renderScene(clamp(-r.top / total))
    if (sky) setSky(sky)
    if (sr.bottom > 0 && sr.top < innerHeight) renderStage(sr)
  }
  const queue = () => {
    if (!queued) {
      queued = true
      requestAnimationFrame(frame)
    }
  }
  /* ── Both sides of one retro: the steps as tabs, played through once while on screen. ──
     Hover, focus or a click hands control to the reader; nothing runs while it's hidden. */
  const duo = document.querySelector('.duo')
  if (duo) {
    const tabs = [...duo.querySelectorAll('[role=tab]')]
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')))
    const DUR = 7000
    let at = 0, timer = 0, owned = 0, visible = false, held = false, stopped = reduced
    duo.style.setProperty('--dur', `${DUR}ms`)
    const show = (i, focus = false) => {
      at = (i + tabs.length) % tabs.length
      tabs.forEach((t, j) => {
        t.setAttribute('aria-selected', String(j === at))
        t.tabIndex = j === at ? 0 : -1
        panels[j].hidden = j !== at
        panels[j].classList.remove('owned')
      })
      clearTimeout(owned)
      // Agree: after a moment, the owner says yes on their phone and the stage says so.
      if (panels[at].querySelector('.ds-owner')) owned = setTimeout(() => panels[at].classList.add('owned'), reduced ? 0 : 2800)
      if (focus) tabs[at].focus()
      schedule()
    }
    const playing = () => visible && !held && !stopped
    // It plays through once, to the recap, and rests there: nothing on the page moves forever.
    const schedule = () => {
      clearTimeout(timer)
      if (at === tabs.length - 1) stopped = true
      duo.toggleAttribute('data-playing', playing())
      if (playing()) timer = setTimeout(() => show(at + 1), DUR)
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { stopped = true; show(i) })
      t.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
        if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); stopped = true; show(e.key === 'Home' ? 0 : tabs.length - 1, true) }
        else if (d) { e.preventDefault(); stopped = true; show(at + d, true) }
      })
    })
    const hold = (on) => () => { held = on; schedule() }
    duo.addEventListener('pointerenter', hold(true))
    duo.addEventListener('pointerleave', hold(false))
    duo.addEventListener('focusin', hold(true))
    duo.addEventListener('focusout', (e) => { if (!duo.contains(e.relatedTarget)) hold(false)() })
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; schedule() }, { threshold: 0.35 }).observe(duo)
    show(0)
  }

  addEventListener('scroll', queue, { passive: true })
  addEventListener('resize', () => { layout(); queue() })
  if (document.fonts) document.fonts.ready.then(() => { layout(); queue() })
  layout()
  frame()
})()
