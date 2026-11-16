import { client } from './export.mjs'

/** Read-only readiness/authentication checks before expensive local validation. */
export async function verifySonarEnvironment({ server, analysisToken, reviewToken, makeClient = client }) {
  try {
    const analysis = makeClient({ server, token: analysisToken, timeoutMs: 2000, retryDelayMs: 100 })
    const review = makeClient({ server, token: reviewToken, timeoutMs: 2000, retryDelayMs: 100 })
    const [status, analysisAuth, reviewAuth] = await Promise.all([analysis('/api/system/status'), analysis('/api/authentication/validate'), review('/api/authentication/validate')])
    if (status?.status !== 'UP' || analysisAuth?.valid !== true || reviewAuth?.valid !== true) throw new Error('unavailable')
  } catch { throw new Error('SONAR_PREFLIGHT_FAILED') }
}
