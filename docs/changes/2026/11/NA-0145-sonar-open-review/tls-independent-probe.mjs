import { pathToFileURL } from 'node:url'
const { CertificateManager } = await import(pathToFileURL(process.cwd()+'/tools/tls/manager.mjs'))
import fs from 'node:fs/promises'
import { join } from 'node:path'
const root=await fs.mkdtemp('/tmp/NA0145-tls-')
try {
 await fs.symlink('versions/old',join(root,'current'))
 let saves=0
 const fake={root,state:{},now:()=>0,active:async()=>({fingerprint:'old'}),save:async()=>{if(++saves===2)throw Object.assign(new Error('simulated persistence failure'),{code:'ENOSPC'})},point:async()=>{throw new Error('simulated apply and rollback failure')},adapter:{test:async()=>{},reload:async()=>{},verify:async()=>{}},step:async(_name,fn)=>fn()}
 let failure
 try {await CertificateManager.prototype.activate.call(fake,{expiresAt:'2099-01-01T00:00:00Z',baseFingerprint:'old',id:'candidate',fingerprint:'new'})}catch(e){failure={code:e.code,recoveryRequired:fake.state.recoveryRequired,pendingPreserved:!!fake.state.pending,saveCalls:saves}}
 if(failure?.code!=='ENOSPC'||!failure.recoveryRequired||!failure.pendingPreserved)throw Error('Unexpected control flow')
 const result={kind:'actual activate method with isolated filesystem and simulated adapter/persistence failures; not real Nginx',observed:failure,interpretation:'Persistence error supersedes ROLLBACK_FAILED; recoveryRequired and pending remain in memory.'}
 console.log(JSON.stringify(result))
}finally{await fs.rm(root,{recursive:true,force:true})}
