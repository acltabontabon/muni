/**
 * Where a new thought goes. One collecting sprint opens directly; with several, the writer chooses
 * (a remembered choice counts). Muni never picks one of several silently.
 */
export function pickDestination<T extends { id: string }>(collecting: T[], chosen: string | null | undefined): T | null {
  if (collecting.length === 1) return collecting[0]
  return collecting.find((s) => s.id === chosen) ?? null
}
