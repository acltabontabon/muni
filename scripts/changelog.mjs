/**
 * CHANGELOG.md, read the same way everywhere it's used: the app's What's new (web/vite.config.ts),
 * release validation and the GitHub release notes (scripts/release.mjs). No dependencies.
 *
 * The file follows Keep a Changelog 1.1.0 (https://keepachangelog.com/en/1.1.0/) strictly, and this
 * parser refuses anything else, so a release can't publish a malformed entry:
 *
 *   ## [Unreleased]                      changes not released yet; never shown in the app
 *   ## [1.2.0] - 2026-11-03              a release: its semantic version and ISO date
 *   ### Added                            only Added, Changed, Deprecated, Removed, Fixed, Security —
 *   - **A short lead.** Then the detail.   in that order, each once, each with at least one bullet.
 *     Bullets may wrap onto indented lines.
 *   ...
 *   [unreleased]: https://github.com/…/compare/v1.2.0...HEAD
 *   [1.2.0]: https://github.com/…/releases/tag/v1.2.0
 *
 * Inline text supports **bold**, *emphasis* and [links](https://…). HTML comments are dropped, so
 * maintainer notes can sit in the file without reaching the app or a release.
 */

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

/** Keep a Changelog's types of change, in their conventional order. */
export const TYPES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']

/** Whether a version is a prerelease (1.0.0-rc.1), per semver. */
export const isPrerelease = (v) => SEMVER.exec(v)?.[4] !== undefined

/**
 * @typedef {{ t: 'text' | 'strong' | 'em', v: string } | { t: 'link', v: string, href: string }} Span
 * @typedef {{ title: string, items: Span[][] }} Section
 * @typedef {{ version: string, date: string, prerelease: boolean, sections: Section[], markdown: string }} Release
 */

/**
 * Parses the changelog. `unreleased` is the Unreleased entry's sections (maybe none); `links` maps
 * each lower-cased reference ("unreleased", "1.2.0") to its URL; `preamble` is the text above the
 * first entry.
 */
export function parseChangelog(text) {
  const src = text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  const lines = src.split('\n')
  /** @type {Release[]} */
  const releases = []
  /** @type {Record<string, string>} */
  const links = {}
  let unreleased = null
  let current = null
  let body = []
  const preamble = []
  const close = () => {
    if (!current) return
    const markdown = body.join('\n').replace(/^\n+|\s+$/g, '')
    const where = current === 'unreleased' ? 'Unreleased' : current.version
    const sections = parseBody(markdown, where)
    if (current === 'unreleased') unreleased = sections
    else {
      if (!sections.length) throw new Error(`CHANGELOG.md: ${where} lists no changes`)
      releases.push({ ...current, sections, markdown })
    }
    body = []
  }
  if (!/^# Changelog\s*$/m.test(src.split('\n## ')[0])) throw new Error('CHANGELOG.md: start with “# Changelog”')
  for (const line of lines) {
    const h = /^## \[([^\]]+)\](?:\s+-\s+(\S+))?\s*$/.exec(line)
    if (h) {
      close()
      if (h[1] === 'Unreleased') {
        if (unreleased !== null || releases.length) throw new Error('CHANGELOG.md: “## [Unreleased]” comes once, before every release')
        current = 'unreleased'
      } else {
        if (!SEMVER.test(h[1])) throw new Error(`CHANGELOG.md: “${h[1]}” isn’t a semantic version`)
        if (!h[2] || !/^\d{4}-\d{2}-\d{2}$/.test(h[2]) || Number.isNaN(Date.parse(`${h[2]}T00:00:00Z`))) throw new Error(`CHANGELOG.md: ${h[1]} needs a release date as YYYY-MM-DD (“## [${h[1]}] - 2026-01-31”)`)
        if (releases.some((r) => r.version === h[1])) throw new Error(`CHANGELOG.md: ${h[1]} appears twice`)
        current = { version: h[1], date: h[2], prerelease: isPrerelease(h[1]) }
      }
      continue
    }
    if (/^## /.test(line)) throw new Error(`CHANGELOG.md: unexpected heading “${line}” (entries are “## [Unreleased]” or “## [x.y.z] - YYYY-MM-DD”)`)
    const ref = /^\[([^\]]+)\]:\s+(\S+)\s*$/.exec(line)
    if (ref) {
      links[ref[1].toLowerCase()] = ref[2]
      continue
    }
    if (current) body.push(line)
    else preamble.push(line)
  }
  close()
  if (unreleased === null) throw new Error('CHANGELOG.md: keep a “## [Unreleased]” entry at the top')
  return { preamble: preamble.join('\n').trim(), unreleased, releases, links }
}

/** One entry's body: ### sections of the standard types, each a list of bullets, nothing else. */
function parseBody(md, where) {
  const sections = []
  let section = null
  let item = null
  const endItem = () => {
    if (item && section) section.items.push(inline(item.join(' ')))
    item = null
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    const h = /^### (.+)$/.exec(line)
    if (h) {
      endItem()
      if (section && !section.items.length) throw new Error(`CHANGELOG.md: ${where} has an empty “### ${section.title}”`)
      const title = h[1].trim()
      if (!TYPES.includes(title)) throw new Error(`CHANGELOG.md: ${where} has “### ${title}”; use ${TYPES.join(', ')}`)
      const last = sections.at(-1)
      if (last && TYPES.indexOf(title) <= TYPES.indexOf(last.title)) throw new Error(`CHANGELOG.md: ${where} lists “${title}” after “${last.title}”; keep the order ${TYPES.join(', ')}, each once`)
      section = { title, items: [] }
      sections.push(section)
      continue
    }
    const b = /^[-*] (.+)$/.exec(line)
    if (b) {
      if (!section) throw new Error(`CHANGELOG.md: ${where}: a change needs a “### Added” (or other type) heading above it`)
      endItem()
      item = [b[1].trim()]
      continue
    }
    if (!line.trim()) {
      endItem()
      continue
    }
    if (item && /^\s+\S/.test(raw)) item.push(line.trim())
    else throw new Error(`CHANGELOG.md: ${where}: every change is a bullet under a type heading, not free text: “${line.trim()}”`)
  }
  endItem()
  if (section && !section.items.length) throw new Error(`CHANGELOG.md: ${where} has an empty “### ${section.title}”`)
  return sections
}

/** **bold**, *emphasis* and [text](url) — links only to https or site-relative paths. */
export function inline(text) {
  /** @type {Span[]} */
  const out = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ t: 'strong', v: m[1] })
    else if (m[2] !== undefined) out.push({ t: 'em', v: m[2] })
    else {
      if (!/^(https:\/\/|\/(?!\/))/.test(m[4])) throw new Error(`CHANGELOG.md: link “${m[4]}” must be https:// or start with /`)
      out.push({ t: 'link', v: m[3], href: m[4] })
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) })
  return out
}

/** The spans back as one line of markdown (release notes: GitHub turns every newline into a break). */
export const markdown = (spans) => spans.map((s) => (s.t === 'strong' ? `**${s.v}**` : s.t === 'em' ? `*${s.v}*` : s.t === 'link' ? `[${s.v}](${s.href})` : s.v)).join('')

/** The spans as plain text (for titles, summaries and checks). */
export const plain = (spans) => spans.map((s) => s.v).join('')
