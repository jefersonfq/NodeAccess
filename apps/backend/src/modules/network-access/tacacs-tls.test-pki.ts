import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate, sign } from 'node:crypto'
import type { ConnectionOptions } from 'node:tls'
import type { TacacsTlsMaterial } from './tacacs-tls.js'

export function createTacacsTestPki(): { directory: string; server: TacacsTlsMaterial; client: ConnectionOptions; clients: Record<string, ConnectionOptions>; fingerprint: string; expiredCrl: Buffer; missingNextUpdateCrl: Buffer; wrongCrl: Buffer; cleanup: () => void } {
  const directory=mkdtempSync(join(tmpdir(),'nodeaccess-tacacs-tls-'))
  const run=(...args:string[]):void=>{execFileSync('/usr/bin/openssl',args,{cwd:directory,stdio:'ignore'})}
  const write=(file:string,value:string):void=>{writeFileSync(join(directory,file),value,{mode:0o600})}
  const read=(file:string):Buffer=>readFileSync(join(directory,file))
  const authority=(name:string):void=>{
    mkdirSync(join(directory,name));write(`${name}/index`,'');write(`${name}/serial`,'1000\n');write(`${name}/crlnumber`,'1000\n')
    write(`${name}/config`, `[ca]\ndefault_ca=ca_default\n[ca_default]\ndir=${join(directory,name)}\ndatabase=$dir/index\nnew_certs_dir=$dir\ncertificate=$dir/ca.crt\nprivate_key=$dir/ca.key\nserial=$dir/serial\ncrlnumber=$dir/crlnumber\ndefault_md=sha256\ndefault_days=2\ndefault_crl_days=1\npolicy=policy\n[policy]\ncommonName=supplied\n`)
    write('request.config','[req]\ndistinguished_name=dn\n[dn]\n')
    run('req','-config','request.config','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',`${name}/ca.key`,'-out',`${name}/ca.crt`,'-days','2','-subj',`/CN=Disposable ${name}`,'-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign')
  }
  const leaf=(name:string,ca='root',san='IP:127.0.0.1',eku='clientAuth',expired=false):void=>{
    run('req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-keyout',`${name}.key`,'-out',`${name}.csr`,'-subj',`/CN=${name}`)
    write(`${name}.ext`,`[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${eku}\nsubjectAltName=${san}\n`)
    run('ca','-batch','-config',`${ca}/config`,'-in',`${name}.csr`,'-out',`${name}.crt`,'-notext','-extensions','leaf','-extfile',`${name}.ext`,...(expired?['-startdate','20000101000000Z','-enddate','20010101000000Z']:[]))
  }
  try {
    authority('root');authority('other');authority('intermediate')
    // Replace the intermediate's self-signed certificate with a root-signed CA certificate.
    run('req','-new','-key','intermediate/ca.key','-out','intermediate.csr','-subj','/CN=Disposable intermediate')
    write('intermediate.ext','[ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n')
    run('ca','-batch','-config','root/config','-in','intermediate.csr','-out','intermediate/ca.crt','-notext','-extensions','ca','-extfile','intermediate.ext')
    leaf('server','root','DNS:localhost,IP:127.0.0.1','serverAuth')
    leaf('client');leaf('unknown');leaf('revoked');leaf('wrong-san','root','IP:192.0.2.99');leaf('expired','root','IP:127.0.0.1','clientAuth',true)
    leaf('wrong-eku','root','IP:127.0.0.1','serverAuth');leaf('wrong-ca','other');leaf('revoked-intermediate','intermediate')
    run('ca','-config','root/config','-revoke','revoked.crt')
    run('ca','-config','root/config','-revoke','intermediate/ca.crt')
    for(const name of ['root','other','intermediate'])run('ca','-gencrl','-config',`${name}/config`,'-out',`${name}/ca.crl`)
    const expiredCrl = signedTestCrl(read('root/ca.crl'), read('root/ca.key'), false)
    const missingNextUpdateCrl = signedTestCrl(read('root/ca.crl'), read('root/ca.key'), true)
    const server={key:read('server.key'),cert:read('server.crt'),ca:Buffer.concat([read('root/ca.crt'),read('intermediate/ca.crt')]),crl:Buffer.concat([read('root/ca.crl'),read('intermediate/ca.crl')])}
    const clients:Record<string,ConnectionOptions>={}
    for(const name of ['client','unknown','revoked','wrong-san','expired','wrong-eku','wrong-ca','revoked-intermediate'])clients[name]={key:read(`${name}.key`),cert:name==='revoked-intermediate'?Buffer.concat([read(`${name}.crt`),read('intermediate/ca.crt')]):read(`${name}.crt`),ca:server.ca,servername:'localhost',minVersion:'TLSv1.3',maxVersion:'TLSv1.3',rejectUnauthorized:true}
    return {directory,server,client:clients.client!,clients,fingerprint:new X509Certificate(read('client.crt')).fingerprint256.replaceAll(':','').toLowerCase(),expiredCrl,missingNextUpdateCrl,wrongCrl:read('other/ca.crl'),cleanup:():void=>rmSync(directory,{recursive:true,force:true})}
  } catch(error){rmSync(directory,{recursive:true,force:true});throw error}
}

// Test-only DER manipulation followed by a valid CA signature; compatible with OpenSSL 1.1.1 and 3.x.
function signedTestCrl(pem: Buffer, key: Buffer, missingNextUpdate: boolean): Buffer {
  const der=Buffer.from(pem.toString().replace(/-----[^-]+-----|\s/g,''),'base64')
  const tlv=(data:Buffer,offset:number):{start:number;end:number}=>{
    const marker=data[offset+1]!,count=marker&0x7f
    const length=marker<128?marker:data.readUIntBE(offset+2,count)
    const start=offset+2+(marker<128?0:count)
    return {start,end:start+length}
  }
  const outer=tlv(der,0), tbs=tlv(der,outer.start), algorithm=tlv(der,tbs.end)
  const encode=(tag:number,body:Buffer):Buffer=>{
    const length=body.length<128?Buffer.from([body.length]):Buffer.from([0x82,body.length>>8,body.length&255])
    return Buffer.concat([Buffer.from([tag]),length,body])
  }
  let changed:Buffer
  if(missingNextUpdate){
    const fields:Buffer[]=[]
    let dates=0
    for(let offset=tbs.start;offset<tbs.end;){
      const field=tlv(der,offset),tag=der[offset]
      if(tag===0x17||tag===0x18)dates++
      // thisUpdate and nextUpdate are the first two direct temporal fields.
      if(!((tag===0x17||tag===0x18)&&dates===2))fields.push(der.subarray(offset,field.end))
      offset=field.end
    }
    changed=Buffer.concat(fields)
  }else{
    changed=Buffer.from(der.subarray(tbs.start,tbs.end).toString('latin1').replace(/\d{12}Z/g,'000101000000Z'),'latin1')
  }
  const unsigned=encode(0x30,changed),signature=sign('sha256',unsigned,key)
  const signed=encode(0x30,Buffer.concat([unsigned,der.subarray(tbs.end,algorithm.end),encode(3,Buffer.concat([Buffer.from([0]),signature]))]))
  return Buffer.from('-----BEGIN X509 CRL-----\n'+signed.toString('base64').match(/.{1,64}/g)!.join('\n')+'\n-----END X509 CRL-----\n')
}
