import { describe, expect, it } from 'vitest'
import * as entry from '../src/index'

describe('worker entry module', () => {
  // workerd refuses to start a Worker whose main module exports anything but handlers and
  // Durable Object classes; the test pool doesn't enforce that, so this does.
  it('exports only the default handler and classes', () => {
    for (const [name, value] of Object.entries(entry)) {
      if (name === 'default') expect(typeof (value as { fetch?: unknown }).fetch).toBe('function')
      else expect(typeof value, `export "${name}"`).toBe('function')
    }
  })
})
