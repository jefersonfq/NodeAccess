/** Opt-in: customer exports remain ignored local files, never test fixtures in Git. */
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe,expect,it} from 'vitest'
import {buildCommandTimeline,parsePreviewLine} from './session-audit-normalizer.js'
import {reconstructAudit} from './session-audit-reconstruction.js'
const folder=process.env.AUDIT_EXPORT_REVIEW_DIR
function read(id:number) {
 const events=readFileSync(resolve(folder!,`session-audit-${id}.jsonl`),'utf8').split('\n').filter(Boolean).map(parsePreviewLine).filter(e=>e!==null)
 return {events,commands:buildCommandTimeline(events)}
}
describe.skipIf(!folder)('read-only customer export regression',()=>{
 it('183: recovers all five complete reports with the exact date edits',()=>{
  const {events,commands}=read(183)
  const pasted=events.filter(e=>e.type==='stdin'&&e.text?.startsWith('SELECT ')).map(e=>e.text!)
  expect(pasted).toHaveLength(2)
  const expected=(source:string,end:string)=>source.replace('2026-07-30 00:00:00.000','2026-08-27 00:00:00').replace('2026-08-27 00:00:00.000',`${end} 23:59:59`)
  expect(commands).toHaveLength(7)
  expect(commands.slice(2).map(c=>c.command)).toEqual([
   expected(pasted[0]!,'2026-09-26'),expected(pasted[0]!,'2026-09-06'),expected(pasted[0]!,'2026-09-01'),expected(pasted[0]!,'2026-09-26'),expected(pasted[1]!,'2026-09-26'),
  ])
  expect(commands.slice(2,4).every(c=>c.output.includes('Query execution was interrupted'))).toBe(true)
  expect(commands.slice(4).every(c=>c.output.includes('row'))).toBe(true)
 })
 it('136: preserves CLI history edits and assigns outputs to their actual commands',()=>{
  const {commands}=read(136)
  expect(commands).toHaveLength(14)
  expect(commands[2]?.command).toBe('opensips-cli -x mi uptime')
  expect(commands[7]?.command).toBe('opensips-cli')
  expect(commands[7]?.output).not.toContain('load:')
  expect(commands[9]?.command).toBe('mi get_statistics load:')
  expect(commands[9]?.output).toContain('load:')
  expect(commands.at(-1)?.command).toBe('mi which')
  expect(commands.at(-1)?.output.length).toBeGreaterThan(100)
 })
 it('166: preserves SQL statements after history navigation and edited pasted input',()=>{
  const {commands}=read(166)
  expect(commands).toHaveLength(9)
  expect(commands.slice(2).every(c=>c.command.endsWith(';'))).toBe(true)
  expect(commands.slice(3).every(c=>c.output.includes('Query OK'))).toBe(true)
  expect(commands.some(c=>c.command.includes('\x1b'))).toBe(false)
 })
 it('184: reconstructs modified arrows against the subsequent server history echo',()=>{
  const {events,commands}=read(184)
  const observed=events.find(e=>e.seq===3470)?.text?.replaceAll(' \r','')
  expect(commands).toHaveLength(6)
  expect(commands[2]?.command).toBe(observed)
  expect(commands[3]?.command).toBe(observed)
  expect(commands.slice(2,4).every(c=>c.output.includes("Unknown column 'time'"))).toBe(true)
  expect(commands[4]?.command).toContain('substring(call_start_time,1,10)')
  expect(commands.slice(4).every(c=>c.output.includes('rows in set'))).toBe(true)
 })

})

describe.skipIf(!folder)('versioned reconstruction of recorded cases',()=>{
 it.each([[136,14],[166,9],[183,7],[184,6]])('keeps session %i complete with %i commands',(id,count)=>{
  const content=readFileSync(resolve(folder!,`session-audit-${id}.jsonl`),'utf8')
  const result=reconstructAudit([{seq:1,content}],'COMPLETED',1)
  expect(result.metadata.state).toBe('complete')
  expect(result.commands).toHaveLength(count)
  expect(result.commands.every(c=>c.source&&c.processorVersion)).toBe(true)
 })
})
