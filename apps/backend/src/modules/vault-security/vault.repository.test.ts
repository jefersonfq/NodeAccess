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
    eligible:true,membership:true,record:null as unknown,count:1,pending:0,manager:true,target:true,managers:[1,2,3],
    proposal:{proposedBy:2,payload:{kind:'item',secretId:9,enabled:true},expiresAt:new Date(10000)} as {proposedBy:number;payload:VaultChange;expiresAt:Date}|null}
  const queries:string[]=[],writes:{sql:string;values:unknown[]}[]=[]
  const query=vi.fn((strings:TemplateStringsArray,...values:unknown[])=>Promise.resolve().then(()=>{
    const sql=strings.join('?');queries.push(sql)
    if(sql.includes('FROM vault_managers'))return sql.includes('m.user_id=')?(state.manager?[{id:1}]:[]):state.managers.map(id=>({id}))
    if(sql.includes('FROM tenants'))return [{active:state.tenant}]
    if(sql.includes('FROM users'))return sql.includes('password_hash')?[state.user]:state.target?[{id:9}]:[]
    if(sql.includes('FROM tenant_auth_policies'))return state.auth
    if(sql.includes('FROM trial_registrations'))return state.trials
    if(sql.includes('FROM licenses'))return [{features:state.features,active:state.licenseActive,expiresAt:state.licenseExpires}]
    if(sql.includes('FROM vault_policies'))return [{version:state.policyVersion,config:JSON.stringify(state.policy)}]
    if(sql.includes('FROM vault_entitlements'))return state.grant?[state.grant]:[]
    if(sql.includes('FROM vault_web_items'))return [{enabled:state.eligible}]
    if(sql.includes('FROM secrets'))return state.secret?[state.secret]:[]
    if(sql.includes('FROM user_groups'))return state.membership?[{userId:1}]:[]
    if(sql.includes('FROM vault_records'))return sql.includes('COUNT')?[{count:BigInt(state.pending)}]:state.record?[{payload:JSON.stringify(state.record)}]:[]
    if(sql.includes('FROM vault_limits'))return [{count:state.count}]
    if(sql.includes('FROM vault_proposals'))return state.proposal?[state.proposal]:[]
    throw new Error('Uncovered query '+sql+' values-count '+values.length)
  }))
  const execute=vi.fn((strings:TemplateStringsArray,...values:unknown[])=>{writes.push({sql:strings.join('?'),values});return Promise.resolve(1)})
  const db={$queryRaw:query,$executeRaw:execute,$transaction:vi.fn(async(run:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>run(db as unknown as Prisma.TransactionClient))}
  const store=new SqlVaultStore(db as unknown as PrismaClient,()=>1000)
  return {state,queries,writes,store,db,admin:new SqlVaultAdministration(db as unknown as Prisma.TransactionClient,actor,()=>1000)}
}

describe('SQL vault adapter authorization and locking contract',()=>{
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
