import { describe, expect, it } from 'vitest'
import { selectTerminalAiContext } from './terminal-ai-context'
describe('explicit terminal context', () => {
  const source={hostId:42,sessionId:7,selection:'s'.repeat(15000),recentOutput:'r'.repeat(18000),bufferTail:'private duplicate'}
  it.each(['none','selection','recent','both'] as const)('sends only the selected scope: %s', mode => {
    const result=selectTerminalAiContext(source,mode)
    expect(result.hostId).toBe(42)
    expect(result.bufferTail).toBeNull()
    expect((result.selection?.length??0)+(result.recentOutput?.length??0)).toBeLessThanOrEqual(8000)
    if(mode==='none'||mode==='recent') expect(result.selection).toBeNull()
    if(mode==='none'||mode==='selection') expect(result.recentOutput).toBeNull()
    expect(source.selection.length).toBe(15000)
  })
})
