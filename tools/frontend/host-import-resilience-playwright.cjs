#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const scenarios = ['committed', 'rolled_back', 'partially_rolled_back', 'history-failure', 'csv-validation', 'stale-preview']
for (const outcome of scenarios) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'host-import-duplicates-playwright.cjs')], {
    env: { ...process.env, IMPORT_TEST_OUTCOME: outcome }, stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
