import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DEFAULT_RUNTIME,runtimeCredentials,privateLock,writePrivate,api,requireOk,failure} from './maintenance-common.mjs'
import {backup} from './recovery.mjs'
import {renewalDue,rotateTokens,retireTokens} from './token-maintenance.mjs'
export async function maintain({runtime=DEFAULT_RUNTIME,now=new Date(),services={backup,rotateTokens,retireTokens,api}}={}) {
 const {owner,credentials}=await runtimeCredentials(runtime),lockPath=join(runtime,'maintenance.lock')
 const lock=await privateLock(lockPath,owner),status={startedAt:now.toISOString(),passed:false}
 try {
  const request=services.api('http://127.0.0.1:9000',{login:credentials.admin_login,password:credentials.admin_password})
  const tasks=requireOk(await request('/api/ce/activity',{status:'PENDING,IN_PROGRESS',ps:1})).tasks
  if(!Array.isArray(tasks)||tasks.length)throw failure('ANALYSIS_ACTIVE_RETRY_LATER')
  const saved=await services.backup({runtime});status.backup=saved.output.split('/').at(-1)
  status.rotation=renewalDue(credentials.expires,now)?await services.rotateTokens({runtime,now}):{renewalDue:false}
  status.retirement=await services.retireTokens({runtime,now});status.passed=true
  return status
 }catch(error){status.code=error.code??'MAINTENANCE_FAILED';throw failure(status.code)}
 finally {status.finishedAt=new Date().toISOString();try{await writePrivate(join(runtime,'maintenance-status.json'),status,owner)}finally{await lock.close()}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await maintain()))}catch(error){console.error(error.code??'MAINTENANCE_FAILED');process.exitCode=1}
}
