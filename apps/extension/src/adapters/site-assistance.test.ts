import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page, type Frame } from 'playwright'
import { injectSiteAssistance, type SiteAssistanceConfig, type SiteAssistanceMessage } from './site-assistance'

const origin = 'https://login.example.test'
const login = '<form><input id="user" autocomplete="username"><input id="pass" type="password" autocomplete="current-password"><button>Submit</button></form>'
const item = { id: 7, version: 2, label: '<img src=x onerror=alert(1)>', username: 'fixture-user' }
let browser: Browser, page: Page
const moduleCoverage = process.env.NODEACCESS_SITE_ASSISTANCE_MODULE_COVERAGE === '1'
let moduleUrl = '', stopCoverage: (() => Promise<void>) | undefined
const { attachBrowserCoverage } = createRequire(import.meta.url)('../../../../tools/coverage/playwright-coverage.cjs') as {
  attachBrowserCoverage: (page: Page, browser: Browser) => Promise<(() => Promise<void>) | undefined>
}
beforeAll(async () => {
  if (moduleCoverage) {
    const base = new URL(process.env.FRONTEND_BASE ?? '')
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port || base.origin !== process.env.FRONTEND_BASE ||
        !process.env.BROWSER_COVERAGE_DIR || !process.env.BROWSER_COVERAGE_RUN_ID) throw new Error('Explicit loopback coverage collector required')
    moduleUrl = `${base.origin}/@fs${fileURLToPath(new URL('./site-assistance.ts', import.meta.url))}`
  }
  browser = await chromium.launch({ channel: 'chromium', headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
})
afterAll(async () => { await browser?.close() })
afterEach(async () => { await stopCoverage?.(); stopCoverage = undefined })
beforeEach(async () => {
  await page?.close()
  page = await browser.newPage()
  if (moduleCoverage) {
    // Only this disposable fixture may import the collector's loopback module.
    await page.context().grantPermissions(['local-network-access'], { origin })
    stopCoverage = await attachBrowserCoverage(page, browser)
    if (!stopCoverage) throw new Error('Browser coverage hook did not start')
  }
  await page.route('https://**/*', route => route.fulfill({ contentType: 'text/html', body: login }))
  await page.goto(origin)
  await page.evaluate(() => {
    const scope = window as unknown as { chrome: unknown; messages: unknown[] }
    scope.messages = []
    scope.chrome = { runtime: { sendMessage: (message: unknown) => { scope.messages.push(message); return Promise.resolve() } } }
    document.addEventListener('submit', event => event.preventDefault())
  })
})
const invoke = (target: Page | Frame, config: SiteAssistanceConfig): Promise<boolean> => target.evaluate<boolean>(moduleCoverage
  ? `import(${JSON.stringify(moduleUrl)}).then(module => module.injectSiteAssistance(${JSON.stringify(config)}))`
  : `(${injectSiteAssistance.toString()})(${JSON.stringify(config)})`)
const install = (overrides: Partial<SiteAssistanceConfig> = {}): Promise<boolean> => invoke(page, { origin, capability: 'a'.repeat(43), expiresAt: Date.now() + 10000, items: [item], captureOptIn: false, locale: 'en', ...overrides })
const messages = async (): Promise<SiteAssistanceMessage[]> => page.evaluate(() => (window as unknown as { messages: SiteAssistanceMessage[] }).messages)
const choose = async (): Promise<void> => { await page.locator('#user').click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter') }
const submit = async (): Promise<void> => { await page.locator('#user').fill('fixture-user'); await page.locator('#pass').fill('fixture-password'); await page.getByRole('button', { name: 'Submit' }).click() }

describe('site assistance in real Chromium DOM (runtime boundary stubbed)', () => {
  it.each(['throw', 'reject'] as const)('discards a %s from runtime without retry or unhandled errors', async mode => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.evaluate(mode => {
      const scope = window as unknown as { attempts: number; chrome: { runtime: { sendMessage(): Promise<unknown> } } }
      scope.attempts = 0
      scope.chrome.runtime.sendMessage = (): Promise<unknown> => {
        scope.attempts++
        if (mode === 'throw') throw new Error('Invalidated fixture extension context')
        return Promise.reject(new Error('Rejected fixture runtime message'))
      }
    }, mode)
    await install(); await choose(); await page.waitForTimeout(50); await choose()
    expect(await page.evaluate(() => (window as unknown as { attempts: number }).attempts)).toBe(1)
    expect(errors).toEqual([])
    expect(await messages()).toEqual([])
  })
  it('offers metadata only, keeps capability outside DOM and emits only a fill intention with trusted keyboard', async () => {
    expect(await install()).toBe(true)
    await choose()
    expect(await messages()).toEqual([{ type: 'SITE_ASSISTANCE_INTENT', capability: 'a'.repeat(43), origin, intent: { kind: 'fill', id: item.id, version: 2 } }])
    expect(await page.locator('#pass').inputValue()).toBe('')
    expect(await page.content()).not.toContain('a'.repeat(43))
    expect(await page.locator('img').count()).toBe(0)
    await choose(); expect(await messages()).toHaveLength(1)
  })
  it('Escape dismisses suggestions and does not emit intentions', async () => {
    await install(); await page.locator('#user').click(); await page.keyboard.press('Escape'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
    expect(await messages()).toEqual([])
  })
  it('supports ArrowUp and Escape from a focused suggestion', async () => {
    await install(); await page.locator('#user').click(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Escape')
    expect(await page.locator('#user').evaluate(node => document.activeElement === node)).toBe(true)
    expect(await messages()).toEqual([])
  })
  it('does not read credentials on focus or capture without opt-in', async () => {
    await install(); await submit(); expect(await messages()).toEqual([])
  })
  it('offers metadata at an explicitly marked username-only step without capturing a password', async () => {
    await page.setContent('<form><input id="user" autocomplete="username"><button>Submit</button></form>')
    await install({ captureOptIn: true }); await choose()
    expect((await messages())[0]?.intent).toEqual({ kind: 'fill', id: 7, version: 2 })
  })
  it('ArrowUp starts at the last suggestion', async () => {
    await install({ items: [item, { ...item, id: 8 }] }); await page.locator('#user').click(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
    expect((await messages())[0]?.intent).toMatchObject({ kind: 'fill', id: 8 })
  })
  it('captures only a review proposal after explicit submit, once', async () => {
    await install({ captureOptIn: true }); await submit()
    expect((await messages())[0]?.intent).toEqual({ kind: 'review-capture', username: 'fixture-user', password: 'fixture-password', mode: 'login' })
    await submit(); expect(await messages()).toHaveLength(1)
  })
  it('accepts trusted Enter submission when no suggestion was selected', async () => {
    await install({ captureOptIn: true, items: [] }); await page.locator('#user').fill('u'); await page.locator('#pass').fill('p'); await page.keyboard.press('Enter')
    expect((await messages())[0]?.intent).toMatchObject({ kind: 'review-capture', password: 'p' })
  })
  it('does not accept synthetic keyboard/submit or script requestSubmit', async () => {
    await install({ captureOptIn: true }); await page.locator('#pass').fill('synthetic')
    await page.evaluate(() => {
      document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true }))
      document.querySelector('form')!.requestSubmit()
    })
    expect(await messages()).toEqual([])
  })
  it('captures matching new+confirmation and never the old value', async () => {
    await page.setContent('<form><input id="user" autocomplete="username"><input id="old" type="password" autocomplete="current-password"><input id="pass" type="password" autocomplete="new-password"><input id="confirm" type="password" autocomplete="new-password"><button>Submit</button></form>')
    await page.evaluate(() => { document.querySelector('form')!.addEventListener('submit', event => event.preventDefault()); Object.defineProperty(document.querySelector('#old'), 'value', { get() { throw Error('Old password must not be read') } }) })
    await install({ captureOptIn: true }); await page.locator('#user').fill('u'); await page.locator('#pass').fill('new'); await page.locator('#confirm').fill('new'); await page.getByRole('button').click()
    expect((await messages())[0]?.intent).toEqual({ kind: 'review-capture', username: 'u', password: 'new', mode: 'password-change' })
  })
  it.each([
    '<input id="user"><input id="pass" type="password"><input type="password">',
    '<input id="user"><input id="pass" type="password" autocomplete="new-password">',
    '<input id="user"><input id="pass" type="password" autocomplete="new-password"><input type="password" autocomplete="new-password" value="different">',
    '<input id="user"><input id="pass" type="password"><input autocomplete="one-time-code">',
    '<input id="user"><input id="pass" type="password"><input name="totp">',
    '<input id="user"><input id="pass" type="password" style="opacity:0">',
    '<input id="user"><input id="pass" type="password" readonly>',
    '<input id="user"><input id="pass" type="password" disabled>',
  ])('refuses ambiguous, OTP, hidden and noneditable forms: %s', async html => {
    await page.setContent(`<form>${html}<button>Submit</button></form>`)
    await page.evaluate(() => { document.querySelector('form')!.addEventListener('submit', event => event.preventDefault()); const field = document.querySelector<HTMLInputElement>('#pass'); if (field) field.value = 'p' })
    await install({ captureOptIn: true }); await page.locator('#user').click(); await page.getByRole('button').click(); expect(await messages()).toEqual([])
  })
  it('does not capture another form or read hidden honeypots', async () => {
    await page.setContent(`${login}<form id="other"><input type="password" value="other"><button>Other</button></form><input id="hidden" type="password" hidden>`)
    await page.evaluate(() => { document.addEventListener('submit', event => event.preventDefault()); Object.defineProperty(document.querySelector('#hidden'), 'value', { get() { throw Error('Hidden read') } }) })
    await install({ captureOptIn: true }); await page.locator('#pass').fill('p'); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Other', exact: true }).click(); expect(await messages()).toEqual([])
  })
  it('refuses overlong password proposals', async () => {
    await install({ captureOptIn: true }); await page.locator('#pass').fill('a'.repeat(1025)); await page.getByRole('button').click(); expect(await messages()).toEqual([])
  })
  it.each([{ origin: 'https://other.test' }, { capability: 'short' }, { expiresAt: 1 }, { expiresAt: Date.now() + 300000 }, { items: [{ ...item, version: 0 }] }])('rejects invalid binding/config %j', async config => {
    expect(await install(config)).toBe(false); expect(await messages()).toEqual([])
  })
  it('expires and clears listeners without a subsequent page gesture', async () => {
    await install({ expiresAt: Date.now() + 150 }); await page.waitForTimeout(200); await choose(); expect(await messages()).toEqual([])
  })
  it('stops on same-document URL change and pagehide', async () => {
    await install({ captureOptIn: true }); await page.evaluate(() => history.pushState({}, '', '/changed')); await submit(); expect(await messages()).toEqual([])
    await install({ captureOptIn: true }); await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await submit(); expect(await messages()).toEqual([])
  })
  it('replaces a previous installation rather than duplicate listeners or proposals', async () => {
    await install({ captureOptIn: true }); await install({ captureOptIn: true, capability: 'b'.repeat(43) }); await submit()
    expect(await messages()).toHaveLength(1); expect((await messages())[0]?.capability).toBe('b'.repeat(43))
  })
  it('refuses iframe execution even on the same origin', async () => {
    await page.setContent('<iframe src="https://login.example.test/frame"></iframe>')
    const frame = await page.locator('iframe').elementHandle().then(node => node.contentFrame())
    await frame!.waitForLoadState()
    expect(await invoke(frame!, { origin, capability: 'a'.repeat(43), expiresAt: Date.now() + 10000, items: [], captureOptIn: true })).toBe(false)
  })
})
