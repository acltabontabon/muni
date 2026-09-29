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

  it('move on to the next job when another runner claims the one found first', async () => {
    await runDue(env as unknown as Parameters<typeof runDue>[0], 50) // nothing else due
    const queued = async (to: string, runAt: number) => {
      const id = crypto.randomUUID()
      await env.DB.prepare("INSERT INTO jobs (id, kind, payload, run_at, created_at) VALUES (?, 'email', ?, ?, ?)").bind(id, JSON.stringify({ to, subject: 'hello', body: 'x' }), runAt, Date.now()).run()
      return id
    }
    const first = await queued(`first-${tag()}@example.com`, Date.now() - 2000)
    const second = await queued(`second-${tag()}@example.com`, Date.now() - 1000)
    // The database as this runner sees it: another runner claims the first job just after this one found it.
    let raced = false
    const db = new Proxy(env.DB, {
      get(target, prop) {
        if (prop !== 'prepare') {
          const v = Reflect.get(target, prop)
          return typeof v === 'function' ? v.bind(target) : v
        }
        return (sql: string) => {
          const stmt = target.prepare(sql)
          if (raced || !sql.includes("FROM jobs WHERE status = 'queued'")) return stmt
          return {
            bind: (...args: unknown[]) => ({
              first: async () => {
                const row = await stmt.bind(...args).first<{ id: string }>()
                raced = true
                if (row) await target.prepare("UPDATE jobs SET status = 'running', locked_at = ? WHERE id = ?").bind(Date.now(), row.id).run()
                return row
              },
            }),
          }
        }
      },
    })
    await runDue({ ...(env as object), DB: db } as unknown as Parameters<typeof runDue>[0], 5)
    expect(raced).toBe(true)
    expect((await job(first))!.status).toBe('running') // the other runner's
    expect((await job(second))!.status).toBe('succeeded')
    await env.DB.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = ?").bind(first).run()
  })
})
