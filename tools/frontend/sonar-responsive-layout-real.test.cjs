const { test } = require('node:test')
const assert = require('node:assert/strict')
const { waitForResponsiveLayout } = require('./sonar-responsive-layout.cjs')

// Opt-in: general Node CI does not need a browser installation.
test('real Chromium distinguishes transient resize layout from persistent overflow', { skip: process.env.RUN_SONAR_LAYOUT_REAL !== 'true' }, async t => {
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH })
  try {
    for (const transient of [true, false]) {
      await t.test(transient ? 'transient layout: immediate assertion fails, bounded condition passes' : 'persistent overflow: bounded condition rejects', async () => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
        page.setDefaultTimeout(5000)
        try {
          await page.setContent('<div id="content" style="height:10px"></div>')
          await page.evaluate(() => {
            window.addEventListener('resize', () => {
              document.getElementById('content').style.width = '900px'
              document.documentElement.dataset.resized = 'true'
            }, { once: true })
          })
          await page.setViewportSize({ width: 390, height: 844 })
          await page.waitForFunction(() => document.documentElement.dataset.resized === 'true')
          const baseline = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          assert.throws(() => assert(baseline, 'mobile overflow'), { name: 'AssertionError' })
          if (transient) {
            // Release the synthetic delayed resize response only after recording the baseline.
            await page.evaluate(() => setTimeout(() => { document.getElementById('content').style.width = '100%' }, 150))
            await waitForResponsiveLayout(page)
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile overflow')
          } else {
            await assert.rejects(waitForResponsiveLayout(page), { name: 'TimeoutError' })
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), false)
          }
        } finally { await page.close() }
      })
    }
  } finally { await browser.close() }
})
