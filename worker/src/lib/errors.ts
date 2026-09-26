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
