import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {restoreRehearsal,snapshot} from './recovery.mjs'
import {api,writePrivate,runtimeCredentials,DEFAULT_RUNTIME,failure,readFileSafe,privateDirectory} from './maintenance-common.mjs'
import {rotateTokens,retireTokens} from './token-maintenance.mjs'
export async function recoveryReal(backupPath){
 const original=(await runtimeCredentials(DEFAULT_RUNTIME)).credentials
 const owner=await privateDirectory(backupPath),manifest=(await readFileSafe(join(backupPath,'manifest.json'),{owner})).toString()
 const saved=JSON.parse(await readFileSafe(join(backupPath,'credentials.json'),{owner}))
 for(const field of ['admin_password','review_password','analysis_token','review_token'])if(manifest.includes(saved[field]))throw failure('MANIFEST_SECRET_EXPOSURE')
 const before=JSON.stringify(await snapshot('http://127.0.0.1:9000',original))
 const result=await restoreRehearsal({backupPath,onReady:async({origin,credentials,root,owner})=>{
  await writePrivate(join(root,'credentials.json'),credentials,owner)
  const rotation=await rotateTokens({runtime:root,origin,graceHours:0})
  for(const kind of ['analysis','review'])if((await api(origin,{token:credentials[`${kind}_token`]})('/api/authentication/validate')).data?.valid!==true)throw failure('OVERLAP_FAILED')
  const retirement=await retireTokens({runtime:root,origin})
  for(const kind of ['analysis','review'])if((await api(origin,{token:credentials[`${kind}_token`]})('/api/authentication/validate')).data?.valid===true)throw failure('REVOCATION_FAILED')
  return {rotation,retirement,overlapVerified:true,oldRevoked:true}
 }})
 if(before!==JSON.stringify(await snapshot('http://127.0.0.1:9000',original)))throw failure('ORIGINAL_CHANGED_DURING_REHEARSAL')
 return {...result,originalUnchanged:true,manifestContainsNoCredentials:true,finishedAt:new Date().toISOString()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.env.SONAR_RESTORE_TEST!=='1')throw failure('EXPLICIT_RESTORE_OPT_IN_REQUIRED');console.log(JSON.stringify(await recoveryReal(process.argv[2])))}catch(error){console.error(JSON.stringify({code:error.code??'RESTORE_REAL_FAILED',operation:error.operation,status:error.status}));process.exitCode=1}
}
