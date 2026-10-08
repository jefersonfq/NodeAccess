import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*-NOTE-JEFF.*'] },
  ...tsPlugin.configs['flat/recommended-type-checked'].map(config => ({ ...config, files: ['apps/backend/src/**/*.ts', 'apps/frontend/src/**/*.{ts,vue}'] })),
  ...vue.configs['flat/recommended'].map(config => ({ ...config, files: ['apps/frontend/src/**/*.vue'] })),
  {
    files: ['apps/backend/src/**/*.ts', 'apps/frontend/src/**/*.{ts,vue}'],
    languageOptions: { parser: tsParser, parserOptions: { project: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  { files: ['apps/frontend/src/**/*.vue'], languageOptions: { parser: vueParser, parserOptions: { parser: tsParser, project: true, extraFileExtensions: ['.vue'] } } },
  ...['backend', 'frontend'].map(app => ({
    files: [`apps/${app}/src/**/*.test.ts`],
    languageOptions: { parserOptions: { project: [`./apps/${app}/tsconfig.eslint.json`] } },
    rules: { '@typescript-eslint/explicit-function-return-type': 'off' },
  })),
]
