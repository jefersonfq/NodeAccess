/** Minimal typing of the Chromium extension APIs used by the adapter (no @types dependency). */
declare namespace chrome {
  namespace runtime {
    const id: string
    function getManifest(): { version: string }
    function sendMessage<T = unknown>(message: unknown): Promise<T>
    const onMessage: { addListener(listener: (message: unknown, sender: { id?: string }, respond: (reply: unknown) => void) => boolean | undefined): void }
  }
  namespace identity {
    function getRedirectURL(path?: string): string
    function launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>
  }
  namespace storage {
    interface Area {
      get(keys: string | string[]): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string | string[]): Promise<void>
      setAccessLevel?(details: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>
    }
    const session: Area
  }
  namespace tabs {
    function create(details: { url: string }): Promise<unknown>
  }
}
declare const __PORTAL_ORIGIN__: string
