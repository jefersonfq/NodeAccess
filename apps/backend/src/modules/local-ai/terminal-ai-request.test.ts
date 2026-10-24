import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { terminalAiRequestScope } from './terminal-ai-request.js'
afterEach(() => vi.useRealTimers())
describe('terminal AI request lifetime', () => {
  function scope() {
    const request=Object.assign(new EventEmitter(),{aborted:false})
    const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false})
    const lifetime=terminalAiRequestScope(request as IncomingMessage,response as ServerResponse,100)
    return {request,response,...lifetime}
  }
  it('does not cancel when the request body finishes normally', () => {
    const s=scope();s.request.emit('close');expect(s.signal.aborted).toBe(false)
    s.response.writableEnded=true;s.response.emit('close');expect(s.signal.aborted).toBe(false);s.dispose()
    expect(s.response.listenerCount('close')).toBe(0)
  })
  it.each(['request','response'] as const)('cancels on aborted %s', side => {
    const s=scope();s[side].emit(side==='request'?'aborted':'close');expect(s.signal.aborted).toBe(true);s.dispose()
  })
  it('has a bounded deadline and removes listeners', () => {
    vi.useFakeTimers();const s=scope();vi.advanceTimersByTime(100)
    expect(s.signal.reason).toBeInstanceOf(DOMException);expect((s.signal.reason as DOMException).name).toBe('TimeoutError');s.dispose()
    expect(s.request.listenerCount('aborted')).toBe(0)
  })
})
