/** Split text into plain runs and web links, so links in someone's own thought can be followed. */
export type Run = { text: string; href?: string }

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi
// Punctuation that usually ends a sentence rather than a URL.
const TRAILING = /[.,;:!?)\]}’”'"]$/

export function splitLinks(text: string): Run[] {
  const out: Run[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0]
    // Drop trailing punctuation one character at a time, keeping a ")" that closes a "(" inside
    // the URL (wiki-style links).
    while (TRAILING.test(url)) {
      const last = url[url.length - 1]
      if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break
      url = url.slice(0, -1)
    }
    const start = m.index ?? 0
    if (start > last) out.push({ text: text.slice(last, start) })
    try {
      const u = new URL(url)
      out.push(u.protocol === 'http:' || u.protocol === 'https:' ? { text: url, href: u.href } : { text: url })
    } catch {
      out.push({ text: url })
    }
    last = start + url.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
