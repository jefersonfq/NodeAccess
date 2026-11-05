import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { connect as connectTls } from 'node:tls'
import { createTacacsTestPki } from './tacacs-tls.test-pki.js'
import { createTacacsServer } from './tacacs-server.js'
import { authReply, readHeader, reply } from './tacacs-protocol.js'
import { commandAllowed, GrantSchema } from './network-access.service.js'
import { deviceCapabilities, classifyNetworkCommand } from '@nodeaccess/shared'
const pki=createTacacsTestPki()
afterAll(()=>pki.cleanup())
const connect=(port:number,host:string)=>connectTls({...pki.client,port,host})
const device={id:1,hostId:1,tenantId:1,certificateFingerprintSha256:pki.fingerprint}
const running:Array<ReturnType<typeof createTacacsServer>>=[]
afterEach(async()=>{await Promise.all(running.splice(0).map(r=>r.close()))})
async function setup(overrides:Partial<Parameters<typeof createTacacsServer>[0]>={},limits?:Parameters<typeof createTacacsServer>[2]) {
  const backend={device:vi.fn().mockResolvedValue(device),authenticate:vi.fn((_d:unknown,u:string,p:string)=>Promise.resolve(u==='alice'&&p==='good-password-123')),authorize:vi.fn((_d:unknown,_u:string,args:string[])=>Promise.resolve(commandAllowed([['show','version']],args))),event:vi.fn().mockResolvedValue(undefined),...overrides}
  const runtime=createTacacsServer(backend,pki.server,limits);running.push(runtime)
  await new Promise<void>(resolve=>runtime.server.listen(0,'127.0.0.1',resolve))
  return {runtime,backend,port:(runtime.server.address() as {port:number}).port}
}
function packet(type:number,body:Buffer,sequence=1,version=0xc0) {
  const header=Buffer.alloc(12);header[0]=version;header[1]=type;header[2]=sequence;header[3]=1;header.writeUInt32BE(12345,4);header.writeUInt32BE(body.length,8)
  return Buffer.concat([header,body])
}
function start(u='alice',p='good-password-123',type=2) {return Buffer.concat([Buffer.from([1,1,type,1,u.length,0,0,p.length]),Buffer.from(u+p)])}
function argsBody(args:string[],accounting=false){const u='alice';return Buffer.concat([Buffer.from(accounting?[2,6,1,1,1,u.length,0,0,args.length]:[6,1,1,1,u.length,0,0,args.length]),Buffer.from(args.map(a=>Buffer.byteLength(a))),Buffer.from(u+args.join(''))])}
async function exchange(port:number,data:Buffer,fragment=false):Promise<Buffer> {
  return new Promise(resolve=>{const socket=connect(port,'127.0.0.1');const chunks:Buffer[]=[];socket.on('error',()=>{});socket.on('data',(c:Buffer)=>chunks.push(c));socket.on('end',()=>resolve(Buffer.concat(chunks)));socket.on('close',()=>resolve(Buffer.concat(chunks)));socket.on('connect',()=>{if(fragment){socket.write(data.subarray(0,5));setTimeout(()=>socket.write(data.subarray(5)),5)}else socket.write(data)})})
}
function decoded(response:Buffer){expect(response[3]).toBe(1);return response.subarray(12)}
describe('TACACS+ TLS 1.3',()=>{
  it('authenticates PAP over a fragmented frame and denies a wrong password',async()=>{const {port,backend}=await setup();expect(decoded(await exchange(port,packet(1,start(),1,0xc1),true))[0]).toBe(1);expect(decoded(await exchange(port,packet(1,start('alice','wrong'),1,0xc1)))[0]).toBe(2);expect(backend.authenticate).toHaveBeenCalledTimes(2)})
  it('authorizes exact query and denies configuration, abbreviation and injection',async()=>{const {port}=await setup();for(const [args,status] of [[['service=shell','cmd=show','cmd-arg=version'],1],[['service=shell','cmd=configure','cmd-arg=terminal'],16],[['service=shell','cmd=sh','cmd-arg=version'],16],[['service=shell','cmd=show','cmd-arg=version;reload'],16]] as const){expect(decoded(await exchange(port,packet(2,argsBody([...args]))))[0]).toBe(status)}})
  it('records accounting before acknowledging',async()=>{const {port,backend}=await setup();expect(decoded(await exchange(port,packet(3,argsBody(['service=shell','cmd=show','cmd-arg=version'],true))))[4]).toBe(1);expect(backend.event).toHaveBeenCalledWith(device,'alice','accounting','start',expect.any(Array))})
  it('does not acknowledge when auditing fails',async()=>{const {port}=await setup({event:vi.fn().mockRejectedValue(new Error('DB down'))});expect(decoded(await exchange(port,packet(3,argsBody([],true))))[4]).toBe(2)})
  it('denies unknown certificate/source, disabled module and malformed body',async()=>{const a=await setup({device:vi.fn().mockResolvedValue(null)});expect((await exchange(a.port,packet(1,start(),1,0xc1))).length).toBe(0);expect(a.backend.authenticate).not.toHaveBeenCalled();const b=await setup();expect((await exchange(b.port,packet(1,Buffer.from([1]),1,0xc1))).length).toBe(0)})
  it('rejects oversized frames, invalid versions and out-of-order packets',async()=>{const {port,backend}=await setup();for(const mutate of [(b:Buffer)=>b.writeUInt32BE(9000,8),(b:Buffer)=>b[0]=0xc2,(b:Buffer)=>b[2]=3]){const p=packet(1,start(),1,0xc1);mutate(p);expect((await exchange(port,p)).length).toBe(0)}expect(backend.authenticate).not.toHaveBeenCalled()})
  it('bounds backend stalls and rejects work beyond operation capacity',async()=>{const {port,runtime}=await setup({device:vi.fn(()=>new Promise(()=>{}))},{connections:4,perSource:4,operations:1,timeoutMs:40});const first=exchange(port,packet(1,start(),1,0xc1));await new Promise(r=>setTimeout(r,10));expect((await exchange(port,packet(1,start(),1,0xc1))).length).toBe(0);expect((await first).length).toBe(0);expect(runtime.stats.rejected).toBe(1)})
  it('returns protocol errors for unavailable authentication and authorization dependencies',async()=>{
    const {port}=await setup({authenticate:vi.fn().mockRejectedValue(new Error('unavailable')),authorize:vi.fn().mockRejectedValue(new Error('unavailable'))})
    expect(decoded(await exchange(port,packet(1,start(),1,0xc1)))[0]).toBe(7)
    expect(decoded(await exchange(port,packet(2,argsBody(['service=shell','cmd=']))))[0]).toBe(17)
  })
  it('bounds repeated authentication attempts per source',async()=>{
    const {port,runtime}=await setup()
    for(let i=0;i<60;i++)expect(decoded(await exchange(port,packet(1,start('alice','wrong'),1,0xc1)))[0]).toBe(2)
    expect((await exchange(port,packet(1,start(),1,0xc1))).length).toBe(0)
    expect(runtime.stats.rejected).toBe(1)
  })
  it('performs ASCII username/password dialogue with NOECHO and checks each continuation',async()=>{const {port,backend}=await setup();await new Promise<void>((resolve,reject)=>{const socket=connect(port,'127.0.0.1');let seq=1;socket.on('error',reject);socket.on('connect',()=>socket.write(packet(1,start('','',1))));socket.on('data',(data:Buffer)=>{try{const body=decoded(data);if(seq===1){expect(body[0]).toBe(4);seq=3;const a=Buffer.from('alice');socket.write(packet(1,Buffer.concat([Buffer.from([0,a.length,0,0,0]),a]),seq))}else if(seq===3){expect(body[0]).toBe(5);expect(body[1]).toBe(1);seq=5;const a=Buffer.from('good-password-123');socket.write(packet(1,Buffer.concat([Buffer.from([0,a.length,0,0,0]),a]),seq))}else{expect(body[0]).toBe(1);socket.end();resolve()}}catch(e){socket.destroy();reject(e instanceof Error?e:new Error('Dialogue failed'))}})});expect(backend.device).toHaveBeenCalledTimes(3)})
  it('completes 100 sequential authorizations without an unbounded queue',async()=>{const {port,runtime}=await setup();for(let i=0;i<100;i++)expect(decoded(await exchange(port,packet(2,argsBody(['service=shell','cmd=show','cmd-arg=version']))))[0]).toBe(1);expect(runtime.stats.requests).toBe(100);expect(runtime.stats.errors).toBe(0)})
})
describe('policy and compatibility',()=>{
  it('keeps legacy servers and closes unknown capability profiles',()=>{expect(deviceCapabilities().sftp).toBe(true);expect(deviceCapabilities('network_generic').sftp).toBe(false);expect(deviceCapabilities('newer_profile').serverAutomation).toBe(false)})
  it('does not confuse informative command classification with authorization',()=>{expect(classifyNetworkCommand('cisco_ios','show version')).toBe('query');expect(classifyNetworkCommand('juniper_junos','commit')).toBe('configuration');expect(classifyNetworkCommand('network_generic','show version')).toBe('unknown');expect(classifyNetworkCommand('cisco_ios','show version | redirect file')).toBe('unknown');expect(commandAllowed([],['service=shell','cmd=show','cmd-arg=version'])).toBe(false)})
  it('rejects ambiguous authorization arguments and exact vector mismatches',()=>{for(const args of [['cmd=show'],['service=shell','cmd=show','cmd=reload'],['service=shell','cmd=show','cmd-arg=version','priv-lvl=15'],['service=shell','cmd=show','cmd-arg=version','cmd-arg=extra'],['service=shell','cmd=','cmd-arg=reload']])expect(commandAllowed([['show','version']],args)).toBe(false);expect(commandAllowed([],['service=shell','cmd='])).toBe(true)})
  it('validates command limits and rejects shell metacharacters',()=>{expect(GrantSchema.safeParse({userId:1,hostId:2,commands:[['show','version;reload']]}).success).toBe(false);expect(GrantSchema.safeParse({userId:1,hostId:2,commands:[]}).success).toBe(true)})
  it('encodes unobfuscated reply only for TLS with mandatory flag',()=>{const h={version:0xc0,type:1,sequence:1,sessionId:12345,flags:1,length:6};const encoded=reply(h,authReply(1));expect(encoded[2]).toBe(2);expect(encoded[3]).toBe(1);expect(encoded.subarray(12)).toEqual(authReply(1));expect(()=>readHeader(Buffer.alloc(1))).toThrow()})
})
