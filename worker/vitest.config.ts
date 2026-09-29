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
          bindings: { TEST_MIGRATIONS: migrations, APP_ENV: 'test', EMAIL_PROVIDER: 'console', ALLOW_DEMO_SEED: 'true', PUBLIC_ORIGIN: 'http://localhost:5173',
            // Every test account is created from the same simulated network, and tests send a lot of
            // invitations (a test of the daily email limit sets its own).
            SIGNUPS_PER_NETWORK_DAILY: '100000', SIGNUPS_DAILY_LIMIT: '100000', EMAIL_DAILY_LIMIT: '100000' },
        },
      }),
    ],
    // See tsconfig.json: the web client's crypto imports @noble/* from the worker's devDependencies.
    resolve: { alias: [{ find: /^@noble\/(.*)$/, replacement: path.join(import.meta.dirname, 'node_modules/@noble/$1') }] },
    test: { setupFiles: ['./test/setup.ts'], testTimeout: 30_000, hookTimeout: 60_000 },
  }
})
