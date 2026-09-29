/**
 * Leaving: a workspace (from People), or Muni altogether (from Account). Both read where you stand
 * first (`/api/auth/me/deletion`), so what you'd need to hand on — ownership, or a sprint you
 * facilitate — is said before anything is asked, with the way to do it. The server checks again.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, del, get, post } from '@/api/client'
import type { AccountDeleted, AccountDeletionPreview, SprintSummary, WorkspaceStanding } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { keyring } from '@/lib/e2ee/keyring'
import { useLocal } from '@/lib/local/LocalProvider'
import { forgetDeletedPasskeys } from '@/lib/passkeys'
import { forgetSignedInState } from '@/lib/prefs'
import { announceSignOut } from '@/lib/signout'
import { Button, Dialog, ErrorText, Input, Label, useToast } from '@/ui'
import { sentence } from '@/ui/invite-email'
import { useReauth } from '@/ui/reauth'

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)
const failure = (e: unknown, what: string) => (e instanceof ApiError ? (e.status === 0 ? `You’re offline, so ${what}.` : sentence(e.message)) : `Something went wrong, so ${what}.`)

function useStanding(open: boolean) {
  const [state, setState] = useState<{ data: AccountDeletionPreview | null; error: string }>({ data: null, error: '' })
  // Read again when the server says things changed (someone joined, a sprint gained a facilitator).
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    if (!open) setAsked(0)
  }, [open])
  useEffect(() => {
    if (!open) return
    let live = true
    setState((s) => (asked ? s : { data: null, error: '' }))
    get<AccountDeletionPreview>('/api/auth/me/deletion').then(
      (data) => live && setState({ data, error: '' }),
      (e) => live && setState({ data: null, error: failure(e, 'Muni couldn’t check') }),
    )
    return () => {
      live = false
    }
  }, [open, asked])
  return { ...state, reload: () => setAsked((n) => n + 1) }
}

/** What has to happen first in one workspace, with the way to do it. */
function HandOn({ s, onNavigate }: { s: WorkspaceStanding; onNavigate: () => void }) {
  return (
    <ul className="space-y-2 text-[15px]">
      {s.last_owner ? (
        <li>
          You’re the only owner of <strong className="font-medium">{s.workspace_name}</strong>.{' '}
          <Link to={`/workspaces/${s.workspace_id}/people`} className="underline underline-offset-2" onClick={onNavigate}>Make someone else an owner</Link> first.
        </li>
      ) : null}
      {s.facilitating.map((f) => (
        <li key={f.id}>
          You facilitate <strong className="font-medium">{f.name}</strong>, and others are in it.{' '}
          <Link to={`/sprints/${f.id}/setup`} className="underline underline-offset-2" onClick={onNavigate}>Choose another facilitator</Link> first.
        </li>
      ))}
    </ul>
  )
}

/** Unsent thoughts and drafts on this device that would be lost. */
function useUnsent(open: boolean, workspaceId?: string) {
  const local = useLocal()
  const [drafts, setDrafts] = useState(0)
  useEffect(() => {
    if (open && !workspaceId) local.draftCount().then(setDrafts, () => setDrafts(0))
  }, [open, local, workspaceId])
  const queued = local.items.filter((i) => !workspaceId || i.workspaceId === workspaceId).length
  return { queued, drafts: workspaceId ? 0 : drafts }
}

export function LeaveWorkspaceDialog({ open, onClose, workspace }: { open: boolean; onClose: () => void; workspace: { id: string; name: string } }) {
  const { refresh } = useAuth()
  const local = useLocal()
  const toast = useToast()
  const nav = useNavigate()
  const { data, error: loadError, reload } = useStanding(open)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { queued } = useUnsent(open, workspace.id)
  useEffect(() => setError(''), [open])
  const s = data?.workspaces.find((w) => w.workspace_id === workspace.id)
  const blocked = !!s && (s.last_owner || s.facilitating.length > 0)
  const leave = async () => {
    setBusy(true)
    setError('')
    try {
      // Its sprints, while they can still be listed: drafts for them can't be reached after leaving.
      const sprintIds = await get<SprintSummary[]>(`/api/workspaces/${workspace.id}/sprints`).then((l) => l.map((x) => x.id), () => [] as string[])
      const r = await post<{ ok: true; deleted?: boolean }>(`/api/workspaces/${workspace.id}/leave`, s?.sole ? { delete_workspace: true } : {})
      await local.forgetWorkspace(workspace.id, sprintIds).catch(() => {})
      onClose()
      nav('/', { replace: true })
      await refresh()
      // What the server did, not what the dialog expected: someone may have joined meanwhile.
      toast(r?.deleted ? `${workspace.name} was deleted` : `You left ${workspace.name}`)
    } catch (e) {
      setError(failure(e, 'you’re still in the workspace'))
      // Where you stand may have changed (someone joined, a sprint needs handing on): read it again.
      if (e instanceof ApiError && e.status === 409) reload()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={s?.sole ? `Delete ${workspace.name}?` : `Leave ${workspace.name}?`}>
      {loadError ? (
        <ErrorText>{loadError}</ErrorText>
      ) : !s ? (
        <p className="text-sm text-ink-soft" role="status">Checking…</p>
      ) : blocked ? (
        <>
          <p className="mb-3 text-[15px]">Others depend on you here, so there’s something to hand on before you can leave.</p>
          <HandOn s={s} onNavigate={onClose} />
        </>
      ) : s.sole ? (
        <p className="text-[15px]">You’re the only one here, so leaving deletes the workspace and everything in it — its sprints, thoughts, themes, notes and experiments. This can’t be undone.</p>
      ) : (
        <>
          <p className="text-[15px]">You’ll lose access right away, including any sprint in progress. Thoughts you already submitted stay in their sprints, still without your name.</p>
          <p className="mt-2 text-sm text-ink-soft">An owner can invite you back later.</p>
        </>
      )}
      {s && !blocked && queued > 0 ? (
        <p className="mt-3 rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm">
          <strong className="font-medium">{queued === 1 ? '1 thought on this device hasn’t been sent' : `${queued} thoughts on this device haven’t been sent`}</strong> to this workspace. After you leave, {queued === 1 ? 'it' : 'they'} can’t be.
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{blocked ? 'Close' : 'Cancel'}</Button>
        {s && !blocked ? (
          <Button variant="danger" busy={busy} onClick={leave}>{s.sole ? 'Delete and leave' : 'Leave workspace'}</Button>
        ) : null}
      </div>
    </Dialog>
  )
}

const CONFIRM_WORD = 'delete'

export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signOutLocal } = useAuth()
  const local = useLocal()
  const toast = useToast()
  const nav = useNavigate()
  const { run, dialog: reauth } = useReauth()
  const { data, error: loadError } = useStanding(open)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { queued, drafts } = useUnsent(open)
  useEffect(() => {
    setTyped('')
    setError('')
  }, [open])
  const blocking = (data?.workspaces ?? []).filter((w) => w.last_owner || w.facilitating.length > 0)
  const going = (data?.workspaces ?? []).filter((w) => w.sole)
  const staying = (data?.workspaces ?? []).filter((w) => !w.sole)
  const ready = !!data && data.can_delete && typed.trim().toLowerCase() === CONFIRM_WORD
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      const done = await run(() => del<AccountDeleted>('/api/auth/me', { confirm: true }))
      if (!done) return
      await forgetDeletedPasskeys(done.rp_id, done.credential_ids)
      // Nothing of this account stays on this device either: its drafts, its choice to keep them
      // here (and the device database, once nobody keeps anything in it), and its unlock.
      await local.forgetAccount().catch(() => {})
      await keyring.forgetDevice({ serverToo: false })
      forgetSignedInState()
      announceSignOut()
      signOutLocal()
      onClose()
      nav('/signin', { replace: true })
      toast('Your account was deleted')
    } catch (e) {
      setError(failure(e, 'nothing was deleted'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Delete your account?" wide>
        {loadError ? (
          <ErrorText>{loadError}</ErrorText>
        ) : !data ? (
          <p className="text-sm text-ink-soft" role="status">Checking your workspaces…</p>
        ) : blocking.length ? (
          <>
            <p className="mb-3 text-[15px]">Others depend on you, so there’s something to hand on first. Nothing has been deleted.</p>
            <div className="space-y-3">
              {blocking.map((s) => (
                <HandOn key={s.workspace_id} s={s} onNavigate={onClose} />
              ))}
            </div>
          </>
        ) : (
          <div className="space-y-3 text-[15px]">
            <p>Your name, email address, passkeys, keys and sessions are deleted, and you’re signed out everywhere. This can’t be undone.</p>
            {staying.length ? (
              <p>
                In {list(staying.map((w) => w.workspace_name))}: thoughts, votes and answers nobody has seen yet are deleted. What your team has already seen stays
                in its sprints, tied to no one — as it always appeared.
              </p>
            ) : null}
            {going.length ? (
              <p>
                <strong className="font-medium">{list(going.map((w) => w.workspace_name))}</strong> {going.length === 1 ? 'has' : 'have'} no one else in {going.length === 1 ? 'it' : 'them'}, so {going.length === 1 ? 'it goes' : 'they go'} too, with everything inside.
              </p>
            ) : null}
            <p className="text-sm text-ink-soft">
              Deleted data stays in Muni’s database backups for up to 30 days, then it’s gone. Your passkey may still be listed in your password manager; you can remove it there.{' '}
              <Link to="/privacy#retention" className="underline underline-offset-2" onClick={onClose}>About retention</Link>
            </p>
            {queued + drafts > 0 ? (
              <p className="rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm">
                <strong className="font-medium">
                  {[queued ? (queued === 1 ? '1 thought hasn’t been sent' : `${queued} thoughts haven’t been sent`) : '', drafts ? (drafts === 1 ? '1 draft is unfinished' : `${drafts} drafts are unfinished`) : ''].filter(Boolean).join(' and ')}
                </strong>{' '}
                on this device. They’re discarded too.
              </p>
            ) : null}
            <div className="pt-1">
              <Label htmlFor="del-confirm">Type “{CONFIRM_WORD}” to confirm</Label>
              <Input id="del-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} className="mt-1.5 max-w-xs" />
            </div>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{blocking.length ? 'Close' : 'Cancel'}</Button>
          {data && !blocking.length ? (
            <Button variant="danger" busy={busy} disabled={!ready} onClick={remove}>Delete my account</Button>
          ) : null}
        </div>
      </Dialog>
      {reauth}
    </>
  )
}
