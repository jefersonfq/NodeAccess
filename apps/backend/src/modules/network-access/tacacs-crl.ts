import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, openSync, closeSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Validate public CA/CRL material at startup; no private key is written or passed to the CLI. */
export function validateTacacsCrl(ca: Buffer, bundle: Buffer): void {
  const crls=bundle.toString().match(/-----BEGIN X509 CRL-----[\s\S]+?-----END X509 CRL-----/g)
  if(!crls?.length)throw new Error('TACACS+ TLS requires a PEM CRL')
  const directory=mkdtempSync(join(tmpdir(),'nodeaccess-crl-'))
  try {
    const authority=join(directory,'ca.pem'),file=join(directory,'crl.pem'),diagnostic=join(directory,'verify.txt')
    writeFileSync(authority,ca,{mode:0o600})
    for(const crl of crls){
      writeFileSync(file,crl,{mode:0o600})
      const errorFd=openSync(diagnostic,'w',0o600)
      let output:string
      try {
        output=execFileSync('/usr/bin/openssl',['crl','-in',file,'-CAfile',authority,'-verify','-noout','-lastupdate','-nextupdate'],
          {shell:false,timeout:5000,maxBuffer:16384,encoding:'utf8',stdio:['ignore','pipe',errorFd]})
      } catch {throw new Error('TACACS+ CRL signature verification failed')}
      finally {closeSync(errorFd)}
      if(!/^verify OK\r?$/m.test(readFileSync(diagnostic,'utf8')))throw new Error('TACACS+ CRL signature verification failed')
      const last=Date.parse(output.match(/^lastUpdate=(.+)$/m)?.[1]??''),next=Date.parse(output.match(/^nextUpdate=(.+)$/m)?.[1]??'')
      const now=Date.now()
      if(!Number.isFinite(last)||!Number.isFinite(next)||last>now||next<=now||next<=last)throw new Error('TACACS+ CRL outside validity period')
    }
  } finally {rmSync(directory,{recursive:true,force:true})}
}
