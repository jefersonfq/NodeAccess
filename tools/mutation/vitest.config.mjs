import { defineConfig } from 'vitest/config'
import { mutationTests } from './scope.mjs'

export default defineConfig({
  test: {
    environment: 'node',
    include: [...mutationTests],
    maxWorkers: 1,
    testTimeout: 5000,
  },
})
