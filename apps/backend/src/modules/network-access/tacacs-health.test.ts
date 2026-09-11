import { describe, it, expect, vi } from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { TacacsMetrics } from './tacacs-metrics.js'
import { tenantHealth, operationalState, requiresSupervisorRestart, type Heartbeat } from './tacacs-health.js'
import { NetworkAccessService } from './network-access.service.js'
import { networkAccessRoutes } from './network-access.routes.js'
function beat(): Heartbeat { return { observedAt: Date.now(), database: true, runtime: { listening:true, connections:0, limits:{connections:64,perSource:8,operations:32,timeoutMs:5000},accepted:0,rejected:0,requests:0,errors:0,timeouts:0,pendingOperations:0,oldestOperationMs:0,tenants:{} } } }
describe('TACACS+ tenant diagnostics', () => {
  it('distinguishes ready, stale, database failure and capacity exhaustion', () => {
    const b=beat(); expect(operationalState(b)).toBe('ready')
    expect(operationalState(b,b.observedAt+21000)).toBe('stale')
    expect(operationalState({...b,database:false})).toBe('degraded')
    expect(operationalState({...b,runtime:{...b.runtime,pendingOperations:32}})).toBe('degraded')
    expect(operationalState({...b,runtime:{...b.runtime,oldestOperationMs:5001}})).toBe('degraded')
    expect(operationalState({...b,runtime:{...b.runtime,listening:false}})).toBe('degraded')
  })
  it('requests supervisor restart only for an operation still pending beyond its stall deadline', () => {
    const runtime=beat().runtime
    expect(requiresSupervisorRestart({...runtime,pendingOperations:1,oldestOperationMs:59999},60000)).toBe(false)
    expect(requiresSupervisorRestart({...runtime,pendingOperations:1,oldestOperationMs:60000},60000)).toBe(true)
    expect(requiresSupervisorRestart({...runtime,pendingOperations:0,oldestOperationMs:60000},60000)).toBe(false)
  })
  it('does not expose other tenants or global activity counters', () => {
    const b=beat(); b.runtime.tenants={1:{requests:2,errors:0,timeouts:0,lastRequestAt:Date.now(),pendingOperations:0,p95Ms:10},2:{requests:999,errors:0,timeouts:0,lastRequestAt:Date.now(),pendingOperations:0,p95Ms:900}}
    const result=tenantHealth([{id:'instance',heartbeat:b}],1)
    expect(result.status).toBe('ready'); expect(result.instances[0]?.activity?.requests).toBe(2)
    expect(JSON.stringify(result)).not.toContain('999'); expect(result.instances[0]).not.toHaveProperty('runtime')
    expect(tenantHealth([{id:'instance',heartbeat:b}],3).instances[0]?.activity).toBeNull()
  })
  it('does not hide a stale replica behind a healthy instance', () => {
    const b=beat();expect(tenantHealth([{id:'a',heartbeat:b},{id:'b',heartbeat:{...b,observedAt:b.observedAt-30000}}],1).status).toBe('degraded')
    expect(tenantHealth([],1).status).toBe('unobserved')
  })
  it('keeps pending operations visible after timeout until completion', () => {
    const m=new TacacsMetrics(),id=m.begin();m.bind(id,1);m.timeout(id)
    expect(m.snapshot().pendingOperations).toBe(1);expect(m.snapshot().tenants[1]?.timeouts).toBe(1)
    m.error(id);m.finish(id)
    expect(m.snapshot().pendingOperations).toBe(0);expect(m.snapshot().tenants[1]?.errors).toBe(1)
  })
  it('bounds both tenant and latency history memory', () => {
    const m=new TacacsMetrics()
    for(let i=1;i<=1100;i++){const id=m.begin();m.bind(id,i);m.finish(id)}
    expect(Object.keys(m.snapshot().tenants)).toHaveLength(1024)
    const clock=vi.spyOn(Date,'now');let now=1000;clock.mockImplementation(()=>now)
    try{for(let i=0;i<200;i++){const id=m.begin();m.bind(id,1100);now+=i<72?10000:10;m.finish(id)}expect(m.snapshot().tenants[1100]?.p95Ms).toBe(10)}finally{clock.mockRestore()}
  })
  it('does not query monitoring for a disabled tenant; store failure is unknown, never ready', async () => {
    const read=vi.fn().mockRejectedValue(Error('Redis unavailable'))
    const service=new NetworkAccessService({} as any,{} as any,{read})
    vi.spyOn(service,'settings').mockResolvedValue({defaultProfile:'server_ssh',tacacsEnabled:false})
    expect((await service.health(1)).status).toBe('disabled');expect(read).not.toHaveBeenCalled()
    vi.mocked(service.settings).mockResolvedValue({defaultProfile:'server_ssh',tacacsEnabled:true})
    expect((await service.health(1)).status).toBe('unavailable')
  })
  it('requires admin and scopes health to the authenticated tenant, ignoring a supplied tenant', async () => {
    const app=Fastify(),service=new NetworkAccessService({} as any,{} as any)
    const health=vi.spyOn(service,'health').mockResolvedValue({status:'unobserved',instances:[]})
    await app.register(jwt,{secret:'disposable-health-test-key-at-least-32'})
    await networkAccessRoutes(app,service)
    const auth=(role:string)=>({authorization:'Bearer '+app.jwt.sign({sub:'1',tenantId:7,role,stage:'authenticated'})})
    try{
      expect((await app.inject({url:'/health'})).statusCode).toBe(401)
      expect((await app.inject({url:'/health',headers:auth('user')})).statusCode).toBe(403)
      expect((await app.inject({url:'/health?tenantId=99',headers:auth('admin')})).statusCode).toBe(200)
      expect(health).toHaveBeenCalledTimes(1);expect(health).toHaveBeenCalledWith(7)
    }finally{await app.close()}
  })
})
