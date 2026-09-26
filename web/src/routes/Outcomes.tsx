import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Download } from 'lucide-react'
import { ApiError, get, patch, post, put } from '@/api/client'
import type { Experiment, Recap, SprintDetail } from '@/api/types'
import { OUTCOME_LABEL } from '@/lib/categories'
import { useLive } from '@/lib/live'
import { Badge, Button, EmptyState, Help, SectionTitle, Select, Spinner, Textarea, useDocumentTitle, useToast } from '@/ui'
import { AppShell, PageTitle } from '@/ui/shell'
import { ExperimentEditor } from '@/ui/experiments'
import { Postcard } from '@/ui/art'
import { shortDate } from '@/lib/schedule'
import type { GroupingView } from '@/api/types'
import { download, fileName, rawMarkdown, recapDraft, summaryCsv, summaryMarkdown } from '@/lib/e2ee/local-export'
import { EncryptionLine } from '@/ui/keys'

export function Outcomes() {
  const { sprintId = '' } = useParams()
  const toast = useToast()
  const [s, setS] = useState<SprintDetail | null>(null)
  const [exps, setExps] = useState<Experiment[]>([])
  const [recap, setRecap] = useState<Recap | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  useDocumentTitle(s ? `${s.name} · outcomes` : 'Outcomes')
  const load = useCallback(async () => {
    try {
      const [d, e, r] = await Promise.all([get<SprintDetail>(`/api/sprints/${sprintId}`), get<Experiment[]>(`/api/sprints/${sprintId}/experiments`), get<Recap>(`/api/sprints/${sprintId}/recap`)])
      setS(d)
      setExps(e)
      setRecap(r)
      setDraft((prev) => prev || r.body)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load')
    }
  }, [sprintId])
  useEffect(() => {
    load()
  }, [load])
  useLive(sprintId, () => load())
  if (error)
    return (
      <AppShell>
        <EmptyState title="Can’t open this">{error}</EmptyState>
      </AppShell>
    )
  if (!s || !recap)
    return (
      <AppShell>
        <div className="grid place-items-center py-20"><Spinner /></div>
      </AppShell>
    )
  const fac = s.is_facilitator
  const encrypted = s.encryption === 'e1'
  // Encrypted: exports and the recap draft are made here, from what this device decrypted.
  const themes = () => get<GroupingView>(`/api/sprints/${sprintId}/themes`).catch(() => null)
  const btn = 'inline-flex h-9 items-center gap-2 rounded-full border border-line bg-card px-3.5 text-sm'
  const meId = s.participants.find((p) => p.is_you)?.account_id
  return (
    <AppShell>
      {['completed', 'archived'].includes(s.status) ? <Postcard framing="wide" lights={4} className="mb-8 aspect-[3.2/1] w-full sm:aspect-[4.2/1]" /> : null}
      <PageTitle eyebrow={<Link to={`/sprints/${sprintId}`} className="hover:underline">{s.name}</Link>} title={<>What we’ll <em>try next</em></>} actions={
        <>
          {encrypted ? (
            <>
              <button className={btn} onClick={async () => download(fileName(s, 'summary', 'md'), summaryMarkdown(s, await themes(), exps, recap.exists ? recap.body : null))}><Download className="size-4" /> Summary (.md)</button>
              <button className={btn} onClick={async () => download(fileName(s, 'summary', 'csv'), summaryCsv(await themes()), 'text/csv')}><Download className="size-4" /> Summary (.csv)</button>
              {fac ? <button className={`${btn} border-dashed text-ink-soft`} onClick={async () => download(fileName(s, 'raw-notes', 'md'), rawMarkdown(s, await themes()))}>Raw notes (.md)</button> : null}
            </>
          ) : (
            <>
              <a className={btn} href={`/api/sprints/${sprintId}/export.md`} download><Download className="size-4" /> Summary (.md)</a>
              <a className={btn} href={`/api/sprints/${sprintId}/export.csv`} download><Download className="size-4" /> Summary (.csv)</a>
              {fac ? <a className={`${btn} border-dashed text-ink-soft`} href={`/api/sprints/${sprintId}/export.md?scope=raw`} download>Raw notes (.md)</a> : null}
            </>
          )}
        </>
      }>
        The changes the team agreed to, when to look back at them, and the recap. Exports never include who wrote what, when, or anyone’s votes.{encrypted ? ' This sprint’s files are made on your device; the downloaded files aren’t encrypted.' : ''}
        <span className="mt-1 block text-sm"><EncryptionLine encryption={s.encryption} /></span>
      </PageTitle>
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <section>
          <SectionTitle aside={`${exps.filter((e) => e.status !== 'proposed').length} accepted`}>Experiments</SectionTitle>
          {exps.length === 0 ? <p className="text-ink-soft">No experiments were recorded for this sprint.</p> : null}
          <ul className="space-y-3">
            {exps.map((e) => (
              <li key={e.id} className="rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--line)]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium leading-snug">{e.change_to_try}</p>
                  <Badge tone={e.status === 'helped' ? 'ok' : e.status === 'did_not_help' ? 'danger' : e.status === 'proposed' ? 'warn' : 'neutral'}>{OUTCOME_LABEL[e.status]}</Badge>
                </div>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm text-ink-soft sm:grid-cols-2">
                  <div><dt className="inline text-ink-faint">Signal: </dt><dd className="inline">{e.success_signal}</dd></div>
                  <div><dt className="inline text-ink-faint">Revisit: </dt><dd className="inline">{shortDate(e.review_on)}</dd></div>
                  <div><dt className="inline text-ink-faint">Owner: </dt><dd className="inline">{e.owner_name ? `${e.owner_name}${e.owner_accepted ? '' : ' (not yet accepted)'}` : 'nobody yet'}</dd></div>
                  {e.theme_title ? <div><dt className="inline text-ink-faint">From: </dt><dd className="inline">{e.theme_title}</dd></div> : null}
                </dl>
                {e.owner_account_id === meId && !e.owner_accepted ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="primary" onClick={async () => { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: true }); toast('You own this experiment'); load() }}>Accept ownership</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await post(`/api/sprints/${sprintId}/experiments/${e.id}/accept`, { accept: false }); load() }}>Not me</Button>
                  </div>
                ) : null}
                {(fac || e.owner_account_id === meId) && e.status !== 'proposed' ? <OutcomeForm e={e} sprintId={sprintId} onSaved={load} /> : null}
              </li>
            ))}
          </ul>
          {fac && ['live', 'completed', 'ready'].includes(s.status) ? (
            <div className="mt-4">
              <ExperimentEditor sprintId={sprintId} participants={s.participants} themes={[]} existingCount={exps.length} onSaved={load} />
            </div>
          ) : null}
        </section>
        <section>
          <SectionTitle aside={recap.published_at ? `published ${new Date(recap.published_at).toLocaleDateString()}` : fac ? 'draft — not yet published' : ''}>Recap</SectionTitle>
          {fac ? (
            <div className="card p-4">
              <Textarea rows={18} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-sm" aria-label="Recap (Markdown)" />
              <Help>Generated from the meeting record when you ask for a draft; everything here is editable. Publishing makes it visible to participants. Nothing is emailed automatically.</Help>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={async () => { if (encrypted) { setDraft(recapDraft(s, await themes(), exps)); toast('Draft written from the meeting record — save to keep it'); return } const r = await put<Recap>(`/api/sprints/${sprintId}/recap`, {}); setRecap(r); setDraft(r.body); toast('Draft regenerated from the meeting record') }}>{encrypted ? 'Draft from the meeting' : 'Regenerate draft'}</Button>
                <Button size="sm" onClick={async () => { const r = await put<Recap>(`/api/sprints/${sprintId}/recap`, { body: draft }); setRecap(r); toast('Saved') }}>Save</Button>
                <Button size="sm" variant="primary" onClick={async () => { const r = await put<Recap>(`/api/sprints/${sprintId}/recap`, { body: draft, publish: true }); setRecap(r); toast('Recap published to participants') }}>Publish</Button>
              </div>
            </div>
          ) : recap.exists ? (
            <pre className="card whitespace-pre-wrap p-5 font-sans text-[15px] leading-relaxed">{recap.body}</pre>
          ) : (
            <p className="text-ink-soft">The facilitator hasn’t published a recap yet.</p>
          )}
        </section>
      </div>
    </AppShell>
  )
}

function OutcomeForm({ e, sprintId, onSaved }: { e: Experiment; sprintId: string; onSaved: () => void }) {
  const [status, setStatus] = useState(e.status)
  const [note, setNote] = useState(e.outcome_note ?? '')
  const toast = useToast()
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
      onSubmit={async (ev) => {
        ev.preventDefault()
        await patch(`/api/sprints/${sprintId}/experiments/${e.id}`, { status: status === 'accepted' ? undefined : status, outcome_note: note })
        toast('Outcome saved')
        onSaved()
      }}
    >
      <div>
        <label className="block text-xs text-ink-soft" htmlFor={`st-${e.id}`}>What happened?</label>
        <Select id={`st-${e.id}`} value={status} onChange={(ev) => setStatus(ev.target.value)} className="h-9 py-1 text-sm">
          <option value="accepted">Still running</option>
          <option value="helped">Helped</option>
          <option value="did_not_help">Didn’t help</option>
          <option value="inconclusive">Inconclusive</option>
          <option value="not_tried">Not tried yet</option>
        </Select>
      </div>
      <div className="min-w-48 flex-1">
        <label className="block text-xs text-ink-soft" htmlFor={`nt-${e.id}`}>Short note</label>
        <input id={`nt-${e.id}`} className="h-9 w-full rounded-xl border border-line bg-card px-3 text-sm" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} placeholder="What did we learn, even if it failed?" />
      </div>
      <Button size="sm" type="submit">Save outcome</Button>
    </form>
  )
}
