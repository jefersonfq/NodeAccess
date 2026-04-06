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

export interface TerminalAdapter {
  readonly rows: number
  readonly cols: number
  readonly bufferLength: number
  mount(el: HTMLElement): void
  fit(): void
  focus(): void
  write(data: Uint8Array): void
  writeln(text: string): void
  clear(): void
  scrollToBottom(): void
  dispose(): void
  getSelection(): string
  getBufferLine(index: number): string | null
  setFontSize(size: number): void
  setFontFamily(fontFamily: string): void
  setTheme(theme: TerminalTheme): void
  setDisableStdin(disabled: boolean): void
  attachShortcuts(handlers: { onFind?: () => void }): void
  onSelectionChange(handler: () => void): void
  onScroll(handler: (viewportY: number) => void): void
  onData(handler: (data: string) => void): { dispose(): void }
  searchNext(query: string): void
  searchPrev(query: string): void
}
