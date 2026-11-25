import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient, Prisma } from '@prisma/client'
import { SqlVaultStore } from './vault.repository.js'
import { SqlVaultAdministration } from './vault-administration.repository.js'
import type { VaultChange } from './vault-domain.js'
const actor={userId:1,tenantId:2,sessionVersion:3}
function fixture() {
  const policy={unlock:true,reveal:true,copy:true,localReauth:true,origin:'https://vault.test',tenantQuota:100}
  const state={tenant:true,user:{active:true,deletedAt:null as Date|null,version:3,role:'USER',email:'user@example.test',passwordHash:'hash' as string|null,mfaSecret:'mfa' as string|null,mfaEnabled:true,forcePasswordChange:false,lockedUntil:null as Date|null},
    auth:[] as {local:boolean;sso:boolean}[],trials:[] as object[],features:{secrets:true},licenseActive:true,licenseExpires:null as Date|null,policy,policyVersion:1,
    grant:{enabled:true,grantedBy:2,approvedBy:3} as {enabled:boolean;grantedBy:number;approvedBy:number}|null,
    secret:{encrypted:'ciphertext',iv:'iv',scope:'PERSONAL',owner:1,groupId:null as number|null,revokedAt:null as Date|null} as {encrypted:string;iv:string;scope:string;owner:number|null;groupId:number|null;revokedAt:Date|null}|null,
    writeRows: [] as Array<{ id: number; scope: string; owner: number | null; creator: number | null; groupId: number | null }>,
    generation: null as string | null, siteRows: [] as Record<string, unknown>[],
    hostPermissions: [{ hostId: 10, canView: 1 }, { hostId: 11, canView: 0 }],
    eligible:true,membership:true,released:[] as number[],
    grantRows:[] as {action:string;enabled:unknown;grantedBy:number;approvedBy:number}[],record:null as unknown,count:1,pending:0,manager:true,target:true,managers:[1,2,3],
    proposal:{proposedBy:2,payload:{kind:'item',secretId:9,enabled:true},expiresAt:new Date(10000)} as {proposedBy:number;payload:VaultChange;expiresAt:Date}|null}
  const queries:string[]=[],writes:{sql:string;values:unknown[]}[]=[],reads:{sql:string;values:unknown[]}[]=[]
  const query=vi.fn((strings:TemplateStringsArray | Prisma.Sql,...parameters:unknown[])=>Promise.resolve().then(()=>{
    const sql=Array.isArray(strings)?strings.join('?'):(strings as Prisma.Sql).sql
    const values=Array.isArray(strings)?parameters:(strings as Prisma.Sql).values
    queries.push(sql);reads.push({sql,values})
    if(sql.includes('WITH RECURSIVE ancestors'))return state.hostPermissions
    if(sql.includes('FROM vault_fill_generation'))return state.generation===null?[]:[{generation:state.generation}]
    if(sql.includes('FROM vault_site_items'))return state.siteRows
    if(sql.includes('FROM vault_managers'))return sql.includes('m.user_id=')?(state.manager?[{id:1}]:[]):state.managers.map(id=>({id}))
    if(sql.includes('FROM tenants'))return [{active:state.tenant}]
    if(sql.includes('FROM users'))return sql.includes('password_hash')?[state.user]:state.target?[{id:9}]:[]
    if(sql.includes('FROM tenant_auth_policies'))return state.auth
    if(sql.includes('FROM trial_registrations'))return state.trials
    if(sql.includes('FROM licenses'))return [{features:state.features,active:state.licenseActive,expiresAt:state.licenseExpires}]
    if(sql.includes('FROM vault_policies'))return [{version:state.policyVersion,config:JSON.stringify(state.policy)}]
    if(sql.includes("action IN ('reveal','copy')"))return state.grantRows
    if(sql.includes('FROM vault_entitlements'))return state.grant?[state.grant]:[]
    if(sql.includes('FROM vault_web_items w'))return state.released.map(id=>({id}))
    if(sql.includes('FROM vault_web_items'))return [{enabled:state.eligible}]
    if(sql.includes('created_by_user_id AS creator'))return state.writeRows
    if(sql.includes('FROM `groups`'))return state.membership?[{id:8,name:'Ops'}]:[]
    if(sql.includes('FROM secrets'))return state.secret?[state.secret]:[]
    if(sql.includes('FROM user_groups'))return state.membership?[{userId:1}]:[]
    if(sql.includes('FROM vault_records'))return sql.includes('COUNT')?[{count:BigInt(state.pending)}]:state.record?[{payload:JSON.stringify(state.record)}]:[]
    if(sql.includes('FROM vault_limits'))return [{count:state.count}]
    if(sql.includes('FROM vault_proposals'))return state.proposal?[state.proposal]:[]
    throw new Error('Uncovered query '+sql+' values-count '+values.length)
  }))
  const execute=vi.fn((strings:TemplateStringsArray,...values:unknown[])=>{const sql=strings.join('?');writes.push({sql,values});if(sql.includes('INSERT INTO vault_fill_generation'))state.generation=String(values[0]);return Promise.resolve(1)})
  const hosts=[{id:10,name:'Visible'},{id:11,name:'Hidden'}]
  const db={host:{findMany:vi.fn((_args:unknown)=>Promise.resolve(hosts))},
    hostAssociatedLink:{findMany:vi.fn((_args:unknown)=>Promise.resolve(hosts.map(host=>({urlTemplate:'https://login.test/signin',host:{...host,ip:'private-address',port:22,sshUser:'private-account'}}))))},$queryRaw:query,$executeRaw:execute,$transaction:vi.fn(async(run:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>run(db as unknown as Prisma.TransactionClient))}
  const store=new SqlVaultStore(db as unknown as PrismaClient,()=>1000)
  return {state,queries,writes,reads,store,db,admin:new SqlVaultAdministration(db as unknown as Prisma.TransactionClient,actor,()=>1000)}
}

describe('SQL vault adapter authorization and locking contract',()=>{
  it('E4 capabilities distinguish owner, creator, reader, tenant admin and revoked grant', async () => {
    const f=fixture()
    f.state.writeRows=[
      {id:1,scope:'PERSONAL',owner:1,creator:1,groupId:null},
      {id:2,scope:'GROUP',owner:null,creator:1,groupId:8},
      {id:3,scope:'GROUP',owner:null,creator:7,groupId:8},
      {id:4,scope:'TENANT',owner:null,creator:7,groupId:null},
      {id:5,scope:'PERSONAL',owner:7,creator:7,groupId:null},
    ]
    const items=f.state.writeRows.map(r=>({kind:'secret' as const,sourceId:r.id,label:'item',description:null,scope:'shared' as const,portalPath:'/vault'}))
    const capabilities=()=>f.store.transaction(actor,tx=>tx.itemWriteAccess!(items))
    expect((await capabilities()).map(i=>i.writable)).toEqual([true,true,false,false,false])
    expect(await f.store.transaction(actor,tx=>tx.writeAccess!())).toEqual({groups:[{id:8,name:'Ops'}],tenant:false})
    f.state.user.role='ADMIN'
    expect((await capabilities()).map(i=>i.writable)).toEqual([true,true,true,true,false])
    expect((await f.store.transaction(actor,tx=>tx.writeAccess!())).tenant).toBe(true)
    f.state.grant!.enabled=false
    expect((await capabilities()).map(i=>i.writable)).toEqual([true,false,false,false,false])
    expect(await f.store.transaction(actor,tx=>tx.writeAccess!())).toEqual({groups:[],tenant:false})
  })
  it('NA-0196: availability applies the delivery grant rule and limits released items to the visible scope',async()=>{
    const f=fixture()
    f.state.grantRows=[{action:'reveal',enabled:1,grantedBy:2,approvedBy:3},{action:'copy',enabled:1,grantedBy:1,approvedBy:3}]
    f.state.released=[4,7]
    const own=await f.store.transaction(actor,tx=>tx.availability!())
    // Copy approved with the user themself as proposer does not count (same rule as delivery).
    expect(own).toEqual({grants:{reveal:true,copy:false},items:[4,7]})
    const scoped=f.queries.find(q=>q.includes('FROM vault_web_items w'))!
    expect(scoped).toContain("s.scope='TENANT'"); expect(scoped).toContain('FROM user_groups g'); expect(scoped).toContain('s.revoked_at IS NULL')
    f.state.grantRows=[{action:'reveal',enabled:0,grantedBy:2,approvedBy:3},{action:'copy',enabled:true,grantedBy:2,approvedBy:2}]
    f.state.user.role='ADMIN'; f.queries.length=0
    expect(await f.store.transaction(actor,tx=>tx.availability!())).toEqual({grants:{reveal:false,copy:false},items:[4,7]})
    // Administrators see every item, so their query has no scope filter.
    expect(f.queries.find(q=>q.includes('FROM vault_web_items w'))).not.toContain('user_groups')
  })
  it('takes authoritative locks and binds transaction timeouts',async()=>{
    const f=fixture();await f.store.transaction(actor,async tx=>tx.secret(9,'reveal'))
    for(const table of ['tenants','users','tenant_auth_policies','trial_registrations','licenses','vault_policies','secrets','vault_web_items','vault_entitlements'])
      expect(f.queries.some(q=>q.includes('FROM '+table)&&/FOR (SHARE|UPDATE)/.test(q))).toBe(true)
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable',maxWait:500,timeout:2500})
  })
  it.each(['tenant','inactive','deleted','version','mfa','mfa-disabled','password-change','locked','trial','license','license-inactive','license-expired','policy'] as const)('denies %s authority',async mode=>{
    const f=fixture(),s=f.state
    if(mode==='tenant')s.tenant=false;if(mode==='inactive')s.user.active=false;if(mode==='deleted')s.user.deletedAt=new Date()
    if(mode==='version')s.user.version++;if(mode==='password')s.user.passwordHash=null;if(mode==='mfa')s.user.mfaSecret=null
    if(mode==='mfa-disabled')s.user.mfaEnabled=false;if(mode==='password-change')s.user.forcePasswordChange=true;if(mode==='locked')s.user.lockedUntil=new Date(2000)
    if(mode==='local-disabled')s.auth=[{local:false,sso:false}];if(mode==='sso')s.auth=[{local:true,sso:true}];if(mode==='trial')s.trials=[{id:1}]
    if(mode==='license')s.features.secrets=false;if(mode==='license-inactive')s.licenseActive=false;if(mode==='license-expired')s.licenseExpires=new Date(1000);if(mode==='policy')s.policy.unlock=false
    await expect(f.store.transaction(actor,()=>Promise.resolve(true))).rejects.toMatchObject({status:403})
  })
  it.each([
    ['no policy row', [], null, { local: true, ldap: true, oidc: true, google: true }],
    ['standard', [{ local: true, sso: false }], 'hash', { local: true, ldap: true, oidc: true, google: true }],
    ['local disabled', [{ local: false, sso: false }], 'hash', { local: false, ldap: true, oidc: true, google: true }],
    ['sso required', [{ local: true, sso: true }], 'hash', { local: false, ldap: false, oidc: true, google: true }],
    ['no local password', [{ local: true, sso: false }], null, { local: true, ldap: true, oidc: true, google: true }],
  ] as const)('derives allowed vault methods for %s without denying the whole tenant (NA-0184)', async (_label, auth, passwordHash, methods) => {
    const f=fixture(),s=f.state; s.auth=[...auth]; s.user.passwordHash=passwordHash
    const authority=await f.store.transaction(actor,tx=>Promise.resolve(tx.authority))
    expect(authority.methods).toEqual(methods)
    expect(authority.passwordHash).toBe(passwordHash)
  })
  it.each(['no-grant','disabled-grant','self-grant','same-approver','no-secret','revoked','not-web','no-group','no-member','flag'] as const)('denies %s extraction',async mode=>{
    const f=fixture(),s=f.state
    if(mode==='no-grant')s.grant=null;if(mode==='disabled-grant')s.grant!.enabled=false;if(mode==='self-grant')s.grant!.approvedBy=1
    if(mode==='same-approver')s.grant!.approvedBy=2;if(mode==='no-secret')s.secret=null;if(mode==='revoked')s.secret!.revokedAt=new Date()
    if(mode==='not-web')s.eligible=false;if(mode==='no-group')s.secret!.owner=5
    if(mode==='no-member'){s.secret!.owner=5;s.secret!.groupId=8;s.membership=false}if(mode==='flag')s.policy.reveal=false
    await expect(f.store.transaction(actor,tx=>tx.secret(9,'reveal'))).rejects.toMatchObject({status:403})
  })
  it('locks group association and fingerprints rotation/ACL, not only updated_at',async()=>{
    const f=fixture();f.state.secret!.owner=5;f.state.secret!.groupId=8
    const a=await f.store.transaction(actor,tx=>tx.secret(9,'copy'));expect(f.queries.some(q=>q.includes('FROM user_groups')&&q.includes('FOR SHARE'))).toBe(true)
    f.state.secret!.encrypted='rotated';const b=await f.store.transaction(actor,tx=>tx.secret(9,'copy'));expect(b.version).not.toBe(a.version)
  })
  it('tenant and existing admin ACL still require explicit grant and eligibility',async()=>{
    const f=fixture();f.state.secret!.owner=null;f.state.secret!.scope='TENANT';await f.store.transaction(actor,tx=>tx.secret(9,'copy'))
    f.state.secret!.scope='PERSONAL';f.state.user.role='ADMIN';await f.store.transaction(actor,tx=>tx.secret(9,'copy'))
    f.state.grant=null;await expect(f.store.transaction(actor,tx=>tx.secret(9,'copy'))).rejects.toMatchObject({status:403})
  })
  it('hashes record keys and audit references; metadata excludes capability',async()=>{
    const f=fixture(),token='opaque-capability'
    await f.store.transaction(actor,async tx=>{
      expect(await tx.get('client',token)).toBeNull();f.state.record={safe:true};expect(await tx.get('client',token)).toEqual({safe:true})
      await tx.put('client',token,{safe:true},2000);await tx.remove('client',token)
      await tx.put('operation',token,{state:'AUTHORIZED',clientId:'hashed'},2000)
      await tx.limit('unlock',1000,5);await tx.limit('tenant:operations',1000,20)
      await tx.audit({type:'DELIVERY_RELEASE_COMMITTED',clientId:token,operationId:token,policyVersion:1})
      await tx.audit({type:'POLICY_CHANGED',policyVersion:2})
    })
    expect(JSON.stringify(f.writes)).not.toContain(token)
    expect(f.writes.some(w=>w.sql.includes('INSERT INTO vault_audit'))).toBe(true)
  })
  it('NA-0183: an approval by reference keeps the stored proposal hash in the audit, same as the proposal event',async()=>{
    const f=fixture(),proposalId='proposal-capability',reference=createHash('sha256').update(proposalId).digest('hex')
    await f.store.transaction(actor,async tx=>{
      await tx.audit({type:'POLICY_CHANGE_PROPOSED',operationId:proposalId,policyVersion:1})
      await tx.audit({type:'POLICY_CHANGED',operationRef:reference,policyVersion:2})
    })
    const audits=f.writes.filter(w=>w.sql.includes('INSERT INTO vault_audit')).map(w=>JSON.parse(String(w.values[4])) as Record<string,unknown>)
    expect(audits.map(a=>a.operationId)).toEqual([reference,reference])
    expect(audits[1]).not.toHaveProperty('operationRef')
    expect(JSON.stringify(f.writes)).not.toContain(proposalId)
    expect(f.state.manager).toBe(true)
    await f.store.transaction(actor,async tx=>{ expect(await tx.administration?.isManager()).toBe(true) })
  })
  it('rejects full pending capacity and exhausted shared counters',async()=>{
    const f=fixture();f.state.pending=5
    await expect(f.store.transaction(actor,tx=>tx.put('operation','id',{state:'AUTHORIZED',clientId:'hash'},2000))).rejects.toMatchObject({status:429})
    f.state.count=6;await expect(f.store.transaction(actor,tx=>tx.limit('unlock',1000,5))).rejects.toMatchObject({status:429})
  })
})
describe('administrative approval',()=>{
  it.each(['grant','item','policy'] as const)('applies %s only with distinct eligible actors and increments global generation',async kind=>{
    const f=fixture();f.state.proposal!.payload=kind==='grant'?{kind,userId:4,action:'copy',enabled:true}:kind==='item'?{kind,secretId:9,enabled:true}:{kind,reveal:true,copy:false,tenantQuota:40}
    await f.store.transaction(actor,async tx=>{await tx.propose('new',f.state.proposal!.payload);await tx.approve('pending')})
    expect(f.writes.some(w=>w.sql.includes('version=version+1'))).toBe(true)
    expect(f.writes.some(w=>w.sql.includes('DELETE FROM vault_proposals'))).toBe(true)
  })
  it.each(['non-manager','self-proposal','self-approval','expired','missing','beneficiary','target-missing','item-missing'] as const)('rejects %s',async mode=>{
    const f=fixture();if(mode==='non-manager')f.state.manager=false
    if(mode==='self-proposal'){await expect(f.admin.propose('id',{kind:'grant',userId:1,action:'copy',enabled:true})).rejects.toMatchObject({status:403});return}
    if(mode==='self-approval')f.state.proposal!.proposedBy=1;if(mode==='expired')f.state.proposal!.expiresAt=new Date(1000);if(mode==='missing')f.state.proposal=null
    if(mode==='beneficiary')f.state.proposal!.payload={kind:'grant',userId:1,action:'copy',enabled:true}
    if(mode==='target-missing'){f.state.proposal!.payload={kind:'grant',userId:4,action:'copy',enabled:true};f.state.target=false}
    if(mode==='item-missing')f.state.secret=null
    await expect(f.admin.approve('id')).rejects.toBeDefined();expect(f.writes).toHaveLength(0)
  })
})


describe('NA0203 transaction-bound sites integration', () => {
  it('reads the current persistent generation in each admitted transaction, including missing state and rotation through a lazy store', async () => {
    const f=fixture(), lazy=new SqlVaultStore(()=>f.db as unknown as PrismaClient,()=>1000)
    expect(await f.store.transaction(actor,tx=>tx.siteFillGeneration!())).toBeNull()
    await lazy.rotateSiteFillGeneration('boot-one')
    expect(await f.store.transaction(actor,tx=>tx.siteFillGeneration!())).toBe('boot-one')
    await lazy.rotateSiteFillGeneration('boot-two')
    expect(await f.store.transaction(actor,tx=>tx.siteFillGeneration!())).toBe('boot-two')
    expect(f.reads.filter(read=>read.sql.includes('vault_fill_generation')).every(read=>read.sql.includes('FOR SHARE'))).toBe(true)
    f.db.$executeRaw.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(lazy.rotateSiteFillGeneration('boot-three')).rejects.toThrow('database unavailable')
  })
  it('propagates tenant, role and live shared-write grant into site metadata without granting extension writes from portal access', async () => {
    const f=fixture()
    f.state.siteRows=[{id:20,tenantId:actor.tenantId,kind:'login',label:'Team',scope:'GROUP',ownerUserId:null,groupId:8,
      createdByUserId:actor.userId,username:'account',origins:['https://login.test'],url:null,hostId:null,allowFill:false,version:1,revokedAt:null,deletedAt:null}]
    const list=(channel:'portal'|'extension')=>f.store.transaction(actor,async tx=>(await tx.sites!(channel)).list())
    f.state.grant!.enabled=false
    expect((await list('portal')).items[0]?.canManage).toBe(true)
    expect((await list('extension')).items[0]?.canManage).toBe(false)
    f.state.grant!.enabled=true
    expect((await list('extension')).items[0]?.canManage).toBe(true)
    f.state.user.role='ADMIN';f.state.grant!.enabled=false
    expect((await list('extension')).items[0]?.canManage).toBe(false)
    expect((await list('portal')).items[0]?.canManage).toBe(true)
    for(const query of f.reads.filter(read=>read.sql.includes('FROM vault_site_items'))){
      expect(query.sql).toContain('s.tenant_id=?');expect(query.values).toContain(actor.tenantId)
      expect(query.values).toContain(actor.userId);expect(query.sql).not.toMatch(/encrypted_value|\biv\b/)
    }
  })
  it('projects only tenant-scoped visible hosts and strips SSH fields from current-origin suggestions', async () => {
    const f=fixture()
    await f.store.transaction(actor,async tx=>{
      expect(await tx.siteHosts!('Vis')).toEqual([{id:10,name:'Visible'}])
      expect(await tx.siteCurrentHosts!('https://login.test')).toEqual([{id:10,name:'Visible'}])
      expect(await tx.siteCurrentHosts!('https://other.test')).toEqual([])
    })
    expect(f.db.host.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:actor.tenantId,deletedAt:null,name:{contains:'Vis'}}}))
    expect(f.db.hostAssociatedLink.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({tenantId:actor.tenantId,host:{tenantId:actor.tenantId,deletedAt:null}})}))
    for(const query of f.reads.filter(read=>read.sql.includes('WITH RECURSIVE ancestors'))){expect(query.values).toContain(actor.tenantId);expect(query.values).toContain(actor.userId)}
    f.state.hostPermissions=[]
    expect(await f.store.transaction(actor,tx=>tx.siteHosts!(''))).toEqual([])
  })
  it('returns group choices and tenant-write capability from the current admitted role', async () => {
    const f=fixture()
    expect(await f.store.transaction(actor,tx=>tx.siteWriteAccess!())).toEqual({groups:[{id:8,name:'Ops'}],tenant:false})
    f.state.membership=false
    expect(await f.store.transaction(actor,tx=>tx.siteWriteAccess!())).toEqual({groups:[],tenant:false})
    f.state.user.role='ADMIN';f.state.membership=true
    expect(await f.store.transaction(actor,tx=>tx.siteWriteAccess!())).toEqual({groups:[{id:8,name:'Ops'}],tenant:true})
    f.state.tenant=false
    await expect(f.store.transaction(actor,tx=>tx.siteWriteAccess!())).rejects.toThrow()
  })
})
