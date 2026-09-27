import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, get } from '@/api/client'
import type { Experiment, SprintDetail } from '@/api/types'
import { useAuth } from '@/lib/auth'
import { OUTCOME_LABEL } from '@/lib/categories'
import { isComposerDirty } from '@/lib/dirty'
import { sprintGuide } from '@/lib/lifecycle'
import { useLive } from '@/lib/live'
import { useLocal } from '@/lib/local/LocalProvider'
import { writePrefs } from '@/lib/prefs'
import { dateRange } from '@/lib/schedule'
import { Spinner, useDocumentTitle } from '@/ui'
import { Composer, MyThoughts } from '@/ui/capture'
import { GuidePanel, StepPips, useActionRunner } from '@/ui/guide'
import { AppShell } from '@/ui/shell'
import { RetroWhen } from '@/ui/when'
import { InviteDialog } from './Workspace'
import { DeviceKeyNotice, EncryptionLine } from '@/ui/keys'
import { keyring } from '@/lib/e2ee/keyring'
import { useDeviceKeys } from '@/lib/e2ee/E2eeProvider'
import { Button } from '@/ui'
import type { SprintKeyView } from '@/api/types'

/**
 * A sprint's guide: where it is, what that means for you, and the next step. Participants write
 * here while it's collecting (the same composer as the home page); the facilitator's controls sit
 * in their own marked area, apart from writing.
 */
export function SprintHome() {
  const { sprintId = '' } = useParams()
  const nav = useNavigate()
  const { offline } = useAuth()
  const local = useLocal()
  const [s, setS] = useState<SprintDetail | null>(null)
  const [prev, setPrev] = useState<Experiment[]>([])
  const [error, setError] = useState('')
  const [inviting, setInviting] = useState(false)
  // Collection closed while text was in the composer: keep it on screen.
  const [kept, setKept] = useState(false)
  useDocumentTitle(s?.name ?? 'Sprint')
  const load = useCallback(async () => {
    try {
      const d = await get<SprintDetail>(`/api/sprints/${sprintId}`)
      setS((old) => {
        if (old?.status === 'collecting' && d.status !== 'collecting' && isComposerDirty()) setKept(true)
        return d
      })
      writePrefs({ lastSprint: d.status === 'collecting' ? sprintId : undefined, lastWorkspace: d.workspace_id })
      get<Experiment[]>(`/api/sprints/${sprintId}/experiments/previous`).then(setPrev).catch(() => {})
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load this sprint')
    }
  }, [sprintId])
  // Read again when this device unlocks (or locks): what can be shown changed.
  const { keysEpoch, state: { kind: keyKind } } = useDeviceKeys()
  useEffect(() => {
    load()
  }, [load, keyKind, keysEpoch])
  useLive(sprintId, (r) => { if (r === 'sprint' || r === 'commitments' || r === 'all') load() }, () => nav('/'))
  const { state: keys, changes } = useDeviceKeys()
  const [access, setAccess] = useState<SprintKeyView | null>(null)
  // Share this device's keys with anyone in the sprint who should have them and doesn't
  // (never a still-sealed version, except to the facilitator), then show who still can't read.
  useEffect(() => {
    if (s?.encryption !== 'e1' || keys.kind !== 'ready') return
    let live = true
    keyring.shareMissing(sprintId).then(() => keyring.sprint(sprintId, true)).then((k) => live && setAccess(k?.view ?? null)).catch(() => {})
    return () => {
      live = false
    }
  }, [s?.encryption, s?.status, keys.kind, sprintId])
  const runner = useActionRunner({ id: sprintId, status: s?.status, encryption: s?.encryption }, { online: !offline, onChanged: (d) => setS(d), onInvite: () => setInviting(true) })

  if (error)
    return (
      <AppShell>
        <div className="mx-auto max-w-lg py-16 text-center">
          <h1 className="font-display text-xl">Can’t open this sprint</h1>
          <p className="mt-2 text-ink-soft">{error}</p>
          <Link to="/" className="mt-5 inline-block text-sm underline underline-offset-4">Back to Muni</Link>
        </div>
      </AppShell>
    )
  if (!s)
    return (
      <AppShell>
        <div className="grid place-items-center py-20"><Spinner /></div>
      </AppShell>
    )
  const g = sprintGuide({ ...s, participant_count: s.participants.length }, { online: !offline })
  const collecting = s.status === 'collecting'
  const dest = { workspaceId: s.workspace_id, sprintId, sprintName: s.name, encrypted: s.encryption === 'e1' }
  const showComposer = s.is_participant && (collecting || kept)
  const closedFacts =
    !['draft', 'collecting'].includes(s.status) && s.entry_count !== null ? (
      <p className="mt-3 border-t border-line/70 pt-3 text-sm text-ink-soft">
        {s.entry_count === 1 ? '1 thought was' : `${s.entry_count} thoughts were`} revealed to the {s.participants.length} participants, without names{s.collection_closed_at ? `, on ${new Date(s.collection_closed_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}.
        {s.reopened_count ? ` Collection was reopened ${s.reopened_count === 1 ? 'once' : `${s.reopened_count} times`}; what was seen before stays visible.` : ''}
      </p>
    ) : null

  return (
    <AppShell wide>
      <header className="mb-8">
        <nav aria-label="You are here" className="text-sm text-ink-soft">
          <Link to={`/workspaces/${s.workspace_id}`} className="hover:text-ink hover:underline">{s.workspace_name}</Link>
        </nav>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <h1 className="font-display min-w-0 text-2xl leading-tight [overflow-wrap:anywhere] sm:text-[30px]">{s.name}</h1>
          <StepPips step={g.step} />
        </div>
        <div className="mt-2 flex flex-col gap-1 text-sm text-ink-soft sm:flex-row sm:flex-wrap sm:gap-x-5">
          <RetroWhen s={s} />
          <span>{dateRange(s.starts_on, s.ends_on)} · {s.participants.length} {s.participants.length === 1 ? 'person' : 'people'}</span>
        </div>
        {s.goal ? <p className="mt-2 max-w-prose text-[15px]"><span className="text-ink-faint">Goal · </span>{s.goal}</p> : null}
      </header>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {s.encryption === 'e1' ? <DeviceKeyNotice need={collecting && s.is_participant ? 'write' : 'read'} /> : null}
          <GuidePanel g={g} runner={runner} extra={<>{closedFacts}{s.is_facilitator && s.encryption === 'e1' ? <AccessNote view={access} changes={changes.filter((c) => c.sprintId === sprintId)} status={s.status} /> : null}</>} composerShown={showComposer} />
          {showComposer ? (
            <div className="max-w-2xl">
            <Composer
              key={`${sprintId}:${local.cleared}`}
              headingLevel={2}
              dest={collecting ? dest : null}
              choices={[]}
              onChoose={() => {}}
              closed={!collecting ? 'Collection closed while you were writing. Nothing was sent — your text is still here to copy.' : undefined}
            />
            </div>
          ) : null}
          {s.is_participant && s.status !== 'draft' ? <MyThoughts sprintId={sprintId} editable={collecting && !offline} moveChoices={[]} online={!offline} /> : null}
        </div>

        <aside className="min-w-0 space-y-10 text-sm">
          {prev.length ? (
            <section aria-labelledby="last-time">
              <h2 id="last-time" className="font-display text-base">Last time, we said…</h2>
              <ul className="mt-3 space-y-3">
                {prev.slice(0, 4).map((e) => (
                  <li key={e.id} className="rounded-2xl bg-card p-3.5 shadow-[0_0_0_1px_var(--line)]">
                    <p className="font-medium text-ink [overflow-wrap:anywhere]">{e.change_to_try}</p>
                    <p className="mt-1 text-ink-soft">{OUTCOME_LABEL[e.status]}{e.owner_name ? ` · ${e.owner_name}` : ''}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : s.previous_sprint_id === null ? (
            <p className="text-ink-soft">This is the first retro here. Experiments you agree on come back at the start of the next one.</p>
          ) : null}
          <section aria-labelledby="whos-in">
            <h2 id="whos-in" className="font-display text-base">Who’s in</h2>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {s.participants.map((p) => (
                <li key={p.account_id} className="rounded-full bg-card px-3 py-1 shadow-[0_0_0_1px_var(--line)]">
                  {p.display_name}{p.is_you ? <span className="text-ink-faint"> (you)</span> : null}{p.is_facilitator ? <span className="text-ink-faint"> · facilitator</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-ink-faint">Thoughts are counted, never attributed. Nobody sees who wrote what.</p>
          </section>
          <section aria-labelledby="details">
            <h2 id="details" className="font-display text-base">Privacy</h2>
            <p className="mt-2 text-ink-soft"><EncryptionLine encryption={s.encryption} /></p>
            <p className="mt-2 text-ink-soft">
              Muni’s servers record who wrote each thought, and wording can still give someone away. <Link to="/privacy#visibility" className="underline underline-offset-2">Privacy &amp; data</Link>
            </p>
            {s.reminders_enabled ? <p className="mt-2 text-ink-soft">Reminder emails: {s.my_reminders_opt_out ? 'off for you' : 'on'} · <Link to="/account#notifications" className="underline underline-offset-2">change</Link></p> : null}
          </section>
        </aside>
      </div>
      <InviteDialog open={inviting} onClose={() => setInviting(false)} workspaceId={s.workspace_id} sprints={s.is_facilitator ? [{ id: s.id, name: s.name }] : []} defaultSprint={s.is_facilitator ? s.id : undefined} onInvited={load} />
    </AppShell>
  )
}

/** For the facilitator: who can't read yet, and keys that changed unexpectedly. */
function AccessNote({ view, changes, status }: { view: SprintKeyView | null; changes: { accountId: string; name: string }[]; status: string }) {
  if (!view?.participants) return null
  const noKey = view.participants.filter((p) => !p.public_key)
  const sealed = status === 'draft' || status === 'collecting'
  const waiting = sealed ? [] : view.participants.filter((p) => p.public_key && !p.has_latest && !changes.some((c) => c.accountId === p.account_id))
  if (!noKey.length && !waiting.length && !changes.length) return null
  return (
    <div className="mt-3 space-y-2 border-t border-line/70 pt-3 text-sm">
      {noKey.length ? <p className="text-ink-soft"><span className="text-ink">{noKey.map((p) => p.display_name).join(', ')}</span> {noKey.length === 1 ? 'hasn’t' : 'haven’t'} set up encryption yet. {sealed ? 'They can still write once they do; ' : ''}they’ll get access automatically from a device that has it.</p> : null}
      {waiting.length ? <p className="text-ink-soft">Waiting for access: {waiting.map((p) => p.display_name).join(', ')}. The next device with the key that opens this page shares it.</p> : null}
      {changes.map((c) => <KeyChange key={c.accountId} c={c} view={view} />)}
    </div>
  )
}

function KeyChange({ c, view }: { c: { accountId: string; name: string }; view: SprintKeyView }) {
  const p = view.participants?.find((x) => x.account_id === c.accountId)
  return (
    <div className="rounded-2xl bg-warn/10 px-3.5 py-2.5">
      <p><strong className="font-medium">{c.name}’s encryption key changed.</strong> That happens when someone starts over after losing their devices — or if something is wrong. Muni won’t share this sprint with the new key until you confirm it with them.</p>
      {p?.public_key ? (
        <p className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-ink-soft">New fingerprint: <span className="font-mono text-ink">{fingerprintOf(p.public_key)}</span></span>
          <Button size="sm" onClick={() => keyring.acceptKeyChange(c.accountId, p.public_key!)}>They confirmed it</Button>
        </p>
      ) : null}
    </div>
  )
}
import { fingerprint, fromB64u } from '@/lib/e2ee/crypto'
const fingerprintOf = (pk: string) => fingerprint(fromB64u(pk, 32))
