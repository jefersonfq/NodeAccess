import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync, writeSync } from 'node:fs'
import childProcess from 'node:child_process'
import timers from 'node:timers/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { backup, restoreRehearsal } from './recovery.mjs'
import { recoveryReal } from './recovery-real.mjs'
import { writePrivate, DEFAULT_RUNTIME } from './maintenance-common.mjs'

async function simulation(t, options = {}) {
  const original = { readFile:fs.readFile, open:fs.open, lstat:fs.lstat, realpath:fs.realpath, rm:fs.rm }
  const root = await fs.mkdtemp(join(tmpdir(), 'sonar-orchestration-'))
  await fs.chmod(root, 0o700)
  const credentials = { admin_login:'fixture-admin', admin_password:'private-fixture-admin', review_login:'fixture-review', review_password:'private-fixture-review', analysis_token:'private-fixture-analysis', review_token:'private-fixture-read' }
  for (const [name, value] of Object.entries({ 'credentials.json':credentials, '.env':'SONAR_DB_PASSWORD=fixture-only\n', 'compose.yaml':'services: {}\n' })) await writePrivate(join(root,name), value)
  const resources = { container:new Map(), volume:new Map(), network:new Map() }, commands=[]
  const dump = Buffer.from('PGDMP-fixture-consistent-snapshot'), extensions=Buffer.from('fixture-extension-archive')
  const dbImage=`sha256:${'a'.repeat(64)}`,sonarImage=`sha256:${'b'.repeat(64)}`
  let now=Date.now(),sourceSnapshots=0,indexFailures=options.indexFailures??0
  const rows = () => [
    {login:credentials.admin_login,name:'nodeaccess-local-analysis-old',type:'PROJECT_ANALYSIS_TOKEN',token:credentials.analysis_token},
    {login:credentials.review_login,name:'nodeaccess-local-review-old',type:'USER_TOKEN',token:credentials.review_token},
  ]
  const tokens = new Map([['9000',rows()],['30080',rows()]])
  t.mock.method(Date,'now',()=>now)
  t.mock.method(timers,'setTimeout',async milliseconds=>{now+=milliseconds})
  const mapped = path => typeof path==='string' && (path===DEFAULT_RUNTIME || path.startsWith(`${DEFAULT_RUNTIME}/`)) ? root+path.slice(DEFAULT_RUNTIME.length) : path
  t.mock.method(fs,'readFile',async(path,...args)=>path==='/proc/sys/vm/max_map_count'?Buffer.from(String(options.kernel??524288)):original.readFile(mapped(path),...args))
  t.mock.method(fs,'open',(...args)=>original.open(mapped(args[0]),...args.slice(1)))
  t.mock.method(fs,'lstat',(...args)=>original.lstat(mapped(args[0]),...args.slice(1)))
  t.mock.method(fs,'realpath',async(path,...args)=>mapped(path)!==path?path:original.realpath(path,...args))
  t.mock.method(childProcess,'spawnSync',(executable,args,config)=>{
    assert.equal(executable,'/usr/bin/docker');assert.equal(config.shell,false)
    commands.push(args)
    const ok = stdout=>({status:0,stdout:stdout??'',stderr:''}),failed=()=>({status:1,stdout:'',stderr:'fixture failure (not returned to callers)'})
    const label = args[args.indexOf('--label')+1], name=args[args.indexOf('--name')+1]
    if(args[0]==='ps')return ok(options.ambiguousSource?'aaaaaaaaaaaa\nbbbbbbbbbbbb':args.some(a=>a.endsWith('service=db'))?'aaaaaaaaaaaa':'bbbbbbbbbbbb')
    if(args[0]==='image')return ok(args[2])
    if(args[0]==='inspect')return ok(args.includes('{{.State.Running}}')?(options.sonarExited?'false':'true'):args[1]==='aaaaaaaaaaaa'?dbImage:sonarImage)
    if(['network','volume'].includes(args[0]) && args[1]==='create'){resources[args[0]].set(args.at(-1),label);return ok(args.at(-1))}
    if(['network','volume','container'].includes(args[0]) && args[1]==='ls')return ok([...resources[args[0]]].filter(([,value])=>args.includes(`label=${value}`)).map(([key])=>key).join('\n'))
    if(['network','volume'].includes(args[0]) && args[1]==='rm'){resources[args[0]].delete(args[2]);return ok()}
    if(args[0]==='rm'){if(options.cleanupFails)return failed();resources.container.delete(args.at(-1));return ok()}
    if(args[0]==='port')return ok(options.publicBind?'0.0.0.0:30080':'127.0.0.1:30080')
    if(args[0]==='run'){
      resources.container.set(name,label)
      if(args.includes('--entrypoint')){
        assert.deepEqual(readFileSync(config.stdio[0]),extensions)
        if(options.transferFails)return failed()
        resources.container.delete(name);return ok()
      }
      assert.ok(args.includes('--pull=never'))
      if(args.at(-1)===dbImage){assert.ok(args.includes('--network-alias'));assert.ok(args.includes('restore-db'));assert.ok(!args.includes('--publish'))}
      else{assert.ok(args.includes('127.0.0.1::9000'));assert.ok(args.includes('4g'))}
      return ok('fixture-container-id')
    }
    if(args[0]==='exec'){
      if(args.includes('pg_dump')){if(options.dumpFails)return failed();writeSync(config.stdio[1],dump);return ok()}
      if(args.includes('tar')){writeSync(config.stdio[1],extensions);return ok()}
      if(args.includes('pg_isready')){assert.ok(args.includes('-h'));return options.dbNeverReady?failed():ok()}
      if(args.includes('pg_restore')){assert.deepEqual(readFileSync(config.stdio[0]),dump);return options.restoreFails?failed():ok()}
    }
    assert.fail(`Unmodeled Docker operation: ${args[0]} ${args[1]}`)
  })
  t.mock.method(globalThis,'fetch',async(value,config)=>{
    const url=new URL(value),endpoint=url.pathname,parameters=config.method==='POST'?new URLSearchParams(config.body):url.searchParams
    const bearer=config.headers.Authorization.startsWith('Bearer ')?config.headers.Authorization.slice(7):null
    const account=tokens.get(url.port),identity=account.find(row=>row.token===bearer)
    const response=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status})
    if(endpoint==='/api/authentication/validate')return response({valid:!!identity})
    if(bearer && ['/api/system/info','/api/permissions/users'].includes(endpoint))return response({},403)
    if(endpoint==='/api/analysis_cache/get')return response({},identity?.type==='PROJECT_ANALYSIS_TOKEN'?200:403)
    if(endpoint==='/api/ce/activity')return response({tasks:[]})
    if(endpoint==='/api/user_tokens/search')return response({userTokens:account.filter(row=>row.login===parameters.get('login')).map(({token,...metadata})=>metadata)})
    if(endpoint==='/api/user_tokens/generate'){
      const generated={...Object.fromEntries(parameters),token:`fixture-generated-${account.length}`};account.push(generated);return response({token:generated.token})
    }
    if(endpoint==='/api/user_tokens/revoke'){const index=account.findIndex(row=>row.login===parameters.get('login')&&row.name===parameters.get('name'));if(index>=0)account.splice(index,1);return response(null,204)}
    if(endpoint==='/api/system/status')return response({status:options.sonarNeverReady?'STARTING':'UP'})
    if(endpoint==='/api/components/show'){
      if(bearer && identity?.type==='PROJECT_ANALYSIS_TOKEN')return response({},403)
      if(url.port==='9000')sourceSnapshots++
      return response({component:{key:'nodeaccess',visibility:'private'}})
    }
    const paged=(field,values)=>response({paging:{total:values.length},[field]:values})
    if(endpoint==='/api/project_analyses/search')return paged('analyses',[{key:'analysis-fixture',date:'2026-11-01T00:00:00Z',revision:'fixture-revision',events:[]}])
    if(endpoint==='/api/permissions/users')return paged('users',[{login:'fixture-review',permissions:['user']}])
    if(endpoint==='/api/permissions/groups')return paged('groups',[{name:'fixture-group',permissions:['scan','user']}])
    if(endpoint==='/api/issues/search'){
      if(url.port==='30080' && indexFailures-->0)return response({},503)
      return paged('issues',[{key:options.sourceChanges&&sourceSnapshots>1?'changed':'issue-fixture',rule:'fixture:rule',status:'OPEN'}])
    }
    if(endpoint==='/api/hotspots/search')return paged('hotspots',[{key:'review-fixture',status:'REVIEWED',resolution:'SAFE'}])
    assert.fail(`Unmodeled HTTP endpoint: ${endpoint}`)
  })
  syncBuiltinESMExports()
  t.after(async()=>{t.mock.restoreAll();syncBuiltinESMExports();await original.rm(root,{recursive:true,force:true})})
  return {root,resources,commands,credentials,tokens,read:original.readFile}
}
function emptyResources(resources){for(const entries of Object.values(resources))assert.equal(entries.size,0)}
test('backup and full restore orchestration preserve manifests, permissions, reviews and tokens',async t=>{
 const s=await simulation(t,{indexFailures:2}),saved=await backup({runtime:s.root})
 assert.deepEqual(saved.counts,{analyses:1,issues:1,hotspots:1,permissionUsers:1,permissionGroups:1})
 const result=await recoveryReal(saved.output)
 assert.equal(result.passed,true);assert.equal(result.indexReadinessRetries,2);assert.equal(result.originalUnchanged,true)
 assert.equal(result.additional.overlapVerified,true);assert.equal(result.additional.oldRevoked,true);assert.equal(result.additional.retirement.revoked,2)
 assert.equal(s.tokens.get('9000').length,2);emptyResources(s.resources)
 const snapshot=JSON.parse(await s.read(join(saved.output,'snapshot.json')))
 assert.equal(snapshot.hotspots[0].resolution,'SAFE');assert.equal(snapshot.analyses[0].revision,'fixture-revision')
 assert.ok(s.commands.filter(args=>args[0]==='volume'&&args[1]==='create').every(args=>args.at(-1).startsWith('nodeaccess-sonar-restore-')))
})
for(const [option,code] of [['restoreFails','DOCKER_OPERATION_FAILED'],['transferFails','DOCKER_OPERATION_FAILED'],['publicBind','RESTORE_BIND_INVALID'],['sonarExited','RESTORE_SONAR_EXITED'],['dbNeverReady','RESTORE_DATABASE_TIMEOUT'],['sonarNeverReady','RESTORE_SONAR_TIMEOUT']])test(`restore cleanup after ${option}`,async t=>{
 const s=await simulation(t,{[option]:true}),saved=await backup({runtime:s.root})
 await assert.rejects(restoreRehearsal({backupPath:saved.output}),{code});emptyResources(s.resources)
})
test('restore cleanup runs when post-restore verification throws',async t=>{const s=await simulation(t),saved=await backup({runtime:s.root});await assert.rejects(restoreRehearsal({backupPath:saved.output,onReady:()=>{throw Error('fixture cancellation')}}),/fixture cancellation/);emptyResources(s.resources)})
test('failed dump records a private failure without accepting a manifest',async t=>{const s=await simulation(t,{dumpFails:true});await assert.rejects(backup({runtime:s.root}),{code:'DOCKER_OPERATION_FAILED'});const dirs=await fs.readdir(join(s.root,'backups')),path=join(s.root,'backups',dirs[0]);assert.equal(JSON.parse(await s.read(join(path,'FAILED.json'))).code,'DOCKER_OPERATION_FAILED');await assert.rejects(s.read(join(path,'manifest.json')),{code:'ENOENT'});emptyResources(s.resources)})
test('backup rejects changing source snapshot',async t=>{const s=await simulation(t,{sourceChanges:true});await assert.rejects(backup({runtime:s.root}),{code:'SOURCE_CHANGED_RETRY_BACKUP'});emptyResources(s.resources)})
test('restore checks kernel prerequisite before Docker allocation',async t=>{const s=await simulation(t,{kernel:65530}),saved=await backup({runtime:s.root}),before=s.commands.length;await assert.rejects(restoreRehearsal({backupPath:saved.output}),{code:'KERNEL_PREREQUISITE_NOT_MET'});assert.equal(s.commands.length,before);emptyResources(s.resources)})
test('cleanup failure is explicit instead of reporting a successful restore',async t=>{const s=await simulation(t,{cleanupFails:true}),saved=await backup({runtime:s.root});await assert.rejects(restoreRehearsal({backupPath:saved.output}),{code:'RESTORE_CLEANUP_FAILED'});assert.ok(s.resources.container.size>0)})
