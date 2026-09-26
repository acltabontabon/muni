import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { post, ApiError } from '@/api/client'
import type { InvitationPreview } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { Button, ErrorText, Spinner, useDocumentTitle } from '@/ui'
import { AuthFlow, EntranceShell, JoinDoors, NameStep, PROGRESS, Step } from '@/ui/entrance'
import { LeaveDialog } from '@/ui/menus'

/**
 * An invitation, inside the entrance. The token never leaves the page except in request bodies,
 * so every step (email, code, name, join) happens here without navigating away and losing it.
 */
export function Invite() {
  useDocumentTitle('Invitation')
  // New links carry the token in the fragment (/invite#…), which the browser never sends to a server;
  // /invite/:token still opens. Either way it goes to the API in a request body, not a URL.
  const { token: pathToken = '' } = useParams()
  const { hash } = useLocation()
  const token = pathToken || decodeURIComponent(hash.replace(/^#/, ''))
  const { me, refresh } = useAuth()
  const nav = useNavigate()
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [progress, setProgress] = useState<number>(PROGRESS.email)
  const [intent, setIntent] = useState<'signin' | 'create' | null>(null)
  const load = useCallback(() => {
    setLoadError('')
    return post<InvitationPreview>('/api/invitations/preview', { token })
      .then(setPreview)
      .catch((e) => setLoadError(e instanceof ApiError && e.status === 0 ? 'You’re offline, so this invitation can’t be checked yet.' : 'This invitation couldn’t be checked just now.'))
  }, [token])
  useEffect(() => {
    load()
  }, [load, me])

  let body
  if (loadError)
    body = (
      <Step describedBy="inv-error" title="You’re invited." lead={loadError}>
        <Button variant="primary" size="lg" className="mt-7 w-full" onClick={() => load()}>Try again</Button>
      </Step>
    )
  else if (!preview)
    body = (
      <div className="entrance-step grid place-items-center py-10 text-ink-soft" role="status" aria-label="Checking the invitation">
        <Spinner />
      </div>
    )
  else if (!preview.valid)
    body = (
      <Step describedBy="inv-invalid" title="This invitation can’t be used." lead="It may have expired, been used already, or been withdrawn. Ask the person who invited you to send a new one.">
        <p className="quiet mt-6">{me ? <Link to="/" className="entrance-link">Go to Muni</Link> : <>Already a member? <Link to="/signin" className="entrance-link">Sign in</Link></>}</p>
      </Step>
    )
  else if (!me && !intent)
    body = (
      <JoinDoors
        title="You’re invited."
        lead={<>This invitation is for <span className="email-line">{preview.email_hint}</span>. Already use Muni with that address? Sign in, so you join as you.</>}
        onChoose={setIntent}
      />
    )
  else if (!me)
    body = (
      <AuthFlow
        intent={intent ?? undefined}
        onProgress={setProgress}
        intro={{ title: intent === 'create' ? 'Create your account.' : 'Welcome back.', lead: <>This invitation is for <span className="email-line">{preview.email_hint}</span>. {intent === 'create' ? 'Enter that address — we’ll send a code to confirm it’s yours.' : 'Continue with a passkey, or enter that address for a code.'}</> }}
        onDone={async () => {
          await refresh()
        }}
      />
    )
  else if (!preview.matches_session) body = <WrongAccount hint={preview.email_hint ?? ''} email={me.email} />
  else if (me.needs_name) body = <NameStep onDone={async () => { setProgress(PROGRESS.done); await refresh() }} />
  else body = <Join token={token} workspace={preview.workspace_name ?? 'this workspace'} name={me.display_name} email={me.email} onJoined={(to) => nav(to, { replace: true })} onNeedsName={refresh} />

  return <EntranceShell progress={me && preview?.matches_session ? Math.max(progress, me.needs_name ? PROGRESS.name : PROGRESS.done) : progress}>{body}</EntranceShell>
}

function Join({ token, workspace, name, email, onJoined, onNeedsName }: { token: string; workspace: string; name: string; email: string; onJoined: (to: string) => void; onNeedsName: () => Promise<unknown> }) {
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const accept = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await post<{ workspace_id: string; sprint_id: string | null }>('/api/invitations/accept', { token })
      await refresh()
      onJoined(r.sprint_id ? `/sprints/${r.sprint_id}` : `/workspaces/${r.workspace_id}`)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'name_required') await onNeedsName()
      else setError(e instanceof ApiError && e.status === 0 ? 'You’re offline. Nothing changed — try again when you’re connected.' : e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Step
      describedBy="inv-join"
      title={<>Join {workspace}?</>}
      lead={<>You’ll join as <strong className="font-medium text-[var(--e-ink)]">{name}</strong> (<span className="email-line">{email}</span>).</>}
    >
      <p className="quiet mt-4">Your entries and votes are shown to teammates without your name.</p>
      <ErrorText>{error}</ErrorText>
      <Button variant="primary" size="lg" className="mt-6 w-full" busy={busy} onClick={accept} autoFocus>Join the workspace</Button>
    </Step>
  )
}

function WrongAccount({ hint, email }: { hint: string; email: string }) {
  const [leaving, setLeaving] = useState(false)
  return (
    <Step
      describedBy="inv-wrong"
      title="This invitation is for another address."
      lead={<>It was sent to <span className="email-line">{hint}</span>, and you’re signed in as <span className="email-line">{email}</span>. Forwarded invitations don’t work for other addresses.</>}
    >
      <Button variant="primary" size="lg" className="mt-7 w-full" onClick={() => setLeaving(true)}>Sign out and use that address</Button>
      <p className="quiet mt-4"><Link to="/" className="entrance-link">Stay signed in as {email}</Link></p>
      <LeaveDialog kind={leaving ? 'signout' : null} stay onClose={() => setLeaving(false)} />
    </Step>
  )
}
