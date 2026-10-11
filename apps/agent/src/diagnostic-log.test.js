'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createDiagnosticLogger } = require('./diagnostic-log')

test('diagnostic log persists structured metadata and rotates locally', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeaccess-agent-log-'))
  const file = path.join(root, 'agent.jsonl')
  const original = console.log
  console.log = () => {}
  try {
    const logger = createDiagnosticLogger({ filePath: file, maxBytes: 100 })
    logger.info('agent.connected', { attempt: 1 })
    logger.warn('agent.disconnected', { code: 1006, reason: 'network changed' })
    logger.error('agent.websocket.error', { error: Object.assign(new Error('socket failed'), { code: 'ECONNRESET' }) })
    assert.ok(fs.existsSync(`${file}.1`))
    const entries = [fs.readFileSync(`${file}.1`, 'utf8'), fs.readFileSync(file, 'utf8')].join('\n')
    assert.match(entries, /agent\.connected/)
    assert.match(entries, /ECONNRESET/)
    assert.doesNotMatch(entries, /undefined/)
  } finally {
    console.log = original
    fs.rmSync(root, { recursive: true, force: true })
  }
})
