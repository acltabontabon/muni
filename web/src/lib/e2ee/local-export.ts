/**
 * Summaries for encrypted sprints, written on this device from what it has decrypted. The server
 * can't build them (it can't read the content). Same rules as the server's exports: no authors,
 * no timestamps, no individual votes; raw notes only on explicit request.
 */
import type { Experiment, GroupingView, SprintDetail } from '@/api/types'
import { categoryMeta, OUTCOME_LABEL } from '@/lib/categories'
import { isLocked } from './keyring'

const text = (s: string | null | undefined) => (s && !isLocked(s) ? s : s ? '[not readable on this device]' : '')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sprint'
/** Neutralises spreadsheet formula injection, as the server does. */
const csvSafe = (s: string) => {
  const t = s.replace(/[\r\n]+/g, ' ')
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
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

/** A starting point for the recap, from the meeting record. Everything stays editable. */
export function recapDraft(s: SprintDetail, g: GroupingView | null, exps: Experiment[]): string {
  const discussed = (g?.themes ?? []).filter((t) => t.takeaway || t.discussed)
  let out = `# ${s.name} — retro recap\n\n`
  if (discussed.length) out += `We talked about ${discussed.map((t) => text(t.title)).join(', ')}.\n\n` + discussed.filter((t) => t.takeaway).map((t) => `- ${text(t.title)}: ${text(t.takeaway)}`).join('\n') + '\n\n'
  const agreed = exps.filter((e) => e.status !== 'proposed')
  out += agreed.length ? `We agreed to try:\n\n${agreed.map((e) => `- ${text(e.change_to_try)}${e.owner_name ? ` (${e.owner_name})` : ''} — we’ll know by: ${text(e.success_signal)}; revisit ${e.review_on}`).join('\n')}\n` : 'No experiments this time.\n'
  return out
}

export function download(name: string, body: string, type = 'text/markdown') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export const fileName = (s: SprintDetail, kind: string, ext: string) => `${slug(s.name)}-${kind}.${ext}`
