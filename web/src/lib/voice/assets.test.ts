import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { fileUrl, modelFetch, MODEL, MODEL_BYTES } from './assets'

const O = 'https://muni.test'
const bytes = Uint8Array.from({ length: 50 }, (_, i) => i)
const file = { path: 'onnx/m.onnx', bytes: bytes.length, sha256: bytesToHex(sha256(bytes)) }

function server(overrides: Record<string, Uint8Array | number> = {}) {
  const hits: string[] = []
  const parts: Record<string, Uint8Array> = {
    [`${fileUrl(O, file.path)}.part0`]: bytes.slice(0, 20),
    [`${fileUrl(O, file.path)}.part1`]: bytes.slice(20, 40),
    [`${fileUrl(O, file.path)}.part2`]: bytes.slice(40),
  }
  const fetcher = async (input: string | URL) => {
    const url = String(input)
    hits.push(url)
    const o = overrides[url]
    if (typeof o === 'number') return new Response(null, { status: o })
    const b = o ?? parts[url]
    return b ? new Response(b as Uint8Array<ArrayBuffer>) : new Response('<!doctype html>', { status: 200 })
  }
  return { hits, fetcher }
}

describe('model files', () => {
  it('pins a model under 25 MiB per part and about 250 MB in all', () => {
    expect(MODEL.partBytes).toBeLessThanOrEqual(25 * 1024 * 1024)
    expect(MODEL_BYTES).toBeGreaterThan(240e6)
    expect(MODEL_BYTES).toBeLessThan(260e6)
    for (const f of MODEL.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('joins the parts into one verified file', async () => {
    const s = server()
    const r = await modelFetch(O, { fetcher: s.fetcher, files: [file], partBytes: 20 })(fileUrl(O, file.path))
    expect(r.headers.get('content-length')).toBe('50')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes)
    expect(s.hits).toHaveLength(3)
  })

  it('fails a corrupt file instead of handing it on', async () => {
    const bad = bytes.slice(20, 40)
    bad[3] = 99
    const s = server({ [`${fileUrl(O, file.path)}.part1`]: bad })
    const r = await modelFetch(O, { fetcher: s.fetcher, files: [file], partBytes: 20 })(fileUrl(O, file.path))
    await expect(r.arrayBuffer()).rejects.toThrow(/checksum/)
  })

  it('answers unknown files in the model folder with 404, without asking the server', async () => {
    const s = server()
    const r = await modelFetch(O, { fetcher: s.fetcher, files: [file], partBytes: 20 })(`${O}/${MODEL.dir}/processor_config.json`)
    expect(r.status).toBe(404)
    expect(s.hits).toHaveLength(0)
  })

  it('does not touch other requests', async () => {
    const s = server()
    await modelFetch(O, { fetcher: s.fetcher, files: [file], partBytes: 20 })(`${O}/api/me`)
    expect(s.hits).toEqual([`${O}/api/me`])
  })
})

describe('size probes', () => {
  it('answers a one-byte range request from the manifest, without the network', async () => {
    const s = server()
    const r = await modelFetch(O, { fetcher: s.fetcher, files: [file], partBytes: 20 })(fileUrl(O, file.path), { headers: { Range: 'bytes=0-0' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 0-0/50')
    expect(s.hits).toHaveLength(0)
  })

  it('fetches nothing until the body is read', async () => {
    const s = server()
    await modelFetch(O, { fetcher: s.fetcher, files: [file], partBytes: 20 })(fileUrl(O, file.path))
    await new Promise((r) => setTimeout(r, 10))
    expect(s.hits).toHaveLength(0)
  })
})
