import fs from 'node:fs/promises'
import tls from 'node:tls'
import http from 'node:http'
import { lookup } from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { run, metadata, TlsError } from './certificates.mjs'
export function createAdapter({domain,external=false,certbotDir='/var/lib/nodeaccess-acme',webroot='/var/www/acme',connectHost='127.0.0.1',port=443,signal=()=>process.kill(1,'SIGHUP'),trustFile,acmeDirectory}) {
  if(acmeDirectory && new URL(acmeDirectory).protocol!=='https:')throw Error('ACME directory requires HTTPS')
  const args=email=>['certonly','--non-interactive','--agree-tos','--email',email,'--webroot','-w',webroot,'-d',domain,'--cert-name','nodeaccess-managed','--config-dir',certbotDir,'--work-dir',path.join(certbotDir,'work'),'--logs-dir',path.join(certbotDir,'logs'),...(acmeDirectory?['--server',acmeDirectory]:[])]
  const inspect=(trusted=true)=>new Promise((resolve,reject)=>{
    const socket=tls.connect({host:external?domain:connectHost,port,servername:domain,rejectUnauthorized:trusted},()=>{
      try {const cert=socket.getPeerCertificate();resolve(metadata(cert.raw))}catch{reject(new TlsError('TLS_VERIFY_FAILED','Não foi possível ler o certificado servido.'))}finally{socket.end()}
    })
    socket.setTimeout(8000,()=>socket.destroy(new Error('timeout')))
    socket.on('error',()=>reject(new TlsError('TLS_VERIFY_FAILED','Não foi possível verificar o HTTPS servido: confira cadeia, domínio e conectividade.')))
  })
  return {
    resolveDns:async()=>{
      try { await lookup(domain,{all:true}) }
      catch { throw new TlsError('ACME_DNS','O domínio não resolve neste servidor. Confira o DNS antes da emissão.') }
    },
    checkChallenge:async()=>{
      const directory=path.join(webroot,'.well-known/acme-challenge'),name='nodeaccess-'+randomUUID(),file=path.join(directory,name)
      try {
        await fs.mkdir(directory,{recursive:true,mode:0o755})
        await fs.chmod(path.dirname(directory),0o755);await fs.chmod(directory,0o755)
        await fs.writeFile(file,name,{mode:0o644});await fs.chmod(file,0o644)
        await new Promise((resolve,reject)=>{
          const request=http.get({host:connectHost,port:80,path:'/.well-known/acme-challenge/'+name,headers:{Host:domain}},response=>{
            let data='';response.on('data',chunk=>{data+=chunk;if(data.length>1000)request.destroy(new Error('oversized'))})
            response.on('error',reject);response.on('end',()=>response.statusCode===200&&data===name?resolve():reject(new Error('challenge mismatch')))
          })
          request.setTimeout(5000,()=>request.destroy(new Error('timeout')));request.on('error',reject)
        })
      }catch{throw new TlsError('HTTP01_LOCAL_FAILED','O desafio HTTP-01 não está acessível no Nginx local. Confira o volume e a rota do desafio. A acessibilidade pela internet será validada pela autoridade.')}
      finally{await fs.unlink(file).catch(()=>{})}
    },
    // Nginx opens /dev/stdout and /dev/stderr. Node execFile uses socket-backed pipes
    // which cannot be reopened there; discard validation output, keep a safe error code.
    test:()=>new Promise((resolve,reject)=>{
      const child=spawn('nginx',['-t'],{stdio:'ignore'}), timer=setTimeout(()=>child.kill('SIGKILL'),10000)
      const failure=()=>new TlsError('NGINX_CONFIG_FAILED','A configuração do Nginx não passou na validação. Verifique nginx -t no serviço.')
      child.once('error',()=>{clearTimeout(timer);reject(failure())});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(failure())})
    }),
    reload:async()=>{signal()},
    inspect,
    verify:async fingerprint=>{
      for(let i=0;i<10;i++){try{if((await inspect(false)).fingerprint===fingerprint)return}catch{};await new Promise(r=>setTimeout(r,500))}
      throw new TlsError('TLS_MISMATCH','O certificado servido não corresponde à versão aplicada.')
    },
    validateChain:async(dir,hostname)=>{
      const pem=await fs.readFile(path.join(dir,'fullchain.pem'),'utf8'), parts=pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
      await fs.writeFile(path.join(dir,'leaf.pem'),parts[0]);await fs.writeFile(path.join(dir,'chain.pem'),parts.slice(1).join('\n'))
      await run('openssl',['verify','-purpose','sslserver','-verify_hostname',hostname,...(trustFile?['-CAfile',trustFile]:[]),...(parts.length>1?['-untrusted',path.join(dir,'chain.pem')]:[]),path.join(dir,'leaf.pem')])
    },
    dryRun:email=>run('certbot',[...args(email),'--dry-run'],{timeout:180000}),
    issue:async email=>{
      await run('certbot',[...args(email),'--keep-until-expiring'],{timeout:180000})
      const base=path.join(certbotDir,'live/nodeaccess-managed')
      return {certificate:await fs.readFile(path.join(base,'fullchain.pem'),'utf8'),privateKey:await fs.readFile(path.join(base,'privkey.pem'),'utf8')}
    },
  }
}
