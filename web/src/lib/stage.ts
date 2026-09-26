import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, get, post } from '@/api/client'
import type { Command, Experiment, GroupingView, SprintDetail, StageSnapshot, VotingState } from '@/api/types'
import { useLive } from './live'

/**
 * Everything the stage and the companion need, refreshed by SSE hints.
 * Refresh never resets local UI state; the server holds the meeting state.
 */
export function useStage(sprintId: string) {
  const [sprint, setSprint] = useState<SprintDetail | null>(null)
  const [stage, setStage] = useState<StageSnapshot | null>(null)
  const [grouping, setGrouping] = useState<GroupingView | null>(null)
  const [votes, setVotes] = useState<VotingState | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [previous, setPrevious] = useState<Experiment[]>([])
  const [error, setError] = useState('')
  const [revoked, setRevoked] = useState(false)

  const loadSprint = useCallback(() => get<SprintDetail>(`/api/sprints/${sprintId}`).then(setSprint), [sprintId])
  const loadStage = useCallback(() => get<StageSnapshot>(`/api/sprints/${sprintId}/meeting`).then(setStage).catch((e) => { if (e instanceof ApiError && e.status === 404) setStage(null); else throw e }), [sprintId])
  const loadThemes = useCallback(() => get<GroupingView>(`/api/sprints/${sprintId}/themes`).then(setGrouping).catch(() => setGrouping(null)), [sprintId])
  const loadVotes = useCallback(() => get<VotingState>(`/api/sprints/${sprintId}/votes`).then(setVotes).catch(() => {}), [sprintId])
  const loadExperiments = useCallback(() => Promise.all([get<Experiment[]>(`/api/sprints/${sprintId}/experiments`).then(setExperiments), get<Experiment[]>(`/api/sprints/${sprintId}/experiments/previous`).then(setPrevious)]), [sprintId])
  const loadAll = useCallback(async () => {
    try {
      await Promise.all([loadSprint(), loadStage(), loadThemes(), loadVotes(), loadExperiments()])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load the retro')
    }
  }, [loadSprint, loadStage, loadThemes, loadVotes, loadExperiments])
  useEffect(() => {
    loadAll()
  }, [loadAll])
  const live = useLive(
    sprintId,
    (r) => {
      if (r === 'all') loadAll()
      else if (r === 'sprint') { loadSprint(); loadStage() }
      else if (r === 'meeting') loadStage()
      else if (r === 'themes' || r === 'entries') { loadThemes(); loadStage() }
      else if (r === 'votes') { loadVotes(); loadThemes() }
      else if (r === 'commitments') loadExperiments()
    },
    () => setRevoked(true),
  )

  const liveRef = useRef<string>('connecting')
  const versionRef = useRef(0)
  versionRef.current = stage?.version ?? 0
  /** Sends a facilitator command with the last-seen version. On a conflict the stage is refetched and the command is not retried. */
  const command = useCallback(
    async (c: Command): Promise<{ ok: boolean; message?: string }> => {
      // Live control is never queued: while the room can't be reached, a command is refused now.
      if (liveRef.current === 'reconnecting') return { ok: false, message: 'Reconnecting to the retro. Try again when Muni is back.' }
      try {
        const s = await post<StageSnapshot>(`/api/sprints/${sprintId}/meeting/command`, { expected_version: versionRef.current, command: c })
        setStage(s)
        return { ok: true }
      } catch (e) {
        await loadStage()
        return { ok: false, message: e instanceof ApiError ? e.message : 'Command failed' }
      }
    },
    [sprintId, loadStage],
  )

  useEffect(() => {
    liveRef.current = live
  }, [live])
  return { sprint, stage, grouping, votes, experiments, previous, error, revoked, command, reload: loadAll, setStage, loadVotes, loadExperiments, loadThemes, live }
}
