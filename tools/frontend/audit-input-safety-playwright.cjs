#!/usr/bin/env node
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { chromium } = require('playwright')
const { installRoutes, authenticate, SESSION_ID } = require('./session-playback-playwright.cjs')
const { artifactPath } = require('../shared/private-artifacts.cjs')
const { navigationFixture } = require('./sonar-flow-fixtures.cjs')

async function main() {
  const output = process.env.AUDIT_INPUT_OUTPUT || mkdtempSync(join(tmpdir(), 'nodeaccess-audit-input-safety-'))
  artifactPath('report.json', output)
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined })
  const report = { output, startedAt: new Date().toISOString(), checks: [], transport: 'intercepted API/WebSocket; actual Vue and keyboard events' }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
    await installRoutes(context, { events: [
      { seq: 1, type: 'session_started', timestamp: '2026-08-13T12:00:00.000Z', text: '' },
      { seq: 2, type: 'stdout', timestamp: '2026-08-13T12:00:01.000Z', text: Array.from({ length: 100 }, (_, index) => `Linha sintética ${index + 1}`).join('\r\n') },
      { seq: 3, type: 'session_ended', timestamp: '2026-08-13T12:00:02.000Z', text: '' },
    ] })
    await context.addInitScript(() => localStorage.setItem('nodeaccess_locale', 'pt-BR'))
    const page = await context.newPage()
    if (process.env.BROWSER_COVERAGE_DIR) await require('../coverage/playwright-coverage.cjs').attachBrowserCoverage(page, browser)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await authenticate(page)
    const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5198'
    await page.goto(`${base}/admin/session-audit/${SESSION_ID}?tab=playback`)
    const terminal = page.locator('[data-playback-terminal]')
    await terminal.waitFor()
    await page.locator('[data-playback-action="load-end"]').click()
    await terminal.focus()
    await terminal.evaluate(element => { element.scrollTop = 0 })
    await page.keyboard.press('PageDown')
    await page.waitForFunction(() => document.querySelector('[data-playback-terminal]').scrollTop > 0)
    const selectedText = await terminal.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      return selection.toString()
    })
    await page.keyboard.press('Control+c')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selectedText)
    await page.evaluate(() => window.getSelection().removeAllRanges())
    await page.evaluate(() => { window.__auditKeys = []; window.addEventListener('keydown', event => window.__auditKeys.push({ key: event.key, prevented: event.defaultPrevented })) })
    for (const key of ['ArrowDown', 'PageDown', 'Control+c']) await page.keyboard.press(key)
    assert((await page.evaluate(() => window.__auditKeys)).every(event => !event.prevented))
    const text = await terminal.textContent()
    await page.keyboard.type('READ_ONLY_CHECK')
    assert.equal(await terminal.textContent(), text)
    await page.keyboard.press('Tab')
    assert.equal(await terminal.evaluate(el => el === document.activeElement), false)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await terminal.evaluate(el => el === document.activeElement), true)
    assert.notEqual(await terminal.evaluate(el => getComputedStyle(el).boxShadow), 'none')
    await page.screenshot({ path: join(output, 'playback-desktop.png'), fullPage: true })
    report.checks.push('Playback stays read-only; Tab leaves and Shift+Tab returns with visible focus')

    const sent = []
    let graphicalSocket
    await context.routeWebSocket(/\/ws\/graphical\//, socket => {
      graphicalSocket = socket
      socket.onMessage(message => sent.push(JSON.parse(String(message))))
      socket.send(JSON.stringify({ type: 'graphical_gateway_connected', code: 'GRAPHICAL_GATEWAY_CONNECTED', sessionId: 123, protocol: 'vnc', hostId: 9, hostName: 'Host sintético', message: 'Fixture' }))
    })
    await context.route('**/api/v1/hosts/9', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 9, tenantId: 1, name: 'Host sintético', ip: '192.0.2.9', port: 5900, accessProtocol: 'vnc', authType: 'password', connectionMode: 'direct', scope: 'global', accessPermissions: { view: true, connect: true, edit: true, admin: true }, tags: [] }) }))
    await page.goto(`${base}/graphical/9`)
    const canvas = page.locator('canvas[role="application"]')
    await canvas.waitFor()
    await canvas.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    assert.equal(await canvas.evaluate(el => el === document.activeElement), true)
    await page.keyboard.down('Control')
    await page.keyboard.down('Alt')
    await page.keyboard.down('Shift')
    const resume = page.getByRole('button', { name: 'Retomar teclado remoto', exact: true })
    await resume.waitFor()
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Retomar teclado remoto')
    await page.keyboard.up('Shift')
    await page.keyboard.up('Alt')
    await page.keyboard.up('Control')
    const messages = sent.filter(item => item.type === 'guacd').map(item => item.data)
    for (const key of [65289, 65307, 65507, 65513]) {
      assert(messages.includes(`3.key,5.${key},1.1;`), `Missing remote keydown ${key}`)
      assert(messages.includes(`3.key,5.${key},1.0;`), `Missing remote keyup ${key}`)
    }
    assert(!messages.includes('3.key,5.65505,1.1;'), 'Exit chord must not send final modifier down')
    await page.screenshot({ path: join(output, 'canvas-local-keyboard-desktop.png'), fullPage: true })
    await page.keyboard.press('Tab')
    assert.equal(await canvas.evaluate(el => el === document.activeElement), false)
    await resume.click()
    await page.waitForFunction(() => document.activeElement?.tagName === 'CANVAS')
    await page.screenshot({ path: join(output, 'canvas-remote-desktop.png'), fullPage: true })
    await page.keyboard.down('a')
    await page.getByRole('button', { name: 'Mostrar detalhes', exact: true }).click()
    assert(sent.some(item => item.data === '3.key,2.97,1.0;'), 'Blur must release a held remote character')
    await page.keyboard.up('a')
    await page.getByRole('button', { name: 'Ocultar detalhes', exact: true }).click()
    // Reproduce a late fullscreen callback after the user explicitly releases remote input.
    // Only the harness controls frame delivery; product scheduling and timeouts stay unchanged.
    await page.evaluate(() => {
      const requestFrame = window.requestAnimationFrame.bind(window)
      const queued = []
      let hold = false
      document.addEventListener('fullscreenchange', () => { hold = true }, { once: true, capture: true })
      window.requestAnimationFrame = callback => requestFrame(timestamp => {
        if (hold) queued.push(() => callback(timestamp))
        else callback(timestamp)
      })
      window.__fullscreenFocusRace = { release: async () => {
        const delayedFrames = queued.length
        hold = false
        window.requestAnimationFrame = requestFrame
        for (const callback of queued) requestFrame(callback)
        await new Promise(resolve => requestFrame(() => requestFrame(() => requestFrame(resolve))))
        return delayedFrames
      } }
    })
    await page.getByRole('button', { name: 'Tela cheia', exact: true }).click()
    await page.waitForFunction(() => Boolean(document.fullscreenElement), null, { polling: 20 })
    await canvas.focus()
    await page.keyboard.press('Control+Alt+Shift')
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Retomar teclado remoto', null, { polling: 20 })
    const delayedFrames = await page.evaluate(() => window.__fullscreenFocusRace.release())
    assert(delayedFrames > 0, 'Fullscreen race must exercise delayed animation frames')
    await page.screenshot({ path: join(output, 'canvas-local-keyboard-fullscreen.png'), fullPage: true })
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Retomar teclado remoto', 'Late fullscreen callback must preserve local keyboard focus')
    report.checks.push('Delayed fullscreen frames preserve explicit local keyboard mode and return-button focus')
    await page.evaluate(() => document.exitFullscreen())
    await page.waitForFunction(() => !document.fullscreenElement)
    await page.setViewportSize({ width: 390, height: 844 })
    await canvas.focus()
    const hint = page.locator(`#${await canvas.getAttribute('aria-describedby')}`)
    const box = await hint.boundingBox()
    assert(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 844)
    await page.screenshot({ path: join(output, 'canvas-mobile.png'), fullPage: true })
    await page.keyboard.press('Control+Alt+Shift')
    await resume.waitFor()
    graphicalSocket.send(JSON.stringify({ type: 'closed' }))
    await resume.waitFor({ state: 'hidden' })
    const sentAfterClose = sent.length
    await canvas.focus()
    await page.keyboard.press('a')
    assert.equal(sent.length, sentAfterClose, 'Closed session must not forward keyboard input')
    report.checks.push('Closed canvas hides local return action and forwards no keyboard input')
    report.checks.push('Canvas preserves remote Tab/Escape; exit chord releases modifiers, moves focus and offers return; mobile hint fits')

    await context.route('**/api/v1/hosts/sidebar-bootstrap', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(navigationFixture('/api/v1/hosts/sidebar-bootstrap')) }))
    await context.route('**/api/v1/hosts?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(navigationFixture('/api/v1/hosts')) }))
    await page.setViewportSize({ width: 1440, height: 1000 })
    let createdHosts = 0
    await context.route('**/api/v1/hosts', route => {
      if (route.request().method() === 'POST') createdHosts += 1
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(navigationFixture('/api/v1/hosts')) })
    })
    await page.goto(`${base}/hosts`)
    await page.locator('[data-host-new-button]').first().click()
    const ip = page.locator('#host-form-ip')
    await ip.fill('2001:db8:')
    await page.getByText('IPv6 incompleto — continue digitando o endereço', { exact: true }).waitFor()
    await page.locator('#host-form-name').fill('Host IPv6 sintético')
    await page.getByRole('button', { name: 'Criar', exact: true }).last().click()
    await page.waitForFunction(() => document.activeElement?.id === 'host-form-ip')
    assert.equal(createdHosts, 0, 'Incomplete IPv6 must never reach the create API')
    await ip.fill('1::2::3')
    await page.getByText('IPv6 inválido', { exact: true }).first().waitFor()
    await page.screenshot({ path: join(output, 'ipv6-invalid-desktop.png'), fullPage: true })
    await ip.fill('::ffff:192.0.2.1/128')
    await page.getByText('IPv6 inválido', { exact: true }).waitFor({ state: 'hidden' })
    report.checks.push('IPv6 typing feedback, incomplete save blocked with focus, repeated compression rejected, mapped IPv4 accepted')
    assert.deepEqual(errors, [])
    report.status = 'passed'
    await context.close()
  } finally {
    await browser.close()
    report.finishedAt = new Date().toISOString()
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify(report))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
