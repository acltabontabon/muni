import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, type Block, type Inline } from './markdown'

/** The text a reader sees, with the shape marked: **strong**, _em_, [link](href), ⏎ for a line break. */
const show = (c: Inline[]): string => c.map((n) => (n.t === 'text' ? n.v : n.t === 'br' ? '⏎' : n.t === 'code' ? `\`${n.v}\`` : n.t === 'strong' ? `**${show(n.c)}**` : n.t === 'em' ? `_${show(n.c)}_` : `[${show(n.c)}](${n.href})`)).join('')
const outline = (b: Block[]) => b.map((x) => (x.t === 'hr' ? 'hr' : x.t === 'h' ? `h${x.level} ${show(x.c)}` : x.t === 'p' ? `p ${show(x.c)}` : `${x.t}${x.t === 'ol' && x.start !== 1 ? `@${x.start}` : ''} ${x.items.map(show).join(' | ')}`))

describe('recap Markdown', () => {
  it('shows what Muni’s own drafts are made of', () => {
    const md = '# Sprint 14 — retro recap\n\n## Topics discussed\n\n### Reviews that wait\n\n**Takeaway:** keep twenty minutes after standup\n\n_No theme was marked as discussed._\n\n- **Pair on reviews** — success signal: PRs wait less than a day. (owner: Ana)\n- Parked one\n'
    expect(outline(parseMarkdown(md))).toEqual([
      'h3 Sprint 14 — retro recap',
      'h3 Topics discussed',
      'h4 Reviews that wait',
      'p **Takeaway:** keep twenty minutes after standup',
      'p _No theme was marked as discussed._',
      'ul **Pair on reviews** — success signal: PRs wait less than a day. (owner: Ana) | Parked one',
    ])
  })

  it('numbered lines are a list, a lone dash is nothing, and --- is a rule', () => {
    expect(outline(parseMarkdown('We agreed:\n1. Pair on reviews\n2. Name a staging owner\n-\n---\n#### Later\n3) Keep going'))).toEqual([
      'p We agreed:',
      'ol Pair on reviews | Name a staging owner',
      'hr',
      'h4 Later',
      'ol@3 Keep going',
    ])
  })

  it('keeps each line of a paragraph on its own line, and indented lines with their item', () => {
    expect(outline(parseMarkdown('Dear team,\nthank you.\n\n- One\n  still one\n- Two'))).toEqual(['p Dear team,⏎thank you.', 'ul One⏎still one | Two'])
  })

  it('bold, italics and code, nested or not; snake_case and lone stars stay as written', () => {
    expect(show(parseInline('**bold _and em_** then *em **and bold***'))).toBe('**bold _and em_** then _em **and bold**_')
    expect(show(parseInline('snake_case_name, 5 * 3 = 15, a ** b'))).toBe('snake_case_name, 5 * 3 = 15, a ** b')
    expect(show(parseInline('`**not bold**` and \\*escaped\\*'))).toBe('`**not bold**` and *escaped*')
    expect(show(parseInline('***both***'))).toBe('**_both_**')
  })

  it('follows only web links; anything else stays text', () => {
    expect(show(parseInline('See [the runbook](https://example.com/run) or https://example.com/b.'))).toBe('See [the runbook](https://example.com/run) or [https://example.com/b](https://example.com/b).')
    expect(show(parseInline('[click](javascript:alert(1)) and [mail](mailto:a@b.c)'))).toBe('click and mail')
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }])
  })

  it('a heading marker without words, or a hashtag, isn’t a heading', () => {
    expect(outline(parseMarkdown('#\n#hashtag\n####'))).toEqual(['p #hashtag'])
  })
})

describe('a line full of marks that never close', () => {
  it.each(['*a ', '_a ', '*a _b '])('stays quick to show, and reads as written: %s', (marks) => {
    const line = marks.repeat(6000)
    const t0 = performance.now()
    const out = parseInline(line)
    expect(performance.now() - t0).toBeLessThan(250)
    expect(out.every((n) => n.t === 'text')).toBe(true)
    expect(out.map((n) => (n.t === 'text' ? n.v : '')).join('')).toBe(line)
  })

  it('keeps later searches independent around code, escapes and longer runs', () => {
    expect(parseInline('___```__`')).toEqual([
      { t: 'text', v: '_' },
      { t: 'strong', c: [{ t: 'text', v: '```' }] },
      { t: 'text', v: '`' },
    ])
    expect(parseInline('(****a *****__b_a_')).toEqual([
      { t: 'text', v: '(****a ' },
      { t: 'strong', c: [{ t: 'text', v: '*' }] },
      { t: 'text', v: '_' },
      { t: 'em', c: [{ t: 'text', v: 'b_a' }] },
    ])
    expect(show(parseInline('\\*a *b* and \\_c _d_'))).toBe('*a _b_ and _c _d_')
  })
})
