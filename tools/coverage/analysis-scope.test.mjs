import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import { ESLint } from 'eslint'

const root = new URL('../../', import.meta.url)

test('Sonar analyzes coverage collector sources while excluding generated root reports', () => {
  const properties = readFileSync(new URL('sonar-project.properties', root), 'utf8')
  const exclusions = properties.match(/^sonar.exclusions=(.+)$/m)[1].split(',')
  for (const source of ['tools/coverage/run.mjs', 'tools/coverage/node-map.mjs', 'tools/coverage/analysis-scope.test.mjs']) {
    assert.equal(exclusions.some(pattern => matchesGlob(source, pattern)), false, source)
  }
  assert.equal(exclusions.some(pattern => matchesGlob('coverage/browser/report.js', pattern)), true)
})

test('ESLint sees collector sources and ignores generated root reports', async () => {
  const eslint = new ESLint({ cwd: root.pathname })
  assert.equal(await eslint.isPathIgnored('tools/coverage/run.mjs'), false)
  assert.equal(await eslint.isPathIgnored('tools/coverage/analysis-scope.test.mjs'), false)
  assert.equal(await eslint.isPathIgnored('coverage/browser/report.js'), true)
})
