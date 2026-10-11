import { Terminal } from 'xterm'
import { CanvasAddon } from '@xterm/addon-canvas'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TerminalAdapter, TerminalHighlightRange, TerminalTheme } from './types'

export function createXtermAdapter(options: {
  fontSize: number
  fontFamily: string
  scrollback: number
  theme: TerminalTheme
}): TerminalAdapter {
  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 1,
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
  const highlightDecorations = new Map<number, Array<{ dispose(): void }>>()
  const clearLineHighlights = (index: number) => {
    highlightDecorations.get(index)?.forEach((item) => item.dispose())
    highlightDecorations.delete(index)
  }

  return {
    get rows() { return terminal.rows },
    get cols() { return terminal.cols },
    get bufferLength() { return terminal.buffer.active.length },
    get cursorLine() { return terminal.buffer.active.baseY + terminal.buffer.active.cursorY },
    get isAlternateBuffer() { return terminal.buffer.active.type === 'alternate' },
    isMouseTrackingEnabled() {
      return terminal.modes.mouseTrackingMode !== 'none'
    },
    getCursorAnchor() {
      const screen = terminal.element?.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen || !terminal.cols || !terminal.rows) return null
      const width = screen.clientWidth / terminal.cols
      const height = screen.clientHeight / terminal.rows
      return {
        left: screen.offsetLeft + terminal.buffer.active.cursorX * width,
        top: screen.offsetTop + (terminal.buffer.active.cursorY + 1) * height,
        cellHeight: height,
      }
    },
    mount(el: HTMLElement) {
      terminal.open(el)
    },
    fit() {
      fitAddon.fit()
      return { cols: terminal.cols, rows: terminal.rows }
    },
    focus() {
      terminal.focus()
    },
    write(data: Uint8Array, callback?: () => void) {
      terminal.write(data, callback)
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
      for (const line of [...highlightDecorations.keys()]) clearLineHighlights(line)
      terminal.dispose()
    },
    getSelection() {
      return terminal.getSelection()
    },
    getBufferLine(index: number) {
      return terminal.buffer.active.getLine(index)?.translateToString(true) ?? null
    },
    setLineHighlights(index: number, ranges: TerminalHighlightRange[]) {
      clearLineHighlights(index)
      if (!ranges.length || terminal.buffer.active.type === 'alternate') return
      const cursorLine = terminal.buffer.active.baseY + terminal.buffer.active.cursorY
      const marker = terminal.registerMarker(index - cursorLine)
      if (!marker) return
      const decorations = ranges.flatMap((range) => {
        const decoration = terminal.registerDecoration({ marker, x: range.x, width: range.width, foregroundColor: range.foreground, backgroundColor: range.background, layer: 'top' })
        if (!decoration) return []
        if (range.bold) decoration.onRender((element) => { element.style.fontWeight = '700' })
        return [decoration]
      })
      if (decorations.length) highlightDecorations.set(index, decorations)
      else marker.dispose()
    },
    clearHighlights() {
      for (const line of [...highlightDecorations.keys()]) clearLineHighlights(line)
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
    attachShortcuts(handlers: { onFind?: () => void; onShortcutKey?: (event: KeyboardEvent) => boolean }) {
      const suppressedKeyUps = new Set<string>()
      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type === 'keyup' && suppressedKeyUps.delete(event.code)) return false
        const isFind = (event.ctrlKey && !event.metaKey && event.key === 'f') ||
          (event.metaKey && !event.ctrlKey && event.key === 'f')
        if (isFind && !event.shiftKey) {
          if (event.type === 'keydown') handlers.onFind?.()
          return false
        }

        if (event.type === 'keydown' && handlers.onShortcutKey?.(event)) {
          suppressedKeyUps.add(event.code)
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
