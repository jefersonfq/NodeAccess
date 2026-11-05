// Runs directly in the browser through Playwright; returns the same observed dimensions
// used to build the next synthetic remote frame, rather than reading them again later.
function observeTerminalZoom({ resizeCount, rowsBefore, expectedFont }) {
  const container = document.querySelector('[data-terminal-container="true"]')
  if (!container) return false
  const rows = Number(container.dataset.terminalRows), cols = Number(container.dataset.terminalCols)
  const messages = window.__terminalExperience.resizeMessages, last = messages.at(-1)
  if (Number(localStorage.getItem('na_term_fontSize')) !== expectedFont || messages.length <= resizeCount) return false
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 10 || cols < 40 || rows >= rowsBefore) return false
  if (last?.rows !== rows || last?.cols !== cols) return false
  return { rows, cols, resizeCount: messages.length }
}
module.exports = { observeTerminalZoom }
