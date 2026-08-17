export function isTerminalAiShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, isMac: boolean) {
  const modifierPressed = isMac ? event.metaKey : event.ctrlKey
  return modifierPressed && event.shiftKey && event.key.toLowerCase() === 'i'
}
