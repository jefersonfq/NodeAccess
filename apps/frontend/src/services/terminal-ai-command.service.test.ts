import { describe, it, expect } from 'vitest'
import type { LocalAiTerminalAssist } from '@nodeaccess/shared'
import { canInsertTerminalAiCommand, terminalAiRejectionReason } from './terminal-ai-command.service'
const suggestion = { kind:'command', content:'ss -lntup', risk:'safe', canInsert:true, requiresApproval:false } as LocalAiTerminalAssist
describe('AI command insertion boundary', () => {
  it('allows a reviewed single line command',()=>expect(canInsertTerminalAiCommand(suggestion)).toBe(true))
  it.each(['', ' ', 'pwd\nwhoami','pwd\r','\x1b[200~pwd','pwd\x00','pwd\u0085','pwd\u2028','x'.repeat(8193)])('rejects empty/oversized/control input %j', content => {
    expect(canInsertTerminalAiCommand({...suggestion,content})).toBe(false)
  })
  it.each([
    {kind:'script'}, {kind:'explanation'}, {risk:'blocked'}, {risk:'approval_required'},
    {requiresApproval:true}, {canInsert:false},
  ])('preserves server policy %j', patch=>expect(canInsertTerminalAiCommand({...suggestion,...patch} as LocalAiTerminalAssist)).toBe(false))
})

describe('AI rejection explanation', () => {
  it.each([
    [{risk:'blocked'},'blocked'],
    [{risk:'approval_required'},'approval'],
    [{requiresApproval:true},'approval'],
    [{content:'pwd\nwhoami'},'format'],
    [{content:'"ss -lntup"'},'format'],
    [{content:'`ss -lntup`'},'format'],
    [{canInsert:false},'unavailable'],
  ] as const)('distinguishes policy and response format: %j', (patch, reason) => {
    expect(terminalAiRejectionReason({...suggestion,...patch})).toBe(reason)
  })
})
