import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const src = fileURLToPath(new URL('./src', import.meta.url))

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
      const files = [...Object.keys(bundle), ...walk(publicDir)].filter((f) => !skip.test(f))
      const assets = [...new Set(files)].sort().map((f) => `/${f}`)
      const version = createHash('sha256').update(assets.join('\n')).update(readFileSync(path.join(outDir, 'index.html'))).digest('hex').slice(0, 12)
      const { build } = await import('rolldown')
      await build({
        input: path.join(src, 'sw.ts'),
        resolve: { alias: { '@': src } },
        platform: 'browser',
        logLevel: 'warn',
        output: { file: path.join(outDir, 'sw.js'), format: 'iife', minify: true, banner: `self.__MUNI_BUILD=${JSON.stringify({ version, assets })};` },
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
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false, ws: true } },
  },
  build: { sourcemap: false, target: 'es2022' },
})
