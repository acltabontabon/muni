/**
 * CHANGELOG.md, read the same way everywhere it's used: the app's What's new (web/vite.config.ts),
 * release validation and the GitHub release notes (scripts/release.mjs). No dependencies.
 *
 * The format is deliberately small — Keep a Changelog, minus what Muni doesn't use:
 *
 *   ## [Unreleased]                      notes for the next release; never shown in the app
 *   ## [1.2.0] - 2026-11-03              a release: its version and date (YYYY-MM-DD)
 *   One or more paragraphs introducing it.
 *   ### Highlights                       sections of bullets; any title
 *   - **A short lead.** Then the detail. Bullets may wrap onto indented lines.
 *
 * Inline text supports **bold**, *emphasis* and [links](https://…). HTML comments are dropped,
 * so maintainer notes can sit in the file without ever reaching the app or a release.
 */

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/

/** Whether a version is a prerelease (1.0.0-rc.1), per semver. */
export const isPrerelease = (v) => SEMVER.exec(v)?.[4] !== undefined

/**
 * @typedef {{ t: 'text' | 'strong' | 'em', v: string } | { t: 'link', v: string, href: string }} Span
 * @typedef {{ title: string, items: Span[][] }} Section
 * @typedef {{ version: string, date: string | null, prerelease: boolean, intro: Span[][], sections: Section[], markdown: string }} Release
 */

/** Parses the changelog. `unreleased` holds the Unreleased section's markdown (maybe empty). */
export function parseChangelog(text) {
  const src = text.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  const lines = src.split('\n')
  /** @type {Release[]} */
  const releases = []
  let unreleased = null
  let current = null
  let body = []
  const close = () => {
    if (!current) return
    const markdown = body.join('\n').replace(/^\n+|\s+$/g, '')
    if (current === 'unreleased') unreleased = markdown
    else releases.push({ ...current, ...parseBody(markdown), markdown })
    body = []
  }
  for (const line of lines) {
    const h = /^## \[([^\]]+)\](?:\s+-\s+(\S+))?\s*$/.exec(line)
    if (h) {
      close()
      if (h[1].toLowerCase() === 'unreleased') current = 'unreleased'
      else {
        if (!SEMVER.test(h[1])) throw new Error(`CHANGELOG.md: “${h[1]}” isn’t a semantic version`)
        if (!h[2] || !/^\d{4}-\d{2}-\d{2}$/.test(h[2]) || Number.isNaN(Date.parse(`${h[2]}T00:00:00Z`))) throw new Error(`CHANGELOG.md: ${h[1]} needs a release date as YYYY-MM-DD`)
        if (releases.some((r) => r.version === h[1])) throw new Error(`CHANGELOG.md: ${h[1]} appears twice`)
        current = { version: h[1], date: h[2], prerelease: isPrerelease(h[1]) }
      }
      continue
    }
    if (/^## /.test(line)) throw new Error(`CHANGELOG.md: unexpected heading “${line}” (releases are “## [x.y.z] - YYYY-MM-DD”)`)
    // Link reference definitions ([1.0.0]: https://…) are for GitHub's rendering only.
    if (/^\[[^\]]+\]:\s+\S+/.test(line)) continue
    if (current) body.push(line)
  }
  close()
  return { unreleased: unreleased ?? '', releases }
}

/** One release's body: intro paragraphs, then ### sections of bullets. */
function parseBody(md) {
  const intro = []
  const sections = []
  let para = []
  let section = null
  let item = null
  const endPara = () => {
    if (para.length) intro.push(inline(para.join(' ')))
    para = []
  }
  const endItem = () => {
    if (item && section) section.items.push(inline(item.join(' ')))
    item = null
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    const h = /^### (.+)$/.exec(line)
    if (h) {
      endPara()
      endItem()
      section = { title: h[1].trim(), items: [] }
      sections.push(section)
      continue
    }
    const b = /^[-*] (.+)$/.exec(line)
    if (b) {
      if (!section) throw new Error('CHANGELOG.md: a bullet needs a “### Section” heading above it')
      endItem()
      item = [b[1].trim()]
      continue
    }
    if (!line.trim()) {
      endPara()
      endItem()
      continue
    }
    if (item && /^\s+\S/.test(raw)) item.push(line.trim())
    else if (!section) para.push(line.trim())
    else throw new Error(`CHANGELOG.md: text under “### ${section.title}” must be a bullet: “${line.trim()}”`)
  }
  endPara()
  endItem()
  return { intro, sections }
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
