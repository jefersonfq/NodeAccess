import { Terminal } from 'xterm'
import { CanvasAddon } from '@xterm/addon-canvas'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TerminalAdapter, TerminalTheme } from './types'

export function createXtermAdapter(options: {
  fontSize: number
  fontFamily: string
  scrollback: number
  theme: TerminalTheme
}): TerminalAdapter {
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: options.fontSize,
    fontFamily: options.fontFamily,
    scrollback: options.scrollback,
    theme: options.theme,
  })

  const fitAddon = new FitAddon()
  const canvasAddon = new CanvasAddon()
  const searchAddon = new SearchAddon()

  terminal.loadAddon(canvasAddon)
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(searchAddon)
  terminal.loadAddon(new WebLinksAddon())

  return {
    get rows() { return terminal.rows },
    get cols() { return terminal.cols },
    get bufferLength() { return terminal.buffer.active.length },
    mount(el: HTMLElement) {
      terminal.open(el)
    },
    fit() {
      fitAddon.fit()
    },
    focus() {
      terminal.focus()
    },
    write(data: Uint8Array) {
      terminal.write(data)
    },
    writeln(text: string) {
      terminal.writeln(text)
    },
    clear() {
      terminal.clear()
    },
    scrollToBottom() {
      terminal.scrollToBottom()
    },
    dispose() {
      terminal.dispose()
    },
    getSelection() {
      return terminal.getSelection()
    },
    getBufferLine(index: number) {
      return terminal.buffer.active.getLine(index)?.translateToString(true) ?? null
    },
    setFontSize(size: number) {
      terminal.options.fontSize = size
    },
    setFontFamily(fontFamily: string) {
      terminal.options.fontFamily = fontFamily
    },
    setTheme(theme: TerminalTheme) {
      terminal.options.theme = theme
    },
    setDisableStdin(disabled: boolean) {
      terminal.options.disableStdin = disabled
    },
    attachShortcuts(handlers: { onFind?: () => void }) {
      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        const isFind = (event.ctrlKey && !event.metaKey && event.key === 'f') ||
          (event.metaKey && !event.ctrlKey && event.key === 'f')
        if (isFind && !event.shiftKey) {
          if (event.type === 'keydown') handlers.onFind?.()
          return false
        }

        const isPaste = (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'v') ||
          (event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'v') ||
          (event.shiftKey && event.key === 'Insert')

        if (isPaste) {
          return false
        }
        return true
      })
    },
    onSelectionChange(handler: () => void) {
      terminal.onSelectionChange(handler)
    },
    onScroll(handler: (viewportY: number) => void) {
      terminal.onScroll(handler)
    },
    onData(handler: (data: string) => void) {
      return terminal.onData(handler)
    },
    searchNext(query: string) {
      searchAddon.findNext(query, { caseSensitive: false, incremental: true })
    },
    searchPrev(query: string) {
      searchAddon.findPrevious(query, { caseSensitive: false, incremental: true })
    },
  }
}
