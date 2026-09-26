import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { get } from '@/api/client'
import type { CaptureTarget, SprintSummary } from '@/api/types'
import { readPrefs, writePrefs } from '@/lib/prefs'
import { EmptyState, Select, Spinner, useDocumentTitle } from '@/ui'
import { CaptureComposer, MyThoughts } from '@/ui/capture'
import { AppShell } from '@/ui/shell'

/**
 * /capture — the bookmarkable place to write. Resolves the destination
 * sprint itself: the last one used if it's still collecting, otherwise the
 * single collecting sprint, otherwise a compact selector.
 */
export function Capture() {
  useDocumentTitle('Capture')
  const [params] = useSearchParams()
  const [target, setTarget] = useState<CaptureTarget | null>(null)
  const [chosen, setChosen] = useState<string | null>(params.get('sprint') ?? readPrefs().lastSprint ?? null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    get<CaptureTarget>('/api/me/capture-target').then(setTarget).catch(() => setTarget({ collecting: [], upcoming: [] }))
  }, [])
  if (!target)
    return (
      <AppShell>
        <div className="grid place-items-center py-20 text-ink-soft"><Spinner /></div>
      </AppShell>
    )
  const options = target.collecting
  const sprint: SprintSummary | undefined = options.find((s) => s.id === chosen) ?? (options.length === 1 ? options[0] : undefined)
  if (sprint && sprint.id !== readPrefs().lastSprint) writePrefs({ lastSprint: sprint.id, lastWorkspace: sprint.workspace_id })
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        {options.length > 1 ? (
          <div className="mb-4 flex items-center gap-3">
            <label htmlFor="dest" className="text-sm text-ink-soft">Saving to</label>
            <Select id="dest" value={sprint?.id ?? ''} onChange={(e) => setChosen(e.target.value)} className="max-w-xs">
              {!sprint ? <option value="">Choose a sprint…</option> : null}
              {options.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
        {sprint ? (
          <>
            <CaptureComposer sprintId={sprint.id} sprintName={sprint.name} onSaved={() => setTick((t) => t + 1)} />
            <p className="mt-3 text-sm text-ink-soft">
              Retro {sprint.retro_local}. <Link className="underline" to={`/sprints/${sprint.id}`}>Open the sprint</Link>
            </p>
            <div className="mt-8">
              <MyThoughts sprintId={sprint.id} refreshKey={tick} editable />
            </div>
          </>
        ) : options.length === 0 ? (
          <EmptyState title="No sprint is collecting right now">
            {target.upcoming.length ? (
              <span>
                {target.upcoming[0].status === 'live' ? 'A retro is live — ' : 'The next retro is being prepared — '}
                <Link className="underline" to={target.upcoming[0].status === 'live' ? `/sprints/${target.upcoming[0].id}/room` : `/sprints/${target.upcoming[0].id}`}>open {target.upcoming[0].name}</Link>.
              </span>
            ) : (
              <span>When a facilitator opens a sprint for collection, this page becomes the place to write. <Link className="underline" to="/">Back to home</Link>.</span>
            )}
          </EmptyState>
        ) : null}
      </div>
    </AppShell>
  )
}
