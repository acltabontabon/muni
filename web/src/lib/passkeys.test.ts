import { describe, expect, it } from 'vitest'
import { takePrf } from './passkeys'

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const response = (ext: unknown) => ({ id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'x', authenticatorData: 'y', signature: 'z' }, clientExtensionResults: ext })

describe('the PRF output never reaches Muni', () => {
  it('is copied out and the response sent carries no extension results — even when it came as a Uint8Array', () => {
    for (const as of ['buffer', 'bytes'] as const) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const original = new Uint8Array(bytes)
      const first = as === 'buffer' ? bytes.buffer : bytes
      const r = response({ prf: { enabled: true, results: { first } }, credProps: { rk: true } })
      const { prf, enabled, safe } = takePrf(r)
      expect(prf).toEqual(original)
      expect(enabled).toBe(true)
      expect(safe.clientExtensionResults).toEqual({})
      const body = JSON.stringify({ response: safe })
      expect(body).not.toContain(hex(original))
      expect(body).not.toContain(String(original[0]) + ',' + String(original[1]))
      expect(body).not.toContain('"prf"')
      // What the browser handed back is zeroed once copied.
      expect(new Uint8Array(as === 'buffer' ? (first as ArrayBuffer) : (first as Uint8Array).buffer).every((b) => b === 0)).toBe(true)
    }
  })

  it('reports no output when the passkey or browser gave none', () => {
    expect(takePrf(response({})).prf).toBeNull()
    expect(takePrf(response({ prf: { enabled: false } }))).toMatchObject({ prf: null, enabled: false })
    expect(takePrf(response(undefined)).safe.clientExtensionResults).toEqual({})
    // Too short to be a PRF output: ignored rather than used.
    expect(takePrf(response({ prf: { results: { first: new Uint8Array(8) } } })).prf).toBeNull()
  })
})
