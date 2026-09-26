/** Markdown and CSV exports: summary by default, raw notes explicit. No authorship, timestamps, or per-person votes. Bounded sizes. */
import { Hono } from 'hono'
import { isEncrypted } from '../lib/sealed'
import { AppError } from '../lib/errors'
import type { HonoEnv } from '../env'
import { config } from '../lib/config'
import { requireParticipant, requireSprint, type SprintCtx } from '../lib/auth'
import { one } from '../lib/db'
import { conflict, forbidden } from '../lib/errors'
import { generateRecap, listFor } from './commitments'
import { grouping } from './themes'

export const exportsRoutes = new Hono<HonoEnv>()

function check(ctx: SprintCtx, raw: boolean) {
  requireParticipant(ctx)
  // The server can't read an encrypted sprint, so it can't write its summary: the client builds it.
  if (isEncrypted(ctx.sprint)) throw new AppError(409, 'encrypted_export', 'this sprint is encrypted, so its summary is built on your device')
  if (['draft', 'collecting'].includes(ctx.sprint.status)) throw conflict('exports are available once collection has closed')
  if (raw && !ctx.isFacilitator) throw forbidden('raw-note export is a facilitator action')
}

/** Neutralises spreadsheet formula injection. */
export function csvSafe(s: string): string {
  const t = s.replace(/[\r\n]+/g, ' ')
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t
}
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`
const csvRow = (cells: string[]) => cells.map(csvCell).join(',') + '\r\n'
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

exportsRoutes.get('/api/sprints/:sprintId/export.md', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  const raw = c.req.query('scope') === 'raw'
  check(ctx, raw)
  const db = c.env.DB
  let out = await generateRecap(db, ctx)
  const published = await one<{ body: string }>(db, 'SELECT body FROM recaps WHERE sprint_id = ? AND published_at IS NOT NULL', ctx.sprint.id)
  if (published) out = published.body + '\n\n'
  out += '## Themes\n\n'
  const g = await grouping(c.env, ctx)
  for (const t of g.themes) {
    out += `### ${t.title}${t.parked ? ' (parked)' : ''}\n\n${t.summary ? `${t.summary}\n\n` : ''}${t.entry_count} entries${t.votes !== null ? ` · ${t.votes} votes` : ''}\n\n`
    if (raw) {
      for (const e of t.entries) {
        out += `- [${e.category ?? 'unsorted'}] ${e.body}\n`
        if (e.impact) out += `  - Impact: ${e.impact}\n`
        if (e.might_help) out += `  - Might help: ${e.might_help}\n`
      }
      for (const x of t.context) out += `- (added during the retro) ${x.body}\n`
      out += '\n'
    }
  }
  if (raw && g.ungrouped.length) {
    out += '### Ungrouped\n\n'
    for (const e of g.ungrouped) out += `- [${e.category ?? 'unsorted'}] ${e.body}\n`
    out += '\n'
  }
  out += '---\n_Exported from Muni. Entries are anonymous; this file contains no authorship or timing information._\n'
  return new Response(out, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${slug(ctx.sprint.name)}-retro.md"` } })
})

exportsRoutes.get('/api/sprints/:sprintId/export.csv', async (c) => {
  const ctx = await requireSprint(c, config(c.env), c.env.DB, c.req.param('sprintId'))
  const raw = c.req.query('scope') === 'raw'
  check(ctx, raw)
  const g = await grouping(c.env, ctx)
  let out = ''
  if (raw) {
    out += csvRow(['theme', 'category', 'observation', 'impact', 'might_help', 'period'])
    for (const t of g.themes) for (const e of t.entries) out += csvRow([csvSafe(t.title), e.category ?? 'unsorted', csvSafe(e.body), csvSafe(e.impact ?? ''), csvSafe(e.might_help ?? ''), e.period ?? ''])
    for (const e of g.ungrouped) out += csvRow(['', e.category ?? 'unsorted', csvSafe(e.body), csvSafe(e.impact ?? ''), csvSafe(e.might_help ?? ''), e.period ?? ''])
  } else {
    out += csvRow(['theme', 'summary', 'entries', 'votes', 'parked', 'needs_attention'])
    for (const t of g.themes) out += csvRow([csvSafe(t.title), csvSafe(t.summary), String(t.entry_count), t.votes === null ? '' : String(t.votes), String(t.parked), String(t.needs_attention)])
    out += csvRow(['', '', '', '', '', '']) + csvRow(['experiment', 'success_signal', 'owner', 'review_on', 'status', 'outcome'])
    for (const e of await listFor(c.env.DB, ctx.sprint.id)) out += csvRow([csvSafe(e.change_to_try), csvSafe(e.success_signal), csvSafe(e.owner_name ?? ''), e.review_on, e.status, csvSafe(e.outcome_note ?? '')])
  }
  return new Response(out, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${slug(ctx.sprint.name)}-retro.csv"` } })
})
