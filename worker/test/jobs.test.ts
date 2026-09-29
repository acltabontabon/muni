/** Background jobs: a job that keeps stopping without finishing is retried like a failure, then given up. */
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { runDue } from '../src/jobs'
import { lastMailTo, tag } from './harness'

const job = (id: string) => env.DB.prepare('SELECT status, attempts, last_error, payload FROM jobs WHERE id = ?').bind(id).first<{ status: string; attempts: number; last_error: string | null; payload: string }>()

/** A job left 'running' by an isolate that died 11 minutes ago, after `attempts` tries. */
async function stranded(kind: string, payload: Record<string, unknown>, attempts: number) {
  const id = crypto.randomUUID()
  const t = Date.now() - 11 * 60_000
  await env.DB.prepare("INSERT INTO jobs (id, kind, payload, run_at, attempts, status, locked_at, created_at) VALUES (?,?,?,?,?,'running',?,?)").bind(id, kind, JSON.stringify(payload), t, attempts, t, t).run()
  return id
}

describe('jobs', () => {
  it('give up on one that keeps stopping without finishing, and retry one that stopped once', async () => {
    const to = `stranded-${tag()}@example.com`
    const spent = await stranded('email', { to, subject: 'never', body: 'x' }, 5)
    const once = await stranded('email', { to, subject: 'retried', body: 'x' }, 1)
    await runDue(env as unknown as Parameters<typeof runDue>[0], 50)
    const given = (await job(spent))!
    expect(given).toMatchObject({ status: 'failed', attempts: 5, last_error: 'stopped without finishing', payload: '{}' })
    expect(await job(once)).toMatchObject({ status: 'succeeded', attempts: 2 })
    expect((await lastMailTo(to))?.subject).toBe('retried')
    // Given up is final: later runs leave it alone.
    await runDue(env as unknown as Parameters<typeof runDue>[0], 50)
    expect((await job(spent))!.attempts).toBe(5)
  })
})
