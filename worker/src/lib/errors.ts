export class AppError extends Error {
  /** `extra` is merged into the JSON error body (e.g. `retry_after_seconds`); never put content in it. */
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}
export const bad = (m: string) => new AppError(400, 'bad_request', m)
export const unauthorized = () => new AppError(401, 'unauthorized', 'sign in to continue')
export const forbidden = (m: string) => new AppError(403, 'forbidden', m)
export const notFound = (m = 'not found') => new AppError(404, 'not_found', m)
export const conflict = (m: string) => new AppError(409, 'conflict', m)
export const unprocessable = (m: string) => new AppError(422, 'unprocessable', m)
export const rateLimited = (retryAfterSecs?: number) => new AppError(429, 'rate_limited', 'too many attempts — wait a little and try again', retryAfterSecs ? { retry_after_seconds: retryAfterSecs } : {})
export const setupRequired = (m: string) => new AppError(503, 'setup_required', m)
export const quota = (m: string) => new AppError(503, 'quota', m)

/**
 * What an unexpected failure tells the person who asked, claiming no more than is known. A
 * constraint the database enforced (a race lost) is a conflict. Quota and platform limits are a
 * recoverable 503 that says a change may not have been saved — never that nothing was, which a
 * request that wrote something before failing can't promise. Anything else is an internal error.
 */
export function failure(message: string, method: string): { status: 409 | 500 | 503; error: string; code: string } {
  if (/constraint failed|SQLITE_CONSTRAINT/i.test(message)) return { status: 409, error: 'something changed while you were working — reload and try again', code: 'conflict' }
  if (/D1_ERROR|too many requests|exceeded|quota|limit/i.test(message)) {
    const reading = ['GET', 'HEAD'].includes(method.toUpperCase())
    return { status: 503, error: reading ? 'Muni is at its usage limit right now — try again in a little while.' : 'Muni is at its usage limit right now, so this may not have been saved — try again in a little while.', code: 'quota' }
  }
  return { status: 500, error: 'internal error', code: 'internal' }
}
