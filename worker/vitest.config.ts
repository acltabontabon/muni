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
            // Every test account is created from the same simulated network.
            SIGNUPS_PER_NETWORK_DAILY: '100000', SIGNUPS_DAILY_LIMIT: '100000', EMAIL_DAILY_LIMIT: '100000' },
          // An empty database for migration tests (test/migrations.test.ts), migrated step by step.
          d1Databases: ['MIGRATION_DB'],
        },
      }),
    ],
    // See tsconfig.json: the web client's crypto imports @noble/* from the worker's devDependencies.
    resolve: { alias: [{ find: /^@noble\/(.*)$/, replacement: path.join(import.meta.dirname, 'node_modules/@noble/$1') }] },
    test: { setupFiles: ['./test/setup.ts'], testTimeout: 30_000, hookTimeout: 60_000 },
  }
})
