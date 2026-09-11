#!/usr/bin/env node
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5173').replace(/\/$/, '')
function token() {
  const payload = { sub: '1', userId: 1, tenantId: 1, name: 'Administrador', role: 'admin', email: 'admin@nodeaccess.test', stage: 'authenticated', iat: 1, exp: 4102444800 }
  return `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.harness`
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((value) => {
    localStorage.setItem('na_access_token', value)
    localStorage.setItem('na_refresh_token', 'native-gateway-harness')
  }, token())
  let probeCalls = 0
  await context.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/v1/native-ssh-gateway/config') body = {
      enabled: true, bindHost: '0.0.0.0', host: '0.0.0.0', port: 2222, publicEndpoint: 'ssh.nodeaccess.test',
      hostKeyPath: '/var/lib/nodeaccess/ssh-gateway/ssh_host_ed25519_key', passwordAuth: true, mfaRequired: true, publicKeyAuth: false,
      hostKeyConfigured: true, hostKeyPathConfigured: true, suggestedEndpoint: 'ssh.nodeaccess.test', appUrl: 'https://nodeaccess.test', configSource: 'database',
      effective: { enabled: true, bindHost: '0.0.0.0', port: 2222, hostKeyConfigured: true, hostKeyPathConfigured: true },
      operational: { appMode: 'gateway', processStatusObservable: true, processState: 'online', runtimeHost: '0.0.0.0', runtimePort: 2222,
        runtimeStartedAt: new Date().toISOString(), runtimeLastSeenAt: new Date().toISOString(), runtimeLastFailureAt: null, runtimeLastFailureMessage: null,
        hostKeyState: 'valid', hostKeyPath: '/var/lib/nodeaccess/ssh-gateway/ssh_host_ed25519_key', hostKeyAlgorithm: 'ssh-ed25519',
        hostKeyFingerprint: 'SHA256:2nSJMd2Drhdq03UtrfyAg1mMUJpb31s3qgFdF55Y2FA', hostKeyPermissionsSafe: true, hostKeyMessage: 'Host key carregada e validada', activeNativeSshSessions: 0 },
      differsFromEnv: false, requiresGatewayRestart: false,
    }
    else if (path === '/api/v1/native-ssh-gateway/diagnostics/probe') {
      probeCalls += 1
      body = { success: true, testedAt: new Date().toISOString(), latencyMs: 4, banner: 'SSH-2.0-NodeAccess', endpoint: 'ssh-gateway:2222', attempts: [], message: 'Listener acessível e protocolo SSH identificado' }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()) })
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  await page.goto(`${FRONTEND}/admin/native-ssh-gateway`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1_000)
  if (!await page.getByText('Gateway: Pronto').count()) {
    throw new Error(`Tela não atingiu prontidão em ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 1600)} | erros=${errors.join(';')}`)
  }
  await page.getByText('Gateway: Pronto').waitFor()
  await page.getByText('SHA256:2nSJMd2Drhdq03UtrfyAg1mMUJpb31s3qgFdF55Y2FA').waitFor()
  await page.locator('[data-native-gateway-probe="true"]').click()
  await page.getByText('Teste interno aprovado').waitFor()
  await page.getByText('SSH-2.0-NodeAccess').waitFor()
  await page.getByText('Autenticação por chave pública ainda pendente').waitFor()
  await page.getByText(/Test-NetConnection/).waitFor()
  if (probeCalls !== 1) throw new Error(`Diagnóstico chamado ${probeCalls} vezes`)
  if (errors.length) throw new Error(errors.join('; '))

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('Gateway: Pronto').waitFor()
  console.log(JSON.stringify({ ok: true, probeCalls, desktop: true, mobile: true }))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
