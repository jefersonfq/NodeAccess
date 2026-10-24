#!/usr/bin/env node
// Browser validation with synthetic API responses; never creates a real session.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  try {
    const page = await browser.newPage()
    const errors = []
    let submissions = 0
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('nodeaccess_locale', 'pt-BR'))
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/auth/login')) {
        submissions++
        return route.fulfill({ status: 401, json: { message: 'Credenciais de teste recusadas' } })
      }
      return route.fulfill({ json: path.endsWith('/auth/lookup-tenant') ? { tenants: [{ id: 1, slug: 'fixture', name: 'Fixture' }] } : { enabled: false } })
    })
    await page.goto((process.env.FRONTEND_BASE || 'http://127.0.0.1:5297') + '/login')
    await page.locator('input').first().fill('visitor@example.test')
    await page.locator('button[type="submit"]').click()
    await page.locator('input[type="password"]').waitFor()
    // Empty password must produce a local Zod issue, without HTTP or an exception.
    await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await page.getByText('Senha obrigatória', { exact: true }).waitFor()
    assert.equal(submissions, 0)
    await page.locator('input[type="password"]').fill('Synthetic-invalid-password')
    await page.locator('button[type="submit"]').click()
    await page.getByText('Credenciais de teste recusadas', { exact: true }).waitFor()
    assert.equal(submissions, 1)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, emptyPasswordLocalIssue: true, noInvalidRequest: true, recovery: true, errors }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
