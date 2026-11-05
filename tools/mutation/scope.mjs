export const mutationFiles = Object.freeze([
  'apps/backend/src/modules/auth/auth-policy.ts',
  'apps/backend/src/modules/mcp/mcp-action-mode-policy.ts',
])
export const mutationTests = Object.freeze(mutationFiles.map(file => file.replace('.ts', '.test.ts')))
export const mutationThreshold = 80
export const mutationBudgetMs = 15 * 60 * 1000
export const mutationInputs = Object.freeze([
  'package.json', 'package-lock.json', 'stryker.config.mjs', 'tools/mutation/scope.mjs',
  'tools/mutation/vitest.config.mjs', 'tools/mutation/run.mjs', 'tools/mutation/report.mjs',
  'tools/mutation/process.mjs', ...mutationFiles, ...mutationTests,
])
