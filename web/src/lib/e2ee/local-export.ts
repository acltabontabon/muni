/**
 * Summaries for encrypted sprints, written on this device from what it has decrypted. The server
 * can't build them (it can't read the content). Same rules as the server's exports: no authors,
 * no timestamps, no individual votes; raw notes only on explicit request. Also the recap's first
 * draft, for every sprint.
 */
import type { Experiment, GroupingView, SprintDetail } from '@/api/types'
import { categoryMeta, OUTCOME_LABEL } from '@/lib/categories'
import { shortDate } from '@/lib/schedule'
import { isLocked } from './keyring'

const text = (s: string | null | undefined) => (s && !isLocked(s) ? s : s ? '[not readable on this device]' : '')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sprint'
/** Neutralises spreadsheet formula injection, as the server does. */
const csvSafe = (s: string) => {
  const t = s.replace(/[\r\n]+/g, ' ')
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
}
/**
 * Text as the end of a sentence: a full stop only if it doesn't already end with one (or with ?, !
 * or …, perhaps inside a closing quote or bracket). "Who owns staging?" stays as written.
 */
export const endSentence = (s: string) => (/[.?!…]["'”’)\]]*$/.test(s.trimEnd()) ? s.trimEnd() : `${s.trimEnd()}.`)
/** Titles in a sentence, as written: "A, B and C" — no comma straight after a title ending in ? or !. */
export function listTitles(titles: string[]): string {
  const asks = (t: string) => /[?!]["'”’)\]]*$/.test(t)
  return titles.map((t, i) => (i === 0 ? t : `${i === titles.length - 1 ? ' and ' : asks(titles[i - 1]) ? ' ' : ', '}${t}`)).join('')
}
const csvRow = (cells: string[]) => cells.map((c) => `"${csvSafe(c).replace(/"/g, '""')}"`).join(',') + '\r\n'

export function summaryMarkdown(s: SprintDetail, g: GroupingView | null, exps: Experiment[], recap: string | null): string {
  let out = `# ${s.name} — retro summary\n\n`
  const agreed = exps.filter((e) => e.status !== 'proposed')
  out += `## Experiments\n\n`
  out += agreed.length ? agreed.map((e) => `- **${text(e.change_to_try)}** — signal: ${text(e.success_signal)}; revisit ${e.review_on}${e.owner_name ? `; owner ${e.owner_name}` : ''}; ${OUTCOME_LABEL[e.status] ?? e.status}${e.outcome_note ? ` — ${text(e.outcome_note)}` : ''}`).join('\n') + '\n\n' : '_None agreed._\n\n'
  if (g?.themes.length) {
    out += `## Themes\n\n`
    for (const t of g.themes) out += `### ${text(t.title)}\n\n${t.summary ? `${text(t.summary)}\n\n` : ''}${t.takeaway ? `Takeaway: ${text(t.takeaway)}\n\n` : ''}${t.entry_count} thoughts${typeof t.votes === 'number' ? ` · ${t.votes} votes in total` : ''}\n\n`
  }
  if (recap) out += `## Recap\n\n${text(recap)}\n`
  return out
}

export function summaryCsv(g: GroupingView | null): string {
  let out = csvRow(['theme', 'summary', 'entries', 'votes', 'parked', 'needs_attention'])
  for (const t of g?.themes ?? []) out += csvRow([text(t.title), text(t.summary), String(t.entry_count), typeof t.votes === 'number' ? String(t.votes) : '', t.parked ? 'yes' : 'no', t.needs_attention ? 'yes' : 'no'])
  return out
}

export function rawMarkdown(s: SprintDetail, g: GroupingView | null): string {
  let out = `# ${s.name} — raw notes\n\nAnonymous, in the order they were revealed.\n\n`
  const all = [...(g?.themes ?? []).map((t) => ({ title: text(t.title), entries: t.entries })), { title: 'Not grouped', entries: g?.ungrouped ?? [] }]
  for (const group of all) {
    if (!group.entries.length) continue
    out += `## ${group.title}\n\n`
    for (const e of group.entries) out += `- ${e.category ? `[${categoryMeta(e.category).label}] ` : ''}${text(e.body)}${e.impact ? ` — impact: ${text(e.impact)}` : ''}${e.might_help ? ` — might help: ${text(e.might_help)}` : ''}\n`
    out += '\n'
  }
  return out
}

/** Someone's words inside Muni's own Markdown: nothing in them changes how it reads (lib/markdown.ts). */
const md = (s: string) => s.replace(/[\\`*_[\]]/g, '\\$&')

/**
 * A starting point for the recap, from the retro's record — written on this device for every sprint,
 * and saved only when the facilitator saves it. Markdown the recap page shows as it reads here:
 * a heading, what was talked about, what the room kept, what the team will try (numbered, each
 * with its owner) and what wasn't reached. Everything stays editable.
 */
export function recapDraft(s: SprintDetail, g: GroupingView | null, exps: Experiment[]): string {
  const themes = (g?.themes ?? []).filter((t) => !t.parked)
  const discussed = themes.filter((t) => t.discussed || t.takeaway || t.could_try)
  let out = `# ${md(s.name)} — retro recap\n\n`
  if (s.goal) out += `Sprint goal: ${md(s.goal)}\n\n`
  if (discussed.length) {
    out += `${md(endSentence(`We talked about ${listTitles(discussed.map((t) => text(t.title)))}`))}\n\n`
    const kept = discussed.filter((t) => t.takeaway || t.could_try)
    if (kept.length) out += `## What we’ll remember\n\n${kept.map((t) => `- **${md(text(t.title))}:** ${[t.takeaway ? md(endSentence(text(t.takeaway))) : '', t.could_try ? `We could try: ${md(endSentence(text(t.could_try)))}` : ''].filter(Boolean).join(' ')}`).join('\n')}\n\n`
  }
  if (exps.length) {
    const owner = (e: Experiment) => (!e.owner_name ? 'No owner yet.' : e.owner_accepted ? `Owner: ${md(e.owner_name)}.` : `Waiting for ${md(e.owner_name)} to say yes.`)
    out += `## What we’ll try\n\n${exps.map((e, i) => `${i + 1}. **${md(text(e.change_to_try))}** — we’ll know it helped if ${md(endSentence(text(e.success_signal)))} ${owner(e)} Back on ${shortDate(e.review_on)}.`).join('\n')}\n\n`
  } else out += 'No experiments this time.\n\n'
  const missed = discussed.length ? themes.filter((t) => !discussed.includes(t)) : []
  if (missed.length) out += `## Not reached\n\n${missed.map((t) => `- ${md(text(t.title))}`).join('\n')}\n\n`
  return out.trimEnd() + '\n'
}

export function download(name: string, body: string, type = 'text/markdown') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export const fileName = (s: SprintDetail, kind: string, ext: string) => `${slug(s.name)}-${kind}.${ext}`
