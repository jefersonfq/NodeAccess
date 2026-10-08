import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { CertificateManager } from './manager.mjs'
import { randomUUID } from 'node:crypto'
import { StateStore } from './storage.mjs'
import { TlsError } from './certificates.mjs'
import { validatePair, metadata } from './certificates.mjs'
let base,certificate,key,second
const openssl=args=>execFileSync('openssl',args,{stdio:'ignore'})
before(async()=>{
 base=await fs.mkdtemp(path.join(os.tmpdir(),'nodeaccess-tls-unit-'))
 for(const name of ['first','second'])openssl(['req','-x509','-newkey','rsa:2048','-nodes','-days','90','-subj','/CN=tls.example.test','-addext','subjectAltName=DNS:tls.example.test','-addext','basicConstraints=critical,CA:FALSE','-keyout',path.join(base,name+'.key'),'-out',path.join(base,name+'.pem')])
 certificate=await fs.readFile(path.join(base,'first.pem'),'utf8');key=await fs.readFile(path.join(base,'first.key'),'utf8');second={certificate:await fs.readFile(path.join(base,'second.pem'),'utf8'),privateKey:await fs.readFile(path.join(base,'second.key'),'utf8')}
})
after(async()=>fs.rm(base,{recursive:true,force:true}))
async function fixture(options={}){
 const dir=await fs.mkdtemp(path.join(base,'case-')),root=path.join(dir,'certs');await fs.mkdir(path.join(root,'versions/initial'),{recursive:true});await fs.writeFile(path.join(root,'versions/initial/fullchain.pem'),certificate);await fs.writeFile(path.join(root,'versions/initial/privkey.pem'),key);await fs.symlink('versions/initial',path.join(root,'current'))
 const calls=[],adapter={validateChain:async()=>{},test:async()=>calls.push('test'),reload:async()=>calls.push('reload'),verify:async fingerprint=>calls.push(fingerprint),inspect:async()=>metadata(certificate),issue:async()=>second,dryRun:async()=>{}}
 const manager=new CertificateManager({root,stateDir:path.join(dir,'state'),domain:'tls.example.test',adapter,...options});await manager.init()
 const perform=async input=>{await manager.submit({expectedFingerprint:(await manager.active())?.fingerprint||'',...input},'user:1');await manager.completion;return manager.state.job}
 return {manager,adapter,calls,perform,root}
}
test('valid PEM accepted; mismatch, malformed and wrong domain rejected',()=>{
 assert.equal(validatePair(certificate,key,'tls.example.test').fingerprint,metadata(certificate).fingerprint)
 for(const [cert,k,domain] of [[certificate,second.privateKey,'tls.example.test'],['bad',key,'tls.example.test'],[certificate,key,'other.test']])assert.throws(()=>validatePair(cert,k,domain),{code:'INVALID_CERTIFICATE'})
})
test('preview does not reload; apply atomically replaces and verifies; no key in status/events',async()=>{
 const {manager,perform,calls}=await fixture();const events=[];manager.on('completed',e=>events.push(e))
 assert.equal((await perform({action:'validate',...second})).status,'succeeded');assert.deepEqual(calls,[])
 assert.equal((await manager.active()).fingerprint,metadata(certificate).fingerprint)
 const candidate=manager.state.candidate;assert.equal((await perform({action:'apply',candidateId:candidate.id})).status,'succeeded')
 assert.equal((await manager.active()).fingerprint,metadata(second.certificate).fingerprint);assert.equal(calls.filter(x=>x==='reload').length,1)
 assert.ok(!JSON.stringify([await manager.status(),events]).includes('PRIVATE KEY'))
})
test('chain validation failure leaves active certificate intact',async()=>{
 const {manager,adapter,perform}=await fixture();adapter.validateChain=async()=>{throw Error('private secret output')}
 const job=await perform({action:'validate',...second});assert.equal(job.status,'failed');assert.ok(!JSON.stringify(job).includes('private secret'));assert.equal(manager.state.candidate,undefined)
})
test('apply failure restores prior certificate and reloads it',async()=>{
 const {manager,adapter,perform}=await fixture();await perform({action:'validate',...second});let tests=0;adapter.test=async()=>{if(++tests===1)throw Error('nginx failed')}
 const job=await perform({action:'apply',candidateId:manager.state.candidate.id});assert.equal(job.error.code,'APPLY_ROLLED_BACK');assert.equal((await manager.active()).fingerprint,metadata(certificate).fingerprint);assert.ok(!manager.state.recoveryRequired)
})
test('failed recovery blocks further mutation',async()=>{
 const {manager,adapter,perform}=await fixture();await perform({action:'validate',...second});adapter.test=async()=>{throw Error('failure')};await perform({action:'apply',candidateId:manager.state.candidate.id});assert.equal(manager.state.job.error.code,'ROLLBACK_FAILED');await assert.rejects(perform({action:'automatic',email:'ops@example.test',agreeTerms:true}),{code:'RECOVERY_REQUIRED'})
})
test('automatic provisioning + scheduler + unchanged certificate avoids reload',async()=>{
 const {manager,perform,calls}=await fixture();await perform({action:'automatic',email:'ops@example.test',agreeTerms:true});assert.equal(manager.state.mode,'automatic');assert.ok(manager.state.nextCheck)
 calls.length=0;await perform({action:'renew'});assert.equal(calls.length,0)
 manager.state.nextCheck=null;await manager.tick();await manager.completion;assert.equal(manager.state.job.actor,'scheduler')
 await perform({action:'pause'});assert.equal(manager.state.mode,'provided');assert.equal(manager.state.nextCheck,null)
})
test('issuance failure preserves certificate and mode; retry scheduled when already automatic',async()=>{
 const {manager,adapter,perform}=await fixture();adapter.issue=async()=>{throw Error('DNS or network failure')};await perform({action:'automatic',email:'ops@example.test',agreeTerms:true});assert.equal(manager.state.mode,'provided');assert.equal((await manager.active()).fingerprint,metadata(certificate).fingerprint)
 manager.state.mode='automatic';await manager.tick();await manager.completion;assert.equal(manager.state.job.status,'failed');assert.ok(Date.parse(manager.state.nextCheck)>Date.now())
})
test('parallel submission rejected; stale fingerprint rejected; terms required; paths forbidden',async()=>{
 const {manager,adapter,perform}=await fixture();let unblock;adapter.inspect=()=>new Promise(r=>unblock=r)
 await manager.submit({action:'check'},'user:1');await assert.rejects(manager.submit({action:'check'},'user:2'),{code:'TLS_BUSY'});await waitFor(()=>typeof unblock==='function');unblock(metadata(certificate));await manager.completion
 await assert.rejects(manager.submit({action:'pause',expectedFingerprint:'old'},'user:1'),{code:'STALE_STATE'})
 await assert.rejects(perform({action:'automatic',email:'ops@example.test',agreeTerms:false}),{code:'ACME_CONSENT'})
 await assert.rejects(perform({action:'check',path:'/etc/passwd'}),{code:'INVALID_INPUT'})
})
test('expired preview cannot be applied and external topology cannot mutate certificates',async()=>{
 const {manager,perform}=await fixture();await perform({action:'validate',...second});manager.state.candidate.expiresAt='2020-01-01';assert.equal((await perform({action:'apply',candidateId:manager.state.candidate.id})).error.code,'CANDIDATE_EXPIRED')
 const ext=await fixture({external:true});await assert.rejects(ext.perform({action:'validate',...second}),{code:'EXTERNAL_TLS'});assert.equal((await ext.perform({action:'check'})).status,'succeeded');assert.equal((await ext.manager.status()).active,null)
})
test('restart during pending swap recovers prior version and records interrupted operation',async()=>{
 const {manager,perform,root,adapter}=await fixture();await perform({action:'validate',...second});const id=manager.state.candidate.id
 manager.state.pending={previous:'versions/initial',fingerprint:metadata(certificate).fingerprint};manager.state.job={id:'interrupted',status:'running',action:'apply'};await manager.save();await manager.point(`versions/${id}`)
 const restarted=new CertificateManager({root,stateDir:manager.stateDir,domain:'tls.example.test',adapter});await restarted.init();assert.equal((await restarted.active()).fingerprint,metadata(certificate).fingerprint);assert.equal(restarted.state.job.error.code,'INTERRUPTED')
})
test('recovery journal survives repeated failure and succeeds after operator fixes Nginx',async()=>{
 const {manager,root,adapter}=await fixture()
 manager.state.pending={previous:'versions/initial',fingerprint:metadata(certificate).fingerprint};await manager.save()
 adapter.verify=async()=>{throw Error('Nginx still broken')}
 const restart=async()=>{const next=new CertificateManager({root,stateDir:manager.stateDir,domain:'tls.example.test',adapter});await next.init();return next}
 const failed=await restart();assert.equal(failed.state.recoveryRequired,true);assert.ok(failed.state.pending)
 const failedAgain=await restart();assert.equal(failedAgain.state.recoveryRequired,true);assert.ok(failedAgain.state.pending)
 adapter.verify=async()=>{}
 const recovered=await restart();assert.equal(recovered.state.recoveryRequired,false);assert.equal(recovered.state.pending,undefined)
})

async function waitFor(condition){for(let i=0;i<100;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5))}throw Error('Condition not reached')}
test('lost ACK replay and request lookup survive restart without applying twice',async()=>{
 const {manager,perform,root,adapter,calls}=await fixture()
 await perform({action:'validate',...second})
 const input={action:'apply',candidateId:manager.state.candidate.id,expectedFingerprint:(await manager.active()).fingerprint,requestId:randomUUID()}
 const accepted=await manager.submit(input,'user:1');await manager.completion
 const restarted=new CertificateManager({root,stateDir:manager.stateDir,domain:'tls.example.test',adapter});await restarted.init()
 const replay=await restarted.submit(input,'user:1');assert.equal(replay.id,accepted.id);assert.equal(replay.status,'succeeded');assert.equal(calls.filter(c=>c==='reload').length,1)
 assert.equal(restarted.operation(input.requestId,'user:1').id,accepted.id)
 assert.throws(()=>restarted.operation(input.requestId,'user:2'),{code:'OPERATION_NOT_FOUND'})
 await assert.rejects(restarted.submit({...input,action:'pause'},'user:1'),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(restarted.submit(input,'user:2'),{code:'IDEMPOTENCY_CONFLICT'})
})
test('two admins cannot overwrite a preview and accepted running request is replayable',async()=>{
 const {manager,adapter}=await fixture();let unblock;adapter.inspect=()=>new Promise(resolve=>unblock=resolve)
 const input={action:'check',requestId:randomUUID()},first=await manager.submit(input,'user:1')
 assert.equal((await manager.submit(input,'user:1')).id,first.id)
 await assert.rejects(manager.submit({action:'check',requestId:randomUUID()},'user:2'),{code:'TLS_BUSY'})
 await waitFor(()=>!!unblock);unblock(metadata(certificate));await manager.completion
})
test('HTTPS check never calls ACME; simulation records DNS/challenge/ACME without reload',async()=>{
 const {manager,adapter,perform,calls}=await fixture();let issued=0,dry=0
 manager.state.mode='automatic';manager.state.email='ops@example.test'
 adapter.resolveDns=async()=>{};adapter.checkChallenge=async()=>{};adapter.issue=async()=>{issued++;return second};adapter.dryRun=async()=>{dry++}
 await perform({action:'check'});assert.equal(dry,0);assert.equal(issued,0)
 const result=await perform({action:'simulate'});assert.equal(dry,1);assert.deepEqual(result.steps.map(s=>s.name),['dns','challenge','acme']);assert.equal(calls.filter(c=>c==='reload').length,0)
 adapter.resolveDns=async()=>{throw new TlsError('ACME_DNS','DNS inválido')}
 const failed=await perform({action:'simulate'});assert.equal(failed.steps[0].status,'failed');assert.equal(failed.steps.length,1);assert.equal(dry,1)
})
test('retry uses exponential delay and rate limit blocks manual attempts until CA deadline',async()=>{
 let now=Date.now();const {manager,adapter,perform}=await fixture({now:()=>now})
 manager.state.mode='automatic';manager.state.email='ops@example.test'
 adapter.issue=async()=>{throw new TlsError('ACME_NETWORK','Rede indisponível')}
 await perform({action:'renew'});assert.equal(Date.parse(manager.state.nextCheck)-now,300000)
 await perform({action:'renew'});assert.equal(Date.parse(manager.state.nextCheck)-now,600000)
 const limited=new TlsError('ACME_RATE_LIMIT','Limite');limited.retryAfter=new Date(now+2*86400000).toISOString();adapter.issue=async()=>{throw limited}
 await perform({action:'renew'});assert.equal(manager.state.nextCheck,limited.retryAfter)
 await assert.rejects(perform({action:'simulate'}),{code:'ACME_RATE_LIMIT'})
 now+=3*86400000;adapter.issue=async()=>second;await perform({action:'renew'});assert.equal(manager.state.renewalFailure,undefined);assert.equal(manager.state.renewalAttempts,0)
})
test('corrupt state stays available for diagnosis but never overwrites disk or certificate',async()=>{
 const {manager,root,adapter}=await fixture();const file=path.join(manager.stateDir,'state.json');await fs.writeFile(file,'{broken')
 const restarted=new CertificateManager({root,stateDir:manager.stateDir,domain:'tls.example.test',adapter});await restarted.init()
 assert.equal((await restarted.status()).alerts[0].code,'STATE_CORRUPT');await assert.rejects(restarted.submit({action:'check'},'user:1'),{code:'RECOVERY_REQUIRED'})
 assert.equal(await fs.readFile(file,'utf8'),'{broken');assert.equal((await restarted.active()).fingerprint,metadata(certificate).fingerprint)
})
test('disk-full and read-only admission failures never execute a certificate change',async()=>{
 for(const code of ['ENOSPC','EROFS']){
  const {manager,adapter,root}=await fixture();let executions=0;adapter.issue=async()=>{executions++;return second}
  manager.store.save=async()=>{throw Object.assign(new Error('sensitive path'),{code})}
  await assert.rejects(manager.submit({action:'automatic',email:'ops@example.test',agreeTerms:true,expectedFingerprint:(await manager.active()).fingerprint},'user:1'),{code:code==='ENOSPC'?'STORAGE_FULL':'STORAGE_READ_ONLY'})
  assert.equal(executions,0);assert.equal(manager.state.recoveryRequired,true);assert.equal(await fs.readlink(path.join(root,'current')),'versions/initial')
 }
})
test('failure after pointer swap restores prior certificate and retains a recovery journal',async()=>{
 const {manager,perform,root,adapter}=await fixture();await perform({action:'validate',...second})
 const save=manager.store.save.bind(manager.store);manager.store.save=async value=>{
   if(await fs.readlink(path.join(root,'current'))!=='versions/initial')throw Object.assign(Error('full'),{code:'ENOSPC'})
   return save(value)
 }
 const job=await perform({action:'apply',candidateId:manager.state.candidate.id});assert.equal(job.status,'failed');assert.equal(manager.state.recoveryRequired,true);assert.equal((await manager.active()).fingerprint,metadata(certificate).fingerprint)
 const restarted=new CertificateManager({root,stateDir:manager.stateDir,domain:'tls.example.test',adapter});await restarted.init();assert.equal((await restarted.active()).fingerprint,metadata(certificate).fingerprint);assert.equal(restarted.state.recoveryRequired,false)
})
test('outbox survives API outage and restart; acknowledgement only removes selected events',async()=>{
 const {manager,perform,root,adapter}=await fixture();await perform({action:'check'});await perform({action:'check'})
 const restarted=new CertificateManager({root,stateDir:manager.stateDir,domain:'tls.example.test',adapter});await restarted.init()
 assert.equal(restarted.events().length,2);const id=restarted.events()[0].id;await restarted.acknowledge([id]);assert.equal(restarted.events().length,1)
 const data=JSON.stringify(restarted.events());assert.ok(!data.includes('PRIVATE KEY'))
})
test('external certificate expiry and monitoring failure generate durable alerts',async()=>{
 const {manager,adapter}=await fixture({external:true})
 adapter.inspect=async()=>({...metadata(certificate),validTo:new Date(Date.now()+3*86400000).toISOString()})
 await manager.monitor();assert.ok((await manager.status()).alerts.some(a=>a.code==='CERTIFICATE_EXPIRING'));assert.equal(manager.events()[0].type,'alerts.changed')
 adapter.inspect=async()=>{throw new TlsError('TLS_VERIFY_FAILED','HTTPS indisponível')};await manager.monitor();assert.ok((await manager.status()).alerts.some(a=>a.code==='HTTPS_MONITOR_FAILED'))
})

test('process termination during chain, pointer, Nginx, reload and verification recovers safely',async()=>{
 const {fork}=await import('node:child_process')
 for(const phase of ['chain','pointer','nginx','reload','verify']){
  const {manager,perform,root,adapter}=await fixture();await perform({action:'validate',...second})
  const child=fork(new URL('./crash-fixture.mjs',import.meta.url),[root,manager.stateDir,phase,path.join(base,'second.pem'),path.join(base,'second.key')],{stdio:['ignore','ignore','ignore','ipc']})
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Crash checkpoint timed out: '+phase))},10000)
   child.once('error',reject);child.once('message',()=>{clearTimeout(timer);child.kill('SIGKILL')})
   child.once('exit',(_code,signal)=>{clearTimeout(timer);signal==='SIGKILL'?resolve():reject(Error('Child exited before checkpoint: '+phase))})
  })
  const restarted=new CertificateManager({root,stateDir:manager.stateDir,domain:'tls.example.test',adapter});await restarted.init()
  assert.equal((await restarted.active()).fingerprint,metadata(certificate).fingerprint,phase)
  assert.equal(restarted.state.job.error.code,'INTERRUPTED',phase)
 }
})
test('a newer preview cannot be replaced by applying another administrator’s older preview',async()=>{
 const {manager,perform}=await fixture();await perform({action:'validate',...second});const previousId=manager.state.candidate.id
 await manager.submit({action:'validate',certificate,privateKey:key,expectedFingerprint:(await manager.active()).fingerprint,requestId:randomUUID()},'user:2');await manager.completion
 const job=await perform({action:'apply',candidateId:previousId});assert.equal(job.error.code,'INVALID_CANDIDATE');assert.equal((await manager.active()).fingerprint,metadata(certificate).fingerprint)
})

test('completion and events are not exposed before the final durable commit',async()=>{
 const {manager}=await fixture(),save=manager.store.save.bind(manager.store)
 let release
 manager.store.save=async value=>{
  if(value.job?.status==='succeeded')await new Promise(resolve=>release=resolve)
  return save(value)
 }
 const requestId=randomUUID();await manager.submit({action:'check',requestId},'user:1')
 await waitFor(()=>!!release)
 assert.equal((await manager.status()).job.status,'running')
 assert.equal(manager.operation(requestId,'user:1').status,'running')
 assert.equal(manager.events().length,0)
 release();await manager.completion
 assert.equal((await manager.status()).job.status,'succeeded');assert.equal(manager.events().length,1)
})
