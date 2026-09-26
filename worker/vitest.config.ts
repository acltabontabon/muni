import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import path from 'node:path'

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, APP_ENV: 'test', EMAIL_PROVIDER: 'console', AI_PROVIDER: 'fake', ALLOW_DEMO_SEED: 'true', PUBLIC_ORIGIN: 'http://localhost:5173',
            // Every test account signs in from the same simulated network.
            SIGNIN_CODES_PER_NETWORK_DAILY: '100000',
            // The production cap, which auth.test.ts exercises (local dev raises it in wrangler.jsonc).
            SIGNIN_EMAILS_DAILY_LIMIT: '60' },
        },
      }),
    ],
    // See tsconfig.json: the web client's crypto imports @noble/* from the worker's devDependencies.
    resolve: { alias: [{ find: /^@noble\/(.*)$/, replacement: path.join(import.meta.dirname, 'node_modules/@noble/$1') }] },
    test: { setupFiles: ['./test/setup.ts'], testTimeout: 30_000, hookTimeout: 60_000 },
  }
})
