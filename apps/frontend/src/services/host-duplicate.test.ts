import { describe, expect, it } from 'vitest'
import type { HostPublic } from '@nodeaccess/shared'
import { duplicateHostDraft } from './host-duplicate'
const host = {
  id: 21, tenantId: 7, name: 'Example', ip: '192.0.2.21', port: 2222,
  description: 'Notes', accessProtocol: 'ssh', operatingSystem: 'linux', deviceProfile:'server_ssh',
  sshUser:'ops',authType:'pem_password',connectionMode:'direct',scope:'personal',
  folderId:8, inventoryParentId:800, groupId:9,bastionId:12,pemKeyId:31,passwordSecretId:91,
  startupSnippetId:51,startupSnippetMode:'auto',onePasswordRef:null,
  tags:[{id:1,name:'production',color:'#fff'}],
  associatedLinks:[{id:44,label:'Console',urlTemplate:'https://{ip}:8443',position:7,enabled:true,openMode:'new_tab',sourceType:'integration',sourceStatus:'synced',sourceRef:'remote-id',sourceProvider:'onepassword'}],
  trustedHostKeyFingerprint:'old-fingerprint',trustedHostKeyVerifiedAt:new Date(),
  accessPermissions:{view:true,connect:true,edit:true,admin:true},hasPasswordCredential:true,
  password:'must-not-copy',passwordEncrypted:'must-not-copy',effectiveBastionId:99,
} as unknown as HostPublic
describe('duplicate host draft',()=>{
  it('retains editable config and requires a new address',()=>{
    const copy=duplicateHostDraft(host,'Example (copy)')
    expect(copy).toMatchObject({name:'Example (copy)',ip:'',port:2222,description:'Notes',folderId:8,inventoryParentId:800,groupId:9,bastionId:12,pemKeyId:31,passwordSecretId:91,startupSnippetId:51,startupSnippetMode:'auto',password:''})
    expect(copy.tagNames).toEqual(['production'])
  })
  it('omits all source identity, trust, grants and secret values',()=>{
    const copy=duplicateHostDraft(host,'copy')
    for(const key of ['id','tenantId','ownerId','accessPermissions','trustedHostKeyFingerprint','trustedHostKeyVerifiedAt','passwordEncrypted','effectiveBastionId','hasPasswordCredential'])expect(copy).not.toHaveProperty(key)
    expect(copy.password).toBe('')
  })
  it('copies links independently without integration identity',()=>{
    const copy=duplicateHostDraft(host,'copy')
    expect(copy.associatedLinks?.[0]).toEqual({label:'Console',urlTemplate:'https://{ip}:8443',position:0,enabled:true,openMode:'new_tab',sourceType:'manual',sourceStatus:'manual'})
    copy.associatedLinks![0].label='changed';copy.tagNames!.push('other')
    expect(host.associatedLinks![0].label).toBe('Console');expect(host.tags).toHaveLength(1)
  })
  it('does not turn inherited routing into an explicit override',()=>{
    expect(duplicateHostDraft({...host,bastionId:null},'copy').bastionId).toBeUndefined()
  })
  it('keeps root location and does not fabricate a missing inventory destination',()=>{
    expect(duplicateHostDraft({...host,folderId:null,inventoryParentId:800},'copy')).toMatchObject({inventoryParentId:800})
    expect(duplicateHostDraft({...host,folderId:null,inventoryParentId:null},'copy').inventoryParentId).toBeUndefined()
  })
  it('preserves accessible external credential references without local passwords',()=>{
    expect(duplicateHostDraft({...host,passwordSecretId:null,onePasswordRef:'op://vault/item/field'},'copy')).toMatchObject({onePasswordRef:'op://vault/item/field',passwordSecretId:null,password:''})
  })
  it.each(['ssh','rdp','vnc','telnet'] as const)('preserves %s connection parameters',accessProtocol=>{
    expect(duplicateHostDraft({...host,accessProtocol},'copy').accessProtocol).toBe(accessProtocol)
  })
  it('bounds the copied name',()=>expect(duplicateHostDraft(host,'x'.repeat(150)).name).toHaveLength(100))
})
