/** Opt-in live browser/API/MySQL/Redis/SSH test. SMTP + provisioner are explicit doubles. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { Redis } from 'ioredis'
import { Client } from 'ssh2'
import { chromium } from 'playwright'
import speakeasy from 'speakeasy'
import bcrypt from 'bcrypt'

if (!process.env.TRIAL_LIVE_ENV) throw new Error('Set TRIAL_LIVE_ENV to the disposable test environment file')
dotenv.config({ path: process.env.TRIAL_LIVE_ENV, override: true })
const databaseUrl = new URL(process.env.DATABASE_URL!)
assert.ok(['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) && databaseUrl.pathname === '/na0068', 'Disposable local database required')
const frontend = process.env.TRIAL_LIVE_FRONTEND || 'http://127.0.0.1:5190'
const sshHost = process.env.TRIAL_LIVE_SSH_HOST || '10.206.8.10'
const sshPort = Number(process.env.TRIAL_LIVE_SSH_PORT || 2222)
const sshUser = process.env.TRIAL_LIVE_SSH_USER || 'trial'
const sshPassword = process.env.TRIAL_LIVE_SSH_PASSWORD
assert.ok(sshPassword, 'Set disposable SSH password')
const output = '/tmp/na0068-live-browser'
await mkdir(output, { recursive: true })
const { TrialService } = await import('../../apps/backend/src/modules/trials/trial.service.js')
const { trialRoutes } = await import('../../apps/backend/src/modules/trials/trial.routes.js')
const { AuthRateLimitService } = await import('../../apps/backend/src/modules/auth/auth-rate-limit.service.js')
const { configureTrialPolicy, configureTrialUserReader } = await import('../../apps/backend/src/modules/trials/trial-policy.js')
const { TenantRepository } = await import('../../apps/backend/src/modules/tenants/tenant.repository.js')
const db = new PrismaClient()
const redis = new Redis(process.env.REDIS_URL!)
const messages = new Map<string, string>()
const run = randomUUID().slice(0, 8)
const visitorEmail = `live-trial-${run}@example.test`
const normalEmail = `live-normal-${run}@example.test`
const password = 'Live-Browser-Fixture-2026'
let fingerprint = ''
await new Promise<void>((resolve, reject) => {
  const client = new Client()
  client.on('ready', () => { client.end(); resolve() }).on('error', reject)
  client.connect({ host: sshHost, port: sshPort, username: sshUser, password: sshPassword,
    hostVerifier: key => { fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`; return true } })
})
console.log('Disposable SSH handshake verified.')
const service = new TrialService(db, { registrationsEnabled: true, publicUrl: frontend, protectedAddresses: ['177.153.202.21'],
  mailer: { send: async (to, link) => { messages.set(to, link) } },
  provisioner: { ensure: async (id, profile) => ({ trialId: id, state: 'ready', isolated: true, hosts: Array.from({ length: profile.machineCount }, (_, index) => ({ name: index === 0 ? `Live SSH ${run}` : `Demo expansion ${index} ${run}`, ip: index === 0 ? sshHost : `10.206.8.${20 + index}`, port: sshPort, sshUser, password: sshPassword!, fingerprint })) }), remove: async () => {} },
})
if (process.env.TRIAL_LIVE_CLEAN_PREVIOUS === '1') {
  const previous = JSON.parse(await readFile(`${output}/fixture.json`, 'utf8'))
  const owned = await db.trialRegistration.findUnique({ where: { id: previous.trialId } })
  assert.ok(owned?.email.startsWith('live-trial-') && owned.email.endsWith('@example.test'), 'Only own disposable live fixture may be removed')
  await service.cancelById(previous.trialId)
  await service.tick()
}
configureTrialPolicy(tenantId => db.trialRegistration.findUnique({ where: { tenantId } }))
configureTrialUserReader(async (tenantId, userId, sessionVersion) => !!await db.user.findFirst({ where: { tenantId, id: userId, active: true, deletedAt: null, ...(sessionVersion === undefined ? {} : { sessionVersion }) } }))
const oldProfile = await db.trialProfile.findUnique({ where: { id: 1 } })
const normalTenant = await new TenantRepository(db).create({ name: 'Normal Live Fixture', slug: `normal-live-${run}`, active: true, maxUsers: 3,
  firstAdmin: { name: 'Normal Live Admin', email: normalEmail, passwordHash: await bcrypt.hash(password, 12) } })
const normalUser = await db.user.findFirstOrThrow({ where: { tenantId: normalTenant.id, email: normalEmail } })
await db.user.update({ where: { id: normalUser.id }, data: { forcePasswordChange: false } })
await service.updateProfile({ name: 'Live Trial Fixture', durationDays: 1, maxUsers: 2, maxHosts: 4, machineCount: 1, maxMachines: 3, allowCustomHosts: true, maxCustomHosts: 1, maxSessions: 2,
  templateId: 'trusted-ssh-fixture', networkCidr: '10.206.8.0/24', maxActiveTrials: 10, retentionDays: 30,
  privacyUrl: 'https://example.test/privacy', termsUrl: 'https://example.test/terms', privacyVersion: 'live-test-v1', resources: ['ssh', 'sftp', 'sharing'] }, normalUser.id)
const api = Fastify({ logger: false })
await api.register(fastifyJwt, { secret: process.env.JWT_SECRET! })
api.setErrorHandler((error, _request, reply) => reply.status((error as { statusCode?: number }).statusCode || 500).send({ message: error.message }))
await api.register(async app => trialRoutes(app, service, new AuthRateLimitService(redis, { windowSeconds: 60, ip: 500, tenant: 5000, identity: 20, keySecret: process.env.JWT_SECRET! })), { prefix: '/api/v1' })
await api.listen({ port: Number(process.env.TRIAL_LIVE_API_PORT || 3192), host: '127.0.0.1' })
console.log('Live trial route fixture listening on localhost.')
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome' })
const errors: string[] = []
const failedHttp: { path: string; status: number }[] = []
let trialId: string | undefined
let retainForPty = false
async function login(page: import('playwright').Page, email: string): Promise<void> {
  await page.goto(`${frontend}/auth/login`)
  await page.getByPlaceholder('seu@email.com').fill(email)
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.waitForURL(/\/auth\/setup-totp/)
  await page.getByAltText('QR Code TOTP').waitFor()
  const user = await db.user.findFirstOrThrow({ where: { email, deletedAt: null } })
  assert.ok(user.mfaSecret)
  // Read only this test user's seed to act as the authenticator; normal login/MFA routes remain real.
  await page.getByPlaceholder('000000').fill(speakeasy.totp({ secret: user.mfaSecret, encoding: 'base32' }))
  await page.getByRole('button', { name: 'Confirmar e entrar', exact: true }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/auth/'))
}
try {
  const normalContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await normalContext.addInitScript(() => localStorage.setItem('nodeaccess_locale', 'pt-BR'))
  const normalPage = await normalContext.newPage()
  console.log('Checking normal login and MFA.')
  await login(normalPage, normalEmail)
  await normalPage.goto(`${frontend}/hosts`)
  const normalToken = await normalPage.evaluate(() => localStorage.getItem('na_access_token'))
  assert.ok(normalToken)
  assert.equal((await normalPage.request.get(`${frontend}/api/v1/hosts`, { headers: { authorization: `Bearer ${normalToken}` } })).status(), 200)
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(() => localStorage.setItem('nodeaccess_locale', 'pt-BR'))
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', e => errors.push(e.message))
  page.on('response', response => { if (response.url().includes('/api/v1/') && response.status() >= 400) failedHttp.push({ path: new URL(response.url()).pathname, status: response.status() }) })
  console.log('Checking public trial onboarding.')
  await page.goto(`${frontend}/trial`)
  await page.getByLabel('Nome', { exact: true }).fill('Live Trial Visitor')
  await page.getByLabel('E-mail', { exact: true }).fill(visitorEmail)
  await page.getByRole('checkbox').last().check()
  await page.getByRole('button', { name: 'Solicitar meu ambiente de teste' }).click()
  await page.getByRole('heading', { name: 'Confira seu e-mail' }).waitFor()
  assert.ok(messages.get(visitorEmail))
  await page.goto(messages.get(visitorEmail)!)
  await page.getByRole('heading', { name: /Aguardando disponibilidade|Preparando seu ambiente/ }).waitFor()
  const registration = await db.trialRegistration.findUniqueOrThrow({ where: { email: visitorEmail } })
  trialId = registration.id
  await service.tick()
  await page.getByRole('button', { name: 'Atualizar andamento', exact: true }).click()
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByLabel('Confirme a senha').fill(password)
  await page.getByRole('button', { name: 'Ativar minha conta' }).click()
  await page.getByRole('link', { name: 'Entrar no meu ambiente de teste' }).waitFor()
  await page.screenshot({ path: `${output}/activated.png`, fullPage: true })
  console.log('Checking trial login and MFA.')
  await login(page, visitorEmail)
  await page.goto(`${frontend}/hosts?view=all`)
  await page.getByText(`Live SSH ${run}`, { exact: true }).first().waitFor()
  const trial = await db.trialRegistration.findUniqueOrThrow({ where: { id: trialId } })
  const user = await db.user.findFirstOrThrow({ where: { tenantId: trial.tenantId!, email: visitorEmail } })
  const host = await db.host.findFirstOrThrow({ where: { tenantId: trial.tenantId! } })
  const token = await page.evaluate(() => localStorage.getItem('na_access_token'))
  assert.ok(token)
  const headers = { authorization: `Bearer ${token}` }
  const rootNode = await db.inventoryNode.findFirstOrThrow({ where: { rootTenantId: trial.tenantId! } })
  assert.equal((await page.request.post(`${frontend}/api/v1/hosts`, { headers, data: { name: 'Forbidden destination', ip: '10.206.8.99', port: 22, sshUser: 'visitor', authType: 'password', password: 'Never-used-fixture-2026', connectionMode: 'direct', scope: 'personal', inventoryParentId: rootNode.id } })).status(), 403)
  console.log('Checking machine expansion and own-host CRUD through actual trial routes.')
  await page.getByLabel('Quantidade total desejada de máquinas de demonstração').fill('3')
  await page.getByRole('button', { name: 'Solicitar máquinas', exact: true }).click()
  await page.getByText('Preparando seu laboratório para 3 máquina(s).', { exact: false }).waitFor()
  await service.machines.tick()
  await page.getByRole('button', { name: 'Atualizar laboratório', exact: true }).click()
  await page.getByText('3 máquina(s) de demonstração disponível(is)', { exact: false }).waitFor()
  assert.equal(await db.host.count({ where: { tenantId: trial.tenantId!, deletedAt: null } }), 3)
  await page.getByRole('button', { name: 'Cadastrar meu host', exact: true }).click()
  await page.getByLabel('Nome do host', { exact: true }).fill('Own disposable metadata fixture')
  await page.getByLabel('IPv4 público do host').fill('9.9.9.9')
  await page.getByLabel('Usuário SSH', { exact: true }).fill('fixture')
  await page.getByLabel('Senha SSH', { exact: true }).fill('Fixture-Never-Connected-2026')
  await page.getByRole('button', { name: 'Salvar meu host', exact: true }).click()
  await page.getByRole('button', { name: 'Editar host Own disposable metadata fixture', exact: true }).waitFor()
  const ownedHost = await db.host.findFirstOrThrow({ where: { tenantId: trial.tenantId!, ip: '9.9.9.9', deletedAt: null } })
  assert.equal(ownedHost.ownerId, user.id)
  assert.equal(ownedHost.scope, 'PERSONAL')
  assert.ok(ownedHost.passwordEncrypted && !ownedHost.passwordEncrypted.includes('Fixture-Never-Connected'))
  await page.locator(`[data-host-id="${ownedHost.id}"] [data-host-actions-button]`).first().click()
  await page.getByText('Editar', { exact: true }).last().click()
  await page.getByRole('dialog').filter({ hasText: 'Editar meu host' }).waitFor()
  assert.equal(await page.getByLabel('Senha SSH', { exact: true }).inputValue(), '')
  await page.getByLabel('Nome do host', { exact: true }).fill('Own fixture edited')
  await page.getByRole('button', { name: 'Salvar meu host', exact: true }).click()
  await page.getByRole('button', { name: 'Remover host Own fixture edited', exact: true }).waitFor()
  await page.locator(`[data-host-id="${ownedHost.id}"] [data-host-actions-button]`).first().click()
  await page.getByText('Excluir host', { exact: true }).last().click()
  await page.getByRole('button', { name: 'Remover cadastro', exact: true }).click()
  await page.getByText('Cadastro removido.', { exact: false }).waitFor()
  assert.ok((await db.host.findUniqueOrThrow({ where: { id: ownedHost.id } })).deletedAt)
  // Public-IP fixture is metadata only: never establish a connection to that address.
  await page.screenshot({ path: `${output}/resources-real.png`, fullPage: true })
  let sshOutput = ''
  page.on('websocket', socket => socket.on('framereceived', event => { sshOutput += String(event.payload) }))
  await page.evaluate(host => sessionStorage.setItem('na:pending-terminal-host', JSON.stringify({ id: host.id, name: host.name, ip: host.ip, port: host.port, authType: 'password', accessProtocol: 'ssh' })), host)
  console.log('Checking real gateway SSH terminal.')
  await page.goto(`${frontend}/terminal`)
  await page.locator('.xterm-helper-textarea').waitFor()
  await page.waitForTimeout(2000)
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type("printf 'NA0068_RESULT_%s\\n' \"$((123+456))\"")
  await page.keyboard.press('Enter')
  const deadline = Date.now() + 20_000
  while (!sshOutput.includes('NA0068_RESULT_579') && Date.now() < deadline) await page.waitForTimeout(200)
  assert.ok(sshOutput.includes('NA0068_RESULT_579'), 'Real SSH command output required')
  await page.screenshot({ path: `${output}/terminal-real.png`, fullPage: true })
  const sftp = await page.request.get(`${frontend}/api/v1/sftp/${host.id}/list?path=.` , { headers })
  assert.equal(sftp.status(), 200, `SFTP listing failed: ${await sftp.text()}`)
  // Preserve activated fixture for mandatory PTY tool. Only identifiers/fixture email written.
  await writeFile(`${output}/fixture.json`, JSON.stringify({ trialId, tenantId: trial.tenantId, userId: user.id, email: visitorEmail, hostId: host.id, normalTenantId: normalTenant.id, normalUserId: normalUser.id, frontend, api: process.env.TRIAL_LIVE_API || 'http://127.0.0.1:3190' }, null, 2), { mode: 0o600 })
  assert.equal((await normalPage.request.get(`${frontend}/api/v1/hosts`, { headers: { authorization: `Bearer ${normalToken}` } })).status(), 200)
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: normalUser.id } })).active, true)
  assert.deepEqual(errors, [])
  assert.deepEqual(failedHttp, [], 'Authenticated bootstrap must not issue failed requests')
  await writeFile(`${output}/result.json`, JSON.stringify({ at: new Date().toISOString(), result: 'PASS', real: ['MySQL', 'Redis rate limiting', 'Fastify trial routes', 'full API login', 'MFA setup/confirmation', 'browser Hosts', 'machine expansion routes and SQL', 'own host CRUD and encrypted credential preservation (no external connection)', 'gateway SSH command', 'SFTP', 'normal session preservation'], simulated: ['SMTP delivery', 'VM provisioning/isolation'], errors, failedHttp }, null, 2))
  retainForPty = true
  console.log('Live browser/API/MFA/SSH/SFTP checks passed; fixture identifiers retained for PTY.')
} catch (error) {
  for (const [index, context] of browser.contexts().entries()) {
    const page = context.pages()[0]
    if (page) await page.screenshot({ path: `${output}/failure-${index}.png`, fullPage: true }).catch(() => undefined)
  }
  await writeFile(`${output}/failure.json`, JSON.stringify({ at: new Date().toISOString(), failedHttp, errors, message: error instanceof Error ? error.message : 'Unknown failure' }, null, 2))
  throw error
} finally {
  await browser.close()
  await api.close()
  if (!retainForPty && trialId) { await service.cancelById(trialId); await service.tick() }
  if (oldProfile) await db.trialProfile.update({ where: { id: 1 }, data: { configJson: oldProfile.configJson! } })
  await redis.quit()
  await db.$disconnect()
}
