import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {syncBuiltinESMExports} from 'node:module'
import {installMaintenance} from './install-maintenance.mjs'

// System paths are mapped into a private temporary tree. No cron or /usr file is changed.
async function installerSandbox(t, options={}) {
 const original=Object.fromEntries(['mkdir','lstat','open','readFile','chmod','rm','readdir'].map(name=>[name,fs[name]]))
 const root=await fs.mkdtemp(join(tmpdir(),'sonar-installer-test-'));await original.chmod(root,0o700);await original.mkdir(join(root,'cron'),{mode:0o700})
 const prefix='/usr/local/lib/nodeaccess-sonarqube-maintenance',cron='/etc/cron.d'
 const mapped=path=>typeof path==='string'?(path===prefix||path.startsWith(`${prefix}/`)?join(root,'releases')+path.slice(prefix.length):path===cron||path.startsWith(`${cron}/`)?join(root,'cron')+path.slice(cron.length):path):path
 const stat=s=>new Proxy(s,{get(target,key){return key==='uid'?0:typeof target[key]==='function'?target[key].bind(target):target[key]}})
 const parents=new Set(['/usr','/usr/local','/usr/local/lib','/etc','/etc/cron.d'])
 t.mock.method(process,'getuid',()=>options.nonRoot?1000:0)
 t.mock.method(fs,'lstat',async(path,...args)=>{
  if(parents.has(path))return {uid:0,mode:options.unsafeParent?0o777:0o755,isDirectory:()=>true,isSymbolicLink:()=>false}
  return stat(await original.lstat(mapped(path),...args))
 })
 t.mock.method(fs,'mkdir',(path,...args)=>original.mkdir(mapped(path),...args))
 t.mock.method(fs,'chmod',(path,...args)=>original.chmod(mapped(path),...args))
 t.mock.method(fs,'readFile',(path,...args)=>path===process.execPath?Promise.resolve(Buffer.from('fixture-node-binary')):original.readFile(mapped(path),...args))
 t.mock.method(fs,'open',async(path,...args)=>{
  const handle=await original.open(mapped(path),...args)
  return new Proxy(handle,{get(target,key){
   if(key==='stat')return async()=>stat(await target.stat())
   if(key==='chown')return async()=>{} // Model installer root ownership without privileged mutation.
   const value=target[key];return typeof value==='function'?value.bind(target):value
  }})
 })
 syncBuiltinESMExports()
 t.after(async()=>{t.mock.restoreAll();syncBuiltinESMExports();await original.rm(root,{recursive:true,force:true})})
 return {root,mapped,original}
}
test('installer publishes complete immutable release before pointing private cron at it',async t=>{
 const s=await installerSandbox(t),result=await installMaintenance(),release=s.mapped(result.runtime)
 assert.equal(result.installed,true)
 for(const name of ['maintenance-common.mjs','recovery.mjs','token-maintenance.mjs','maintenance.mjs']){
  assert.deepEqual(await s.original.readFile(join(release,name)),await s.original.readFile(join('tools/sonarqube',name)))
  assert.equal((await s.original.lstat(join(release,name))).mode&0o777,0o600)
 }
 assert.equal((await s.original.lstat(release)).mode&0o777,0o700)
 assert.equal((await s.original.lstat(join(release,'node'))).mode&0o777,0o700)
 assert.equal(await s.original.readFile(join(release,'node'),'utf8'),'fixture-node-binary')
 const path=join(s.root,'cron','nodeaccess-sonarqube-maintenance'),text=await s.original.readFile(path,'utf8')
 assert.ok(text.includes(`20 3 * * * root ${result.runtime}/node ${result.runtime}/maintenance.mjs`))
 assert.equal((await s.original.lstat(path)).mode&0o777,0o644)
 const again=await installMaintenance();assert.notEqual(again.runtime,result.runtime)
 assert.equal((await s.original.readdir(join(s.root,'releases'))).length,2)
 assert.ok((await s.original.readFile(path,'utf8')).includes(again.runtime))
})
for(const [option,code] of [['nonRoot','ROOT_REQUIRED'],['unsafeParent','UNTRUSTED_INSTALL_PARENT']])test(`installer fails closed for ${option}`,async t=>{
 const s=await installerSandbox(t,{[option]:true});await assert.rejects(installMaintenance(),{code});assert.deepEqual(await s.original.readdir(join(s.root,'cron')),[])
})
