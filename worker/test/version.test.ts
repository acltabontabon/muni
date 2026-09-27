/** Production is checked from outside after every release: the version it reports must be the committed one. */
import { describe, expect, it } from 'vitest'
import { SELF } from 'cloudflare:test'
import release from '../../package.json'

describe('version', () => {
  it('reports the release version from the root package.json, and no commit unless a release stamped one', async () => {
    const r = await SELF.fetch('https://muni.test/api/version')
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const body = (await r.json()) as Record<string, unknown>
    expect(body).toEqual({ name: 'muni', version: release.version, commit: null, min_client_revision: expect.any(Number) })
    expect(release.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  })

  it('answers health under /api with the database checked', async () => {
    const r = await SELF.fetch('https://muni.test/api/health')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ status: 'ready', database: 'ok', version: release.version })
  })
})
