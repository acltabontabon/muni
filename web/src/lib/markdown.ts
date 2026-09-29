/**
 * Markdown, lightly — the part a recap uses: headings, paragraphs (a line break stays a line
 * break), lists with - * + or 1., a rule (---), **bold**, _italic_, `code` and links. It becomes a
 * small tree the page renders with React, so nothing in it is ever raw HTML; only http(s) links
 * are followed (lib/text.ts), anything else stays text.
 */
import { splitLinks } from './text'

export type Inline = { t: 'text'; v: string } | { t: 'br' } | { t: 'code'; v: string } | { t: 'strong'; c: Inline[] } | { t: 'em'; c: Inline[] } | { t: 'link'; href: string; c: Inline[] }
export type Block = { t: 'h'; level: 3 | 4; c: Inline[] } | { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] } | { t: 'ol'; start: number; items: Inline[][] } | { t: 'hr' }

const HEADING = /^(#{1,6})(?:\s+(.*?))?\s*#*\s*$/
const RULE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const BULLET = /^[-*+](?:\s+(.*))?$/
const NUMBERED = /^(\d{1,9})[.)](?:\s+(.*))?$/

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { t: 'ul' | 'ol'; start: number; items: string[][] } | null = null
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', c: lines(para) })
    if (list) {
      // An item that was only a marker ("-" on its own line) says nothing: it's left out.
      const items = list.items.filter((l) => l.some((x) => x.trim())).map(lines)
      if (items.length) blocks.push(list.t === 'ul' ? { t: 'ul', items } : { t: 'ol', start: list.start, items })
    }
    para = []
    list = null
  }
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if (!line) flush()
    else if (RULE.test(line)) {
      flush()
      blocks.push({ t: 'hr' })
    } else if ((m = line.match(HEADING))) {
      flush()
      if (m[2]) blocks.push({ t: 'h', level: m[1].length <= 2 ? 3 : 4, c: parseInline(m[2]) })
    } else if ((m = line.match(BULLET)) || (m = line.match(NUMBERED))) {
      const numbered = m.length === 3 && /^\d/.test(line)
      const kind = numbered ? 'ol' : 'ul'
      if (para.length || (list && list.t !== kind)) flush()
      list ??= { t: kind, start: numbered ? Number(m[1]) : 1, items: [] }
      list.items.push([(numbered ? m[2] : m[1]) ?? ''])
    } else if (list && /^\s{2,}/.test(raw)) list.items[list.items.length - 1].push(line)
    else {
      if (list) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}

/** Lines of one paragraph or item: each keeps its own line. */
function lines(ls: string[]): Inline[] {
  const out: Inline[] = []
  ls.filter((l) => l.trim()).forEach((l, i) => {
    if (i) out.push({ t: 'br' })
    out.push(...parseInline(l))
  })
  return out
}

const WORD = /[\p{L}\p{N}]/u
const ESCAPABLE = /[\\`*_[\]()#+\-.!>~|{}]/

export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    for (const r of splitLinks(text)) out.push(r.href ? { t: 'link', href: r.href, c: [{ t: 'text', v: r.text }] } : { t: 'text', v: r.text })
    text = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\' && ESCAPABLE.test(s[i + 1] ?? '')) {
      text += s[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', v: s.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === '*' || ch === '_') {
      const mark = s[i + 1] === ch ? ch + ch : ch
      const after = s[i + mark.length]
      // Opens only before a word (and an underscore only at the start of one: snake_case stays as written).
      if (after && !/\s/.test(after) && (ch === '*' || !WORD.test(s[i - 1] ?? ''))) {
        const end = closing(s, i + mark.length, mark)
        if (end > 0) {
          flush()
          out.push({ t: mark.length === 2 ? 'strong' : 'em', c: parseInline(s.slice(i + mark.length, end)) })
          i = end + mark.length
          continue
        }
      }
    }
    if (ch === '[') {
      const m = s.slice(i).match(/^\[([^\]]+)\]\(\s*([^\s()]+(?:\([^\s()]*\))?[^\s()]*)\s*\)/)
      if (m) {
        flush()
        const href = web(m[2])
        if (href) out.push({ t: 'link', href, c: parseInline(m[1]) })
        else out.push(...parseInline(m[1]))
        i += m[0].length
        continue
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

/** Where `mark` closes, from `from`: after a non-space, and not in the middle of a longer run of it. */
function closing(s: string, from: number, mark: string): number {
  const ch = mark[0]
  for (let j = from + 1; j < s.length; j++) {
    if (s[j] === '\\') {
      j++
      continue
    }
    if (s[j] === '`') {
      const end = s.indexOf('`', j + 1)
      if (end > j) j = end
      continue
    }
    if (s[j] !== ch) continue
    let run = 1
    while (s[j + run] === ch) run++
    const fits = mark.length === 2 ? run >= 2 : run === 1 || run >= 3
    // In a longer run (***), this mark is its last characters: what's inside closes first.
    const at = run >= 3 ? j + run - mark.length : j
    if (fits && !/\s/.test(s[j - 1]) && (ch === '*' || !WORD.test(s[at + mark.length] ?? ''))) return at
    j += run - 1
  }
  return -1
}

function web(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}
