const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')

// Real browser parser + the exact installed Monaco sanitizer, not a sanitizer mock.
// No CSP on this isolated page: a broken sanitizer cannot pass because CSP hid execution.
test('patched Monaco sanitizer uses fixed DOMPurify and withstands adversarial DOM/hooks', {
  skip: process.env.RUN_MONACO_SANITIZER_REAL !== 'true',
}, async () => {
  const { chromium } = require('playwright')
  const bundle = buildSync({
    stdin: { contents: "export { sanitizeHtml, safeSetInnerHtml } from 'monaco-editor/esm/vs/base/browser/domSanitize.js'; export { default as purify } from 'dompurify';", resolveDir: path.resolve(__dirname, '../..') },
    bundle: true, write: false, format: 'iife', globalName: 'SanitizerProof', platform: 'browser', metafile: true,
  })
  const inputs = Object.keys(bundle.metafile.inputs)
  assert.ok(inputs.some(file => /dompurify\/dist\/purify\.es\.mjs$/.test(file)))
  assert.ok(!inputs.some(file => file.endsWith('/dompurify/dompurify.js')), 'Vendored vulnerable code must not be bundled')
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser', headless: true })
  try {
    const page = await browser.newPage()
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const result = await page.evaluate(async () => {
      const { sanitizeHtml, safeSetInnerHtml, purify } = window.SanitizerProof
      window.sanitizerExecuted = false
      const control = document.createElement('img')
      control.setAttribute('onerror', 'window.sanitizerExecuted=true')
      control.dispatchEvent(new Event('error'))
      const unsanitizedHandlerExecuted = window.sanitizerExecuted
      window.sanitizerExecuted = false
      const inspect = html => {
        const target = document.createElement('div')
        target.innerHTML = html
        return target
      }
      const dangerous = `<p><strong>Safe text</strong><img src="https://example.invalid/a" onerror="window.sanitizerExecuted=true"><a href="javascript:window.sanitizerExecuted=true">blocked</a><a href="https://example.test/docs">allowed</a><script>window.sanitizerExecuted=true</script></p>`
      const output = inspect(sanitizeHtml(dangerous))
      for (const image of output.querySelectorAll('img')) image.dispatchEvent(new Event('error'))
      const ordinary = {
        strong: output.querySelector('strong')?.textContent,
        scriptCount: output.querySelectorAll('script').length,
        eventAttributes: [...output.querySelectorAll('*')].flatMap(node => [...node.attributes]).filter(attr => /^on/i.test(attr.name)).length,
        unsafeHref: output.querySelector('a')?.getAttribute('href'),
        safeHref: output.querySelectorAll('a')[1]?.getAttribute('href'),
      }
      // RETURN_DOM_FRAGMENT and parser namespace edges must retain no executable markup.
      const fragmentTarget = document.createElement('section')
      safeSetInnerHtml(fragmentTarget, '<svg><foreignObject><img src="data:," onerror="window.sanitizerExecuted=true"></foreignObject></svg><math><mtext><img src="data:," onerror="window.sanitizerExecuted=true"></mtext></math><p>Kept</p>')
      const fragmentSafe = !fragmentTarget.querySelector('svg,math,script,[onerror]') && fragmentTarget.textContent.includes('Kept')
      // Monaco installs hooks per call and must remove custom restrictions afterwards.
      const custom = inspect(sanitizeHtml('<a href="mailto:operator@example.test" title="omit">mail</a>', {
        allowedLinkProtocols: { override: ['mailto'] },
        allowedAttributes: { augment: [{ attributeName: 'title', shouldKeep: () => false }] },
      }))
      const subsequent = inspect(sanitizeHtml('<a href="mailto:operator@example.test" title="keep">mail</a><a href="https://example.test/">web</a>'))
      const hookCompatibility = custom.querySelector('a').getAttribute('href') === 'mailto:operator@example.test'
        && !custom.querySelector('a').hasAttribute('title')
        && !subsequent.querySelector('a').hasAttribute('href')
        && subsequent.querySelector('a').getAttribute('title') === 'keep'
        && subsequent.querySelectorAll('a')[1].hasAttribute('href')
      const detached = []
      // Regression class GHSA-mrv2-3pqr-j5jr: hooks detach an ancestor or an unvisited sibling.
      for (const mode of ['ancestor', 'sibling']) {
        const cleaner = purify(window)
        const container = document.createElement('div')
        container.innerHTML = '<section><img class="trigger"><img class="victim" onerror="window.sanitizerExecuted=true"></section>'
        const victim = container.querySelector('.victim')
        cleaner.addHook('afterSanitizeAttributes', node => {
          if (node.getAttribute('class') === 'trigger') {
            if (mode === 'ancestor') node.parentElement.remove()
            else node.nextElementSibling.remove()
          }
        })
        cleaner.sanitize(container, { IN_PLACE: true })
        victim.dispatchEvent(new Event('error'))
        detached.push({ mode, handler: victim.getAttribute('onerror') })
        cleaner.removeAllHooks()
      }
      await new Promise(resolve => setTimeout(resolve, 0))
      return { unsanitizedHandlerExecuted, version: purify.version, ordinary, fragmentSafe, hookCompatibility, detached, executed: window.sanitizerExecuted }
    })
    assert.equal(result.unsanitizedHandlerExecuted, true, 'Control proves the browser did not hide XSS with CSP')
    assert.equal(result.version, '3.4.17')
    assert.deepEqual(result.ordinary, { strong: 'Safe text', scriptCount: 0, eventAttributes: 0, unsafeHref: null, safeHref: 'https://example.test/docs' })
    assert.equal(result.fragmentSafe, true)
    assert.equal(result.hookCompatibility, true)
    assert.deepEqual(result.detached, [{ mode: 'ancestor', handler: null }, { mode: 'sibling', handler: null }])
    assert.equal(result.executed, false)
  } finally { await browser.close() }
})
