import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { assertZapTarget, summarizeZapReport, zapTarget, zapScenarios } from './zap-policy.mjs'
const names = ['login-page', 'javascript', 'stylesheet', 'ready', 'anonymous-hosts', 'invalid-login', 'login', 'mfa', 'authenticated-hosts', 'refresh', 'logout', 'revoked-refresh']
const fixture = () => ({ schemaVersion: 1, mode: 'passive', target: zapTarget, version: '2.16.1', messages: 12, enabledRules: 30, queueRemaining: 0,
  requests: names.map(name => ({ name, path: typeof zapScenarios[name][1] === 'string' ? zapScenarios[name][1] : `/assets/entry.${name === 'javascript' ? 'js' : 'css'}`, method: zapScenarios[name][0], status: zapScenarios[name][2], passed: true })), alerts: [] })
test('target is the exact owned origin, never an arbitrary URL', () => {
  assert.doesNotThrow(() => assertZapTarget('https://web'))
  for (const target of ['https://example.org', 'http://web', 'https://web.evil', 'https://web/', 'https://web@evil', 'https://web:443', undefined]) assert.throws(() => assertZapTarget(target))
})
test('an inspected empty-alert result passes', () => assert.equal(summarizeZapReport(fixture()).passed, true))
for (const risk of [2, 3]) test(`unreviewed severity ${risk} blocks without hiding alerts`, () => {
  const raw = fixture(); raw.alerts.push({ rule: '10055-6', risk, paths: ['/login'] })
  const result = summarizeZapReport(raw)
  assert.equal(result.passed, false); assert.equal(result.blocking.length, 1); assert.equal(result.alerts.length, 1)
})
test('low and informational findings remain visible', () => {
  const raw = fixture(); raw.alerts = [0, 1].map(risk => ({ rule: '10020', risk, paths: ['/login'] }))
  const result = summarizeZapReport(raw); assert.equal(result.passed, true); assert.equal(result.alerts.length, 2)
})
for (const [name, change] of [
  ['disabled passive rules', r => { r.enabledRules = 0 }],
  ['version with secret suffix', r => { r.version = '2.17.0 secret-token' }],
  ['duplicated scenario', r => { r.requests[1] = r.requests[0] }],
  ['forged success', r => { r.requests[0].status = 500 }],
  ['wrong scenario path', r => { r.requests[0].path = '/api/v1/hosts' }],
  ['wrong target', r => { r.target = 'https://production.invalid' }],
  ['wrong mode', r => { r.mode = 'active' }],
  ['missing version', r => { delete r.version }],
  ['empty scan', r => { r.messages = 0 }],
  ['pending passive queue', r => { r.queueRemaining = 1 }],
  ['missing scan queue', r => { delete r.queueRemaining }],
  ['missing alerts', r => { delete r.alerts }],
  ['missing MFA scenario', r => { r.requests = r.requests.filter(v => v.name !== 'mfa') }],
  ['failed authentication', r => { r.requests.find(v => v.name === 'mfa').passed = false }],
  ['unknown risk', r => { r.alerts = [{ rule: '10020', risk: 9, paths: ['/login'] }] }],
  ['empty alert evidence', r => { r.alerts = [{ rule: '10020', risk: 2, paths: [] }] }],
  ['arbitrary rule', r => { r.alerts = [{ rule: 'secret-content', risk: 2, paths: ['/login'] }] }],
  ['query in evidence', r => { r.requests[0].path = '/login?token=secret' }],
  ['unknown route', r => { r.requests[0].path = '/user/secret' }],
  ['external URL', r => { r.requests[0].path = 'https://external.invalid' }],
  ['traversal', r => { r.requests[0].path = '/assets/../secret.js' }],
  ['invalid response code', r => { r.requests[0].status = 0 }],
  ['unknown method', r => { r.requests[0].method = 'DELETE' }],
]) test(`${name} fails closed`, () => { const raw = fixture(); change(raw); assert.throws(() => summarizeZapReport(raw)) })
test('sanitized output cannot include scanner bodies, tokens or evidence fields', () => {
  const raw = fixture(); raw.secret = 'raw-secret'; raw.requests[0].body = 'request-secret'
  raw.alerts = [{ rule: '10020', risk: 1, paths: ['/login', '/login'], evidence: 'evidence-secret', requestHeader: 'Bearer auth-secret' }]
  const result = summarizeZapReport(raw)
  assert.equal(JSON.stringify(result).includes('secret'), false); assert.deepEqual(result.alerts[0].paths, ['/login'])
})
test('CLI requires opt-in and refuses extra target arguments before Docker', () => {
  const script = new URL('./zap-run.mjs', import.meta.url)
  for (const [enabled, args] of [['false', []], ['true', ['https://production.invalid']]]) {
    const result = spawnSync(process.execPath, [script.pathname, ...args], { env: { ...process.env, RUN_ZAP_REAL: enabled }, encoding: 'utf8' })
    assert.notEqual(result.status, 0); assert.match(result.stderr, /custom targets\/arguments are unsupported/)
  }
})
