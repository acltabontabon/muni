/**
 * Invite one person by email: a single-use link, sent by Muni, that expires in 14 days. Owners may
 * invite someone to the workspace alone (`canWorkspace`); a facilitator invites people to a sprint
 * they facilitate, which also makes them members.
 */
import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { ApiError, post } from '@/api/client'
import type { SprintSummary } from '@/api/types'
import { Button, Dialog, ErrorText, Help, Input, Label } from '@/ui'

export function InviteDialog({ open, onClose, workspaceId, sprints, onInvited, defaultSprint, canWorkspace = false }: { open: boolean; onClose: () => void; workspaceId: string; sprints: Pick<SprintSummary, 'id' | 'name'>[]; onInvited: () => void; defaultSprint?: string; canWorkspace?: boolean }) {
  const first = defaultSprint ?? (canWorkspace ? '' : (sprints[0]?.id ?? ''))
  const [email, setEmail] = useState('')
  const [sprint, setSprint] = useState(first)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ text: string; link?: string }[]>([])
  useEffect(() => {
    if (open) {
      setSprint(first)
      setDone([])
      setError('')
    }
  }, [open, first])
  // Without a sprint to add them to, only an owner can invite (to the workspace).
  const nowhere = !canWorkspace && !sprint
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Invite by email" description="We email them a link. It works once — whoever opens it first and signs in with a passkey joins — and expires in 14 days. No email? Use an invite link or QR instead.">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          if (nowhere) return
          setBusy(true)
          setError('')
          try {
            const r = await post<{ already_member: boolean; email: string; link?: string }>(`/api/workspaces/${workspaceId}/invitations`, { email, sprint_id: sprint || undefined })
            setDone((d) => [...d, r.already_member ? { text: `${r.email} is already a member${sprint ? ' and was added to the sprint' : ''}.` } : { text: `Invitation sent to ${r.email}.`, link: r.link }])
            setEmail('')
            onInvited()
          } catch (err) {
            setError(err instanceof ApiError ? sentence(err.message) : 'Couldn’t invite')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div>
          <Label htmlFor="inv-email">Email</Label>
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="off" placeholder="teammate@company.com" />
        </div>
        {sprints.length ? (
          <div>
            <Label htmlFor="inv-sprint" hint={canWorkspace ? 'optional' : undefined}>{canWorkspace ? 'Also add them to' : 'Add them to'}</Label>
            <select id="inv-sprint" className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5" value={sprint} onChange={(e) => setSprint(e.target.value)}>
              {canWorkspace ? <option value="">Just the workspace</option> : null}
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {canWorkspace ? null : <Help>They join the workspace as a member, and this sprint. Owners can invite people to the workspace alone.</Help>}
          </div>
        ) : nowhere ? (
          <p className="text-sm text-ink-soft">Only the workspace’s owners can invite people to it. A facilitator can invite people to a sprint they facilitate.</p>
        ) : null}
        <ErrorText>{error}</ErrorText>
        {done.length ? (
          <ul className="space-y-1 text-sm text-ok" role="status">
            {done.map((d, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3">
                {d.text}
                {d.link ? (
                  <button type="button" className="inline-flex items-center gap-1 text-ink-soft underline underline-offset-2" onClick={() => navigator.clipboard.writeText(d.link!).catch(() => window.prompt('Copy this invite link', d.link))}>
                    <Copy className="size-3.5" aria-hidden /> Copy invite link
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {done.some((d) => d.link) ? <p className="text-xs text-ink-soft">Share it only with that person: the link works once, for whoever opens it first.</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Done</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={nowhere}>{done.length ? 'Invite another' : 'Send invitation'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

export function sentence(m: string) {
  const t = m.trim()
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t
}
