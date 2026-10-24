import { describe, it, expect, vi, afterEach } from 'vitest'
import { MacroRunner, MacroOutput, type MacroProgress } from './macro-runner'
import type { MacroStep } from '@nodeaccess/shared'
const sendStep = (text: string, enter = true): MacroStep => ({ type: 'send', text, enter })
const waitStep = (pattern: string, timeoutMs = 100, mode: 'literal' | 'regex' = 'literal'): MacroStep => ({ type: 'wait', pattern, mode, timeoutMs, caseSensitive: false })
const matcher = (pattern: string, text: string): Promise<number | null> => {
  const regex = new RegExp(pattern, 'i')
  if (regex.test('')) return Promise.reject(new Error('invalidRegex'))
  const m = regex.exec(text)
  return Promise.resolve(m ? m.index + m[0].length : null)
}
afterEach(() => vi.useRealTimers())
describe('macro execution', () => {
  it('preserves automatic Enter, raw sends and explicit keys', async () => {
    const send = vi.fn()
    const run = new MacroRunner([sendStep('pwd'), sendStep('echo x\n'), sendStep('raw', false), {type:'key',key:'ENTER'}, {type:'key',key:'TAB'}, {type:'key',key:'ESC'}], send, matcher, vi.fn())
    expect((await run.run()).status).toBe('completed')
    expect(send.mock.calls.flat()).toEqual(['pwd\n','echo x\n','raw','\r','\t','\x1b'])
  })
  it('waits across output fragments and strips split ANSI', async () => {
    const send = vi.fn()
    const run = new MacroRunner([waitStep('Password:'),sendStep('next')],send,matcher,vi.fn())
    const result = run.run()
    run.push('\x1b[3'); run.push('1mPass'); run.push('word:\x1b[0m')
    expect((await result).status).toBe('completed')
    expect(send).toHaveBeenCalledOnce()
  })
  it('retains suffix for consecutive waits', async () => {
    const run = new MacroRunner([waitStep('first'),waitStep('second')],vi.fn(),matcher,vi.fn())
    const result = run.run(); run.push('first second')
    expect((await result).status).toBe('completed')
  })
  it('does not match historical output after sending', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const run = new MacroRunner([sendStep('start'),waitStep('ready'),sendStep('finish')],send,matcher,vi.fn())
    run.push('ready')
    const result = run.run()
    await vi.advanceTimersByTimeAsync(110)
    expect((await result).error).toBe('timeout')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('captures immediate response during send', async () => {
    const run = new MacroRunner([sendStep('start'),waitStep('ready')],()=>run.push('ready'),matcher,vi.fn())
    expect((await run.run()).status).toBe('completed')
  })
  it('cancels pauses without sending remaining steps', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const run = new MacroRunner([{type:'pause',durationMs:1000},sendStep('never')],send,matcher,vi.fn())
    const result = run.run(); run.cancel()
    expect((await result).status).toBe('cancelled')
    await vi.runAllTimersAsync()
    expect(send).not.toHaveBeenCalled()
  })
  it('cancels pending waits', async () => {
    const send = vi.fn()
    const run = new MacroRunner([waitStep('ready'),sendStep('never')],send,matcher,vi.fn())
    const result = run.run(); run.cancel(); run.push('ready')
    expect((await result).status).toBe('cancelled')
    expect(send).not.toHaveBeenCalled()
  })
  it('ignores late matcher response after cancellation', async () => {
    let resolve!: (n:number) => void
    const send = vi.fn()
    const run = new MacroRunner([waitStep('ready',1000,'regex'),sendStep('never')],send,()=>new Promise(r=>{resolve=r}),vi.fn())
    const result = run.run(); run.cancel(); resolve(5)
    expect((await result).status).toBe('cancelled')
    expect(send).not.toHaveBeenCalled()
  })
  it('rejects invalid macros before sending', async () => {
    const send = vi.fn()
    const run = new MacroRunner([sendStep('ok'),{type:'pause',durationMs:-1}],send,matcher,vi.fn())
    expect((await run.run()).status).toBe('failed')
    expect(send).not.toHaveBeenCalled()
  })
  it('stops on disconnected sender', async () => {
    const send = vi.fn(()=>{throw new Error('disconnected')})
    const run = new MacroRunner([sendStep('one'),sendStep('two')],send,matcher,vi.fn())
    expect((await run.run()).error).toBe('disconnected')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('supports regex and case-insensitive prompts', async () => {
    const run = new MacroRunner([waitStep('senha.*:$',1000,'regex')],vi.fn(),matcher,vi.fn())
    const result=run.run();run.push('SENHA para operador:')
    expect((await result).status).toBe('completed')
  })
  it('isolates concurrent sessions', async () => {
    const send1=vi.fn(),send2=vi.fn()
    const a=new MacroRunner([waitStep('ready'),sendStep('a')],send1,matcher,vi.fn())
    const b=new MacroRunner([waitStep('ready'),sendStep('b')],send2,matcher,vi.fn())
    const pa=a.run(),pb=b.run();a.push('ready');b.cancel()
    expect((await pa).status).toBe('completed');expect((await pb).status).toBe('cancelled')
    expect(send1).toHaveBeenCalledWith('a\n');expect(send2).not.toHaveBeenCalled()
  })
  it('bounds output while recognizing current tail', async () => {
    const run=new MacroRunner([waitStep('ready')],vi.fn(),matcher,vi.fn())
    const result=run.run();run.push('x'.repeat(30000)+'ready')
    expect((await result).status).toBe('completed')
  })
  it('rejects reuse of an execution instance',async()=>{
    const run=new MacroRunner([sendStep('one')],vi.fn(),matcher,vi.fn())
    await run.run();await expect(run.run()).rejects.toThrow('alreadyStarted')
  })
  it('normalizes backspace identically at every stream split', () => {
    const text = 'ab\bc\x1b[31mde\b\bf'
    const expected = new MacroOutput().clean(text)
    for (let split = 0; split <= text.length; split++) {
      const output = new MacroOutput()
      expect(output.clean(text.slice(split), output.clean(text.slice(0, split)))).toBe(expected)
    }
    expect(expected).toBe('acf')
  })
  it('matches corrected output when backspace arrives in a later frame', async () => {
    const send = vi.fn()
    const run = new MacroRunner([waitStep('ac'), sendStep('next')], send, matcher, vi.fn())
    const result = run.run()
    run.push('ab')
    run.push('\bc')
    expect((await result).status).toBe('completed')
    expect(send).toHaveBeenCalledExactlyOnceWith('next\n')
  })
  it('normalizes fragmented OSC and CRLF',()=>{
    const output=new MacroOutput()
    expect(output.clean('a\x1b]title')).toBe('a')
    expect(output.clean('\x1b')).toBe('')
    expect(output.clean('\\b\r')).toBe('b\n')
    expect(output.clean('\nc')).toBe('c')
  })
  it('ignores late output after a timeout and emits one final state', async()=>{
    vi.useFakeTimers()
    const send=vi.fn(),changed=vi.fn<(state: MacroProgress) => void>()
    const run=new MacroRunner([waitStep('ready'),sendStep('never')],send,matcher,changed)
    const result=run.run()
    await vi.advanceTimersByTimeAsync(101)
    expect((await result).error).toBe('timeout')
    run.push('ready');run.cancel()
    await vi.runAllTimersAsync()
    expect(send).not.toHaveBeenCalled()
    expect(changed.mock.calls.filter(([state])=>state.status!=='running')).toHaveLength(1)
  })
  it('rejects a malformed later regex before the first command',async()=>{
    const send=vi.fn()
    const run=new MacroRunner([sendStep('never'),waitStep('[',1000,'regex')],send,matcher,vi.fn())
    expect((await run.run()).status).toBe('failed')
    expect(send).not.toHaveBeenCalled()
  })
  it('does not share matching output between sessions',async()=>{
    const sendA=vi.fn(),sendB=vi.fn()
    const a=new MacroRunner([waitStep('ready'),sendStep('a')],sendA,matcher,vi.fn())
    const b=new MacroRunner([waitStep('ready'),sendStep('b')],sendB,matcher,vi.fn())
    const pa=a.run(),pb=b.run();a.push('ready')
    await pa
    expect(sendB).not.toHaveBeenCalled()
    b.push('ready');await pb
    expect(sendA).toHaveBeenCalledWith('a\n')
    expect(sendB).toHaveBeenCalledWith('b\n')
  })
  it('honors case-sensitive waits without consuming mismatched output',async()=>{
    const send=vi.fn()
    const run=new MacroRunner([{...waitStep('READY'),caseSensitive:true},sendStep('ok')],send,matcher,vi.fn())
    const result=run.run();run.push('ready');await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
    run.push('READY');expect((await result).status).toBe('completed')
  })

  it('recognizes the prompt at every transport split boundary',async()=>{
    const stream='\x1b]0;demo\x07\x1b[32mREADY:\x1b[0m\r\n'
    for(let split=0;split<=stream.length;split++){
      const send=vi.fn()
      const run=new MacroRunner([waitStep('READY:'),sendStep('ok')],send,matcher,vi.fn())
      const result=run.run()
      run.push(stream.slice(0,split));run.push(stream.slice(split))
      expect((await result).status,'split '+split).toBe('completed')
      expect(send).toHaveBeenCalledExactlyOnceWith('ok\n')
    }
  })

  it('rejects a concurrent replay of the same runner without duplicating sends',async()=>{
    const send=vi.fn()
    const run=new MacroRunner([waitStep('ready'),sendStep('once')],send,matcher,vi.fn())
    const first=run.run()
    await expect(run.run()).rejects.toThrow('alreadyStarted')
    run.push('ready')
    expect((await first).status).toBe('completed')
    expect(send).toHaveBeenCalledExactlyOnceWith('once\n')
  })
  it('stops after a partial send failure without replaying earlier commands',async()=>{
    const send=vi.fn((text:string)=>{if(text==='two\n')throw new Error('disconnected')})
    const run=new MacroRunner([sendStep('one'),sendStep('two'),sendStep('three')],send,matcher,vi.fn())
    const result=await run.run()
    expect(result).toMatchObject({status:'failed',error:'disconnected',index:1})
    expect(send.mock.calls.flat()).toEqual(['one\n','two\n'])
  })
  it('does not emit a second final state for duplicate prompt frames',async()=>{
    const send=vi.fn(),changed=vi.fn<(state: MacroProgress) => void>()
    const run=new MacroRunner([waitStep('ready'),sendStep('once')],send,matcher,changed)
    const result=run.run()
    run.push('ready');run.push('ready')
    await result;run.push('ready')
    expect(send).toHaveBeenCalledExactlyOnceWith('once\n')
    expect(changed.mock.calls.filter(([state])=>state.status==='completed')).toHaveLength(1)
  })

})
