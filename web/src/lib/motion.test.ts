/**
 * Runaway work, guarded: nothing decorative may animate forever. An endless loop keeps a phone
 * drawing frames (and warm) for as long as the page is open, even when nobody is looking at it.
 * Only indicators that exist while something is actually in progress may repeat.
 */
import { describe, expect, it } from 'vitest'
import stylesCss from '../styles.css?raw'
import worldsCss from '../worlds/worlds.css?raw'

// Shown only while its state lasts: a join request waiting.
const WHILE_BUSY = ['.entrance-wait i']

function infinite(css: string) {
  const out: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/animation[^;]*\binfinite\b/.test(m[2])) out.push(m[1].trim().split('\n').pop()!.trim())
  }
  return out
}

describe('motion', () => {
  it('has no endless decorative animation', () => {
    const loops = [...infinite(stylesCss), ...infinite(worldsCss)]
    expect(loops.filter((sel) => !WHILE_BUSY.includes(sel))).toEqual([])
  })

  it('lets the evening scene come to rest', () => {
    for (const sel of ['.scene-duyan', '.scene-tsinelas', '.scene-crown', '.scene-birds', '.scene-thought', '.scene-glints rect', '.dark .scene-stars circle', '.dark .scene-fireflies g']) {
      const rule = stylesCss.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
      expect(rule, sel).not.toBeNull()
      expect(rule![1], sel).toMatch(/animation:[^;]*\b\d+(\.\d+)?\s+(alternate\s+)?(forwards|both)/)
    }
  })

  it('never animates under a filter in the scene', () => {
    expect(stylesCss).not.toMatch(/\.scene-[\w-]+[^{]*\{[^}]*animation[^}]*filter:\s*drop-shadow/)
  })
})
