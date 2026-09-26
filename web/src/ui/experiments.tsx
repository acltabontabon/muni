import { useState, type FormEvent } from 'react'
import { ApiError, post } from '@/api/client'
import type { Participant } from '@/api/types'
import { Button, ErrorText, Help, Input, Label, Select } from '@/ui'

/**
 * "What will we try next?" — three short prompts, not a form. Vague
 * intentions are bounced by the server with a nudge toward a concrete change.
 */
export function ExperimentEditor({ sprintId, participants, themes, defaultThemeId, defaultText, existingCount, onSaved, compact }: { sprintId: string; participants: Participant[]; themes: { id: string; title: string }[]; defaultThemeId?: string; defaultText?: string; existingCount: number; onSaved: () => void; compact?: boolean }) {
  const [change, setChange] = useState(defaultText ?? '')
  const [signal, setSignal] = useState('')
  const [owner, setOwner] = useState('')
  const [review, setReview] = useState('')
  const [theme, setTheme] = useState(defaultThemeId ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [override, setOverride] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // The same check the server runs for legacy sprints; for encrypted ones only this device can read the text.
    const v = vague(change)
    if (v) return setError(v)
    setBusy(true)
    setError('')
    try {
      await post(`/api/sprints/${sprintId}/experiments`, { change_to_try: change, success_signal: signal, owner_account_id: owner || undefined, review_on: review || undefined, theme_id: theme || undefined, override_limit: override || undefined })
      setChange('')
      setSignal('')
      setOwner('')
      setReview('')
      setOverride(false)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && existingCount >= 3) {
        setOverride(true)
        setError(err.message)
      } else setError(err instanceof ApiError ? err.message : 'Couldn’t save')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className={compact ? 'space-y-3' : 'card space-y-3 p-4'}>
      {!compact ? <h3 className="font-display text-lg">What will we try next?</h3> : null}
      <div>
        <Label htmlFor="ex-change">What will we try? <span className="font-normal text-ink-faint">— a specific change, with a when</span></Label>
        <Input id="ex-change" value={change} onChange={(e) => setChange(e.target.value)} placeholder="For the next sprint, reserve a 15-minute daily review window after standup." maxLength={500} required />
      </div>
      <div>
        <Label htmlFor="ex-signal">How will we know it helped?</Label>
        <Input id="ex-signal" value={signal} onChange={(e) => setSignal(e.target.value)} placeholder="PRs wait less than a working day for a first review." maxLength={300} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="ex-owner">Who accepts responsibility?</Label>
          <Select id="ex-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Nominate later</option>
            {participants.map((p) => (
              <option key={p.account_id} value={p.account_id}>{p.display_name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ex-review">When do we revisit?</Label>
          <Input id="ex-review" type="date" value={review} onChange={(e) => setReview(e.target.value)} />
          <Help className="mt-1">Blank = next retro.</Help>
        </div>
        {themes.length ? (
          <div>
            <Label htmlFor="ex-theme">From theme</Label>
            <Select id="ex-theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="">—</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" busy={busy}>{override ? 'Add it anyway' : 'Propose this experiment'}</Button>
        <span className="text-xs text-ink-faint">The nominated owner accepts explicitly; until then it’s proposed.</span>
      </div>
    </form>
  )
}

function vague(change: string): string | null {
  const c = change.toLowerCase()
  const generic = ['communicate better', 'be more careful', 'try harder', 'improve communication', 'work better together', 'be better', 'do better', 'more transparency']
  if (generic.some((g) => c.includes(g)) || c.trim().split(/\s+/).length < 4) return 'That reads as an intention rather than a change. What will someone do differently, and when? For example: “For the next sprint, reserve a 15-minute daily review window; see whether PRs spend less time waiting.”'
  return null
}
