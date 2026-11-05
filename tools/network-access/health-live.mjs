import { artifactPath } from '../shared/private-artifacts.cjs'
// Real Redis round trip in an isolated namespace, no existing tenant mutation.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { TacacsHealthStore, HEALTH_FRESH_MS } from '../../apps/backend/dist/modules/network-access/tacacs-health.js'
import { createTacacsTestPki } from '../../apps/backend/dist/modules/network-access/tacacs-tls.test-pki.js'
import { createTacacsServer } from '../../apps/backend/dist/modules/network-access/tacacs-server.js'
if(process.env.RUN_NETWORK_HEALTH_LIVE!=='true')throw Error('Set RUN_NETWORK_HEALTH_LIVE=true')
const store=new TacacsHealthStore(process.env.REDIS_URL,process.env.REDIS_PASSWORD,'na:tacacs:lab:'+randomUUID())
const pki=createTacacsTestPki()
const runtime=createTacacsServer({device:async()=>null,authenticate:async()=>false,authorize:async()=>false,event:async()=>{}},pki.server)
await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve))
const heartbeat=()=>({observedAt:Date.now(),database:true,runtime:runtime.snapshot()})
try{
 assert.equal((await store.read(7)).status,'unobserved')
 await store.publish('a',heartbeat());assert.equal((await store.read(7)).status,'ready')
 await store.publish('b',{...heartbeat(),observedAt:Date.now()-HEALTH_FRESH_MS-1000})
 assert.equal((await store.read(7)).status,'degraded')
 await store.publish('b',heartbeat());assert.equal((await store.read(7)).status,'ready')
 await store.publish('a',{...heartbeat(),database:false});assert.equal((await store.read(7)).status,'degraded')
 await store.publish('a',heartbeat());assert.equal((await store.read(7)).status,'ready')
 await runtime.close();await store.publish('a',heartbeat());assert.equal((await store.read(7)).status,'degraded')
 const result={ok:true,checks:['no heartbeat is unknown','ready after heartbeat','stale replica degrades fleet','replica recovery','database failure and recovery','closed listener never ready']}
 writeFileSync(artifactPath('nodeaccess-tacacs-health-live.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{if(runtime.server.listening)await runtime.close();await store.remove('a');await store.remove('b');store.close();pki.cleanup()}
