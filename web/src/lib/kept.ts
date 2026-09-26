/**
 * "A thought was just kept": the composer announces a confirmed submission, and the capture scene
 * answers with one small light. Decoration only — nothing here carries text or ids.
 */
const listeners = new Set<() => void>()

export function announceKept() {
  listeners.forEach((l) => l())
}

export function onKept(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
