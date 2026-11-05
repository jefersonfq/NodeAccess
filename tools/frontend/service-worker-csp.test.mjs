import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
const filename = fileURLToPath(new URL('../../apps/frontend/public/sw.js', import.meta.url))
const source = readFileSync(filename, 'utf8')
async function simulate({ mode = 'cors', contentType = 'text/html', cached, offline = false, url = 'https://nodeaccess.test/index.html', destination = '', upgrade = false, cacheControl = '', status = 200, cacheFailure } = {}) {
  const handlers = {}, writes = [], background = []
  const context = vm.createContext({ URL, Response, self: { location: { origin: 'https://nodeaccess.test' }, addEventListener(name, handler) { handlers[name] = handler } }, caches: { match: async () => cached, open: async () => { if (cacheFailure === 'open') throw Error('storage unavailable'); return { put: async (...args) => { if (cacheFailure === 'put') throw Error('quota exceeded'); writes.push(args) } } } }, fetch: async () => {
    if (offline) throw Error('offline')
    return new Response('synthetic fixture', { status, headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } })
  } })
  vm.runInContext(source, context, { filename })
  let response
  handlers.fetch({ request: { url, mode, headers: new Headers(upgrade ? { Upgrade: 'websocket' } : {}), destination }, respondWith(promise) { response = promise }, waitUntil(promise) { background.push(promise) } })
  const result = await response
  await Promise.all(background)
  return { result, writes }
}
test('navigation and programmatic HTML fetches never populate Cache API', async () => {
  for (const mode of ['navigate', 'cors']) {
    const { result, writes } = await simulate({ mode })
    assert.equal(result.status, 200)
    assert.equal(writes.length, 0)
  }
})
test('cached HTML is never replayed for programmatic fetch', async () => {
  const { result, writes } = await simulate({ cached: new Response('stale nonce', { headers: { 'Content-Type': 'text/html' } }) })
  assert.equal(await result.text(), 'synthetic fixture')
  assert.equal(writes.length, 0)
})
test('offline navigation returns inert text; static media caching is preserved', async () => {
  const offline = await simulate({ mode: 'navigate', offline: true })
  assert.equal(offline.result.status, 503)
  assert.match(offline.result.headers.get('content-type'), /text\/plain/)
  assert.equal(offline.writes.length, 0)
  assert.equal((await simulate({ contentType: 'image/svg+xml' })).writes.length, 1)
})
test('install never precaches documents and activation retires previous cache generation', async () => {
  const handlers = {}, deleted = [], preloaded = [], waited = []
  let skippedWaiting = false, claimed = false
  const context = vm.createContext({
    self: { addEventListener(name, handler) { handlers[name] = handler }, skipWaiting() { skippedWaiting = true }, clients: { claim() { claimed = true } } },
    caches: { open: async () => ({ addAll: async urls => preloaded.push(...urls) }), keys: async () => ['nodeaccess-v2', 'nodeaccess-v3-csp'], delete: async name => deleted.push(name) },
  })
  vm.runInContext(source, context, { filename })
  const event = { waitUntil(promise) { waited.push(promise) } }
  handlers.install(event)
  handlers.activate(event)
  await Promise.all(waited)
  assert.equal(skippedWaiting, true)
  assert.equal(claimed, true)
  assert.deepEqual(preloaded, [])
  assert.deepEqual(deleted, ['nodeaccess-v2'])
})
test('API, dev modules, upgraded sockets and external URLs are never intercepted', async () => {
  for (const options of [
    { url: 'https://nodeaccess.test/api/v1/hosts' }, { url: 'https://nodeaccess.test/src/main.ts' },
    { url: 'https://nodeaccess.test/@vite/client' }, { upgrade: true }, { url: 'https://external.test/image.png' },
  ]) {
    const { result, writes } = await simulate(options)
    assert.equal(result, undefined)
    assert.equal(writes.length, 0)
  }
})
test('scripts/styles bypass cache, while errors and no-store responses are never written', async () => {
  for (const options of [
    { destination: 'script' }, { destination: 'style' }, { url: 'https://nodeaccess.test/app.js' },
    { url: 'https://nodeaccess.test/app.css' }, { contentType: 'image/png', cacheControl: 'no-store' }, { status: 404 },
  ]) assert.equal((await simulate(options)).writes.length, 0)
  const image = new Response('cached image', { headers: { 'Content-Type': 'image/png' } })
  assert.equal(await (await simulate({ cached: image, offline: true })).result.text(), 'cached image')
})

test('cache storage and quota failures preserve the successful network response', async () => {
  for (const cacheFailure of ['open', 'put']) {
    const { result, writes } = await simulate({ contentType: 'image/svg+xml', cacheFailure })
    assert.equal(result.status, 200)
    assert.equal(await result.text(), 'synthetic fixture')
    assert.equal(writes.length, 0)
  }
})
