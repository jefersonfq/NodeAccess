const CACHE_NAME = 'nodeaccess-v3-csp'
const PRECACHE = []

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never intercept API calls, WebSocket upgrades, or cross-origin requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@vite/') ||
    event.request.headers.get('Upgrade') === 'websocket' ||
    url.origin !== self.location.origin
  ) {
    return
  }

  // Documents contain a per-response nonce: never replay them from Cache API.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() =>
      new Response('Sem conexão. Reconecte e recarregue o NodeAccess.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    ))
    return
  }

  if (
    event.request.destination === 'script' ||
    event.request.destination === 'style' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  ) {
    event.respondWith(fetch(event.request))
    return
  }

  // Cache-first for static media assets only.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached && !/text\/html/i.test(cached.headers.get('Content-Type') || '')) return cached
      return fetch(event.request).then((res) => {
        if (res.ok && !/text\/html/i.test(res.headers.get('Content-Type') || '')
          && !/no-store/i.test(res.headers.get('Cache-Control') || '')) {
          const clone = res.clone()
          // Cache persistence is best-effort: quota/storage failures must not
          // discard or delay the successful network response.
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {}))
        }
        return res
      })
    })
  )
})
