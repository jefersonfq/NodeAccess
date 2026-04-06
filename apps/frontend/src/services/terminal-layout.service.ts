export const TERMINAL_LAYOUT_RESET_EVENT = 'na:terminal-layout-reset'

export function resetTerminalLayout() {
  window.dispatchEvent(new Event(TERMINAL_LAYOUT_RESET_EVENT))
}
