// Match executable JavaScript/TypeScript/Vue sources analyzed by SonarQube.
// Tests and type declarations have no production coverage denominator.
export const sourcePatterns = [
  'apps/backend/src/**/*.{ts,js,mjs,cjs,mts}',
  'apps/backend/prisma/**/*.{ts,js,mjs,cjs,mts}',
  'apps/frontend/src/**/*.{ts,js,mjs,cjs,mts,vue}',
  'apps/agent/src/**/*.{ts,js,mjs,cjs,mts}',
  'packages/shared/src/**/*.{ts,js,mjs,cjs,mts}',
  'scripts/**/*.{ts,js,mjs,cjs,mts}',
  'tools/**/*.{ts,js,mjs,cjs,mts}',
]
export const nonSourcePatterns = ['**/*.{test,spec}.{ts,js,mjs,cjs,mts}', '**/*.d.ts']
export const legacyServicePattern = 'apps/backend/src/modules/**/*.service.ts'
export const globalThresholds = { lines: 70, functions: 70, branches: 60 }
