import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stamp } from './site-stamp.mjs'

const files = { 'styles.css': 'body{}', 'main.js': 'void 0', 'favicon.svg': '<svg/>' }
const read = (p) => (p in files ? Buffer.from(files[p]) : null)

test('stamps local stylesheets, scripts and icons with a content hash', () => {
  const out = stamp('<link rel="stylesheet" href="styles.css" /><script src="main.js" defer></script><link rel="icon" href="favicon.svg" />', read)
  assert.match(out, /href="styles\.css\?v=[0-9a-f]{10}"/)
  assert.match(out, /src="main\.js\?v=[0-9a-f]{10}"/)
  assert.match(out, /href="favicon\.svg\?v=[0-9a-f]{10}"/)
})

test('a changed file gets a new stamp; the same file, the same one', () => {
  const a = stamp('<link href="styles.css">', read)
  assert.equal(stamp('<link href="styles.css">', read), a)
  const changed = (p) => (p === 'styles.css' ? Buffer.from('body{color:red}') : read(p))
  assert.notEqual(stamp('<link href="styles.css">', changed), a)
})

test('leaves external, absolute, anchored, already-queried and missing files alone', () => {
  const html = '<link href="https://fonts.googleapis.com/x.css"><a href="#main">x</a><link href="/abs.css"><link href="styles.css?v=1"><script src="gone.js"></script><img src="og.jpg">'
  assert.equal(stamp(html, read), html)
})

test('the real page stamps both of its own files', () => {
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8')
  const real = (p) => { try { return readFileSync(new URL(`../site/${p}`, import.meta.url)) } catch { return null } }
  const out = stamp(html, real)
  assert.match(out, /href="styles\.css\?v=[0-9a-f]{10}"/)
  assert.match(out, /src="main\.js\?v=[0-9a-f]{10}"/)
})
