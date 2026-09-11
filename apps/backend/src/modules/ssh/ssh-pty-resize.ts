export interface ResizableSshChannel {
  setWindow(rows: number, cols: number, height: number, width: number): void
}

export function applySshPtyResize(shell: ResizableSshChannel | null, cols: number, rows: number): boolean {
  if (!shell) return false
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 1000 || rows > 500) return false
  // ssh2 usa setWindow(rows, cols, height, width), ao contrário do contrato
  // do browser e WebSocket, que é { cols, rows }.
  shell.setWindow(rows, cols, 0, 0)
  return true
}
