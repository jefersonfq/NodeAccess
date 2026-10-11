import {describe,it,expect} from 'vitest'
import {operationalCorpus} from '../../../../../tools/session-audit/operational-corpus.js'
import {reconstructAudit} from './session-audit-reconstruction.js'
import {terminalTranscript,commandTranscript} from './session-audit-text-export.js'
import {stripAnsi,looksLikePrompt} from './session-audit-normalizer.js'
const corpus=operationalCorpus()
describe('psql prompt boundaries',()=>{
  it('recognizes normal and superuser prompts without treating SQL continuation as completed',()=>{
    expect(looksLikePrompt('reporting=> ')).toBe(true)
    expect(looksLikePrompt('reporting=# ')).toBe(true)
    expect(looksLikePrompt('reporting-> ')).toBe(false)
    expect(looksLikePrompt("reporting'> ")).toBe(false)
  })
})
describe.each(corpus)('operational session: $name',scenario=>{
  it('reconstructs every expected command exactly, with original actor and no invented commands',()=>{
    const snapshot=reconstructAudit([{seq:1,content:scenario.content}],'COMPLETED',1)
    expect(snapshot.metadata.state).toBe('complete')
    expect(snapshot.commands.map(c=>c.command)).toEqual(scenario.expected.map(c=>c.command))
    expect(snapshot.commands.map(c=>c.actorUserId)).toEqual(scenario.expected.map((_,i)=>i%2+1))
  })
  it('exports complete logical commands and error text without mutating the source',async()=>{
    const snapshot=reconstructAudit([{seq:1,content:scenario.content}],'COMPLETED',1)
    const before=JSON.stringify(snapshot)
    const text=await terminalTranscript(scenario.id,snapshot)
    const commands=commandTranscript(scenario.id,snapshot)
    for(const expected of scenario.expected){
      expect(text,expected.command).toContain(expected.command)
      expect(commands,expected.command).toContain(expected.command)
      if(/ERROR|Permission denied|not found|timed out|Error:/.test(expected.output))expect(text).toContain(stripAnsi(expected.output))
    }
    expect(text).not.toContain('\x1b')
    expect(text).not.toContain('�')
    expect(JSON.stringify(snapshot)).toBe(before)
  })
})
