/**
 * The worlds' CSS, checked as text: every world declares the same complete palette for light and
 * dark, keeps Muni's semantic colours, stays readable (WCAG AA), and styles only Muni's own
 * classes (never Tailwind utilities, whose hover and focus states must keep working).
 */
import { describe, expect, it } from 'vitest'
import worldsCss from './worlds.css?raw'
import stylesCss from '../styles.css?raw'
import { AVATAR_IDS, CHARACTERS } from './characters'

const css = worldsCss.replace(/\/\*[\s\S]*?\*\//g, '')
const base = stylesCss.replace(/\/\*[\s\S]*?\*\//g, '')

function block(src: string, selectorStart: string): Record<string, string> {
  const i = src.indexOf(selectorStart)
  if (i < 0) throw new Error(`no block ${selectorStart}`)
  const body = src.slice(src.indexOf('{', i) + 1, src.indexOf('}', i))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}
const tokens = (id: string, dark: boolean) => block(css, dark ? `:root.dark[data-world='${id}']` : `:root[data-world='${id}']`)
const muni = { light: block(base, ':root {'), dark: block(base, '.dark {') }

function lum(hex: string) {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const hex = (v: string | undefined, name: string) => {
  if (!v || !/^#[0-9a-f]{3,6}$/i.test(v)) throw new Error(`${name} is not a hex colour: ${v}`)
  return v
}

describe.each(AVATAR_IDS)('the %s world', (id) => {
  it('declares one complete palette for light and dark (no light value leaks into dark)', () => {
    expect(Object.keys(tokens(id, true)).sort()).toEqual(Object.keys(tokens(id, false)).sort())
    const required = ['--paper', '--card', '--card-2', '--ink', '--ink-soft', '--ink-faint', '--line', '--line-strong', '--accent', '--accent-soft', '--accent-ink', '--action', '--action-ink', '--font-world-display', '--font-world-em', '--font-world-meta']
    for (const t of required) expect(tokens(id, false), t).toHaveProperty(t)
  })

  it('never re-dresses what a colour means (status, categories, ok/warn/danger)', () => {
    for (const dark of [false, true]) for (const k of Object.keys(tokens(id, dark))) expect(k).not.toMatch(/^--(ok|warn|danger|status|status-ink|cat-.*)$/)
  })

  it.each([false, true])('is readable (dark: %s)', (dark) => {
    const t = tokens(id, dark)
    const m = dark ? muni.dark : muni.light
    const paper = hex(t['--paper'], '--paper')
    const card = hex(t['--card'], '--card')
    for (const [fg, min] of [['--ink', 4.5], ['--ink-soft', 4.5], ['--ink-faint', 4.5], ['--accent-ink', 4.5]] as const)
      for (const bg of [paper, card]) expect(ratio(hex(t[fg], fg), bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min)
    expect(ratio(hex(t['--action-ink'], '--action-ink'), hex(t['--action'], '--action')), 'button text').toBeGreaterThanOrEqual(4.5)
    // The focus ring and the state dots are graphics: 3:1.
    expect(ratio(hex(t['--accent'], '--accent'), paper), 'focus ring').toBeGreaterThanOrEqual(3)
    expect(ratio(hex(m['--status'], '--status'), paper), 'status dot').toBeGreaterThanOrEqual(3)
    // Muni's semantic colours, as text on this world's paper.
    for (const k of ['--status-ink', '--warn', '--danger', '--cat-proud', '--cat-keep', '--cat-improve', '--cat-stop', '--cat-try'])
      expect(ratio(hex(m[k], k), paper), `${k} on paper`).toBeGreaterThanOrEqual(4.5)
    // "Unsorted" is never a label, only the filter's marker dot.
    expect(ratio(hex(m['--cat-unsorted'], '--cat-unsorted'), paper), 'unsorted marker').toBeGreaterThanOrEqual(3)
  })

  it('tells the browser the same page colour it paints', () => {
    expect(tokens(id, false)['--paper']).toBe(CHARACTERS[id].themeColor.light)
    expect(tokens(id, true)['--paper']).toBe(CHARACTERS[id].themeColor.dark)
  })
})

describe('the worlds’ composition rules', () => {
  const scoped = [...css.matchAll(/@scope \(\[data-world='(\w+)'\]\) to \(\[data-world\]:not\(\[data-world='(\w+)'\]\)\) \{([\s\S]*?)\n\}/g)]
  it('are written for each world, in @scope, stopping at any other world (a preview inside the page)', () => {
    // A world may have more than one block (its room, then its sprint bar, then its phone layout).
    expect([...new Set(scoped.map((m) => m[1]))].sort()).toEqual([...AVATAR_IDS].sort())
    for (const m of scoped) expect(m[2]).toBe(m[1])
  })
  it('style only Muni’s own classes, never Tailwind utilities', () => {
    const own = /^(room|passage|passages|mine|w|app|cat|period|mark|dark|sbar|sprint|kape|guhit|biyahe|bola|pahina|himig|porma|sibol)(-|$)/
    for (const [, id, , body] of scoped) {
      const selectors = body.replace(/\{[^{}]*\}/g, '{}').split('{}').map((s: string) => s.replace(/@(media|container|supports)[^{]*\{/g, '').trim()).filter(Boolean)
      for (const sel of selectors) for (const cls of sel.match(/\.[\w-]+/g) ?? []) expect(cls.slice(1), `${id}: ${sel}`).toMatch(own)
    }
  })
})
