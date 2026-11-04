const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { probeScript, waitForEditor, safeErrorCode, resourceCategory, networkFailure } = require('./csp-probe.cjs')
const vs = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs'
const methods = { focus() {}, getValue() {}, getModel() {} }
function fixture({ loader = true, fail = false, createFails = false } = {}) {
  const element = { nodeType: 1 }
  const context = { window: { editor: element }, document: { getElementById: id => { assert.equal(id, 'csp-editor-mount'); return element } },
    monaco: { editor: { create: () => { if (createFails) throw new Error('private'); return methods } } } }
  if (loader) {
    context.require = (_dependencies, success, failure) => fail ? failure(new Error('https://private.invalid/?secret=redacted')) : success()
    context.require.config = config => assert.equal(config.paths.vs, vs)
  }
  vm.runInNewContext(probeScript(vs), context)
  return context.window
}
function pageFor(window) {
  return {
    waitForFunction: async (predicate, argument, options) => {
      assert.equal(options.timeout, 45000)
      assert.equal(vm.runInNewContext(`(${predicate.toString()})()`, { window }), true)
    },
    evaluate: async callback => vm.runInNewContext(`(${callback.toString()})()`, { window }),
  }
}
test('namespaced editor cannot collide with DOM named window.editor', async () => {
  const window = fixture()
  assert.equal(window.editor.nodeType, 1)
  assert.equal(window.__nodeaccessCspProbe.editor, methods)
  assert.equal(window.__nodeaccessCspProbe.state, 'ready')
  await waitForEditor(pageFor(window))
})
for (const [options, code] of [[{ loader: false }, 'LOADER_UNAVAILABLE'], [{ fail: true }, 'MONACO_LOAD_FAILED'], [{ createFails: true }, 'EDITOR_CREATE_FAILED']]) {
  test(`load failure ${code} never becomes editor readiness`, async () => {
    const window = fixture(options)
    assert.equal(window.__nodeaccessCspProbe.state, 'error')
    assert.equal(window.__nodeaccessCspProbe.errorCode, code)
    await assert.rejects(waitForEditor(pageFor(window)), error => error.code === code)
    assert.equal(JSON.stringify(window.__nodeaccessCspProbe).includes('private'), false)
  })
}
test('ready marker alone cannot authorize a DOM element or missing methods', async () => {
  for (const editor of [{ nodeType: 1, ...methods }, {}, null]) {
    await assert.rejects(waitForEditor(pageFor({ __nodeaccessCspProbe: { state: 'ready', editor } })), /Monaco instance is invalid/)
  }
})
test('timeout remains a failure at the original 45000ms deadline', async () => {
  const failure = Object.assign(new Error('timeout'), { name: 'TimeoutError' })
  let evaluated = false
  await assert.rejects(waitForEditor({ waitForFunction: async (_fn, _arg, options) => { assert.equal(options.timeout, 45000); throw failure }, evaluate: async () => { evaluated = true } }), error => error === failure)
  assert.equal(evaluated, false)
})
test('diagnostics classify resources and never include supplied URLs or arbitrary errors', () => {
  const base = 'http://127.0.0.1:18667'
  assert.equal(resourceCategory(`${base}/private?token=secret`, base, vs), 'same-origin')
  assert.equal(resourceCategory(`${vs}/loader.js?token=secret`, base, vs), 'monaco')
  for (const url of ['https://private.invalid/secret', 'invalid', `${vs}evil/loader.js`]) assert.equal(resourceCategory(url, base, vs), 'other')
  assert.equal(networkFailure('net::ERR_NAME_NOT_RESOLVED'), 'ERR_NAME_NOT_RESOLVED')
  assert.equal(networkFailure('net::ERR_TIMED_OUT https://private.invalid/?token=secret'), 'OTHER')
  assert.equal(networkFailure(undefined), 'OTHER')
  assert.equal(safeErrorCode('private secret'), 'UNKNOWN')
  assert.equal(safeErrorCode('MONACO_LOAD_FAILED'), 'MONACO_LOAD_FAILED')
})
