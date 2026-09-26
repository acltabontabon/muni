import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { post, ApiError } from '@/api/client'
import type { InvitationPreview } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { Mark } from '@/brand/Mark'
import { Button, ErrorText, Spinner, useDocumentTitle } from '@/ui'
import { CodeSignIn } from './SignIn'
import { LeaveDialog } from '@/ui/menus'

export function Invite() {
  useDocumentTitle('Invitation')
  // New links carry the token in the fragment (/invite#…), which the browser never sends to a server;
  // /invite/:token still opens. Either way it goes to the API in a request body, not a URL.
  const { token: pathToken = '' } = useParams()
  const { hash } = useLocation()
  const token = pathToken || decodeURIComponent(hash.replace(/^#/, ''))
  const { me, refresh } = useAuth()
  const [leaving, setLeaving] = useState(false)
  const nav = useNavigate()
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => post<InvitationPreview>('/api/invitations/preview', { token }).then(setPreview).catch((e) => setError(e.message)), [token])
  useEffect(() => {
    load()
  }, [load, me])

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await post<{ workspace_id: string; sprint_id: string | null }>('/api/invitations/accept', { token })
      await refresh()
      nav(r.sprint_id ? `/sprints/${r.sprint_id}` : `/workspaces/${r.workspace_id}`, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Mark size={56} className="mx-auto text-ink" />
          <h1 className="font-display mt-4 text-2xl">You’re invited.</h1>
        </div>
        <div className="card p-6">
          {!preview ? (
            <div className="text-center text-ink-soft"><Spinner /></div>
          ) : !preview.valid ? (
            <p className="text-ink-soft">This invitation isn’t valid any more. It may have expired, been used, or been withdrawn. Ask whoever invited you for a new one.</p>
          ) : preview.matches_session && me ? (
            <div className="space-y-4">
              <p>
                Join <strong>{preview.workspace_name}</strong> as <strong>{me.email}</strong>?
              </p>
              <p className="text-sm text-ink-soft">Your entries and votes will be shown to teammates without your name. Your identity is used only to check that you belong here.</p>
              <ErrorText>{error}</ErrorText>
              <Button variant="primary" className="w-full" busy={busy} onClick={accept}>Join the workspace</Button>
            </div>
          ) : me ? (
            <div className="space-y-4">
              <p className="text-ink-soft">
                This invitation was sent to <strong className="text-ink">{preview.email_hint}</strong>, but you’re signed in as <strong className="text-ink">{me.email}</strong>. Forwarded links don’t work for other people.
              </p>
              <Button className="w-full" onClick={() => setLeaving(true)}>Sign out and use that address</Button>
              <LeaveDialog kind={leaving ? 'signout' : null} stay onClose={() => setLeaving(false)} />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-ink-soft">
                Sent to <strong className="text-ink">{preview.email_hint}</strong>. Confirm that mailbox to join.
              </p>
              <CodeSignIn fixedEmailHint={preview.email_hint ?? undefined} requireEmail={preview.email_hint ?? undefined} onSignedIn={async () => { await refresh() }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
