import fs from 'node:fs/promises'
import path from 'node:path'
import { run } from './certificates.mjs'
const root=process.env.CERTS_DIR||'/etc/nginx/certs',domain=process.env.TLS_DOMAIN
if(!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain||''))throw Error('TLS_DOMAIN inválido')
const source=process.env.NGINX_SOURCE||'/input/nginx.conf',dest=process.env.NGINX_DEST||'/output/nginx.tls-managed.conf'
let config=await fs.readFile(source,'utf8')
if(process.env.TLS_EXTERNAL!=='true') {
  const redirect='return 301 https://$host$request_uri;'
  if(!config.includes('/etc/nginx/certs/fullchain.pem')||!config.includes('/etc/nginx/certs/privkey.pem'))throw Error('Configuração TLS incompatível; revise os caminhos do certificado')
  if(!config.includes(redirect))throw Error('Configuração HTTP incompatível; revise o desafio ACME')
  const managed=path.join(root,'managed');await fs.mkdir(path.join(managed,'versions/bootstrap'),{recursive:true,mode:0o700})
  try {await fs.lstat(path.join(managed,'current'))}catch(e){
    if(e.code!=='ENOENT')throw e
    const exists=async file=>fs.access(path.join(root,file)).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e})
    const hasCert=await exists('fullchain.pem'),hasKey=await exists('privkey.pem')
    if(hasCert!==hasKey)throw Error('Par de certificados incompleto: restaure fullchain.pem e privkey.pem antes de preparar. Arquivos existentes preservados.')
    if(!hasCert){await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','7','-subj',`/CN=${domain}`,'-addext',`subjectAltName=DNS:${domain}`,'-keyout',path.join(root,'privkey.pem'),'-out',path.join(root,'fullchain.pem')]);await fs.chmod(path.join(root,'privkey.pem'),0o600)}
    for(const file of ['fullchain.pem','privkey.pem'])await fs.copyFile(path.join(root,file),path.join(managed,'versions/bootstrap',file))
    await fs.chmod(path.join(managed,'versions/bootstrap/privkey.pem'),0o600)
    await fs.symlink('versions/bootstrap',path.join(managed,'current'))
  }
  config=config.replaceAll('/etc/nginx/certs/fullchain.pem','/etc/nginx/certs/managed/current/fullchain.pem').replaceAll('/etc/nginx/certs/privkey.pem','/etc/nginx/certs/managed/current/privkey.pem')
  config=config.replace(redirect,'location ^~ /.well-known/acme-challenge/ { root /var/www/acme; default_type text/plain; try_files $uri =404; }\n    location / { return 301 https://$host$request_uri; }')
}
await fs.writeFile(dest,config,{mode:0o644})
console.log('Configuração TLS preparada. Certificados existentes preservados. Nenhum container foi reiniciado.')
