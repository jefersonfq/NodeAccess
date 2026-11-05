import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { connect, type ConnectionOptions } from 'node:tls'
import { connect as connectTcp } from 'node:net'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createTacacsServer } from './tacacs-server.js'
import { loadTacacsTls, tacacsTlsOptions, type TacacsTlsMaterial } from './tacacs-tls.js'
import { createTacacsTestPki } from './tacacs-tls.test-pki.js'
const pki=createTacacsTestPki()
afterAll(()=>pki.cleanup())
const runtimes:ReturnType<typeof createTacacsServer>[]=[]
afterEach(async()=>{await Promise.all(runtimes.splice(0).map(runtime=>runtime.close()))})
async function setup(material:TacacsTlsMaterial=pki.server,limits:Parameters<typeof createTacacsServer>[2]={}):Promise<{runtime:ReturnType<typeof createTacacsServer>;backend:ReturnType<typeof backendFixture>;port:number}> {
  const backend=backendFixture(),runtime=createTacacsServer(backend,material,limits);runtimes.push(runtime)
  await new Promise<void>(resolve=>runtime.server.listen(0,'127.0.0.1',resolve))
  return {runtime,backend,port:(runtime.server.address() as {port:number}).port}
}
function backendFixture():{device:ReturnType<typeof vi.fn>;authenticate:ReturnType<typeof vi.fn>;authorize:ReturnType<typeof vi.fn>;event:ReturnType<typeof vi.fn>} {
  return {device:vi.fn((ip:string,fingerprint:string)=>Promise.resolve(ip==='127.0.0.1'&&fingerprint===pki.fingerprint?{id:1,tenantId:1,hostId:1,certificateFingerprintSha256:fingerprint}:null)),authenticate:vi.fn(()=>Promise.resolve(true)),authorize:vi.fn(()=>Promise.resolve(true)),event:vi.fn(async()=>{})}
}
function packet(type=1,flags=1):Buffer {
  const body=Buffer.concat([Buffer.from([1,1,2,1,5,0,0,8]),Buffer.from('alicepassword')]),header=Buffer.alloc(12)
  header[0]=type===1?0xc1:0xc0;header[1]=type;header[2]=1;header[3]=flags;header.writeUInt32BE(123,4);header.writeUInt32BE(body.length,8)
  return Buffer.concat([header,body])
}
async function request(port:number,options:ConnectionOptions=pki.client,data=packet()):Promise<{wire:Buffer;tickets:Buffer[];reused:boolean}> {
  return new Promise((resolve,reject)=>{
    const socket=connect({...options,port,host:'127.0.0.1'}),chunks:Buffer[]=[],tickets:Buffer[]=[]
    let reused=false
    const deadline=setTimeout(()=>{socket.destroy();reject(new Error('TLS test deadline'))},3000)
    socket.on('session',ticket=>tickets.push(ticket))
    socket.on('secureConnect',()=>{reused=socket.isSessionReused();socket.write(data)})
    socket.on('data',(chunk:Buffer)=>chunks.push(chunk));socket.on('error',()=>{})
    socket.on('close',()=>{clearTimeout(deadline);resolve({wire:Buffer.concat(chunks),tickets,reused})})
  })
}
describe('TACACS TLS identity and transport',()=>{
  it('requires TLS1.3 with mutual certificates and source/pin lookup',async()=>{
    const {port,backend}=await setup(),result=await request(port)
    expect(result.wire[3]).toBe(1);expect(result.wire[12]).toBe(1)
    expect(backend.device).toHaveBeenCalledWith('127.0.0.1',pki.fingerprint)
  })
  it.each(['wrong-ca','expired','revoked','wrong-san','wrong-eku','revoked-intermediate'])('rejects %s certificates before AAA',async kind=>{
    const {port,backend}=await setup();expect((await request(port,pki.clients[kind])).wire).toHaveLength(0)
    expect(backend.device).not.toHaveBeenCalled();expect(backend.authenticate).not.toHaveBeenCalled()
  })
  it('denies an otherwise trusted unknown fingerprint',async()=>{
    const {port,backend}=await setup();expect((await request(port,pki.clients.unknown)).wire).toHaveLength(0)
    expect(backend.device).toHaveBeenCalledOnce();expect(backend.authenticate).not.toHaveBeenCalled()
  })
  it('rejects missing client certificates and TLS1.2',async()=>{
    const {port,backend}=await setup()
    expect((await request(port,{ca:pki.server.ca,servername:'localhost',minVersion:'TLSv1.3',rejectUnauthorized:true})).wire).toHaveLength(0)
    expect((await request(port,{...pki.client,minVersion:'TLSv1.2',maxVersion:'TLSv1.2'})).wire).toHaveLength(0)
    expect(backend.device).not.toHaveBeenCalled()
  })
  it.each([1,2,3])('flushes an ERROR reply for type %s with missing unencrypted flag before reading body',async type=>{
    const {port,backend}=await setup()
    // Deliberately omit the advertised body: the server must inspect the header only.
    const {wire}=await request(port,pki.client,packet(type,0).subarray(0,12))
    expect(wire[3]).toBe(1);expect(wire[2]).toBe(2);expect(wire[type===3?16:12]).toBe(type===1?7:type===2?17:2)
    expect(backend.device).not.toHaveBeenCalled();expect(backend.authenticate).not.toHaveBeenCalled()
  })
  it.each(['expired','wrong-issuer','bad-signature','missing-next-update'])('fails closed at startup for %s CRL',kind=>{
    let crl=kind==='expired'?pki.expiredCrl:kind==='missing-next-update'?pki.missingNextUpdateCrl:pki.wrongCrl
    if(kind==='bad-signature'){
      const der=Buffer.from(pki.server.crl.toString().split('-----END X509 CRL-----')[0]!.replace(/-----BEGIN X509 CRL-----|\s/g,''),'base64')
      der[der.length-1]^=1
      crl=Buffer.from('-----BEGIN X509 CRL-----\n'+der.toString('base64')+'\n-----END X509 CRL-----\n')
    }
    expect(()=>createTacacsServer(backendFixture(),{...pki.server,crl})).toThrow(/CRL/)
  })
  it('does not let a real TLS1.3 ticket bypass a pin revocation on a later connection',async()=>{
    const {port,backend}=await setup();const initial=await request(port)
    expect(initial.wire[12]).toBe(1);expect(initial.tickets.length).toBeGreaterThan(0)
    backend.device.mockResolvedValue(null)
    const next=await request(port,{...pki.client,session:initial.tickets[0]})
    expect(next.wire).toHaveLength(0);expect(backend.authenticate).toHaveBeenCalledTimes(1)
    expect(next.reused).toBe(false)
  })
  it('rejects an old real ticket after a restart loads a CRL revoking that client',async()=>{
    const first=await setup(),initial=await request(first.port)
    expect(initial.tickets.length).toBeGreaterThan(0)
    await first.runtime.close();runtimes.splice(runtimes.indexOf(first.runtime),1)
    execFileSync('/usr/bin/openssl',['ca','-config','root/config','-revoke','client.crt'],{cwd:pki.directory,stdio:'ignore'})
    execFileSync('/usr/bin/openssl',['ca','-gencrl','-config','root/config','-out','client-revoked.crl'],{cwd:pki.directory,stdio:'ignore'})
    const restarted=await setup({...pki.server,crl:readFileSync(pki.directory+'/client-revoked.crl')})
    const result=await request(restarted.port,{...pki.client,session:initial.tickets[0]})
    expect(result.wire).toHaveLength(0);expect(restarted.backend.device).not.toHaveBeenCalled()
  })
  it('normalizes an IPv4-mapped TCP origin before the SAN and device binding checks',async()=>{
    const backend=backendFixture(),runtime=createTacacsServer(backend,pki.server);runtimes.push(runtime)
    await new Promise<void>(resolve=>runtime.server.listen(0,'::',resolve))
    const port=(runtime.server.address() as {port:number}).port
    expect((await request(port)).wire[12]).toBe(1)
    expect(backend.device).toHaveBeenCalledWith('127.0.0.1',pki.fingerprint)
  })
  it.each([false,true])('counts incomplete handshake peers (partial=%s), limits them and recovers capacity',async partial=>{
    const {port,runtime,backend}=await setup(pki.server,{connections:1,perSource:1,timeoutMs:100})
    const raw=connectTcp(port,'127.0.0.1');raw.on('error',()=>{});raw.resume()
    await new Promise<void>(resolve=>raw.once('connect',resolve))
    if(partial)raw.write(Buffer.from([0x16,0x03,0x01,0x00,0x80]))
    const closed=new Promise<void>(resolve=>raw.once('close',resolve))
    expect((await request(port)).wire).toHaveLength(0)
    await closed
    await vi.waitFor(()=>expect(runtime.snapshot().connections).toBe(0))
    expect(backend.device).not.toHaveBeenCalled()
    expect((await request(port)).wire[12]).toBe(1)
  })
  it('rejects plaintext packets without dispatching backend operations',async()=>{
    const {port,backend}=await setup()
    await new Promise<void>(resolve=>{const socket=connectTcp(port,'127.0.0.1',()=>socket.write(packet()));socket.on('error',()=>{});socket.resume();socket.on('close',()=>resolve())})
    expect(backend.device).not.toHaveBeenCalled()
  })
})
describe('TLS material startup validation',()=>{
  it('requires readable key/cert/CA/CRL files and parses them before listen',()=>{
    expect(()=>loadTacacsTls({})).toThrow('KEY_FILE')
    expect(()=>loadTacacsTls({NODEACCESS_TACACS_TLS_KEY_FILE:'/missing-disposable-tls'})).toThrow('Cannot read')
    const directory=pki.directory
    const material=loadTacacsTls({NODEACCESS_TACACS_TLS_KEY_FILE:directory+'/server.key',NODEACCESS_TACACS_TLS_CERT_FILE:directory+'/server.crt',NODEACCESS_TACACS_TLS_CA_FILE:directory+'/root/ca.crt',NODEACCESS_TACACS_TLS_CRL_FILE:directory+'/root/ca.crl'})
    expect(material.cert).toEqual(pki.server.cert)
    expect(()=>tacacsTlsOptions({...material,crl:Buffer.from('not PEM')})).toThrow()
    expect(()=>tacacsTlsOptions({...material,key:Buffer.alloc(0)})).toThrow()
    expect(()=>tacacsTlsOptions({...material,key:readFileSync(directory+'/client.key')})).toThrow()
    expect(()=>tacacsTlsOptions({...material,cert:readFileSync(directory+'/expired.crt')})).toThrow('validity')
    expect(()=>tacacsTlsOptions({...material,ca:readFileSync(directory+'/client.crt')})).toThrow('CA')
  })
})
