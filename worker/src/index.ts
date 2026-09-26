/**
 * Muni on Cloudflare Workers. Static assets are served by the platform (the
 * Worker runs only for /api/*); everything else is the API and the room objects.
 */
import { Hono } from 'hono'
import type { AppEnv, HonoEnv } from './env'
import { config, ConfigError } from './lib/config'
import { AppError } from './lib/errors'
import { auth } from './routes/auth'
import { workspaces } from './routes/workspaces'
import { sprints } from './routes/sprints'
import { entries } from './routes/entries'
import { themes } from './routes/themes'
import { voting } from './routes/voting'
import { meeting } from './routes/meeting'
import { commitments } from './routes/commitments'
import { exportsRoutes } from './routes/exports'
import { ai } from './routes/ai'
import { demo } from './routes/demo'
import { scheduled } from './jobs'

export { MeetingRoom } from './room'

const app = new Hono<HonoEnv>()

app.use('*', async (c, next) => {
  // Configuration is validated once per isolate; a misconfigured production
  // deployment fails loudly instead of degrading.
  try {
    config(c.env)
  } catch (e) {
    if (e instanceof ConfigError) return c.json({ error: `server misconfigured: ${e.message}`, code: 'misconfigured' }, 500)
    throw e
  }
  await next()
  c.header('x-content-type-options', 'nosniff')
  c.header('referrer-policy', 'same-origin')
  c.header('cache-control', 'no-store')
})

app.get('/healthz', (c) => c.json({ status: 'ok', email_transport: config(c.env).email, ai_provider: config(c.env).ai }))
app.get('/readyz', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ status: 'ready', database: 'ok', email_transport: config(c.env).email, ai_provider: config(c.env).ai })
  } catch {
    return c.json({ status: 'not ready', database: 'unreachable' }, 503)
  }
})

app.route('/', auth)
app.route('/', workspaces)
app.route('/', sprints)
app.route('/', entries)
app.route('/', themes)
app.route('/', voting)
app.route('/', meeting)
app.route('/', commitments)
app.route('/', exportsRoutes)
app.route('/', ai)
app.route('/', demo)

app.notFound((c) => c.json({ error: 'not found', code: 'not_found' }, 404))
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: err.message, code: err.code }, err.status as 400)
  // Quota and platform errors surface as a recoverable message, never as a false success.
  const msg = String(err instanceof Error ? err.message : err)
  if (/D1_ERROR|too many requests|exceeded|quota|limit/i.test(msg)) return c.json({ error: 'Muni is at its usage limit right now. Nothing was saved — try again in a little while.', code: 'quota' }, 503)
  console.error('request failed', { path: new URL(c.req.url).pathname, method: c.req.method, error: msg.slice(0, 300) })
  return c.json({ error: 'internal error', code: 'internal' }, 500)
})

export default {
  fetch: (req: Request, env: AppEnv, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled: async (_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(env))
  },
} satisfies ExportedHandler<AppEnv>
