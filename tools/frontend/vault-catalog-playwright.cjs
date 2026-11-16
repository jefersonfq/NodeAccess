#!/usr/bin/env node
const { chromium } = require('playwright')
const { harnessEndpoint } = require('../shared/harness-endpoint.cjs')
const { runVaultFlow } = require('./vault-catalog-flow.cjs')

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  try { console.log(JSON.stringify(await runVaultFlow(browser, harnessEndpoint(process.env.FRONTEND_BASE || 'http://127.0.0.1:5199')))) } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
