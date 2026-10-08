import {describe,it,expect,vi} from 'vitest'
import {TlsMonitor} from './tls.monitor.js'
const event={id:'11111111-1111-4111-8111-111111111111',type:'operation.completed',domain:'tls.example.test',occurredAt:'2026-09-26T00:00:00Z',data:{actor:'scheduler',requestId:'request',status:'succeeded'}}
function fixture(){
 const records=new Map(),db={tlsAuditEvent:{upsert:vi.fn(async({create})=>{records.set(create.id,create);return create})}}
 let ackLost=false,dbDown=false,agentDown=false
 const client={request:vi.fn(async(method,path)=>{
  if(agentDown)throw Error('offline')
  if(path==='/status')return {alerts:[]}
  if(path==='/events')return {events:[event]}
  if(path==='/events/ack'&&ackLost)throw Error('ACK lost')
  return {ok:true}
 })}
 const monitor=new TlsMonitor(db as any,client,true)
 return {monitor,db,client,records,setAckLost:(value:boolean)=>ackLost=value,setAgentDown:(value:boolean)=>agentDown=value}
}
describe('certificate background monitor',()=>{
 it('durably ingests before ACK and replay does not duplicate an event',async()=>{
  const f=fixture();f.setAckLost(true);await f.monitor.poll();expect(f.records.size).toBe(1);expect(f.monitor.status().alerts[0].code).toBe('TLS_AUDIT_PENDING')
  f.setAckLost(false);await f.monitor.poll();expect(f.records.size).toBe(1);expect(f.monitor.status().alerts).toEqual([])
  expect(f.records.get(event.id).actor).toBe('scheduler')
 })
 it('does not acknowledge events when database persistence fails',async()=>{
  const f=fixture();f.db.tlsAuditEvent.upsert.mockRejectedValueOnce(Error('database down'));await f.monitor.poll()
  expect(f.client.request.mock.calls.some(([,path])=>path==='/events/ack')).toBe(false)
  await f.monitor.poll();expect(f.records.size).toBe(1)
 })
 it('reports agent outage and clears alert after recovery',async()=>{
  const f=fixture();f.setAgentDown(true);await f.monitor.poll();expect(f.monitor.status().alerts[0].code).toBe('TLS_AGENT_UNAVAILABLE')
  f.setAgentDown(false);await f.monitor.poll();expect(f.monitor.status().alerts).toEqual([])
 })
 it('disabled pilot never probes; shutdown prevents new polls',async()=>{
  const f=fixture();const disabled=new TlsMonitor(f.db as any,f.client,false);await disabled.poll();expect(f.client.request).not.toHaveBeenCalled()
  await f.monitor.stop();await f.monitor.poll();expect(f.client.request).not.toHaveBeenCalled()
 })
})
