import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DEFAULT_RUNTIME, api, requireOk, runtimeCredentials, privateLock, writePrivate, failure } from './maintenance-common.mjs'

export function expirationDate(now = new Date()) { return new Date(now.getTime()+30*86400_000).toISOString().slice(0,10) }
export function renewalDue(expires, now = new Date()) {
  const date=Date.parse(expires);if(!Number.isFinite(date))throw failure('TOKEN_EXPIRY_INVALID')
  return date-now.getTime()<=7*86400_000
}
export async function verifyScopes(origin, credentials, requestFactory=api) {
  const result={}
  for(const kind of ['analysis','review']) {
    const request=requestFactory(origin,{token:credentials[`${kind}_token`]})
    const valid=await request('/api/authentication/validate')
    if(valid.status!==200||valid.data?.valid!==true)throw failure('TOKEN_NOT_VALID')
    for(const endpoint of ['/api/system/info','/api/permissions/users'])if((await request(endpoint)).status!==403)throw failure('TOKEN_ADMIN_SCOPE_UNEXPECTED')
    if(kind==='analysis') {
      if((await request('/api/analysis_cache/get',{project:'nodeaccess'})).status!==200)throw failure('ANALYSIS_SCOPE_NOT_VERIFIED')
      if((await request('/api/components/show',{component:'nodeaccess'})).status!==403)throw failure('ANALYSIS_BROWSE_SCOPE_UNEXPECTED')
    } else {
      const project=await request('/api/components/show',{component:'nodeaccess'})
      if(project.status!==200||project.data?.component?.key!=='nodeaccess')throw failure('REVIEW_SCOPE_NOT_VERIFIED')
      if((await request('/api/analysis_cache/get',{project:'nodeaccess'})).status!==403)throw failure('REVIEW_ANALYSIS_SCOPE_UNEXPECTED')
    }
    result[kind]={valid:true,administrationDenied:true,projectScopeVerified:true}
  }
  return result
}
async function idle(admin) {
  const result=requireOk(await admin('/api/ce/activity',{status:'PENDING,IN_PROGRESS',ps:1}))
  if(!Array.isArray(result.tasks)||result.tasks.length)throw failure('ANALYSIS_ACTIVE_RETRY_LATER')
}
async function tokenMetadata(admin,login) {
  const data=requireOk(await admin('/api/user_tokens/search',{login}))
  if(!Array.isArray(data.userTokens))throw failure('TOKEN_METADATA_INVALID')
  return data.userTokens
}
async function priorName(admin,c,kind) {
  const login=kind==='analysis'?c.admin_login:c.review_login,type=kind==='analysis'?'PROJECT_ANALYSIS_TOKEN':'USER_TOKEN'
  const rows=(await tokenMetadata(admin,login)).filter(t=>t.type===type)
  const explicit=c[`${kind}_token_name`]
  const candidates=explicit?rows.filter(t=>t.name===explicit):rows.filter(t=>t.name.startsWith('nodeaccess-local-'))
  if(candidates.length!==1)throw failure('TOKEN_NAME_AMBIGUOUS')
  return {login,name:candidates[0].name,kind}
}
export async function rotateTokens({runtime=DEFAULT_RUNTIME,origin='http://127.0.0.1:9000',now=new Date(),graceHours=48,requestFactory=api}={}) {
  if(!Number.isFinite(graceHours)||graceHours<0||graceHours>168)throw failure('TOKEN_GRACE_INVALID')
  const {owner,credentials:previous}=await runtimeCredentials(runtime)
  const lockPath=join(runtime,'token-rotation.lock'),lock=await privateLock(lockPath,owner)
  const admin=requestFactory(origin,{login:previous.admin_login,password:previous.admin_password}),created=[]
  let published=false
  try {
    await idle(admin)
    const old=[];for(const kind of ['analysis','review'])old.push(await priorName(admin,previous,kind))
    const next={...previous},expires=expirationDate(now),suffix=`${now.toISOString().slice(0,10)}-${randomUUID()}`
    for(const kind of ['analysis','review']) {
      const login=kind==='analysis'?previous.admin_login:previous.review_login,name=`nodeaccess-local-${kind}-${suffix}`
      const parameters={name,login,type:kind==='analysis'?'PROJECT_ANALYSIS_TOKEN':'USER_TOKEN',expirationDate:expires,...(kind==='analysis'?{projectKey:'nodeaccess'}:{})}
      created.push({login,name,kind})
      const generated=requireOk(await admin('/api/user_tokens/generate',parameters,'POST'))
      if(typeof generated?.token!=='string'||!generated.token)throw failure('TOKEN_GENERATION_INVALID')
      next[`${kind}_token`]=generated.token;next[`${kind}_token_name`]=name
      const metadata=(await tokenMetadata(admin,login)).find(t=>t.name===name)
      if(metadata?.type!==parameters.type||!metadata.expirationDate?.startsWith(expires))throw failure('TOKEN_EXPIRY_OR_TYPE_MISMATCH')
    }
    const scopes=await verifyScopes(origin,next,requestFactory)
    next.expires=expires;next.rotation={publishedAt:now.toISOString(),retiring:[...(previous.rotation?.retiring??[]),...old.map(t=>({...t,revokeAfter:new Date(now.getTime()+graceHours*3600_000).toISOString()}))]}
    await writePrivate(join(runtime,`credentials-before-${suffix}.json`),previous,owner)
    await writePrivate(join(runtime,'credentials.json'),next,owner);published=true
    return {published:true,expires,overlapHours:graceHours,retiring:old.length,scopes}
  } catch(error) {
    if(!published) {
      const pending=[]
      for(const token of created)try{requireOk(await admin('/api/user_tokens/revoke',{login:token.login,name:token.name},'POST'))}catch{pending.push(token)}
      if(pending.length)await writePrivate(join(runtime,`rotation-cleanup-${randomUUID()}.json`),{pending,at:new Date().toISOString()},owner)
    }
    const result=failure(error.code??'TOKEN_ROTATION_FAILED');result.operation=error.operation;result.status=error.status;throw result
  } finally {await lock.close()}
}
export async function retireTokens({runtime=DEFAULT_RUNTIME,origin='http://127.0.0.1:9000',now=new Date(),requestFactory=api}={}) {
  const {owner,credentials}=await runtimeCredentials(runtime)
  const lockPath=join(runtime,'token-rotation.lock'),lock=await privateLock(lockPath,owner)
  try {
    const admin=requestFactory(origin,{login:credentials.admin_login,password:credentials.admin_password})
    await idle(admin);await verifyScopes(origin,credentials,requestFactory)
    const keep=[];let revoked=0
    for(const token of credentials.rotation?.retiring??[]) {
      if(!['analysis','review'].includes(token.kind)||token.login!==(token.kind==='analysis'?credentials.admin_login:credentials.review_login)||typeof token.name!=='string'||!token.name.startsWith('nodeaccess-local-')||token.name===credentials[`${token.kind}_token_name`]||!Number.isFinite(Date.parse(token.revokeAfter)))throw failure('RETIREMENT_RECORD_INVALID')
      if(Date.parse(token.revokeAfter)>now.getTime()){keep.push(token);continue}
      if((await tokenMetadata(admin,token.login)).some(t=>t.name===token.name))requireOk(await admin('/api/user_tokens/revoke',{login:token.login,name:token.name},'POST'))
      if((await tokenMetadata(admin,token.login)).some(t=>t.name===token.name))throw failure('TOKEN_REVOCATION_NOT_VERIFIED')
      revoked++
    }
    const next={...credentials,rotation:{...credentials.rotation,retiring:keep,lastRetirementAt:now.toISOString()}}
    await writePrivate(join(runtime,'credentials.json'),next,owner)
    return {revoked,remaining:keep.length,currentScopesVerified:true}
  }finally{await lock.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [action]=process.argv.slice(2);const result=action==='rotate'?await rotateTokens():action==='retire'?await retireTokens():action==='check'?await verifyScopes('http://127.0.0.1:9000',(await runtimeCredentials(DEFAULT_RUNTIME)).credentials):(()=>{throw failure('ACTION_REQUIRED')})();console.log(JSON.stringify(result))}
 catch(error){console.error(error.code??'TOKEN_MAINTENANCE_FAILED');process.exitCode=1}
}
