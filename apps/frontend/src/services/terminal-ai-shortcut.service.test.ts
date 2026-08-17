import { describe, expect, it } from 'vitest'
import { isTerminalAiShortcut } from './terminal-ai-shortcut.service'

describe('isTerminalAiShortcut', () => {
  it('accepts Ctrl+Shift+I outside macOS', () => {
    expect(isTerminalAiShortcut({ key: 'I', ctrlKey: true, metaKey: false, shiftKey: true }, false)).toBe(true)
  })

  it('accepts Cmd+Shift+I on macOS', () => {
    expect(isTerminalAiShortcut({ key: 'i', ctrlKey: false, metaKey: true, shiftKey: true }, true)).toBe(true)
  })

  it('does not capture ordinary terminal input or the wrong platform modifier', () => {
    expect(isTerminalAiShortcut({ key: 'i', ctrlKey: false, metaKey: false, shiftKey: false }, false)).toBe(false)
    expect(isTerminalAiShortcut({ key: 'i', ctrlKey: true, metaKey: false, shiftKey: true }, true)).toBe(false)
  })
})
