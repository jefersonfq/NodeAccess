import type { LocalAiTerminalAssist } from '@nodeaccess/shared'

/** Never accept line breaks or terminal controls from a generated command. */
export function canInsertTerminalAiCommand(assist: LocalAiTerminalAssist): boolean {
  return assist.kind === 'command' && assist.canInsert === true && assist.risk === 'safe'
    && !assist.requiresApproval && typeof assist.content === 'string'
    && assist.content.trim().length > 0 && assist.content.length <= 8192
    && !/^(['"`]).*\1$/s.test(assist.content.trim()) && !assist.content.trim().startsWith('```')
    && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(assist.content)
}

export function terminalAiRejectionReason(assist: LocalAiTerminalAssist): 'blocked' | 'approval' | 'format' | 'unavailable' {
  if (assist.risk === 'blocked') return 'blocked'
  if (assist.requiresApproval || assist.risk === 'approval_required') return 'approval'
  if (!canInsertTerminalAiCommand({ ...assist, kind: 'command', canInsert: true, risk: 'safe', requiresApproval: false })) return 'format'
  return 'unavailable'
}
