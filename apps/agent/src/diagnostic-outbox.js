'use strict'
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { catalog } = require('./connection-health')
const LIMIT = 100
function valid(event) {
  return event && /^[a-f0-9-]{36}$/.test(event.id) && /^[a-f0-9-]{36}$/.test(event.attemptId) && Object.hasOwn(catalog, event.code) && Number.isFinite(Date.parse(event.at))
}
function createOutbox(file, scope) {
  let events = []
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (saved.scope === scope) events = saved.events.filter(valid).slice(-LIMIT).map(({ id, attemptId, code, at, targetConnectionId }) => ({ id, attemptId, code, at, ...(/^[a-f0-9-]{36}$/.test(targetConnectionId) ? { targetConnectionId } : {}) }))
  } catch { /* Memory-only fallback; diagnostics never block access. */ }
  function persist() {
    if (!file) return
    try { fs.writeFileSync(`${file}.tmp`, JSON.stringify({ scope, events }), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file) } catch {}
  }
  return {
    add(code, attemptId, targetConnectionId) {
      if (!Object.hasOwn(catalog, code)) return
      events.push({ id: randomUUID(), attemptId, code, at: new Date().toISOString(), ...(/^[a-f0-9-]{36}$/.test(targetConnectionId) ? { targetConnectionId } : {}) })
      events = events.slice(-LIMIT); persist()
    },
    batch() { return events.slice(0, 20) },
    acknowledge(ids) { const ack = new Set(ids); events = events.filter(e => !ack.has(e.id)); persist() },
  }
}
module.exports = { createOutbox }
