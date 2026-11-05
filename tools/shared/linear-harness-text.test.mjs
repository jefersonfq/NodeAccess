import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { stripFingerprintPadding, containsYearAndTime } from './linear-harness-text.cjs'

test('padding preserves empty, internal padding and Unicode against original behavior', () => {
  const samples = ['', '=', '==', 'abc=', 'a=b==', '=a', 'é😀==', 'a=\n', '\ud800==']
  for (const prefix of samples) for (const suffix of samples) {
    const value = prefix + suffix
    assert.equal(stripFingerprintPadding(value), value.replace(/=+$/, ''))
  }
})

test('year/time preserves original matching boundaries without claiming calendar validation', () => {
  const tokens = ['', '2026', '1', '11111', '12:30', '99:99', 'aaaa', '\n', '\r', '\u2028', '\u2029', '😀']
  let checked = 0
  for (const first of tokens) for (const second of tokens) for (const third of tokens) {
    const value = first + second + third
    assert.equal(containsYearAndTime(value), /\d{4}.*\d{2}:\d{2}/.test(value))
    checked++
  }
  assert.equal(checked, 1728)
  assert.equal(containsYearAndTime('2026-11-04 12:30'), true)
  assert.equal(containsYearAndTime('2026\n12:30'), false)
})

test('long negative strings complete in a bounded child without truncating inputs', () => {
  const source = `const { stripFingerprintPadding, containsYearAndTime } = require(process.argv[1]); const size=500000; console.log(JSON.stringify({padding:stripFingerprintPadding('='.repeat(size)+'!').length, date:containsYearAndTime('1'.repeat(size)+'!'), lines:containsYearAndTime(('2026\\n').repeat(100000)+'12:30')}))`
  const result = spawnSync(process.execPath, ['-e', source, new URL('./linear-harness-text.cjs', import.meta.url).pathname], { encoding: 'utf8', timeout: 3000 })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { padding: 500001, date: false, lines: false })
})
