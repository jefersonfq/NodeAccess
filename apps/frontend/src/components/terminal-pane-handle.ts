import type { useTerminal } from '@/composables/useTerminal'

type TerminalController = ReturnType<typeof useTerminal>

/** Public, unwrapped API exposed by TerminalPane to its parent and host views. */
export type TerminalPaneHandle = Pick<TerminalController,
  'sendText' | 'sendSnippetText' | 'sendSecretText' | 'sendCredentialsResponse'
  | 'canInsertAiCommand' | 'dismissSavePasswordOffer' | 'fit' | 'focus' | 'getBufferText' | 'getSelectionText'> & {
  getAiAnchor(this: void): { left: number; top: number; cellHeight: number; viewport: { left: number; top: number; width: number; height: number } }
  reconnect(this: void, hostId?: number, connectionToken?: string): Promise<void>
  status: TerminalController['status']['value']
  error: string | null
  errorCode: string | null
  getSessionId(this: void): number | null
}
