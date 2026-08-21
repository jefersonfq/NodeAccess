
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'apps/frontend/src') },
  },
  test: {
    globals: true,
    environment: 'node',
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
