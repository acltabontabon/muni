/**
 * Muni on Cloudflare Workers. Static assets are served by the platform (the
 * Worker runs only for /api/*); everything else is the API and the room objects.
 */
import { Hono, type Context } from 'hono'
import type { AppEnv, HonoEnv } from './env'
import { config, ConfigError } from './lib/config'
import { AppError, failure } from './lib/errors'
import { edgeLimit } from './lib/ratelimit'
import { auth } from './routes/auth'
import { workspaces } from './routes/workspaces'
import { sprints } from './routes/sprints'
import { entries } from './routes/entries'
import { themes } from './routes/themes'
import { voting } from './routes/voting'
import { meeting } from './routes/meeting'
import { commitments } from './routes/commitments'
import { checkins } from './routes/checkins'
import { exportsRoutes } from './routes/exports'
import { demo } from './routes/demo'
import { keys } from './routes/keys'
import { passkeys } from './routes/passkeys'
import { join } from './routes/join'
import { email } from './routes/email'
import { scheduled } from './jobs'
// The release version has one source, the root package.json (docs/releasing.md).
import release from '../../package.json'

export { MeetingRoom } from './room'

/**
 * Lowest `x-muni-client` revision this server accepts. Raise it when a payload change is not
 * backward compatible. (Not exported: every named export of a Worker's main module must be a
 * handler or Durable Object class, or the runtime refuses to start.)
 */
// The web client in 1.0.0-rc.1 sends revision 6.
const MIN_CLIENT_REVISION = 6

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
  // Clients send their build's API revision. One below the minimum is told to update rather than
  // retrying payloads this server won't accept (an old tab left open across a deploy).
  const client = Number(c.req.header('x-muni-client'))
  if (client && client < MIN_CLIENT_REVISION) return c.json({ error: 'Muni has been updated. Reload to continue — anything you haven’t sent is kept on this device.', code: 'upgrade_required' }, 426)
  await next()
  c.header('x-content-type-options', 'nosniff')
  c.header('referrer-policy', 'same-origin')
  c.header('cache-control', 'no-store')
})

// A flood of signed-out requests from one address is refused here, before anything reads or writes D1.
app.use('/api/*', async (c, next) => {
  await edgeLimit(c.env, c.req.raw)
  await next()
})

/**
 * What's running: the release version, the commit a release deploy stamped on it (`--var
 * MUNI_COMMIT:<sha>`; null for a local deploy) and the oldest client revision it accepts. Public and
 * cheap, so a release can check production from outside. Under /api/ because only /api/* reaches
 * the Worker in production; /healthz and /readyz answer only where the Worker runs first (local).
 */
const version = (env: AppEnv) => ({ name: 'muni', version: release.version, commit: env.MUNI_COMMIT || null, min_client_revision: MIN_CLIENT_REVISION })
async function ready(c: Context<HonoEnv>) {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ status: 'ready', database: 'ok', email_transport: config(c.env).email, ...version(c.env) })
  } catch {
    return c.json({ status: 'not ready', database: 'unreachable', ...version(c.env) }, 503)
  }
}
app.get('/api/version', (c) => c.json(version(c.env)))
app.get('/api/health', ready)
app.get('/healthz', (c) => c.json({ status: 'ok', email_transport: config(c.env).email }))
app.get('/readyz', ready)

app.route('/', auth)
app.route('/', workspaces)
app.route('/', sprints)
app.route('/', entries)
app.route('/', themes)
app.route('/', voting)
app.route('/', meeting)
app.route('/', commitments)
app.route('/', checkins)
app.route('/', exportsRoutes)
app.route('/', demo)
app.route('/', keys)
app.route('/', passkeys)
app.route('/', join)
app.route('/', email)

app.notFound((c) => c.json({ error: 'not found', code: 'not_found' }, 404))
app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ ...err.extra, error: err.message, code: err.code }, err.status as 400)
  // Quota and platform errors surface as a recoverable message, never as a false success.
  const msg = String(err instanceof Error ? err.message : err)
  const f = failure(msg, c.req.method)
  // Logged either way: a limit reached is worth knowing about too. Messages carry no content.
  console.error('request failed', { code: f.code, path: new URL(c.req.url).pathname, method: c.req.method, error: msg.slice(0, 300) })
  return c.json({ error: f.error, code: f.code }, f.status)
})

export default {
  fetch: (req: Request, env: AppEnv, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled: async (_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) => {
    ctx.waitUntil(scheduled(env))
  },
} satisfies ExportedHandler<AppEnv>
