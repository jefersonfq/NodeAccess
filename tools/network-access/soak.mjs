// Opt-in real MySQL + Python client soak. Never targets a customer device.
import assert from 'node:assert/strict'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { createTacacsServer } from '../../apps/backend/src/modules/network-access/tacacs-server.ts'
export async function runSoak({service,probe}) {
  const duration=Number(process.env.NETWORK_SOAK_SECONDS??120),concurrency=Number(process.env.NETWORK_SOAK_CLIENTS??4)
  assert.ok(Number.isInteger(duration)&&duration>=30&&duration<=1800,'duration must be 30..1800 seconds')
  assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=8,'clients must be 1..8')
  let stage='baseline',calls=0,held=0,peakHeld=0
  const faults=new Proxy(service,{get(target,key,receiver){
    if(key==='authorize')return async(...args)=>{
      const n=++calls
      if(stage==='faults'&&n%4===0)throw Error('Injected dependency failure')
      if(stage==='faults'&&n%4===1){held++;peakHeld=Math.max(peakHeld,held);try{await new Promise(r=>setTimeout(r,350))}finally{held--}}
      return target.authorize(...args)
    }
    return Reflect.get(target,key,receiver)
  }})
  const runtime=createTacacsServer(faults,{connections:32,perSource:8,operations:16,timeoutMs:200})
  await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve))
  const port=runtime.server.address().port, phases=[],samples=[]
  const lag=monitorEventLoopDelay({resolution:20});lag.enable()
  const cpuStart=process.cpuUsage(),started=Date.now()
  try{
    for(const phase of ['baseline','faults','recovery']){
      stage=phase;const until=Date.now()+duration*1000/3
      const result={phase,requests:0,permitted:0,denied:0,errors:0,unavailable:0}
      console.log('SOAK phase '+phase)
      await Promise.all(Array.from({length:concurrency},async(_,worker)=>{
        let i=0
        while(Date.now()<until){
          const allowed=(i+++worker)%3!==0
          const args=allowed?['service=shell','cmd=show','cmd-arg=version']:['service=shell','cmd=reload']
          const response=await probe('authorize',{port,args});result.requests++
          if(response.unavailable)result.unavailable++
          else if(response.status===17)result.errors++
          else{assert.equal(response.valid,allowed,'never grant a denied command, even during failure');if(response.valid)result.permitted++;else result.denied++}
          if(phase!=='faults')assert.equal(response.valid,allowed,'healthy phase must complete each request')
        }
      }))
      // All injected delays settle before evaluating recovery and outstanding capacity.
      await new Promise(r=>setTimeout(r,400))
      const snapshot=runtime.snapshot();assert.equal(snapshot.pendingOperations,0)
      samples.push({phase,rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed,connections:snapshot.connections,pendingOperations:snapshot.pendingOperations})
      phases.push(result)
    }
    assert.ok(phases[1].errors>0&&phases[1].unavailable>0,'fault phase must actually exercise both error and timeout')
    assert.ok(phases[2].permitted>0&&phases[2].denied>0,'recovery must exercise permit and deny')
    const cpu=process.cpuUsage(cpuStart)
    return {ok:true,seconds:(Date.now()-started)/1000,concurrency,phases,samples,peakHeld,cpuMicroseconds:cpu,eventLoopP95Ms:lag.percentile(95)/1e6,stats:runtime.stats,limits:'Local Node process memory/CPU only; Python subprocesses and MySQL not included. No production capacity claim.'}
  }finally{lag.disable();await runtime.close()}
}
