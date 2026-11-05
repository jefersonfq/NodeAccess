const assert = require('node:assert/strict')

function probeScript(vs) {
  return `window.__nodeaccessCspProbe={state:'loading',editor:null};
const probe=window.__nodeaccessCspProbe;
try{eval('window.evalExecuted=true')}catch(e){probe.evalBlocked=e instanceof EvalError}
if(typeof require!=='function'){probe.state='error';probe.errorCode='LOADER_UNAVAILABLE'}
else{require.config({paths:{vs:${JSON.stringify(vs)}}});
require(['vs/editor/editor.main'],()=>{
try{probe.editor=monaco.editor.create(document.getElementById('csp-editor-mount'),{value:'const answer = 42',language:'javascript'});probe.state='ready'}
catch{probe.state='error';probe.errorCode='EDITOR_CREATE_FAILED'}
},()=>{probe.state='error';probe.errorCode='MONACO_LOAD_FAILED'});}`
}

async function waitForEditor(page) {
  await page.waitForFunction(() => ['ready', 'error'].includes(window.__nodeaccessCspProbe?.state), {}, { timeout: 45000 })
  const state = await page.evaluate(() => {
    const probe = window.__nodeaccessCspProbe
    return { ready: probe?.state === 'ready', errorCode: probe?.errorCode,
      validEditor: !!probe?.editor && !probe.editor.nodeType && ['focus', 'getValue', 'getModel'].every(method => typeof probe.editor[method] === 'function') }
  })
  if (!state.ready) throw Object.assign(new Error('Monaco load failed'), { code: safeErrorCode(state.errorCode) })
  assert.equal(state.validEditor, true, 'Monaco instance is invalid')
}

function safeErrorCode(value) {
  return ['LOADER_UNAVAILABLE', 'EDITOR_CREATE_FAILED', 'MONACO_LOAD_FAILED'].includes(value) ? value : 'UNKNOWN'
}
function resourceCategory(url, base, vs) {
  // Classify only; never copy paths, hosts, query strings or raw browser errors.
  try {
    const parsed = new URL(url)
    if (parsed.origin === new URL(base).origin) return 'same-origin'
    if (parsed.origin === new URL(vs).origin && parsed.pathname.startsWith(new URL(vs).pathname + '/')) return 'monaco'
  } catch { /* Invalid URLs carry no diagnostic data. */ }
  return 'other'
}
function networkFailure(value) {
  const known = ['ERR_NAME_NOT_RESOLVED', 'ERR_TIMED_OUT', 'ERR_CONNECTION_RESET', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_INTERNET_DISCONNECTED', 'ERR_BLOCKED_BY_CLIENT', 'ERR_ABORTED']
  return known.find(code => value === `net::${code}`) || 'OTHER'
}
module.exports = { probeScript, waitForEditor, safeErrorCode, resourceCategory, networkFailure }
