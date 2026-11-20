import { createServer } from 'node:http'
import { chromium } from 'playwright'
import { OidcFlowService } from '../../apps/backend/src/modules/auth/oidc-flow.service.js'
import { OidcService } from '../../apps/backend/src/modules/auth/oidc.service.js'

const issuer = process.env.KEYCLOAK_ISSUER ?? 'http://127.0.0.1:18080/realms/nodeaccess-cert'
const redirectUri = 'http://127.0.0.1:18081/callback'
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath()

class MemoryFlowStore {
  private readonly values = new Map<string, string>()

  async set(key: string, value: string, _expiry: string, _ttl: number, mode: string): Promise<string | null> {
    if (mode === 'NX' && this.values.has(key)) return null
    this.values.set(key, value)
    return 'OK'
  }

  async call(command: string, key: string): Promise<string | null> {
    if (command !== 'GETDEL') throw new Error(`Unsupported in-memory Redis command: ${command}`)
    const value = this.values.get(key) ?? null
    this.values.delete(key)
    return value
  }
}

async function expectOutage(): Promise<void> {
  const oidc = new OidcService()
  try {
    await oidc.discover(issuer)
    throw new Error('Discovery remained available after Keycloak shutdown')
  } catch (error) {
    if (error instanceof Error && error.message === 'Discovery remained available after Keycloak shutdown') throw error
    process.stdout.write(JSON.stringify({ outageRejected: true, publicTokensExposed: false }) + '\n')
  }
}

async function captureAuthorizationCode(authorizationUrl: string): Promise<{ code: string; state: string }> {
  let resolveCallback!: (value: { code: string; state: string }) => void
  let rejectCallback!: (error: Error) => void
  const callback = new Promise<{ code: string; state: string }>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', redirectUri)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      if (error || !code || !state) throw new Error(`Keycloak callback rejected: ${error ?? 'missing code/state'}`)
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('OIDC certification callback received')
      resolveCallback({ code, state })
    } catch (error) {
      response.writeHead(400)
      response.end('Invalid callback')
      rejectCallback(error as Error)
    }
  })
  await new Promise<void>((resolve) => server.listen(18081, '127.0.0.1', resolve))

  const browser = await chromium.launch({ headless: true, executablePath })
  try {
    const page = await browser.newPage()
    await page.goto(authorizationUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('#username').fill('oidc.user')
    await page.locator('#password').fill('NodeAccess-Cert-2026!')
    await page.locator('#kc-login').click()
    return await Promise.race([
      callback,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Keycloak callback timeout')), 20_000)),
    ])
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

/**
 * NA-0184: one browser session logs in, then follows a vault step-up URL. Keycloak must show the
 * credential form again (prompt=login) even with an active SSO session; every callback is collected in order.
 */
async function captureLoginThenStepUp(loginUrl: string, stepUpUrls: (() => Promise<string>)[]): Promise<Array<{ code: string; state: string; formShown: boolean }>> {
  const received: Array<{ code: string; state: string }> = []
  let notify: (() => void) | null = null
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', redirectUri)
    const code = url.searchParams.get('code'), state = url.searchParams.get('state')
    response.writeHead(code && state ? 200 : 400, { 'Content-Type': 'text/plain' }); response.end('ok')
    if (code && state) { received.push({ code, state }); notify?.() }
  })
  await new Promise<void>((resolve) => server.listen(18081, '127.0.0.1', resolve))
  const next = async (count: number): Promise<void> => {
    const deadline = Date.now() + 20_000
    while (received.length < count) {
      if (Date.now() > deadline) throw new Error('Keycloak callback timeout')
      await new Promise<void>((resolve) => { notify = resolve; setTimeout(resolve, 250) })
    }
  }
  const browser = await chromium.launch({ headless: true, executablePath })
  const results: Array<{ code: string; state: string; formShown: boolean }> = []
  try {
    const page = await browser.newPage()
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('#username').fill('oidc.user')
    await page.locator('#password').fill('NodeAccess-Cert-2026!')
    await page.locator('#kc-login').click()
    await next(1)
    for (const [index, makeUrl] of stepUpUrls.entries()) {
      await page.goto(await makeUrl(), { waitUntil: 'domcontentloaded' })
      const password = page.locator('#password')
      const formShown = await password.isVisible({ timeout: 5_000 }).catch(() => false)
      if (formShown) {
        if (await page.locator('#username').isVisible().catch(() => false)) await page.locator('#username').fill('oidc.user')
        await password.fill('NodeAccess-Cert-2026!')
        await page.locator('#kc-login').click()
      }
      await next(index + 2)
      results.push({ ...received[index + 1]!, formShown })
    }
    return results
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function certify(): Promise<void> {
  process.env.NODE_ENV = 'test'
  const oidc = new OidcService()
  const store = new MemoryFlowStore()
  const config = {
    issuer,
    clientId: 'nodeaccess-cert',
    scopes: ['openid', 'profile', 'email'],
    requireMfaClaim: true,
    acceptedAmrValues: ['mfa'],
    acceptedAcrValues: [],
  }
  const configs = {
    getEnabled: async () => config,
    decryptClientSecret: () => 'nodeaccess-cert-secret',
  }
  const flow = new OidcFlowService(store as never, configs as never, oidc)
  const discovery = await oidc.discover(issuer)
  if (discovery.issuer !== issuer || !discovery.jwks_uri || !discovery.token_endpoint) {
    throw new Error('Keycloak discovery document is incomplete')
  }

  const started = await flow.begin(7, redirectUri)
  const callback = await captureAuthorizationCode(started.authorizationUrl)
  const completed = await flow.complete(callback.state, callback.code)

  if (completed.tenantId !== 7) throw new Error('OIDC flow lost tenant isolation')
  if (completed.identity.email !== 'oidc.user@example.test' || !completed.identity.emailVerified) {
    throw new Error('Keycloak email claims were not normalized')
  }
  if (!completed.identity.groups.includes('operators')) throw new Error('Keycloak group claim was not mapped')
  const amr = Array.isArray(completed.identity.claims.amr) ? completed.identity.claims.amr : []
  if (!amr.includes('mfa')) throw new Error('Keycloak MFA evidence was not validated')

  let replayRejected = false
  try { await flow.complete(callback.state, callback.code) } catch { replayRejected = true }
  if (!replayRejected) throw new Error('OIDC state replay was accepted')

  // NA-0184 vault step-up: forced re-authentication, bound purpose and fresh auth_time.
  const loginForStepUp = await flow.begin(7, redirectUri)
  const stepUpUrls: string[] = []
  const [stepUp, crossed] = await captureLoginThenStepUp(loginForStepUp.authorizationUrl, [
    async () => { const u = (await flow.beginStepUp(7, redirectUri, 'challenge-binding')).authorizationUrl; stepUpUrls.push(u); return u },
    async () => { const u = (await flow.beginStepUp(7, redirectUri, 'challenge-binding-2')).authorizationUrl; stepUpUrls.push(u); return u },
  ])
  const firstUrl = new URL(stepUpUrls[0]!)
  if (firstUrl.searchParams.get('prompt') !== 'login' || firstUrl.searchParams.get('max_age') !== '0' || !stepUp!.state.startsWith('vsu.')) {
    throw new Error('Step-up request did not force re-authentication')
  }
  if (!stepUp!.formShown || !crossed!.formShown) throw new Error('Keycloak reused the SSO session without prompting for credentials')
  let wrongBindingRejected = false
  try { await flow.completeStepUp(crossed!.state, crossed!.code, 'challenge-binding') } catch { wrongBindingRejected = true }
  if (!wrongBindingRejected) throw new Error('Step-up accepted a return bound to another challenge')
  const confirmed = await flow.completeStepUp(stepUp!.state, stepUp!.code, 'challenge-binding')
  const authTime = confirmed.identity.claims.auth_time
  if (typeof authTime !== 'number' || Math.abs(Date.now() / 1000 - authTime) > 120) throw new Error(`Step-up auth_time is missing or stale: type=${typeof authTime} delta=${typeof authTime === 'number' ? Math.round(Date.now() / 1000 - authTime) : 'n/a'} claims=${Object.keys(confirmed.identity.claims).sort((a, b) => a.localeCompare(b)).join(',')}`)
  if (confirmed.identity.subject !== completed.identity.subject || confirmed.tenantId !== 7) throw new Error('Step-up identity changed')
  const loginOnStepUp = await flow.begin(7, redirectUri)
  const [other] = await captureLoginThenStepUp(loginOnStepUp.authorizationUrl, [async () => (await flow.beginStepUp(7, redirectUri, 'challenge-binding-3')).authorizationUrl])
  let purposeSeparated = false
  try { await flow.complete(other!.state, other!.code) } catch { purposeSeparated = true }
  if (!purposeSeparated) throw new Error('Central login completed a vault step-up transaction')

  process.stdout.write(JSON.stringify({
    provider: 'keycloak',
    vaultStepUpForcedLogin: true,
    vaultStepUpFreshAuthTime: true,
    vaultStepUpBindingEnforced: true,
    vaultStepUpPurposeSeparated: true,
    discovery: true,
    authorizationCodePkce: true,
    jwksSignature: true,
    issuerAudienceNonce: true,
    emailVerified: true,
    groups: true,
    delegatedMfa: true,
    stateReplayRejected: true,
    sensitiveTokensPrinted: false,
  }, null, 2) + '\n')
}

async function main(): Promise<void> {
  if (process.env.KEYCLOAK_EXPECT_OUTAGE === 'true') await expectOutage()
  else await certify()
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
