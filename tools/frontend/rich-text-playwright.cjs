const assert = require('node:assert/strict')
const path = require('node:path')
const { build } = require('esbuild')

async function main() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
  const root = path.resolve(__dirname, '../..')
  const bundle = await build({
    stdin: {
      contents: `import { createApp, h, reactive } from 'vue'; import RichText from './apps/frontend/src/components/RichText';
        const state = reactive({html: '', tag: 'article'}); window.richTextState = state; window.richTextClicks = 0;
        createApp({render: () => h(RichText, {...state, class: 'manual-prose', onClick: event => {if(event.target.closest('a')) {event.preventDefault();window.richTextClicks++}}})}).mount('#app');`,
      resolveDir: root, sourcefile: 'rich-text-browser-fixture.ts', loader: 'ts',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  })
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<!doctype html><div id="app"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    async function render(html, tag = 'article') {
      await page.evaluate(({ html, tag }) => { window.richTextState.html = html; window.richTextState.tag = tag }, { html, tag })
      await page.waitForTimeout(25)
    }
    await render('<h2 id="ssh">Acesso &amp; auditoria</h2><p>Use <strong>SSH</strong>, <em>com cuidado</em>.</p><ul><li><code>echo &lt;host&gt;</code></li></ul><table><thead><tr><th scope="col">Host</th></tr></thead><tbody><tr><td colspan="2">Demo</td></tr></tbody></table><a href="/manual/terminal">Terminal</a>')
    assert.equal(await page.locator('article.manual-prose h2#ssh').textContent(), 'Acesso & auditoria')
    assert.equal(await page.locator('li code').textContent(), 'echo <host>')
    assert.equal(await page.locator('td').getAttribute('colspan'), '2')
    await page.getByRole('link', { name: 'Terminal' }).click()
    assert.equal(await page.evaluate(() => window.richTextClicks), 1)

    await render('<b>1.</b> Gere um <b>API token</b> em <code>https://jira.example.test</code>.', 'span')
    assert.equal(await page.locator('#app > span.manual-prose b').count(), 2)
    assert.equal(await page.locator('code').textContent(), 'https://jira.example.test')
    assert.equal(await page.locator('article').count(), 0)

    await render('<script>window.richTextPwned=1</script><svg onload="window.richTextPwned=2"><a>SVG</a></svg><math><mi>x</mi></math><img src=x onerror="window.richTextPwned=3"><iframe srcdoc="<script>top.richTextPwned=4</script>"></iframe><object data=x></object><form><input autofocus onfocus="window.richTextPwned=5"></form><p onclick="window.richTextPwned=6" style="position:fixed">Safe</p>')
    assert.equal(await page.locator('#app script,#app svg,#app math,#app img,#app iframe,#app object,#app form,#app input').count(), 0)
    assert.equal(await page.locator('#app [onclick],#app [style],#app [onerror]').count(), 0)
    await page.getByText('Safe', { exact: true }).click()
    assert.equal(await page.evaluate(() => window.richTextPwned), undefined)

    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,test', 'vbscript:alert(1)']) {
      await render(`<a href="${href}">Blocked</a>`)
      assert.equal(await page.locator('a').getAttribute('href'), null)
    }
    for (const href of ['/manual/terminal', '#ssh', 'https://example.test/help', 'mailto:comercial@example.test']) {
      await render(`<a href="${href}" target="_blank" rel="opener" onclick="window.richTextPwned=1">Allowed</a>`)
      assert.equal(await page.locator('a').getAttribute('href'), href)
      assert.equal(await page.locator('a').getAttribute('rel'), 'noopener noreferrer')
      assert.equal(await page.locator('a').getAttribute('onclick'), null)
    }
    await render('<p>Malformed <b>still readable')
    assert.equal(await page.locator('b').textContent(), 'still readable')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, checks: ['manual semantics', 'localized guide formatting', 'reactive replacement', 'link event bubbling', 'active markup removal', 'URL protocols', 'safe new-tab links', 'malformed HTML'], browserErrors: errors }))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
