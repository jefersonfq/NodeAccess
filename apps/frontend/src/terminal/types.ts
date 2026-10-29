export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  selectionForeground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
}

export interface TerminalHighlightRange { x: number; width: number; foreground: string; background?: string; bold?: boolean }

export interface TerminalAdapter {
  readonly rows: number
  readonly cols: number
  readonly bufferLength: number
  readonly cursorLine: number
  readonly isAlternateBuffer: boolean
  isMouseTrackingEnabled(): boolean
  getCursorAnchor(): { left: number; top: number; cellHeight: number } | null
  mount(el: HTMLElement): void
  fit(): { cols: number; rows: number }
  focus(): void
  write(data: Uint8Array, callback?: () => void): void
  writeln(text: string): void
  clear(): void
  scrollToBottom(): void
  dispose(): void
  getSelection(): string
  getBufferLine(index: number): string | null
  setLineHighlights(index: number, ranges: TerminalHighlightRange[]): void
  clearHighlights(): void
  setFontSize(size: number): void
  setFontFamily(fontFamily: string): void
  setTheme(theme: TerminalTheme): void
  setDisableStdin(disabled: boolean): void
  attachShortcuts(handlers: { onFind?: () => void; onShortcutKey?: (event: KeyboardEvent) => boolean }): void
  onSelectionChange(handler: () => void): void
  onScroll(handler: (viewportY: number) => void): void
  onBinary(handler: (data: string) => void): { dispose(): void }
  onData(handler: (data: string) => void): { dispose(): void }
  searchNext(query: string): void
  searchPrev(query: string): void
}
