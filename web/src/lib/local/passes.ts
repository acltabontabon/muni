/**
 * One send pass at a time. A routine trigger (opening, focus, a timer) joins the pass already
 * under way. A forced one (a thought just saved, reconnecting, "try again") waits for it and then
 * runs its own, so what was just queued is always included and its result is reported — never
 * "not sent" only because another pass happened to be running.
 */
export function serialPasses<T>(pass: (force: boolean) => Promise<T>) {
  let inflight: Promise<T> | null = null
  return async function run(force = false): Promise<T> {
    if (inflight && !force) return inflight
    while (inflight) await inflight.catch(() => null)
    const p = pass(force)
    inflight = p
    try {
      return await p
    } finally {
      if (inflight === p) inflight = null
    }
  }
}
