/** Minimal typing of the Chromium extension APIs used by the adapter (no @types dependency). */
declare namespace chrome {
  namespace runtime {
    const id: string
    function getManifest(): { version: string }
    function reload(): void
    function sendMessage<T = unknown>(message: unknown): Promise<T>
    interface MessageSender { id?: string; url?: string; frameId?: number; documentId?: string; tab?: { id?: number } }
    const onMessage: { addListener(listener: (message: unknown, sender: MessageSender, respond: (reply: unknown) => void) => boolean | undefined): void }
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
    const onChanged: { addListener(listener: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => void): void }
    const session: Area
    const local: Area
  }
  namespace tabs {
    function create(details: { url: string }): Promise<unknown>
    function get(id: number): Promise<{ id?: number; windowId: number; url?: string }>
    function update(id: number, details: { active: boolean }): Promise<unknown>
  }
  namespace windows {
    function create(details: { url: string; type: 'popup'; width: number; height: number; focused: boolean }): Promise<{ tabs?: Array<{ id?: number }> }>
    function update(id: number, details: { focused: boolean }): Promise<unknown>
  }
}
declare const __PORTAL_ORIGIN__: string
/** NA-0190: content-derived id of a local build; empty in test/production builds. */
declare const __BUILD_ID__: string
