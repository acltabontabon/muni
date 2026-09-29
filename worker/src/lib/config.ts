/**
 * Runtime configuration read from Worker vars and secrets. Validated once per
 * isolate; production refuses insecure settings instead of degrading.
 */
export type EmailProvider = 'console' | 'resend' | 'brevo' | 'none'

export interface Config {
  env: 'development' | 'test' | 'production'
  publicOrigin: string
  cookieSecure: boolean
  sessionTtlDays: number
  email: EmailProvider
  emailFrom: string
  resendApiKey?: string
  brevoApiKey?: string
  allowDemoSeed: boolean
  entryMaxChars: number
  /** Emails the server sends a day in all, below the provider's quota so it's never exhausted. */
  emailDailyLimit: number
  /** New accounts per network and in total per day (nothing else slows abuse). */
  signupsPerNetworkDaily: number
  signupsDailyLimit: number
  /** WebAuthn relying party: an explicit RP ID and the exact origins allowed to use it. */
  webauthn: { rpId: string; rpName: string; origins: string[] }
}

export interface ConfigVars {
  APP_ENV?: string
  PUBLIC_ORIGIN?: string
  COOKIE_SECURE?: string
  SESSION_TTL_DAYS?: string
  EMAIL_PROVIDER?: string
  EMAIL_FROM?: string
  RESEND_API_KEY?: string
  BREVO_API_KEY?: string
  ALLOW_DEMO_SEED?: string
  ENTRY_MAX_CHARS?: string
  EMAIL_DAILY_LIMIT?: string
  SIGNUPS_PER_NETWORK_DAILY?: string
  SIGNUPS_DAILY_LIMIT?: string
  WEBAUTHN_RP_ID?: string
  /** Extra exact origins (comma-separated) allowed for passkeys; development only, e.g. the Vite server. */
  WEBAUTHN_EXTRA_ORIGINS?: string
}

const truthy = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : v === 'true' || v === '1')
const num = (v: string | undefined, dflt: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : dflt)

export class ConfigError extends Error {}

let cached: { key: string; config: Config } | null = null

export function config(vars: ConfigVars): Config {
  const key = JSON.stringify(vars)
  if (cached && cached.key === key) return cached.config
  const env = (vars.APP_ENV || 'development') as Config['env']
  if (!['development', 'test', 'production'].includes(env)) throw new ConfigError(`APP_ENV must be development, test or production (got ${env})`)
  const prod = env === 'production'
  const publicOrigin = (vars.PUBLIC_ORIGIN || 'http://localhost:8787').replace(/\/+$/, '')
  if (prod && !publicOrigin.startsWith('https://')) throw new ConfigError('PUBLIC_ORIGIN must be https:// in production')
  const cookieSecure = truthy(vars.COOKIE_SECURE, prod || publicOrigin.startsWith('https://'))
  if (prod && !cookieSecure) throw new ConfigError('COOKIE_SECURE cannot be disabled in production')
  const email = (vars.EMAIL_PROVIDER || (prod ? 'none' : 'console')) as EmailProvider
  if (!['console', 'resend', 'brevo', 'none'].includes(email)) throw new ConfigError(`unknown EMAIL_PROVIDER ${email}`)
  if (prod && email === 'console') throw new ConfigError('EMAIL_PROVIDER=console is not allowed in production')
  const allowDemoSeed = truthy(vars.ALLOW_DEMO_SEED, !prod)
  if (prod && allowDemoSeed) throw new ConfigError('ALLOW_DEMO_SEED cannot be enabled in production')
  const webauthn = webauthnConfig(vars, env, publicOrigin)
  const c: Config = {
    env,
    publicOrigin,
    cookieSecure,
    sessionTtlDays: num(vars.SESSION_TTL_DAYS, 30),
    email,
    emailFrom: vars.EMAIL_FROM || 'Muni <muni@localhost>',
    resendApiKey: vars.RESEND_API_KEY,
    brevoApiKey: vars.BREVO_API_KEY,
    allowDemoSeed,
    entryMaxChars: num(vars.ENTRY_MAX_CHARS, 2000),
    // Resend's free tier sends 100 a day and Brevo's 300: stay below the smaller by default.
    emailDailyLimit: num(vars.EMAIL_DAILY_LIMIT, 80),
    // New accounts per network and in total per 24 h: with passkeys only, nothing else slows abuse.
    signupsPerNetworkDaily: num(vars.SIGNUPS_PER_NETWORK_DAILY, 10),
    signupsDailyLimit: num(vars.SIGNUPS_DAILY_LIMIT, 200),
    webauthn,
  }
  cached = { key, config: c }
  return c
}

/**
 * The passkey relying party. Nothing here comes from a request: the RP ID and origins are
 * configuration. By default the RP ID is PUBLIC_ORIGIN's own host (act.munimuni.app in the
 * hosted deployment), the narrowest scope: passkeys can't be exercised from munimuni.app, previews
 * or any other subdomain. Production requires exactly that, and exactly one https origin.
 */
function webauthnConfig(vars: ConfigVars, env: Config['env'], publicOrigin: string): Config['webauthn'] {
  const host = new URL(publicOrigin).hostname
  const rpId = (vars.WEBAUTHN_RP_ID || host).trim().toLowerCase()
  const extra = (vars.WEBAUTHN_EXTRA_ORIGINS ?? '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
  const origins = [publicOrigin, ...extra.filter((o) => o !== publicOrigin)]
  if (env === 'production') {
    // Broadening the RP ID to a parent domain would let passkeys work on every sibling host; the
    // app has no need for that, so production refuses it rather than documenting an exception.
    if (rpId !== host) throw new ConfigError(`WEBAUTHN_RP_ID must equal PUBLIC_ORIGIN's host (${host}) in production`)
    if (extra.length) throw new ConfigError('WEBAUTHN_EXTRA_ORIGINS is for development only')
  }
  for (const o of origins) {
    let u: URL
    try {
      u = new URL(o)
    } catch {
      throw new ConfigError(`passkey origin ${o} is not a URL`)
    }
    if (u.origin !== o) throw new ConfigError(`passkey origin ${o} must be a bare origin (scheme://host[:port])`)
    if (u.protocol !== 'https:' && !(env !== 'production' && u.hostname === 'localhost')) throw new ConfigError(`passkey origin ${o} must be https`)
    if (u.hostname !== rpId && !u.hostname.endsWith(`.${rpId}`)) throw new ConfigError(`passkey origin ${o} is not within WEBAUTHN_RP_ID ${rpId}`)
  }
  return { rpId, rpName: 'Muni', origins }
}
