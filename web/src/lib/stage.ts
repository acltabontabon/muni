import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, get, post } from '@/api/client'
import type { CheckinView, Command, Experiment, GroupingView, SprintDetail, StageSnapshot, VotingState } from '@/api/types'
import { useLive, type LiveStatus } from './live'
import { useKeysEpoch } from './e2ee/E2eeProvider'
import { PARTS, Refresher, isNewer, partsFor, type Part } from './stage-reads'

/** A socket's first open this soon after everything was read (or while it's being read) reads nothing more. */
const FRESH_MS = 4000

/** "Not there" — not started, not yours, not any more — is an answer to show; not reaching Muni isn't. */
const absent = (e: unknown) => e instanceof ApiError && [403, 404, 409, 410].includes(e.status)
const or = <T>(p: Promise<T>, none: T) =>
  p.catch((e: unknown) => {
    if (absent(e)) return none
    throw e
  })
/** Something this device couldn't open was in it (lib/e2ee marks those objects). */
const hasLocked = (v: unknown) => v != null && JSON.stringify(v).includes('"__locked":true')

/**
 * Everything the stage and the companion need, read again when the room hints that something
 * changed (how: lib/stage-reads.ts). Reading again never resets local UI state; the server holds
 * the meeting state. A read that fails while the retro is on screen keeps what's there (`stale`
 * says it may be behind) and the next hint or reconnect reads it again: only a first load that
 * fails is an `error`. What an action returns is shown at once, rather than read again.
 */
export function useStage(sprintId: string) {
  const [sprint, setSprint] = useState<SprintDetail | null>(null)
  const [stage, setStage] = useState<StageSnapshot | null>(null)
  const [grouping, setGrouping] = useState<GroupingView | null>(null)
  const [votes, setVotes] = useState<VotingState | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [previous, setPrevious] = useState<Experiment[]>([])
  const [checkins, setCheckins] = useState<CheckinView[]>([])
  /** Parts whose last read failed, with what went wrong. */
  const [trouble, setTrouble] = useState<Partial<Record<Part, string>>>({})
  /** The sprint and the stage have both been read: there's a retro (or its absence) to show. */
  const [ready, setReady] = useState(false)
  const [revoked, setRevoked] = useState(false)

  // The snapshot on screen, known at once (not a render later): commands carry its version, and a
  // snapshot older than it is never shown.
  const shown = useRef<StageSnapshot | null>(null)
  const showStage = useCallback((s: StageSnapshot | null) => {
    if (s && !isNewer(s, shown.current)) return
    shown.current = s
    setStage(s)
  }, [])

  // Parts shown with something this device couldn't open ("can't be shown"): read again once it can.
  const locked = useRef(new Set<Part>())
  const read = async (part: Part, current: () => boolean) => {
    const base = `/api/sprints/${sprintId}`
    const got = (v: unknown) => {
      if (hasLocked(v)) locked.current.add(part)
      else locked.current.delete(part)
    }
    if (part === 'sprint') {
      const s = await get<SprintDetail>(base)
      if (!current()) return
      got(s)
      setSprint(s)
    } else if (part === 'stage') {
      const s = await get<StageSnapshot>(`${base}/meeting`).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      })
      if (!current()) return
      got(s)
      showStage(s)
    } else if (part === 'themes') {
      const g = await or(get<GroupingView>(`${base}/themes`), null)
      if (!current()) return
      got(g)
      setGrouping(g)
    } else if (part === 'votes') {
      const v = await or(get<VotingState>(`${base}/votes`), null)
      if (current()) setVotes(v)
    } else if (part === 'experiments') {
      const [mine, before] = await Promise.all([or(get<Experiment[]>(`${base}/experiments`), []), or(get<Experiment[]>(`${base}/experiments/previous`), [])])
      if (!current()) return
      got([mine, before])
      setExperiments(mine)
      setPrevious(before)
    } else if (part === 'checkins') {
      const c = await or(get<CheckinView[]>(`${base}/checkins`), [])
      if (!current()) return
      got(c)
      setCheckins(c)
    }
  }
  const readRef = useRef(read)
  readRef.current = read

  const reads = useRef<Refresher<Part> | null>(null)
  // Parts whose last read failed: they're read again with the room's next hint, whatever it's about.
  const failing = useRef(new Set<Part>())
  useEffect(() => {
    const seen = new Set<Part>()
    shown.current = null
    failing.current.clear()
    const r = new Refresher<Part>((p, current) => readRef.current(p, current), {
      onResult: (p, e) => {
        if (!e) {
          seen.add(p)
          failing.current.delete(p)
          if (seen.has('sprint') && seen.has('stage')) setReady(true)
        } else failing.current.add(p)
        setTrouble((t) => {
          if (!e) {
            if (!(p in t)) return t
            const next = { ...t }
            delete next[p]
            return next
          }
          const message = e instanceof ApiError ? e.message : 'Couldn’t load the retro.'
          return t[p] === message ? t : { ...t, [p]: message }
        })
      },
    })
    reads.current = r
    return () => {
      r.stop()
      if (reads.current === r) reads.current = null
    }
  }, [sprintId])

  // Everything, on opening.
  const full = useRef<{ at: number; ok: boolean | null } | null>(null)
  const reload = useCallback(async () => {
    const r = reads.current
    if (!r) return false
    const run = { at: Date.now(), ok: null as boolean | null }
    full.current = run
    run.ok = await r.now(PARTS)
    return run.ok
  }, [])
  useEffect(() => {
    void reload()
  }, [reload, sprintId])
  // This device can open more now (it was unlocked): read again what showed as "can't be shown".
  // A read still under way waited for the key, so it opens with it.
  const keysEpoch = useKeysEpoch()
  const epoch = useRef(keysEpoch)
  useEffect(() => {
    if (epoch.current === keysEpoch) return
    epoch.current = keysEpoch
    if (locked.current.size) void reads.current?.now([...locked.current])
  }, [keysEpoch])

  const live = useLive(sprintId, (r) => reads.current?.hint([...partsFor(r), ...failing.current]), () => setRevoked(true), {
    onOpen: (reconnected) => {
      // Everything was just read, or is being read: only a reconnect can have missed a hint.
      const f = full.current
      if (!reconnected && f && f.ok !== false && Date.now() - f.at < FRESH_MS) return
      reads.current?.hint(PARTS)
    },
  })

  /** A snapshot an action returned (a command, attendance, a note, an addition): shown at once, unless one newer is. */
  const putStage = useCallback(
    (s: StageSnapshot) => {
      reads.current?.supersede('stage')
      showStage(s)
    },
    [showStage],
  )
  const putSprint = useCallback((s: SprintDetail) => {
    reads.current?.supersede('sprint')
    setSprint(s)
  }, [])
  const putVotes = useCallback((v: VotingState) => {
    reads.current?.supersede('votes')
    setVotes(v)
  }, [])
  /** A check-in the server just returned replaces the one held, so a tap shows its result without waiting for a hint. */
  const putCheckin = useCallback((c: CheckinView) => {
    reads.current?.supersede('checkins')
    setCheckins((all) => (all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c]))
  }, [])
  const putExperiments = useCallback((list: Experiment[]) => {
    reads.current?.supersede('experiments')
    setExperiments(list)
  }, [])
  /** A verdict on last time's experiment answers with that sprint's list: its experiments replace theirs here. */
  const putPrevious = useCallback((list: Experiment[]) => {
    reads.current?.supersede('experiments')
    setPrevious((before) => before.map((e) => list.find((x) => x.id === e.id) ?? e))
  }, [])
  const refresh = useCallback((...parts: Part[]) => reads.current?.now(parts) ?? Promise.resolve(false), [])

  const liveRef = useRef<LiveStatus>('connecting')
  useEffect(() => {
    liveRef.current = live
  }, [live])
  /** Sends a facilitator command with the version on screen. On a conflict the stage is read again and the command is not retried. */
  const command = useCallback(
    async (c: Command): Promise<{ ok: boolean; message?: string }> => {
      // Live control is never queued: while the room can't be reached, a command is refused now.
      if (liveRef.current === 'reconnecting') return { ok: false, message: 'Reconnecting to the retro. Try again when Muni is back.' }
      try {
        putStage(await post<StageSnapshot>(`/api/sprints/${sprintId}/meeting/command`, { expected_version: shown.current?.version ?? 0, command: c }))
        return { ok: true }
      } catch (e) {
        await reads.current?.now(['stage'])
        return { ok: false, message: e instanceof ApiError ? e.message : 'Command failed' }
      }
    },
    [sprintId, putStage],
  )

  // Having the retro open — the stage or a phone — is being there. Said once per session, when the
  // room can be reached, and again after a reconnect if it didn't get through.
  const presence = useRef<string | null>(null)
  const me = stage?.attendance.find((a) => a.is_you)
  useEffect(() => {
    if (!stage || !me || me.present || stage.ended_at || live === 'reconnecting' || presence.current === stage.session_id) return
    const session = stage.session_id
    presence.current = session
    post<StageSnapshot>(`/api/sprints/${sprintId}/meeting/attendance`, { present: true })
      .then(putStage)
      .catch(() => {
        if (presence.current === session) presence.current = null
      })
  }, [sprintId, stage, me, live, putStage])

  return {
    sprint,
    stage,
    grouping,
    votes,
    experiments,
    previous,
    checkins,
    /** A first load that failed: nothing to show yet. */
    error: ready ? '' : (trouble.sprint ?? trouble.stage ?? ''),
    /** A read failed while the retro is on screen: what's shown may be a moment behind. */
    stale: ready && Object.keys(trouble).length > 0,
    ready,
    revoked,
    live,
    command,
    reload,
    refresh,
    putStage,
    putSprint,
    putVotes,
    putCheckin,
    putExperiments,
    putPrevious,
  }
}
