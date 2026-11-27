import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { captureSiteDocument, chromiumSiteFill, injectSiteCredentials } from './site-fill'
const origin = 'https://login.example.test'
const binding = { mode: 'both' as const, origin, tabId: 1, frameId: 0 as const, documentId: 'doc-1' }
let browser: Browser, page: Page
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true })
  page = await browser.newPage()
  await page.route('https://**/*', route => route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }))
  await page.goto(origin)
})
afterAll(async () => { await browser?.close() })
beforeEach(async () => { await page.setContent('<form><input autocomplete="username"><input type="password"><button>Login</button></form>') })
// Execute the exact self-contained functions serialized by chrome.scripting, in a real DOM.
const inject = (username = 'synthetic-user') => page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, ${JSON.stringify(username)}, "synthetic-password")`)
describe('isolated injection DOM behavior (Chromium)', () => {
  it('captures origin without reading values', async () => {
    await page.evaluate(() => { Object.defineProperty(document.querySelector('input'), 'value', { get() { throw new Error('read') } }) })
    expect(await page.evaluate(captureSiteDocument)).toBe(origin)
  })
  it('fills native values and emits changes without submitting', async () => {
    await page.evaluate(() => {
      document.body.dataset.submits = '0'; document.body.dataset.inputs = '0'; document.body.dataset.changes = '0'
      document.querySelector('form')!.addEventListener('submit', e => { e.preventDefault(); document.body.dataset.submits = '1' })
      document.oninput = () => { document.body.dataset.inputs = String(Number(document.body.dataset.inputs) + 1) }
      document.onchange = () => { document.body.dataset.changes = String(Number(document.body.dataset.changes) + 1) }
    })
    expect(await inject()).toBe(true)
    expect(await page.locator('input').first().inputValue()).toBe('synthetic-user')
    expect(await page.locator('input[type=password]').inputValue()).toBe('synthetic-password')
    expect(await page.locator('input[type=password]').getAttribute('value')).toBeNull()
    expect(await page.evaluate(() => ({ ...document.body.dataset }))).toMatchObject({ submits: '0', inputs: '2', changes: '2' })
  })
  it.each(['hidden', 'readonly', 'disabled', 'inert', 'style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"', 'aria-hidden="true"'])('rejects unavailable password %s', async attr => {
    await page.setContent(`<form><input autocomplete="username"><input type="password" ${attr}></form>`)
    expect(await inject()).toBe(false); expect(await page.locator('input').first().inputValue()).toBe('')
  })
  it.each(['<input>', '<input type="password"><input type="password">', '<form><input type="password"></form><form><input type="password"></form>', '<input type="text"><input type="email"><input type="password">', '<input type="password" autocomplete="new-password">', '<input type="password" autocomplete="username">', '<fieldset disabled><input><input type="password"></fieldset>', '<div hidden><input><input type="password"></div>'])('rejects missing/ambiguous/disabled forms %s', async html => {
    await page.setContent(html); expect(await inject()).toBe(false)
  })
  it('permits password-only with empty username', async () => { await page.setContent('<input type="password">'); expect(await inject('')).toBe(true) })
  it('rejects other origin', async () => {
    expect(await page.evaluate(`(${injectSiteCredentials.toString()})("https://other.test", "u", "p")`)).toBe(false)
  })
  it('rejects nested frame', async () => {
    await page.setContent('<iframe src="https://login.example.test/frame"></iframe>')
    const frame = await page.waitForSelector('iframe').then(e => e.contentFrame())
    await frame!.waitForLoadState(); await frame!.setContent('<input><input type="password">')
    expect(await frame!.evaluate(captureSiteDocument)).toBeNull()
    expect(await frame!.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "u", "p")`)).toBe(false)
  })
})
function apiFixture() {
  return { tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }]) }, scripting: { executeScript: vi.fn().mockResolvedValue([{ frameId: 0, documentId: 'doc-1', result: origin }]) } }
}
describe('Chromium binding', () => {
  it('captures frame zero in isolated world and targets document identity for fill', async () => {
    const api = apiFixture(); const browser = chromiumSiteFill(api)
    expect(await browser.capture()).toEqual({ origin, tabId: 1, frameId: 0, documentId: 'doc-1' })
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: origin }]).mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: true }])
    await browser.fill(binding, { mode: 'both', username: 'u', password: 'p' })
    expect(api.scripting.executeScript).toHaveBeenLastCalledWith({ target: { tabId: 1, documentIds: ['doc-1'] }, world: 'ISOLATED', func: injectSiteCredentials, args: [origin, 'u', 'p', false, 'both'] })
    expect(api.scripting.executeScript.mock.calls[0]![0]).toEqual({ target: { tabId: 1, frameIds: [0] }, world: 'ISOLATED', func: captureSiteDocument })
  })
  it.each([[], [{ id: -1 }], [{ id: 1 }, { id: 2 }], [{}]].map(tabs => ({ tabs })))('rejects unavailable active tab $tabs', async ({ tabs }) => {
    const api = apiFixture(); api.tabs.query.mockResolvedValue(tabs); await expect(chromiumSiteFill(api).capture()).rejects.toThrow('target')
  })
  it.each([{ frameId: 1, documentId: 'd', result: origin }, { frameId: 0, result: origin }, { frameId: 0, documentId: 'd', result: null }])('rejects invalid capture %j', async result => {
    const api = apiFixture(); api.scripting.executeScript.mockResolvedValue([result]); await expect(chromiumSiteFill(api).capture()).rejects.toThrow('target')
  })
  it('rejects tab change during capture', async () => {
    const api = apiFixture(); api.tabs.query.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValue([{ id: 2 }]); await expect(chromiumSiteFill(api).capture()).rejects.toThrow('changed')
  })
  it('recaptures immediately before injection and rejects navigation', async () => {
    const api = apiFixture(); api.scripting.executeScript.mockResolvedValue([{ frameId: 0, documentId: 'new', result: origin }])
    await expect(chromiumSiteFill(api).fill(binding, { mode: 'both', username: 'u', password: 'p' })).rejects.toThrow('changed')
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(1)
  })
  it('rejects failed injection without retry', async () => {
    const api = apiFixture(); api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: origin }]).mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: false }])
    await expect(chromiumSiteFill(api).fill(binding, { mode: 'both', username: 'u', password: 'p' })).rejects.toThrow('fields'); expect(api.scripting.executeScript).toHaveBeenCalledTimes(2)
  })
})


describe('credential-free Chromium preflight', () => {
  it('inspects the captured document with empty arguments, without delivering a value', async () => {
    const api = apiFixture()
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: origin }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: 'both' }])
    await chromiumSiteFill(api).preflight(binding)
    expect(api.scripting.executeScript).toHaveBeenLastCalledWith({ target: { tabId: 1, documentIds: ['doc-1'] },
      world: 'ISOLATED', func: injectSiteCredentials, args: [origin, '', '', true, 'both'] })
  })
  it('omits undefined optional mode from the first serialized scripting arguments', async () => {
    const api = apiFixture()
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: origin }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: 'username' }])
    const document = { origin, tabId: 1, frameId: 0 as const, documentId: 'doc-1' }
    expect(await chromiumSiteFill(api).preflight(document)).toBe('username')
    const request = api.scripting.executeScript.mock.calls.at(-1)![0] as { args: unknown[] }
    expect(request.args).toEqual([origin, '', '', true])
    expect(request.args).toEqual(JSON.parse(JSON.stringify(request.args)))
  })
  it('refuses a false/foreign-document preflight response', async () => {
    const api = apiFixture()
    api.scripting.executeScript.mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-1', result: origin }])
      .mockResolvedValueOnce([{ frameId: 0, documentId: 'doc-2', result: 'both' }])
    await expect(chromiumSiteFill(api).preflight(binding)).rejects.toThrow('fields')
  })
})


describe('local context guard around asynchronous capture', () => {
  it('does not inject if local context changes while the final tab capture is pending', async () => {
    const api = apiFixture(); let current = true
    api.tabs.query.mockImplementation(() => { current = false; return Promise.resolve([{ id: 1 }]) })
    await expect(chromiumSiteFill(api, () => current).fill(binding, { mode: 'both', username: 'u', password: 'p' })).rejects.toThrow('changed')
    expect(api.scripting.executeScript.mock.calls.every(call => (call[0] as { args?: unknown[] } | undefined)?.args === undefined)).toBe(true)
  })
})


// These mocks exercise the real adapter's Chrome API boundary only. They do not execute
// or claim DOM coverage for the function serialized into the isolated Chromium world.
describe('Chrome boundary rejects ambiguous and stale results', () => {
  const captureResult = { frameId: 0, documentId: 'doc-1', result: origin }
  const formResult = { frameId: 0, documentId: 'doc-1', result: 'both' }
  it('rejects a capture with more than one target before any credential script', async () => {
    const api = apiFixture()
    api.scripting.executeScript.mockResolvedValue([captureResult, { ...captureResult, documentId: 'another' }])
    await expect(chromiumSiteFill(api).capture()).rejects.toThrow('target')
    expect(api.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 1, frameIds: [0] }, world: 'ISOLATED', func: captureSiteDocument })
  })
  it('requires inferred binding mode and matching credential mode before consulting Chrome', async () => {
    const api = apiFixture(), browser = chromiumSiteFill(api)
    const document = { origin, tabId: 1, frameId: 0 as const, documentId: 'doc-1' }
    await expect(browser.fill(document, { mode: 'both', username: 'u', password: 'p' })).rejects.toThrow('fields')
    await expect(browser.fill(binding, { mode: 'password', password: 'p' })).rejects.toThrow('fields')
    expect(api.tabs.query).not.toHaveBeenCalled()
    expect(api.scripting.executeScript).not.toHaveBeenCalled()
  })
  it.each([
    { label: 'multiple targets', results: [formResult, { ...formResult, frameId: 1 }] },
    { label: 'nested frame', results: [{ ...formResult, frameId: 1 }] },
    { label: 'unknown mode', results: [{ ...formResult, result: 'unsupported' }] },
  ])('refuses preflight $label without any nonempty credential arguments', async ({ results }) => {
    const api = apiFixture()
    api.scripting.executeScript.mockResolvedValueOnce([captureResult]).mockResolvedValueOnce(results)
    await expect(chromiumSiteFill(api).preflight(binding)).rejects.toThrow('fields')
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(2)
    expect(api.scripting.executeScript).toHaveBeenLastCalledWith({ target: { tabId: 1, documentIds: ['doc-1'] }, world: 'ISOLATED', func: injectSiteCredentials, args: [origin, '', '', true, 'both'] })
  })
  it.each([
    { label: 'different document', result: [{ frameId: 0, documentId: 'new-document', result: true }] },
    { label: 'nested frame', result: [{ frameId: 1, documentId: 'doc-1', result: true }] },
    { label: 'multiple acknowledgements', result: [{ frameId: 0, documentId: 'doc-1', result: true }, { frameId: 0, documentId: 'doc-2', result: true }] },
  ])('does not report success or retry an already dispatched injection with $label', async ({ result }) => {
    const api = apiFixture()
    api.scripting.executeScript.mockResolvedValueOnce([captureResult]).mockResolvedValueOnce(result)
    await expect(chromiumSiteFill(api).fill(binding, { mode: 'both', username: 'u', password: 'p' })).rejects.toThrow('fields')
    expect(api.scripting.executeScript.mock.calls.map(call => (call[0] as { func: unknown }).func)).toEqual([captureSiteDocument, injectSiteCredentials])
    // An injection already dispatched cannot be retracted; only its acknowledgement is refused.
  })
  it('refuses a delayed preflight reply after local context is revoked', async () => {
    const api = apiFixture(); let current = true, entered!: () => void, release!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    api.scripting.executeScript.mockResolvedValueOnce([captureResult]).mockImplementationOnce(async () => { entered(); await gate; return [formResult] })
    const pending = chromiumSiteFill(api, () => current).preflight(binding)
    await started
    current = false
    const rejected = expect(pending).rejects.toThrow('changed')
    release(); await rejected
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(2)
    expect(api.scripting.executeScript).toHaveBeenLastCalledWith({ target: { tabId: 1, documentIds: ['doc-1'] }, world: 'ISOLATED', func: injectSiteCredentials, args: [origin, '', '', true, 'both'] })
  })
})
