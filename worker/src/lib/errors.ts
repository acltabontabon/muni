export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}
export const bad = (m: string) => new AppError(400, 'bad_request', m)
export const unauthorized = () => new AppError(401, 'unauthorized', 'sign in to continue')
export const forbidden = (m: string) => new AppError(403, 'forbidden', m)
export const notFound = (m = 'not found') => new AppError(404, 'not_found', m)
export const conflict = (m: string) => new AppError(409, 'conflict', m)
export const unprocessable = (m: string) => new AppError(422, 'unprocessable', m)
export const rateLimited = () => new AppError(429, 'rate_limited', 'too many attempts — wait a little and try again')
export const setupRequired = (m: string) => new AppError(503, 'setup_required', m)
export const quota = (m: string) => new AppError(503, 'quota', m)
