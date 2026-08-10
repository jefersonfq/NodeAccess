#!/usr/bin/env node
const fs = require('node:fs')
const { chromium } = require('playwright')

const FRONTEND = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5174').replace(/\/$/, '')
const REPORT_PATH = process.env.REPORT_PATH || '/tmp/nodeaccess-pem-key-passphrase.json'
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser'

function fakeJwt() {
  const now = Math.floor(Date.now() / 1000)
  return `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: '1', userId: 1, tenantId: 1, role: 'admin', email: 'admin@test', name: 'Admin', canManageHosts: true, stage: 'authenticated', iat: now, exp: now + 3600 })).toString('base64url')}.harness`
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE_PATH })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript((token) => {
    localStorage.setItem('na_access_token', token)
    localStorage.setItem('na_refresh_token', 'pem-harness-refresh')
  }, fakeJwt())

  const creates = []
  let keys = []
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = null
    let status = 200
    if (path === '/api/v1/pem-keys' && request.method() === 'POST') {
      const payload = request.postDataJSON()
      creates.push(payload)
      const created = { id: 71, name: payload.name, createdById: 1, createdAt: new Date().toISOString(), hasPassphrase: Boolean(payload.passphrase) }
      keys = [created]
      body = created
      status = 201
    } else if (path === '/api/v1/pem-keys') body = keys
    else if (path === '/api/v1/features') body = {}
    else if (path.includes('/preferences')) body = null
    else body = []
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })

  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Log.enable')])
  const anomalies = []
  cdp.on('Runtime.exceptionThrown', (event) => anomalies.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text))
  cdp.on('Log.entryAdded', (event) => { if (event.entry.level === 'error') anomalies.push(event.entry.text) })

  await page.goto(`${FRONTEND}/pem-keys?passphraseHarness=${Date.now()}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Nova chave|New key/ }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  const inputs = dialog.locator('input')
  await inputs.nth(0).fill('encrypted-prod-key')
  await dialog.locator('textarea').fill('-----BEGIN ENCRYPTED PRIVATE KEY-----\nZmFrZQ==\n-----END ENCRYPTED PRIVATE KEY-----')
  await page.getByText(/Chave criptografada detectada|Encrypted key detected/).waitFor()
  await page.getByRole('button', { name: /Salvar chave|Save key/ }).click()
  await page.locator('.n-message').getByText(/Digite a senha da chave|Enter its passphrase/).waitFor()
  if (creates.length !== 0) throw new Error('Formulário enviou chave criptografada sem passphrase')

  await dialog.locator('input[type="password"]').fill('correct horse battery staple')
  await page.getByRole('button', { name: /Salvar chave|Save key/ }).click()
  await page.getByText(/salva com sucesso|saved successfully/i).waitFor()
  if (creates.length !== 1 || creates[0].passphrase !== 'correct horse battery staple') throw new Error('Passphrase não foi enviada corretamente')

  await page.setViewportSize({ width: 360, height: 740 })
  await page.getByRole('button', { name: /Nova chave|New key/ }).click()
  const mobileBox = await page.getByRole('dialog').boundingBox()
  if (!mobileBox || mobileBox.x < 0 || mobileBox.x + mobileBox.width > 360) throw new Error('Modal PEM extrapola viewport mobile')
  await page.keyboard.press('Escape')
  if (anomalies.length) throw new Error(`Anomalias CDP: ${anomalies.join('; ')}`)

  const report = {
    changeId: 'NA-0014', frontend: FRONTEND, result: 'passed',
    encryptedDetected: true, missingPassphraseBlocked: true, passphraseSubmitted: true,
    keyboardOpenedModal: true, mobileModalFits: true, cdpAnomalies: anomalies,
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
