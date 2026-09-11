
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'apps/frontend/src') },
  },
  test: {
    globals: true,
    environment: 'node',
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
      reporter: ['text', 'lcov'],
      include: ['apps/backend/src/modules/**/*.service.ts'],
      exclude: [
        'apps/backend/src/modules/**/*.routes.ts',
        'apps/backend/src/modules/**/*.controller.ts',
        'apps/backend/src/modules/**/*.repository.ts',
      ],
      thresholds: {
        lines:     70,
        functions: 70,
        branches:  60,
      },
    },
  },
})
