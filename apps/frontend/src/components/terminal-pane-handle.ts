import type { useTerminal } from '@/composables/useTerminal'

type TerminalController = ReturnType<typeof useTerminal>

/** Public, unwrapped API exposed by TerminalPane to its parent and host views. */
export type TerminalPaneHandle = Pick<TerminalController,
  'sendText' | 'sendSnippetText' | 'sendSecretText' | 'sendCredentialsResponse'
  | 'dismissSavePasswordOffer' | 'fit' | 'focus' | 'getBufferText' | 'getSelectionText'> & {
  reconnect(this: void, hostId?: number, connectionToken?: string): Promise<void>
  status: TerminalController['status']['value']
  error: string | null
  errorCode: string | null
  getSessionId(this: void): number | null
}
