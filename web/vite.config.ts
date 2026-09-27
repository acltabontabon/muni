/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))

/**
 * The display faces each character world uses (web/src/worlds/worlds.css). They aren't part of the
 * install precache: the service worker fetches a world's Latin files when that world is chosen, so
 * a person downloads only their own world's type.
 */
const WORLD_FONTS: Record<string, string[]> = {
  kape: ['young-serif'],
  guhit: ['bricolage-grotesque', 'caveat'],
  biyahe: ['source-sans-3'],
  bola: ['archivo'],
  pahina: ['newsreader'],
  himig: ['unbounded', 'dm-mono'],
  porma: ['bodoni-moda'],
  sibol: ['alegreya'],
}
const worldFamilies = [...new Set(Object.values(WORLD_FONTS).flat())]
const familyOf = (file: string) => worldFamilies.find((f) => path.basename(file).startsWith(`${f}-`))

/**
 * Builds src/sw.ts into one classic script at /sw.js after the app is written, with this build's
 * asset list and a content-derived version prepended. Any change to the app changes sw.js byte
 * for byte, which is how browsers notice an update.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist'
  let publicDir = 'public'
  return {
    name: 'muni-sw',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir)
      publicDir = path.resolve(c.root, c.publicDir)
    },
    async writeBundle(_, bundle) {
      // Non-Latin font subsets load on demand (unicode-range); precaching them would only cost bandwidth.
      const skip = /(\.map|\.html|_headers|robots\.txt|sw\.js|-(cyrillic|cyrillic-ext|greek|vietnamese)-wght-[^/]*\.woff2)$/
      const walk = (dir: string, base = ''): string[] =>
        readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f), `${base}${f}/`) : [`${base}${f}`]))
      const all = [...new Set([...Object.keys(bundle), ...walk(publicDir)])]
      // Browsers that load these fonts use woff2; the .woff fallbacks are never fetched.
      const files = all.filter((f) => !skip.test(f) && !f.endsWith('.woff') && !familyOf(f))
      const assets = files.sort().map((f) => `/${f}`)
      // Each world's Latin font files, cached on demand (sw.ts: 'muni:warm').
      const worlds = Object.fromEntries(
        Object.entries(WORLD_FONTS).map(([w, fams]) => [w, all.filter((f) => f.endsWith('.woff2') && fams.includes(familyOf(f) ?? '') && /-latin(-ext)?-/.test(path.basename(f))).sort().map((f) => `/${f}`)]),
      )
      const version = createHash('sha256').update(assets.join('\n')).update(JSON.stringify(worlds)).update(readFileSync(path.join(outDir, 'index.html'))).digest('hex').slice(0, 12)
      const { build } = await import('rolldown')
      await build({
        input: path.join(src, 'sw.ts'),
        resolve: { alias: { '@': src } },
        platform: 'browser',
        logLevel: 'warn',
        output: { file: path.join(outDir, 'sw.js'), format: 'iife', minify: true, banner: `self.__MUNI_BUILD=${JSON.stringify({ version, assets, worlds })};` },
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: { alias: { '@': src } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // MUNI_API points the dev server at another local Worker (e.g. a second pair of dev servers).
    proxy: { '/api': { target: process.env.MUNI_API ?? 'http://127.0.0.1:8787', changeOrigin: false, ws: true } },
  },
  build: { sourcemap: false, target: 'es2022' },
  // The worlds' tests read the stylesheets as text (src/worlds/worlds.test.ts).
  test: { css: { include: [/src\/styles\.css/, /src\/worlds\/worlds\.css/] } },
})
