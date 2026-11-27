import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { injectSiteCredentials } from './site-fill'
let browser: Browser, page: Page
const origin = 'https://controlled.example.test'
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: true })
  page = await browser.newPage()
  await page.route('https://**/*', route => route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }))
  await page.goto(origin)
})
afterAll(async () => { await browser?.close() })
beforeEach(async () => { await page.evaluate(() => { document.oninput = null }) })
const inject = () => page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "synthetic-user", "synthetic-password")`)
describe('controlled form event ordering', () => {
  it('preserves both values when each input event synchronously rerenders controlled values', async () => {
    await page.setContent('<form><input id="user" autocomplete="username"><input id="password" type="password"></form>')
    await page.evaluate(() => {
      const user = document.querySelector<HTMLInputElement>('#user')!, password = document.querySelector<HTMLInputElement>('#password')!
      const state = { user: '', password: '' }
      document.querySelector('form')!.addEventListener('input', event => {
        const field = event.target as HTMLInputElement
        if (field === user) state.user = field.value
        if (field === password) state.password = field.value
        // A controlled renderer flushes both current model values synchronously.
        user.value = state.user; password.value = state.password
      })
    })
    expect(await inject()).toBe(true)
    expect(await page.locator('#user').inputValue()).toBe('synthetic-user')
    expect(await page.locator('#password').inputValue()).toBe('synthetic-password')
  })
})


describe('preflight and controlled target replacement', () => {
  it('preflights without reading values or emitting input events', async () => {
    await page.setContent('<form><input autocomplete="username"><input type="password"></form>')
    await page.evaluate(() => {
      document.oninput = () => { throw new Error('unexpected input') }
      for (const input of document.querySelectorAll('input')) Object.defineProperty(input, 'value', { get() { throw new Error('value read') }, set() { throw new Error('value write') } })
    })
    expect(await page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "", "", true)`)).toBe('both')
  })
  it('infers a username-only page in preflight without reads or writes', async () => {
    await page.setContent('<form><input id="user" autocomplete="username"></form>')
    expect(await page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "", "", true)`)).toBe('username')
    expect(await page.locator('#user').inputValue()).toBe('')
  })
  it.each(['replace', 'disable', 'type', 'ambiguous'])('does not write after username event changes the password target: %s', async change => {
    await page.setContent('<form><input id="user" autocomplete="username"><input id="password" type="password"></form>')
    await page.evaluate(change => {
      document.querySelector('#user')!.addEventListener('input', () => {
        const password = document.querySelector<HTMLInputElement>('#password')!
        if (change === 'replace') password.outerHTML = '<input id="password" type="password">'
        if (change === 'disable') password.disabled = true
        if (change === 'type') password.type = 'text'
        if (change === 'ambiguous') password.insertAdjacentHTML('afterend', '<input type="password">')
      })
    }, change)
    expect(await inject()).toBe(false)
    expect(await page.locator('#password').inputValue()).toBe('')
  })
})


describe('separate username and password injections', () => {
  it('fills only username, never clicks next, and requires matching mode after structure changes', async () => {
    await page.setContent('<form><input id="user" autocomplete="username"><button id="next" type="button">Next</button></form>')
    await page.evaluate(() => { document.querySelector('#next')!.addEventListener('click', () => { throw new Error('unexpected next') }) })
    expect(await page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "user", "", false, "username")`)).toBe(true)
    expect(await page.locator('#user').inputValue()).toBe('user')
    await page.setContent('<input id="password" type="password" autocomplete="current-password">')
    expect(await page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "user", "", false, "username")`)).toBe(false)
    expect(await page.locator('#password').inputValue()).toBe('')
    expect(await page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "", "password", false, "password")`)).toBe(true)
    expect(await page.locator('#password').inputValue()).toBe('password')
  })
  it.each(['<input type="search">', '<input type="email">', '<input autocomplete="username"><input autocomplete="username">', '<input autocomplete="username"><input type="password" hidden>'])('refuses ambiguous or incomplete first step %s', async html => {
    await page.setContent(html)
    expect(await page.evaluate(`(${injectSiteCredentials.toString()})(${JSON.stringify(origin)}, "", "", true)`)).toBe(false)
  })
})
