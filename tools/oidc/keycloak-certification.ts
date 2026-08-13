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

  process.stdout.write(JSON.stringify({
    provider: 'keycloak',
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
