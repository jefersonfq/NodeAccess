import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { observeTerminalZoom } = createRequire(import.meta.url)('./terminal-zoom-observer.cjs')
function fixture(t) {
  const state = { dataset: { terminalRows: '32', terminalCols: '100' }, font: '15', messages: [{ rows: 35, cols: 110 }, { rows: 35, cols: 110 }] }
  for (const name of ['document', 'window', 'localStorage']) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name] })
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => state.dataset ? { dataset: state.dataset } : null } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __terminalExperience: { get resizeMessages() { return state.messages } } } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => state.font } })
  return state
}
const baseline = { resizeCount: 2, rowsBefore: 35, expectedFont: 15 }
test('historical resize count cannot authorize a frame after zoom', t => {
  const state = fixture(t)
  assert.equal(state.messages.length >= 2, true)
  assert.equal(observeTerminalZoom(baseline), false)
  state.messages.push({ rows: 35, cols: 110 })
  assert.equal(observeTerminalZoom(baseline), false)
})
test('accepts only new matching post-zoom dimensions and returns their atomic snapshot', t => {
  const state = fixture(t); state.messages.push({ rows: 32, cols: 100 })
  assert.deepEqual(observeTerminalZoom(baseline), { rows: 32, cols: 100, resizeCount: 3 })
  state.dataset.terminalRows = '31'; assert.equal(observeTerminalZoom(baseline), false)
  state.messages.push({ rows: 31, cols: 100 }); assert.deepEqual(observeTerminalZoom(baseline), { rows: 31, cols: 100, resizeCount: 4 })
})
test('rejects old font, unchanged rows, malformed geometry and missing container', t => {
  const state = fixture(t); state.messages.push({ rows: 32, cols: 100 })
  state.font = '14'; assert.equal(observeTerminalZoom(baseline), false)
  state.font = '15'
  for (const rows of ['35', '0', 'NaN', '32.5']) { state.dataset.terminalRows = rows; state.messages.at(-1).rows = Number(rows); assert.equal(observeTerminalZoom(baseline), false) }
  state.dataset.terminalRows = '32'; state.dataset.terminalCols = '0'; assert.equal(observeTerminalZoom(baseline), false)
  state.dataset = null; assert.equal(observeTerminalZoom(baseline), false)
})
