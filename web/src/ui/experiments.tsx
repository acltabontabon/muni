import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, post } from '@/api/client'
import type { Participant } from '@/api/types'
import { Button, ErrorText, Help, Input, Label, Select, Textarea } from '@/ui'

/**
 * Adding an experiment: what the team will do differently, how it'll know it helped, and who owns
 * it. Wording that reads like an intention ("be better") gets a suggestion, never a wall: the
 * facilitator can sharpen it or keep it as written, because a room mid-retro must never be stuck.
 */
export function ExperimentEditor({ sprintId, participants, themes, defaultThemeId, defaultText, seed, existingCount, onSaved }: { sprintId: string; participants: Participant[]; themes: { id: string; title: string }[]; defaultThemeId?: string; defaultText?: string; /** An idea to start from ("Use this idea"): fills the change and its theme in place, keeping the rest of what's typed. */ seed?: { text: string; themeId: string } | null; existingCount: number; onSaved: () => void }) {
  const [change, setChange] = useState(seed?.text ?? defaultText ?? '')
  const [signal, setSignal] = useState('')
  const [owner, setOwner] = useState('')
  const [review, setReview] = useState('')
  const [theme, setTheme] = useState(seed?.themeId ?? defaultThemeId ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [override, setOverride] = useState(false)
  /** The suggestion shown for the wording that's in the box now; saving again keeps it as written. */
  const [nudged, setNudged] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const [seeded, setSeeded] = useState(seed)
  if (seed !== seeded) {
    setSeeded(seed)
    if (seed) {
      setChange(seed.text)
      setTheme(seed.themeId)
    }
  }
  useEffect(() => {
    const el = box.current
    if (!seed || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [seed])
  const nudge = nudged !== null && nudged === change ? vague(change) : null
  const fromTheme = themes.find((t) => t.id === theme)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    // The same check the server runs for unencrypted sprints; for encrypted ones only this device can read the text.
    const keepAsWritten = nudged === change
    if (!keepAsWritten && vague(change)) return setNudged(change)
    setBusy(true)
    try {
      await post(`/api/sprints/${sprintId}/experiments`, { change_to_try: change, success_signal: signal, owner_account_id: owner || undefined, review_on: review || undefined, theme_id: theme || undefined, override_limit: override || undefined, accept_vague: keepAsWritten || undefined })
      setChange('')
      setSignal('')
      setOwner('')
      setReview('')
      setTheme('')
      setOverride(false)
      setNudged(null)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'vague') setNudged(change)
      // Only "three is plenty" can be overridden. The hard limit of ten, or a sprint whose retro
      // hasn't started, are 409s too: offering "Add it anyway" for those could never work.
      else if (softLimit(err)) {
        setOverride(true)
        setError(err.message)
      } else {
        setOverride(false)
        setError(err instanceof ApiError ? (err.status === 0 ? 'You’re offline, so it wasn’t added. It’s still here.' : err.message) : 'Couldn’t add it — try again.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="card exp-form" aria-labelledby="exp-form-title">
      <div className="exp-form-head">
        <h3 id="exp-form-title" className="font-display text-lg">{existingCount ? 'Add another experiment' : 'Add an experiment'}</h3>
        {fromTheme ? (
          <p className="exp-form-from">
            From “{fromTheme.title}”
            <button type="button" className="exp-form-clear" onClick={() => setTheme('')} aria-label="Don’t link it to this theme">×</button>
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="ex-change">What will the team do differently?</Label>
        <Textarea id="ex-change" ref={box} rows={2} autoFocus={!!defaultText} value={change} onChange={(e) => setChange(e.target.value)} placeholder="For the next sprint, review open PRs for 15 minutes right after standup." maxLength={500} required aria-describedby="ex-change-help" />
        {nudge ? (
          <div id="ex-change-help" className="exp-nudge" role="status">
            <p><strong>This reads more like a hope than a change.</strong> What will someone actually do, and when? For example: “For the next sprint, review open PRs for 15 minutes right after standup.”</p>
            <p>Sharpen it above, or add it as it is and refine it later.</p>
          </div>
        ) : (
          <Help className="mt-1"><span id="ex-change-help">Small and specific, with a when — something the team could start on Monday.</span></Help>
        )}
      </div>
      <div>
        <Label htmlFor="ex-signal">How will we know it helped?</Label>
        <Input id="ex-signal" value={signal} onChange={(e) => setSignal(e.target.value)} placeholder="PRs wait less than a day for a first review." maxLength={300} required />
      </div>
      <div className="exp-form-row">
        <div>
          <Label htmlFor="ex-owner">Who will own it?</Label>
          <Select id="ex-owner" value={owner} onChange={(e) => setOwner(e.target.value)} aria-describedby="ex-owner-help">
            <option value="">Decide later</option>
            {participants.map((p) => (
              <option key={p.account_id} value={p.account_id}>{p.display_name}</option>
            ))}
          </Select>
          <Help className="mt-1"><span id="ex-owner-help">They’re asked on their phone to say yes.</span></Help>
        </div>
        <div>
          <Label htmlFor="ex-review">Look at it again on</Label>
          <Input id="ex-review" type="date" value={review} onChange={(e) => setReview(e.target.value)} aria-describedby="ex-review-help" />
          <Help className="mt-1"><span id="ex-review-help">Leave empty for the next retro.</span></Help>
        </div>
        {themes.length && !fromTheme ? (
          <div>
            <Label htmlFor="ex-theme">Came from</Label>
            <Select id="ex-theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="">No particular theme</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="exp-form-foot">
        <Button type="submit" variant="primary" busy={busy}>{nudge ? 'Add it as it is' : override ? 'Add it anyway' : 'Add experiment'}</Button>
        <span>{owner ? 'It’s proposed until they say yes.' : 'You can choose an owner now or later.'}</span>
      </div>
    </form>
  )
}

/** The server's "three experiments is plenty — confirm to continue": the one limit the facilitator may go past. */
export function softLimit(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 409 && (err.code === 'experiment_limit' || /three experiments/i.test(err.message))
}

export function vague(change: string): string | null {
  const c = change.toLowerCase()
  const generic = ['communicate better', 'be more careful', 'try harder', 'improve communication', 'work better together', 'be better', 'do better', 'more transparency']
  if (generic.some((g) => c.includes(g)) || c.trim().split(/\s+/).length < 4) return 'That reads as an intention rather than a change.'
  return null
}
