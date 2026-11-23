/**
 * NA-0190 — local builds only: the portal (dev server) publishes the id of the extension build on disk at
 * `/vaultnaccess-build.json`; when it differs from the running build, the popup offers to reload the unpacked
 * extension. The answer only decides whether a button appears: nothing fetched is executed or stored.
 */
const BUILD = /^[a-f0-9]{12}$/

export interface UpdateCheck { available(): Promise<boolean> }
export function createUpdateCheck(portalOrigin: string, currentBuild: string, fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)): UpdateCheck {
  return {
    async available(): Promise<boolean> {
      // Test and production builds carry no id: they never ask (and never call the portal for this).
      if (!BUILD.test(currentBuild)) return false
      try {
        const response = await fetcher(`${portalOrigin}/vaultnaccess-build.json`, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
        if (!response.ok) return false
        const text = await response.text()
        if (text.length > 512) return false
        const announced = (JSON.parse(text) as { buildId?: unknown }).buildId
        return typeof announced === 'string' && BUILD.test(announced) && announced !== currentBuild
      } catch { return false }
    },
  }
}
