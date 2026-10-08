/** Use local artifacts created by review-exported-session.ts. Never connects to an audited host. */
const fs = require('node:fs')
const { chromium } = require('playwright')
const { installRoutes, authenticate, detail, SESSION_ID } = require('./session-playback-playwright.cjs')
const base = process.env.FRONTEND_BASE || 'http://127.0.0.1:5182'
async function main() {
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const file of process.argv.slice(2)) {
      const fixture = JSON.parse(fs.readFileSync(file, 'utf8'))
      const id = file.match(/audit-(\d+)/)?.[1] || 'synthetic'
      for (const viewport of [{width:1440,height:1000}, {width:390,height:844}]) {
        const context = await browser.newContext({viewport})
        await installRoutes(context, {...fixture, detail:{...detail, startedAt:fixture.events[0].timestamp, endedAt:fixture.events.at(-1).timestamp}})
        const page = await context.newPage()
        page.setDefaultTimeout(30000)
        const errors = []
        page.on('pageerror', e => errors.push(e.message))
        await authenticate(page)
        await page.goto(`${base}/admin/session-audit/${SESSION_ID}?tab=commands`, {waitUntil:'domcontentloaded'})
        const commandTab = page.locator('.n-tabs-tab').filter({hasText:/Comandos|Commands/})
        await commandTab.click()
        await page.locator('[data-audit-command-text]').first().waitFor()
        let reviewed = 0, pages = 0
        do {
          const texts = await page.locator('[data-audit-command-text]').allTextContents()
          const rows = page.locator('[data-audit-command-row]')
          for (let i=0;i<texts.length;i++) {
            const row = rows.nth(i)
            const index = Number(await row.getAttribute('data-command-index'))
            const expected = fixture.commands.find(c=>c.index===index)
            if (!expected || texts[i]!==expected.command) throw Error(`Audit ${id}: command ${index} differs from reconstruction`)
            await row.scrollIntoViewIfNeeded()
            const clipped = await row.locator('[data-audit-command-text]').evaluate(el=>el.scrollWidth>el.clientWidth+2)
            if(clipped) throw Error(`Audit ${id}: command ${index} is horizontally clipped at ${viewport.width}px`)
            if(expected.reconstructionWarnings?.length && !await row.locator('[data-audit-reconstruction-warning]').count()) throw Error('Missing uncertainty warning')
            if(id==='synthetic' && index>=6)await page.screenshot({path:`/tmp/nodeaccess-audit-sql-command-${index}-${viewport.width}.png`})
            reviewed++
          }
          pages++
          const next = page.getByTestId('command-pagination').getByRole('button').last()
          if(await next.isDisabled()) break
          await next.click()
        } while(pages<200)
        if(reviewed!==fixture.commands.length)throw Error(`Audit ${id}: missing commands (${reviewed}/${fixture.commands.length})`)
        // Walk each command through its UI action and check the complete clean playback.
        if(pages===1) {
          for(const command of fixture.commands) {
            await commandTab.click()
            const row=page.locator(`[data-command-index="${command.index}"]`)
            await row.getByRole('button',{name:/playback/i}).click()
            await page.locator('[data-playback-terminal]').waitFor()
          }
        }
        await page.locator('.n-tabs-tab').filter({hasText:'Playback'}).click()
        await page.locator('[data-playback-action="load-end"]').click()
        const text=await page.locator('[data-playback-terminal]').textContent()
        for(const c of fixture.commands)if(!text.includes(c.command))throw Error(`Audit ${id}: playback missing full command ${c.index}`)
        if(errors.length)throw Error(errors.join('\n'))
        // Capture only synthetic fixtures: real exports may contain credentials in SQL.
        if(id==='synthetic')await page.screenshot({path:`/tmp/nodeaccess-audit-sql-${viewport.width}.png`})
        results.push({audit:id,viewport:viewport.width,commands:reviewed,pages,playback:true,errors})
        console.log(JSON.stringify(results.at(-1)))
        await context.close()
      }
    }
    fs.writeFileSync('/tmp/nodeaccess-audit-export-browser-review.json',JSON.stringify({ok:true,results},null,2))
  } finally {await browser.close()}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1})
