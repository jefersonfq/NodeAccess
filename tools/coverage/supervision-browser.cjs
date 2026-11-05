// Opt-in instrumentation wrapper; the existing UI/API/WS assertions remain unchanged.
const { chromium } = require('playwright')
const { attachBrowserCoverage } = require('./playwright-coverage.cjs')
const launch = chromium.launch.bind(chromium)
chromium.launch = async (...args) => {
  const browser = await launch(...args)
  const createContext = browser.newContext.bind(browser)
  browser.newContext = async (...contextArgs) => {
    const context = await createContext(...contextArgs)
    const createPage = context.newPage.bind(context)
    context.newPage = async (...pageArgs) => {
      const page = await createPage(...pageArgs)
      await attachBrowserCoverage(page, browser)
      return page
    }
    return context
  }
  return browser
}
require('../frontend/lucien-feedback-ux-playwright.cjs')
