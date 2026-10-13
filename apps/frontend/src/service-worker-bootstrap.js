if ('serviceWorker' in navigator) {
  const isDevHost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const cleanupDevServiceWorker = () => {
    const cleanup = Promise.all([
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))),
      window.caches?.keys?.()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined),
    ])

    if (navigator.serviceWorker.controller && sessionStorage.getItem('na:dev-sw-cleaned') !== '1') {
      sessionStorage.setItem('na:dev-sw-cleaned', '1')
      cleanup.then(() => window.location.reload()).catch(() => window.location.reload())
    }
    return cleanup
  }

  if (isDevHost) {
    cleanupDevServiceWorker().catch(() => {/* silent — cleanup optional */})
  }

  window.addEventListener('load', () => {
    if (isDevHost) {
      return
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {/* silent — PWA optional */})
  })
}
