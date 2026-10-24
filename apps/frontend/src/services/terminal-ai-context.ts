import type { LocalAiTerminalAssistRequest } from '@nodeaccess/shared'
export type TerminalAiContextMode = 'none' | 'selection' | 'recent' | 'both'
type Context = NonNullable<LocalAiTerminalAssistRequest['terminalContext']>
/** One bounded snapshot, with no duplicate buffer payload. Never persists terminal text. */
export function selectTerminalAiContext(context: Context, mode: TerminalAiContextMode): Context {
  const { selection, recentOutput, ...metadata } = context
  const selectionLimit = mode === 'both' ? 4000 : 8000
  const recentLimit = mode === 'both' ? 4000 : 8000
  return {
    ...metadata,
    selection: mode === 'selection' || mode === 'both' ? selection?.slice(0, selectionLimit) ?? null : null,
    recentOutput: mode === 'recent' || mode === 'both' ? recentOutput?.slice(-recentLimit) ?? null : null,
    bufferTail: null,
  }
}
