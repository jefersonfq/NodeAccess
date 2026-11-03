#!/usr/bin/env node
const { artifactPath } = require('../shared/private-artifacts.cjs')

const { harnessEndpoint } = require('../shared/harness-endpoint.cjs')
const fs = require('node:fs')
const { chromium } = require('playwright')

const frontend = harnessEndpoint(process.env.FRONTEND_BASE || 'http://127.0.0.1:5174')
const accessToken = process.env.HA_TEST_ACCESS_TOKEN
const nodeName = process.env.HA_TEST_NODE_NAME
const nodeEndpoint = process.env.HA_TEST_NODE_ENDPOINT
const virtualIp = process.env.HA_TEST_VIRTUAL_IP
const reportPath = process.env.REPORT_PATH || artifactPath('nodeaccess-ha-live-enrollment.json')

for (const key of ['HA_TEST_ACCESS_TOKEN', 'HA_TEST_NODE_NAME', 'HA_TEST_NODE_ENDPOINT', 'HA_TEST_VIRTUAL_IP']) {
  if (!process.env[key]?.trim()) throw new Error(`${key} é obrigatório para selecionar explicitamente o ambiente descartável`)
}

async function main() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== '0',
    executablePath: fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined,
    args: ['--no-sandbox', '--disable-gpu'],
  })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.addInitScript((token) => localStorage.setItem('na_access_token', token), accessToken)
  const page = await context.newPage()
  try {
    await page.goto(`${frontend}/platform/high-availability?enrollmentTest=${Date.now()}`, {
      waitUntil: 'networkidle',
      timeout: 45_000,
    })
    const existingCard = page.locator('.node-grid .n-card').filter({
      has: page.getByRole('heading', { name: nodeName, exact: true }),
    })
    if (await existingCard.count()) {
      await existingCard.getByRole('button', { name: 'Remover nó' }).click()
      await page.getByRole('button', { name: 'Confirmar' }).click()
      await existingCard.waitFor({ state: 'detached' })
    }

    await page.getByRole('button', { name: 'Anexar nó' }).click()
    const submit = page.getByRole('button', { name: 'Gerar matrícula' })
    const blockedWithoutVip = await submit.isDisabled()
    await page.getByPlaceholder('Ex.: nodeaccess-b').fill(nodeName)
    await page.getByPlaceholder('Ex.: 192.168.1.101').fill(nodeEndpoint)
    await page.getByPlaceholder('Ex.: 192.168.1.105').fill(virtualIp)
    await submit.click()

    const commandField = page.locator('.install-card textarea')
    await commandField.waitFor()
    const command = await commandField.inputValue()
    const agentScopeVisible = await page.getByText(
      'O agente inicia a validação e pode instalar a release',
      { exact: true },
    ).isVisible()
    const result = {
      blockedWithoutVip,
      agentScopeVisible,
      commandVisible: await commandField.isVisible(),
      hasNodeId: /--node-id '[^']+'/.test(command),
      hasEnrollmentToken: /NODEACCESS_HA_ENROLLMENT_TOKEN='[^']+'/.test(command),
      hasExplicitVip: command.includes(`--virtual-ip '${virtualIp}'`),
      hasHttpOptIn: frontend.startsWith('https://')
        ? !command.includes('NODEACCESS_HA_ALLOW_HTTP=true')
        : command.includes('NODEACCESS_HA_ALLOW_HTTP=true'),
      command,
    }
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), { mode: 0o600 })
    if (Object.entries(result).some(([key, value]) => key !== 'command' && value !== true)) {
      process.exitCode = 1
    }
    console.log(JSON.stringify({ ...result, command: '[redacted]' }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
