'use strict'

const fs = require('fs')
const path = require('path')

function safeValue(value) {
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code || null }
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`
  return value
}

function createDiagnosticLogger({ filePath, verbose = false, maxBytes = 5 * 1024 * 1024 } = {}) {
  function rotateIfNeeded() {
    if (!filePath) return
    try {
      if (fs.statSync(filePath).size < maxBytes) return
      const previous = `${filePath}.1`
      try { fs.unlinkSync(previous) } catch {}
      fs.renameSync(filePath, previous)
    } catch {}
  }

  function write(level, event, fields = {}) {
    const entry = { timestamp: new Date().toISOString(), level, event }
    for (const [key, value] of Object.entries(fields)) entry[key] = safeValue(value)
    const line = JSON.stringify(entry)
    console.log(line)
    if (!filePath) return
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
      rotateIfNeeded()
      fs.appendFileSync(filePath, `${line}\n`, { mode: 0o600 })
    } catch (error) {
      if (verbose) console.error(`[diagnostic-log] ${error.message}`)
    }
  }

  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    debug: (event, fields) => { if (verbose) write('debug', event, fields) },
  }
}

module.exports = { createDiagnosticLogger }
