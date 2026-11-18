import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySonarEnvironment } from './preflight.mjs'

test('checks both token identities and server readiness without writes', async () => {
  const calls = []
  await verifySonarEnvironment({ server: 'fixture', analysisToken: 'analysis', reviewToken: 'review', makeClient: ({ token }) => async path => {
    calls.push({ token, path })
    return path === '/api/system/status' ? { status: 'UP' } : { valid: true }
  } })
  assert.deepEqual(calls, [{ token: 'analysis', path: '/api/system/status' }, { token: 'analysis', path: '/api/authentication/validate' }, { token: 'review', path: '/api/authentication/validate' }])
})
for (const failure of ['status', 'analysis', 'review', 'network', 'malformed']) {
  test(`Sonar readiness fails safely for ${failure}`, async () => {
    await assert.rejects(verifySonarEnvironment({ server: 'fixture', analysisToken: 'analysis', reviewToken: 'review', makeClient: ({ token }) => async path => {
      if (failure === 'network') throw new Error('PRIVATE token and server response')
      if (failure === 'malformed') return null
      if (path === '/api/system/status') return { status: failure === 'status' ? 'DOWN' : 'UP' }
      return { valid: token !== failure }
    } }), { message: 'SONAR_PREFLIGHT_FAILED' })
  })
}
