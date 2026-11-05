import { join, resolve } from 'node:path'
import { readFile, readdir, rm } from 'node:fs/promises'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { DEFAULT_RUNTIME, privateDirectory, readFileSafe, writePrivate, privateOutput, privateInput, digest, docker, api, requireOk, runtimeCredentials, failure } from './maintenance-common.mjs'

const files = ['database.dump', 'compose.yaml', '.env', 'credentials.json', 'extensions.tar.gz', 'snapshot.json']
const hashObject = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function collection(request, endpoint, field, params = {}) {
  const rows=[]; let total
  for(let page=1;page<=100;page++) {
    const data=requireOk(await request(endpoint,{...params,p:page,ps:100}))
    if(!Array.isArray(data[field]) || !Number.isSafeInteger(data.paging?.total)) throw failure('SNAPSHOT_SCHEMA')
    if(total!==undefined && total!==data.paging.total)throw failure('SNAPSHOT_CHANGED')
    total=data.paging.total;rows.push(...data[field]);if(rows.length===total)return rows
    if(!data[field].length || rows.length>total)throw failure('SNAPSHOT_TRUNCATED')
  }
  throw failure('SNAPSHOT_LIMIT')
}
export async function snapshot(origin, credentials) {
  const request=api(origin,{login:credentials.admin_login,password:credentials.admin_password})
  const project=requireOk(await request('/api/components/show',{component:'nodeaccess'})).component
  const analyses=await collection(request,'/api/project_analyses/search','analyses',{project:'nodeaccess'})
  const users=await collection(request,'/api/permissions/users','users',{projectKey:'nodeaccess'})
  const groups=await collection(request,'/api/permissions/groups','groups',{projectKey:'nodeaccess'})
  const globalUsers=await collection(request,'/api/permissions/users','users')
  const globalGroups=await collection(request,'/api/permissions/groups','groups')
  const issues=await collection(request,'/api/issues/search','issues',{components:'nodeaccess',resolved:false})
  const hotspots=await collection(request,'/api/hotspots/search','hotspots',{project:'nodeaccess'})
  const ordered=(rows,key)=>rows.sort((a,b)=>String(a[key]).localeCompare(String(b[key]),'en'))
  return { project:{key:project.key,visibility:project.visibility},
    analyses:ordered(analyses.map(a=>({key:a.key,date:a.date,revision:a.revision??null,events:a.events})), 'key'),
    permissions:{globalUsers:ordered(globalUsers.map(u=>({login:u.login,permissions:[...u.permissions].sort((a,b)=>a.localeCompare(b,'en'))})),'login'),globalGroups:ordered(globalGroups.map(g=>({name:g.name,permissions:[...g.permissions].sort((a,b)=>a.localeCompare(b,'en'))})),'name'),users:ordered(users.map(u=>({login:u.login,permissions:[...u.permissions].sort((a,b)=>a.localeCompare(b,'en'))})),'login'),groups:ordered(groups.map(g=>({name:g.name,permissions:[...g.permissions].sort((a,b)=>a.localeCompare(b,'en'))})),'name')},
    issues:ordered(issues.map(i=>({key:i.key,rule:i.rule,status:i.status,resolution:i.resolution??null})), 'key'),
    hotspots:ordered(hotspots.map(h=>({key:h.key,status:h.status,resolution:h.resolution??null})), 'key') }
}
function sourceContainer(service) {
  const id=docker(['ps','--filter','label=com.docker.compose.project=nodeaccess-sonarqube','--filter',`label=com.docker.compose.service=${service}`,'--format','{{.ID}}'])
  if(!/^[a-f0-9]{12,64}$/.test(id))throw failure('SOURCE_CONTAINER_AMBIGUOUS')
  return id
}
export async function backup({runtime=DEFAULT_RUNTIME, origin='http://127.0.0.1:9000'}={}) {
  const {owner,credentials}=await runtimeCredentials(runtime)
  const backups=join(runtime,'backups');try{await privateDirectory(backups,owner)}catch(e){if(e.code!=='ENOENT')throw e;await privateDirectory(backups,owner,true)}
  const output=join(backups,`backup-${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`);await privateDirectory(output,owner,true)
  const db=sourceContainer('db'),sonar=sourceContainer('sonarqube')
  const before=await snapshot(origin,credentials)
  try {
    for(const name of ['compose.yaml','.env','credentials.json']) await writePrivate(join(output,name),await readFileSafe(join(runtime,name),{privateMode:name!=='compose.yaml',owner}),owner)
    for(const [name,args] of [['database.dump',['exec',db,'pg_dump','-U','sonar','-d','sonar','--format=custom','--no-owner','--no-acl']],['extensions.tar.gz',['exec',sonar,'tar','-C','/opt/sonarqube/extensions','-czf','-','.']]]) {
      await privateOutput(join(output,name),owner,fd=>docker(args,{output:fd}))
    }
    const after=await snapshot(origin,credentials)
    if(hashObject(before)!==hashObject(after))throw failure('SOURCE_CHANGED_RETRY_BACKUP')
    await writePrivate(join(output,'snapshot.json'),before,owner)
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),sourceProject:'nodeaccess',
      images:{db:docker(['inspect',db,'--format','{{.Image}}']),sonar:docker(['inspect',sonar,'--format','{{.Image}}'])},
      counts:{analyses:before.analyses.length,issues:before.issues.length,hotspots:before.hotspots.length,permissionUsers:before.permissions.users.length,permissionGroups:before.permissions.groups.length},files:[]}
    for(const name of files)manifest.files.push({name,sha256:await digest(join(output,name),owner)})
    await writePrivate(join(output,'manifest.json'),manifest,owner)
    await verifyBackup(output)
    return {output,counts:manifest.counts,manifestSha256:await digest(join(output,'manifest.json'),owner)}
  } catch(error) { await writePrivate(join(output,'FAILED.json'),{code:error.code??'BACKUP_FAILED',at:new Date().toISOString()},owner);throw failure(error.code??'BACKUP_FAILED') }
}
export async function verifyBackup(output) {
  const owner=await privateDirectory(output)
  const manifest=JSON.parse(await readFileSafe(join(output,'manifest.json'),{owner}))
  if(manifest.schemaVersion!==1 || manifest.sourceProject!=='nodeaccess' || manifest.files?.length!==files.length
    || !Object.values(manifest.images??{}).every(i=>/^sha256:[a-f0-9]{64}$/.test(i)) || JSON.stringify(Object.keys(manifest.images??{}).sort((a,b)=>a.localeCompare(b,'en')))!==JSON.stringify(['db','sonar']))throw failure('MANIFEST_INVALID')
  if(JSON.stringify([...await readdir(output)].sort((a,b)=>a.localeCompare(b,'en')))!==JSON.stringify([...files,'manifest.json'].sort((a,b)=>a.localeCompare(b,'en'))))throw failure('BACKUP_FILE_SET_INVALID')
  const names=new Set()
  for(const item of manifest.files) {
    if(!files.includes(item.name)||names.has(item.name)||!/^([a-f0-9]{64})$/.test(item.sha256))throw failure('MANIFEST_INVALID')
    names.add(item.name)
    if(await digest(join(output,item.name),owner)!==item.sha256)throw failure('BACKUP_CHECKSUM_MISMATCH')
  }
  return {manifest,owner}
}
export async function restoreRehearsal({backupPath,onReady}={}) {
  const {manifest,owner}=await verifyBackup(backupPath)
  if(Number(await readFile('/proc/sys/vm/max_map_count','utf8'))<524288)throw failure('KERNEL_PREREQUISITE_NOT_MET')
  const id=`nodeaccess-sonar-restore-${randomUUID()}`, network=`${id}-net`, db=`${id}-db`, sonar=`${id}-sonar`
  const volumes=['db','data','extensions','logs'].map(part=>`${id}-${part}`)
  const root=join(backupPath,'..',`${id}-runtime`);await privateDirectory(root,owner,true)
  const credentials=JSON.parse(await readFileSafe(join(backupPath,'credentials.json'),{owner}))
  const password=randomBytes(32).toString('hex'), label=`nodeaccess.sonar.restore=${id}`
  const created={network:false,volumes:[],containers:[]},transfer=`${id}-transfer`
  try {
    for(const image of Object.values(manifest.images))docker(['image','inspect',image,'--format','{{.Id}}'])
    created.network=true;docker(['network','create','--label',label,network])
    for(const name of volumes){created.volumes.push(name);docker(['volume','create','--label',label,name])}
    await writePrivate(join(root,'db.env'),`POSTGRES_USER=sonar\nPOSTGRES_DB=sonar\nPOSTGRES_PASSWORD=${password}\n`,owner)
    await writePrivate(join(root,'sonar.env'),`SONAR_JDBC_URL=jdbc:postgresql://restore-db:5432/sonar\nSONAR_JDBC_USERNAME=sonar\nSONAR_JDBC_PASSWORD=${password}\nSONAR_TELEMETRY_ENABLE=false\n`,owner)
    created.containers.push(db)
    docker(['run','-d','--pull=never','--name',db,'--label',label,'--network',network,'--network-alias','restore-db','--memory','1g','--cpus','1','--env-file',join(root,'db.env'),'-v',`${volumes[0]}:/var/lib/postgresql/data`,manifest.images.db])
    let ready=false
    for(let i=0;i<60;i++){try{docker(['exec',db,'pg_isready','-h','127.0.0.1','-U','sonar','-d','sonar'],{timeout:2000});ready=true;break}catch{await delay(500)}}
    if(!ready)throw failure('RESTORE_DATABASE_TIMEOUT')
    await privateInput(join(backupPath,'database.dump'),owner,fd=>docker(['exec','-i',db,'pg_restore','--exit-on-error','--no-owner','--no-acl','-U','sonar','-d','sonar'],{inputFile:fd}))
    created.containers.push(transfer)
    await privateInput(join(backupPath,'extensions.tar.gz'),owner,fd=>docker(['run','--rm','--name',transfer,'--label',label,'-i','--pull=never','--network','none','--user','0','-v',`${volumes[2]}:/extensions`,'--entrypoint','tar',manifest.images.sonar,'-C','/extensions','-xzf','-'],{inputFile:fd}))
    created.containers.push(sonar)
    docker(['run','-d','--pull=never','--name',sonar,'--label',label,'--network',network,'--publish','127.0.0.1::9000','--memory','4g','--cpus','2','--ulimit','nofile=131072:131072','--ulimit','nproc=8192:8192','--env-file',join(root,'sonar.env'),'-v',`${volumes[1]}:/opt/sonarqube/data`,'-v',`${volumes[2]}:/opt/sonarqube/extensions`,'-v',`${volumes[3]}:/opt/sonarqube/logs`,manifest.images.sonar])
    const binding=docker(['port',sonar,'9000/tcp']);if(!/^127\.0\.0\.1:\d+$/.test(binding))throw failure('RESTORE_BIND_INVALID')
    const origin=`http://${binding}`,request=api(origin,{login:credentials.admin_login,password:credentials.admin_password});ready=false
    const deadline=Date.now()+300_000
    while(Date.now()<deadline){if(docker(['inspect',sonar,'--format','{{.State.Running}}'])!=='true')throw failure('RESTORE_SONAR_EXITED');try{if((await request('/api/system/status')).data?.status==='UP'){ready=true;break}}catch{}await delay(1500)}
    if(!ready)throw failure('RESTORE_SONAR_TIMEOUT')
    const expected=JSON.parse(await readFileSafe(join(backupPath,'snapshot.json'),{owner}))
    let actual,indexReadinessRetries=0
    const indexDeadline=Date.now()+90_000
    while(!actual){try{actual=await snapshot(origin,credentials)}catch(error){if(error.status!==503||Date.now()>=indexDeadline)throw error;indexReadinessRetries++;await delay(1500)}}
    if(hashObject(expected)!==hashObject(actual))throw failure('RESTORE_CONTENT_MISMATCH')
    const result={passed:true,counts:manifest.counts,snapshotSha256:hashObject(actual),isolated:true,loopback:true,reindexed:true,indexReadinessRetries}
    if(onReady)result.additional=await onReady({origin,credentials,root,owner})
    return result
  } finally {
    const errors=[]
    // Names are reserved before creation: timeout after Docker accepts a resource must still clean it.
    const remove=(kind,name,args)=>{
      const found=docker([kind,'ls',...(kind==='container'?['-a']:[]),'--filter',`label=${label}`,'--format',kind==='container'?'{{.Names}}':'{{.Name}}']).split('\n')
      if(found.includes(name))docker(args)
    }
    for(const name of [...created.containers].reverse())try{remove('container',name,['rm','-f',name])}catch{errors.push('container')}
    for(const name of created.volumes)try{remove('volume',name,['volume','rm',name])}catch{errors.push('volume')}
    if(created.network)try{remove('network',network,['network','rm',network])}catch{errors.push('network')}
    await rm(root,{recursive:true,force:true})
    if(errors.length)throw failure('RESTORE_CLEANUP_FAILED')
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { const [action,path]=process.argv.slice(2);let result
    if(action==='backup')result=await backup({runtime:path??DEFAULT_RUNTIME})
    else if(action==='verify')result={verified:true,counts:(await verifyBackup(path)).manifest.counts}
    else if(action==='rehearse')result=await restoreRehearsal({backupPath:path})
    else throw failure('ACTION_REQUIRED')
    console.log(JSON.stringify(result))
  }catch(error){console.error(error.code??'SONAR_RECOVERY_FAILED');process.exitCode=1}
}
