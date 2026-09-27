/**
 * Joining a team from a shared invite QR or link: scan → sign in → request to join → wait for a
 * person to approve → continue to the sprint. The token lives in the URL fragment (never sent to a
 * server except in request bodies), and every step happens on this page so it isn't lost.
 *
 * This is membership only. The browser's own "use a passkey from your phone" QR is a different
 * thing, handled entirely by the browser during sign-in.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, get, post } from '@/api/client'
import type { JoinPreview, MyJoinRequest } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { Button, ErrorText, Spinner, useDocumentTitle } from '@/ui'
import { AuthFlow, EntranceShell, NameStep, PROGRESS, Step } from '@/ui/entrance'
import { LeaveDialog } from '@/ui/menus'

const destination = (r: { workspace_id?: string | null; sprint_id?: string | null }) => (r.sprint_id ? `/sprints/${r.sprint_id}` : r.workspace_id ? `/workspaces/${r.workspace_id}` : '/')

export function Join() {
  useDocumentTitle('Join a team')
  const { hash } = useLocation()
  const token = decodeURIComponent(hash.replace(/^#/, ''))
  const { me, refresh } = useAuth()
  const nav = useNavigate()
  const [preview, setPreview] = useState<JoinPreview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [progress, setProgress] = useState<number>(PROGRESS.start)
  const [requestId, setRequestId] = useState<string | null>(null)
  const load = useCallback(() => {
    setLoadError('')
    return post<JoinPreview>('/api/join/preview', { token })
      .then((p) => {
        setPreview(p)
        if (p.state === 'pending' && p.request_id) setRequestId(p.request_id)
      })
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 0 ? 'You’re offline. Joining a team needs a connection — try again when you’re back online.' : 'This invite couldn’t be checked just now.'))
  }, [token])
  useEffect(() => {
    void load()
  }, [load, me?.account_id])
  // Already in: straight on to where the code leads.
  useEffect(() => {
    if (me && preview?.state === 'member') nav(destination(preview), { replace: true })
  }, [me, preview, nav])

  let body
  if (!token || (preview && !preview.valid))
    body = (
      <Step describedBy="join-invalid" title="This invite code can’t be used." lead="It may have expired, reached its limit, or been turned off. Ask the person who shared it for a new one — or for an email invitation.">
        <p className="quiet mt-6">{me ? <Link to="/" className="entrance-link">Go to Muni</Link> : <>Already a member? <Link to="/signin" className="entrance-link">Sign in</Link></>}</p>
      </Step>
    )
  else if (loadError)
    body = (
      <Step describedBy="join-error" title="You’re invited to a team." lead={loadError}>
        <Button variant="primary" size="lg" className="mt-7 w-full" onClick={() => load()}>Try again</Button>
      </Step>
    )
  else if (!preview)
    body = (
      <div className="entrance-step grid place-items-center py-10 text-ink-soft" role="status" aria-label="Checking the invite">
        <Spinner />
      </div>
    )
  else if (!me)
    body = (
      <AuthFlow
        onProgress={setProgress}
        intro={{
          title: 'You’re invited to a team.',
          lead: preview.mode === 'direct'
            ? 'This personal link adds you to the team once you’re signed in with your passkey, or once you’ve created an account.'
            : 'Sign in with your passkey, or create an account. Anyone with this code can ask to join, so someone on the team approves each request.',
        }}
        onDone={async () => {
          await refresh()
        }}
      />
    )
  else if (me.needs_name) body = <NameStep onDone={async () => { await refresh() }} />
  else if (requestId) body = <Waiting requestId={requestId} onAgain={() => { setRequestId(null); void load() }} />
  else if (preview.state === 'member')
    body = (
      <div className="entrance-step grid place-items-center py-10 text-ink-soft" role="status" aria-label="Opening your team">
        <Spinner />
      </div>
    )
  else if (preview.state === 'full')
    body = (
      <Step describedBy="join-full" title="This invite code is full." lead="It has reached the number of requests it allows. Ask the person who shared it for a new one.">
        <p className="quiet mt-6"><Link to="/" className="entrance-link">Go to Muni</Link></p>
      </Step>
    )
  else body = <RequestStep token={token} preview={preview} onPending={setRequestId} onMember={(to) => nav(to, { replace: true })} onNeedsName={refresh} />

  return <EntranceShell progress={me ? (requestId ? PROGRESS.name : PROGRESS.done) : progress}>{body}</EntranceShell>
}

function RequestStep({ token, preview, onPending, onMember, onNeedsName }: { token: string; preview: JoinPreview; onPending: (id: string) => void; onMember: (to: string) => void; onNeedsName: () => Promise<unknown> }) {
  const { me } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)
  if (!me) return null
  const ask = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await post<{ state: 'pending' | 'member'; request_id?: string; workspace_id?: string; sprint_id?: string | null }>('/api/join/request', { token })
      if (r.state === 'member') onMember(destination(r))
      else if (r.request_id) onPending(r.request_id)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'name_required') await onNeedsName()
      else setError(e instanceof ApiError && e.status === 0 ? 'You’re offline. Nothing was sent — try again when you’re connected.' : e instanceof ApiError ? sentence(e.message) : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step
      describedBy="join-ask"
      title={<>Join {preview.workspace_name || 'this team'}?</>}
      lead={
        preview.mode === 'direct' ? (
          <>You’ll join as <strong className="font-medium text-[var(--e-ink)]">{me.display_name}</strong>. This personal link works once.</>
        ) : (
          <>You’ll ask as <strong className="font-medium text-[var(--e-ink)]">{me.display_name}</strong>{me.email ? <> (<span className="email-line">{me.email}</span>)</> : null}. Whoever approves sees your name{me.email ? ' and email address' : ''} and how new your account is — they may check with you that it’s really you.</>
        )
      }
    >
      {preview.includes_sprint ? <p className="quiet mt-4">{preview.mode === 'direct' ? 'You’ll also join one of the team’s sprints.' : 'This code also adds you to one of the team’s sprints once you’re approved.'}</p> : null}
      <p className="quiet mt-2">Your thoughts and votes are shown to teammates without your name.</p>
      <ErrorText>{error}</ErrorText>
      <Button variant="primary" size="lg" className="mt-6 w-full" busy={busy} onClick={ask} autoFocus>{preview.mode === 'direct' ? 'Join the team' : 'Request to join'}</Button>
      <p className="quiet mt-4">
        Not you, or want another account? <button type="button" className="entrance-link" onClick={() => setLeaving(true)}>Switch account</button>
      </p>
      <LeaveDialog kind={leaving ? 'signout' : null} stay onClose={() => setLeaving(false)} />
    </Step>
  )
}

/** Checks after 5 s, then less and less often (up to once a minute), for half an hour; again on focus or on request. */
const DELAYS = [5, 5, 10, 15, 30, 45, 60]
const GIVE_UP_MS = 30 * 60_000

/** The requester's waiting state, from the join page or from home (a request made earlier). */
export function Waiting({ requestId, onAgain }: { requestId: string; onAgain?: () => void }) {
  const { refresh } = useAuth()
  const nav = useNavigate()
  const [req, setReq] = useState<MyJoinRequest | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [paused, setPaused] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const tries = useRef(0)
  const started = useRef(Date.now())
  const timer = useRef<number | undefined>(undefined)
  const again = useRef<() => void>(() => {})

  const check = useCallback(async () => {
    window.clearTimeout(timer.current)
    setChecking(true)
    try {
      const r = await get<MyJoinRequest>(`/api/join-requests/${requestId}`)
      setReq(r)
      setError('')
      if (r.status === 'approved') await refresh()
      if (r.status !== 'pending') return
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? 'You’re offline — Muni will check again when you’re back.' : 'Couldn’t check just now.')
    } finally {
      setChecking(false)
    }
    // Bounded: slower over time, and stops after a while (the page still checks on focus).
    if (Date.now() - started.current > GIVE_UP_MS) return setPaused(true)
    const delay = DELAYS[Math.min(tries.current++, DELAYS.length - 1)] * 1000
    timer.current = window.setTimeout(() => {
      if (!document.hidden) again.current()
    }, delay)
  }, [requestId, refresh])
  useEffect(() => {
    again.current = () => void check()
  }, [check])

  useEffect(() => {
    void check()
    const wake = () => {
      if (document.hidden) return
      started.current = Date.now()
      tries.current = 0
      setPaused(false)
      void check()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      window.clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [check])

  if (!req)
    return (
      <div className="entrance-step grid place-items-center py-10 text-ink-soft" role="status" aria-label="Checking your request">
        {error ? <ErrorText>{error}</ErrorText> : <Spinner />}
      </div>
    )
  if (req.status === 'approved')
    return (
      <Step describedBy="join-in" title="You’re in." lead={<>You’ve joined {req.workspace_name}.{req.workspace_id ? null : ' Your access has since changed — ask the team if that’s unexpected.'}</>}>
        <p className="quiet mt-4">Encrypted sprints also need your encryption key on this device. Muni shows what to do when you open one; teammates’ devices share the sprint’s key with you once you’re a participant.</p>
        {req.workspace_id ? (
          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => nav(destination(req), { replace: true })} autoFocus>Continue</Button>
        ) : (
          <p className="quiet mt-6"><Link to="/" className="entrance-link">Go to Muni</Link></p>
        )}
      </Step>
    )
  if (req.status !== 'pending') {
    const text = {
      declined: { title: 'Your request wasn’t approved.', lead: 'If you think that’s a mistake, ask the person who shared the code.' },
      withdrawn: { title: 'You withdrew your request.', lead: 'You can ask again with the same code while it’s still active.' },
      expired: { title: 'This request expired.', lead: 'Nobody decided on it in time. You can ask again while the code is still active.' },
    }[req.status]
    return (
      <Step describedBy="join-closed" title={text.title} lead={text.lead}>
        {req.status !== 'declined' && onAgain ? <Button variant="primary" size="lg" className="mt-7 w-full" onClick={onAgain}>Ask again</Button> : null}
        <p className="quiet mt-6"><Link to="/" className="entrance-link">Go to Muni</Link></p>
      </Step>
    )
  }
  return (
    <Step
      describedBy="join-wait"
      title="Waiting for approval."
      lead={<>Your request to join <strong className="font-medium text-[var(--e-ink)]">{req.workspace_name}</strong> is with the people who manage it. You can close this page — you’ll see the answer here or on Muni’s home.</>}
    >
      <div className="entrance-wait" role="status" aria-live="polite">
        <i aria-hidden />
        <span>{paused ? 'Paused checking. Come back to this page, or check now.' : checking ? 'Checking…' : 'Waiting for someone on the team.'}</span>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button size="lg" className="mt-5 w-full" busy={checking} onClick={() => { started.current = Date.now(); tries.current = 0; setPaused(false); void check() }}>Check now</Button>
      <p className="quiet mt-4">
        <button
          type="button"
          className="entrance-link"
          disabled={withdrawing}
          onClick={async () => {
            setWithdrawing(true)
            try {
              await post(`/api/join-requests/${requestId}/withdraw`)
              await check()
              await refresh()
            } catch (e) {
              setError(e instanceof ApiError && e.status === 0 ? 'You’re offline, so the request is still open.' : 'Couldn’t withdraw it just now.')
            } finally {
              setWithdrawing(false)
            }
          }}
        >
          Withdraw request
        </button>
      </p>
    </Step>
  )
}

/** A request made earlier, opened from home: no token needed to see how it's going. */
export function JoinStatus() {
  useDocumentTitle('Your request')
  const { requestId = '' } = useParams()
  return (
    <EntranceShell progress={PROGRESS.name}>
      <Waiting requestId={requestId} />
    </EntranceShell>
  )
}

function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
