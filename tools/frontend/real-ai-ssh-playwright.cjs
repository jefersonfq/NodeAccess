#!/usr/bin/env node
const path = require('node:path')
const dotenv = require('dotenv')
const jwt = require('jsonwebtoken')
const { chromium } = require('playwright')

dotenv.config({ path: path.resolve(__dirname, '../../apps/backend/.env'), override: true })

const frontend = (process.env.FRONTEND_BASE || 'http://127.0.0.1:5178').replace(/\/$/, '')
const hostId = Number(process.env.AI_SSH_HOST_ID || 7027)
const cdpUrl = process.env.CHROMIUM_CDP_URL || ''

function accessToken() {
  return jwt.sign({
    sub: '1',
    email: 'admin@nodeaccess.local',
    role: 'admin',
    isPlatformAdmin: true,
    tenantId: 1,
    canManageHosts: true,
    canViewLiveSessions: false,
    forcePasswordChange: false,
    sessionVersion: 0,
    stage: 'authenticated',
  }, process.env.JWT_SECRET, { expiresIn: '10m' })
}

async function main() {
  const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await context.addInitScript(({ token, host }) => {
    localStorage.setItem('na_access_token', token)
    sessionStorage.setItem('na:pending-terminal-host', JSON.stringify({
      id: host,
      name: 'AI SSH certification target',
      ip: '127.0.0.1',
      port: 2223,
      authType: 'password',
      accessProtocol: 'ssh',
    }))
  }, { token: accessToken(), host: hostId })

  const page = await context.newPage()
  const pageErrors = []
  const failedResponses = []
  const webSockets = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() })
  })
  page.on('websocket', (socket) => webSockets.push(socket.url()))
  await page.goto(`${frontend}/terminal`, { waitUntil: 'domcontentloaded' })

  const trustButton = page.getByRole('button', { name: /Trust and continue|Confiar e continuar/i })
  const trustRequired = await trustButton.waitFor({ state: 'visible', timeout: 45_000 })
    .then(() => true)
    .catch(() => false)
  if (trustRequired) {
    await trustButton.click()
  }

  try {
    await page.waitForFunction(() => window.__NODEACCESS_TERMINAL_HARNESS__?.flags.ready === true, null, { timeout: 45_000 })
  } catch (error) {
    const debug = await page.evaluate(() => ({
      harness: window.__NODEACCESS_TERMINAL_HARNESS__,
      body: document.body.innerText.slice(0, 4_000),
    }))
    throw new Error(`SSH did not become ready: ${JSON.stringify({ debug, failedResponses, webSockets, pageErrors })}`, { cause: error })
  }
  const terminalInput = page.locator('.xterm-helper-textarea').first()
  await terminalInput.focus()
  await terminalInput.pressSequentially("printf 'NODEACCESS_REAL_SSH_OK\\n'", { delay: 8 })
  await terminalInput.press('Enter')
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('NODEACCESS_REAL_SSH_OK'), null, { timeout: 15_000 })

  await terminalInput.press('Control+Space')
  await page.getByTestId('terminal-inline-autocomplete').waitFor()
  await page.getByTestId('terminal-inline-autocomplete').getByText('pwd', { exact: true }).click()
  await terminalInput.press('Control+U')
  const commandsBeforeAiPrefix = (await page.evaluate(() => window.__NODEACCESS_TERMINAL_HARNESS__))?.counts.commandSent
  await terminalInput.pressSequentially('@ai ', { delay: 20 })
  const prompt = page.getByTestId('terminal-ai-prompt').locator('textarea')
  await prompt.waitFor()
  const commandsAfterAiPrefix = (await page.evaluate(() => window.__NODEACCESS_TERMINAL_HARNESS__))?.counts.commandSent
  if (commandsAfterAiPrefix !== commandsBeforeAiPrefix) throw new Error('@ai prefix was sent to SSH instead of being intercepted')
  await prompt.fill('Explique objetivamente o marcador NODEACCESS_REAL_SSH_OK presente no terminal real.')
  await page.getByTestId('terminal-ai-send').click()
  await page.getByText(/^(Assistente|Assistant)$/).waitFor({ timeout: 60_000 })
  await page.getByText('ollama', { exact: true }).waitFor({ timeout: 60_000 })

  const modalText = await page.locator('.n-modal').last().innerText()
  const harness = await page.evaluate(() => window.__NODEACCESS_TERMINAL_HARNESS__)
  if (!modalText.includes('NODEACCESS_REAL_SSH_OK')) throw new Error('AI response did not preserve the real terminal marker context')
  if (!harness?.flags.ready || !harness?.flags.outputReceived || harness.counts.commandSent < 1) {
    throw new Error(`Unexpected terminal harness state: ${JSON.stringify(harness)}`)
  }
  if (pageErrors.length) throw new Error(`Browser errors: ${JSON.stringify(pageErrors)}`)

  console.log(JSON.stringify({
    connected: harness.flags.ready,
    realOutput: harness.flags.outputReceived,
    commandsSent: harness.counts.commandSent,
    aiProvider: 'ollama',
    aiContextMarkerObserved: true,
    deterministicAutocomplete: true,
    aiPrefixIntercepted: true,
    cdp: !!cdpUrl,
  }))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
