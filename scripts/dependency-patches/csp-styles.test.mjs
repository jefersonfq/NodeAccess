import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { patchCspStyles } from './csp-styles.mjs'
test('reviewed patches are idempotent on the installed sources', () => {
  assert.equal(patchCspStyles(), 0)
})
test('dependency source drift fails closed instead of trusting new emitters', () => {
  const root = mkdtempSync(join(tmpdir(), 'na-csp-patch-'))
  try {
    const patches = JSON.parse(readFileSync(new URL('./csp-styles.json', import.meta.url), 'utf8'))
    const file = join(root, 'node_modules', patches[0].path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, patches[0].old)
    assert.throws(() => patchCspStyles(root), /CSP_PATCH_SOURCE_REVIEW_REQUIRED/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('an installed library with a missing reviewed emitter fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'na-csp-missing-'))
  try {
    mkdirSync(join(root, 'node_modules/css-render'), { recursive: true })
    assert.throws(() => patchCspStyles(root), /CSP_PATCH_EMITTER_MISSING/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
