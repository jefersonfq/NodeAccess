import vue from '@vitejs/plugin-vue'
import { sourcePatterns, nonSourcePatterns, globalThresholds, legacyServicePattern } from './tools/coverage/sources.mjs'

import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, 'apps/frontend/src') },
      { find: /^@nodeaccess\/shared$/, replacement: resolve(__dirname, 'packages/shared/src/index.ts') },
      { find: /^@nodeaccess\/shared\/(.*)$/, replacement: resolve(__dirname, 'packages/shared/src/$1.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    // Bound contention with disposable DB/browser suites on CI and developer hosts.
    // Keep individual timeouts unchanged so stalled operations still fail.
    maxWorkers: 4,
    // Unit suites import backend configuration; keep npm test self-contained.
    // Explicit environments remain available to opt-in integration suites.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'mysql://vitest:disposable@127.0.0.1:1/nodeaccess_test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:1',
      JWT_SECRET: process.env.JWT_SECRET ?? 'nodeaccess-vitest-disposable-signing-key',
      PEM_ENCRYPTION_KEY: process.env.PEM_ENCRYPTION_KEY ?? '00'.repeat(32),
    },
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json', 'json-summary', 'lcovonly'],
      reportsDirectory: 'coverage/vitest',
      include: sourcePatterns,
      exclude: nonSourcePatterns,
      excludeAfterRemap: true,
      reportOnFailure: true,
      // The aggregate command enforces these same gates after adding Node-runner coverage.
      thresholds: process.env.NODEACCESS_COVERAGE_COLLECT === '1' ? undefined : { [legacyServicePattern]: globalThresholds },
    },
  },
})
