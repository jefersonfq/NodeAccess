import { describe, expect, it } from 'vitest'
import { terminalAiFailure, canRetryTerminalAi } from './terminal-ai-errors'
describe('recoverable AI failures', () => {
  it.each([
    [undefined,undefined,'network',true],
    [504,undefined,'timeout',true],
    [502,'AI_RESPONSE_INVALID','format',true],
    [403,'AI_LICENSE','license',false],
    [403,undefined,'permission',false],
    [429,undefined,'rateLimit',true],
    [503,'AI_PROVIDER_CONFIGURATION','configuration',false],
    [503,undefined,'unavailable',true],
  ] as const)('maps %s/%s without exposing provider text', (status,code,reason,retry) => {
    const result=terminalAiFailure({response:{status,data:{code,message:'secret provider text'}}})
    expect(result).toBe(reason)
    expect(canRetryTerminalAi(result)).toBe(retry)
  })
})
