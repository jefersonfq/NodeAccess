import test from 'node:test'
import assert from 'node:assert/strict'
import { addClaudeLine, addCodexLine, newClaudeSession, newCodexSession, parseArgs, summarize } from './ai-usage.mjs'

const line = value => JSON.stringify(value)
const tokenCount = (input, cached, last) => line({ type: 'event_msg', payload: { type: 'token_count', info: {
  total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: 10, reasoning_output_tokens: 2 },
  last_token_usage: { input_tokens: last } } } })

test('codex totals keep the last cumulative counter and count escalations', () => {
  const s = newCodexSession()
  addCodexLine(s, line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: 'base instructions' }] } }))
  addCodexLine(s, tokenCount(100, 80, 60))
  addCodexLine(s, line({ type: 'response_item', payload: { type: 'function_call', arguments: '{"sandbox_permissions":"require_escalated","cmd":"PRIVATE_SENTINEL"}' } }))
  addCodexLine(s, tokenCount(300, 250, 120))
  addCodexLine(s, line({ type: 'compacted', payload: {} }))
  addCodexLine(s, 'not json')
  assert.equal(s.kind, 'main'); assert.equal(s.input, 300); assert.equal(s.cached, 250)
  assert.equal(s.lastContext, 120); assert.equal(s.escalations, 1); assert.equal(s.compactions, 1)
})

test('codex approval reviewer sessions are classified separately', () => {
  const s = newCodexSession()
  addCodexLine(s, line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: 'You are judging one planned coding-agent action.' }] } }))
  addCodexLine(s, line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: 'other' }] } }))
  assert.equal(s.kind, 'reviewer')
})

test('claude usage sums fresh, cache read and cache write once per request', () => {
  const s = newClaudeSession()
  const usage = { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 7 }
  addClaudeLine(s, line({ type: 'assistant', requestId: 'r1', message: { usage } }))
  addClaudeLine(s, line({ type: 'assistant', requestId: 'r1', message: { usage } }))
  addClaudeLine(s, line({ type: 'user', message: { content: 'PRIVATE_SENTINEL' } }))
  assert.equal(s.requests, 1); assert.equal(s.input, 152); assert.equal(s.cached, 100); assert.equal(s.output, 7)
})

test('summary exposes only counters and file names', () => {
  const a = { ...newCodexSession(), input: 1000, cached: 900, output: 5, file: 'a.jsonl' }
  const b = { ...newCodexSession(), kind: 'reviewer', input: 200, cached: 100, output: 1, escalations: 0, file: 'b.jsonl' }
  const result = summarize([a, b], 1)
  assert.equal(result.groups.main.uncached, 100); assert.equal(result.groups.reviewer.uncached, 100)
  assert.deepEqual(result.largest.map(x => x.file), ['a.jsonl'])
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false)
})

test('argument parsing defaults to 14 days and rejects unknown flags or dates', () => {
  const now = new Date('2026-11-08T00:00:00Z')
  assert.equal(parseArgs([], now).since.toISOString(), '2026-10-25T00:00:00.000Z')
  assert.equal(parseArgs(['--since', '2026-11-01'], now).since.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.throws(() => parseArgs(['--bogus'], now), /AI_USAGE_UNKNOWN_FLAG/)
  assert.throws(() => parseArgs(['--since', 'x'], now), /AI_USAGE_INVALID_DATE/)
})

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

test('CLI filters files by mtime and reports selected session totals without transcript content', () => {
  const temporaryRoot = resolve('.tmp')
  mkdirSync(temporaryRoot, { recursive: true })
  const directory = mkdtempSync(join(temporaryRoot, 'ai-usage-cli-'))
  const codex = join(directory, 'codex'), claude = join(directory, 'claude')
  const writeTranscript = (file, records, modifiedAt = '2026-11-05T00:00:00Z') => {
    writeFileSync(file, records.join('\n') + '\n')
    const modified = new Date(modifiedAt)
    utimesSync(file, modified, modified)
  }
  try {
    mkdirSync(join(codex, 'nested'), { recursive: true }); mkdirSync(claude)
    writeTranscript(join(codex, 'nested', 'main.jsonl'), [
      line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: 'PRIVATE_TRANSCRIPT_SENTINEL' }] } }),
      tokenCount(100, 80, 60), 'malformed record', tokenCount(300, 250, 120),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', input: 'require_escalated PRIVATE_TRANSCRIPT_SENTINEL' } }),
      line({ payload: { type: 'context_compacted' } }),
    ], '2026-11-01T00:00:00Z')
    writeTranscript(join(codex, 'reviewer.jsonl'), [
      line({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: 'judging one planned coding-agent action' }] } }),
      tokenCount(50, 0, 50),
    ])
    writeTranscript(join(codex, 'empty.jsonl'), ['{}', 'malformed record'])
    writeTranscript(join(codex, 'old.jsonl'), [tokenCount(9999, 0, 9999)], '2026-10-31T23:59:59Z')
    writeTranscript(join(codex, 'future.jsonl'), [tokenCount(9999, 0, 9999)], '2026-11-10T00:00:00Z')
    writeTranscript(join(codex, 'ignored.txt'), [tokenCount(9999, 0, 9999)])
    const usage = { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, output_tokens: 7 }
    writeTranscript(join(claude, 'claude.jsonl'), [
      line({ type: 'assistant', requestId: 'one', message: { usage } }),
      line({ type: 'assistant', requestId: 'one', message: { usage } }),
      line({ type: 'assistant', message: { id: 'two', usage: { input_tokens: 3, output_tokens: 2 } } }),
      line({ type: 'user', message: { content: 'PRIVATE_TRANSCRIPT_SENTINEL' } }),
    ])
    const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('./ai-usage.mjs', import.meta.url)),
      '--since', '2026-11-01', '--until', '2026-11-10', '--codex-dir', codex, '--claude-dir', claude, '--top', '1'], { encoding: 'utf8' })
    const result = JSON.parse(stdout)
    assert.equal(result.window.since, '2026-11-01T00:00:00.000Z')
    assert.equal(result.window.until, '2026-11-10T00:00:00.000Z')
    assert.deepEqual(result.codex.groups.main, { sessions: 2, input: 300, cached: 250, uncached: 50, output: 10, escalations: 1, compactions: 1 })
    assert.equal(result.codex.groups.reviewer.input, 50)
    assert.deepEqual(result.codex.largest, [{ kind: 'main', file: 'main.jsonl', input: 300, cachedPercent: 83, lastContext: 120 }])
    assert.equal(result.claude.groups.claude.input, 155)
    assert.equal(result.claude.groups.claude.cached, 100)
    assert.equal(result.claude.groups.claude.output, 9)
    assert.equal(stdout.includes('PRIVATE_TRANSCRIPT_SENTINEL'), false)
    assert.equal(stdout.includes(directory), false)
    assert.equal(stdout.includes('9999'), false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('CLI handles absent transcript directories without reading default account histories', () => {
  const temporaryRoot = resolve('.tmp')
  mkdirSync(temporaryRoot, { recursive: true })
  const directory = mkdtempSync(join(temporaryRoot, 'ai-usage-missing-'))
  try {
    const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('./ai-usage.mjs', import.meta.url)),
      '--codex-dir', join(directory, 'no-codex'), '--claude-dir', join(directory, 'no-claude')], { encoding: 'utf8' })
    const result = JSON.parse(stdout)
    assert.deepEqual(result.codex.groups, {})
    assert.deepEqual(result.claude.groups, {})
    assert.deepEqual(result.codex.largest, [])
    assert.deepEqual(result.claude.largest, [])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
