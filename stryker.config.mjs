import { mutationFiles, mutationTests, mutationThreshold } from './tools/mutation/scope.mjs'

export default {
  mutate: [...mutationFiles],
  files: ['package.json', 'tools/mutation/vitest.config.mjs', 'tools/mutation/scope.mjs', ...mutationFiles, ...mutationTests],
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  vitest: { configFile: 'tools/mutation/vitest.config.mjs' },
  concurrency: 2,
  timeoutMS: 5000,
  timeoutFactor: 1.5,
  dryRunTimeoutMinutes: 2,
  thresholds: { high: 90, low: mutationThreshold, break: mutationThreshold },
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: { fileName: 'artifacts/mutation/mutation.json' },
  htmlReporter: { fileName: 'artifacts/mutation/mutation.html' },
  tempDirName: 'artifacts/mutation/.sandbox',
  cleanTempDir: 'always',
  incremental: false,
  allowEmpty: false,
}
