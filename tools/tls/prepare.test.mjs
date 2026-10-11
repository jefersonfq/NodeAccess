import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec=promisify(execFile)
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nodeaccess-tls-prepare-'))
  t.after(()=>fs.rm(dir,{recursive:true,force:true}))
  const certs=path.join(dir,'certs'),dest=path.join(dir,'nginx.conf')
  await fs.mkdir(certs)
  const prepare=(overrides={})=>exec(process.execPath,['tools/tls/prepare.mjs'],{env:{...process.env,TLS_DOMAIN:'tls.example.test',TLS_EXTERNAL:'false',CERTS_DIR:certs,NGINX_SOURCE:path.resolve('docker/nginx.https.conf'),NGINX_DEST:dest,...overrides}})
  return {dir,certs,dest,prepare}
}
test('preparation preserves existing files, is idempotent and enables HTTP-01',async t=>{
  const {certs,dest,prepare}=await fixture(t)
  // File migration is tested here; cryptographic validity is covered by real integration.
  await fs.writeFile(path.join(certs,'fullchain.pem'),'existing certificate')
  await fs.writeFile(path.join(certs,'privkey.pem'),'existing key')
  await prepare();await prepare()
  assert.equal(await fs.readFile(path.join(certs,'fullchain.pem'),'utf8'),'existing certificate')
  assert.equal(await fs.readFile(path.join(certs,'managed/current/privkey.pem'),'utf8'),'existing key')
  assert.equal((await fs.stat(path.join(certs,'managed/current/privkey.pem'))).mode&0o777,0o600)
  const config=await fs.readFile(dest,'utf8')
  assert.ok(config.includes('/etc/nginx/certs/managed/current/fullchain.pem'))
  assert.ok(config.includes('location ^~ /.well-known/acme-challenge/'))
  assert.ok(config.includes('location / { return 301 https://$host$request_uri; }'))
})
test('partial certificate pair is never overwritten with bootstrap material',async t=>{
  const {certs,prepare}=await fixture(t)
  await fs.writeFile(path.join(certs,'fullchain.pem'),'valuable existing certificate')
  await assert.rejects(prepare(),e=>e.stderr.includes('Par de certificados incompleto'))
  assert.equal(await fs.readFile(path.join(certs,'fullchain.pem'),'utf8'),'valuable existing certificate')
  await assert.rejects(fs.access(path.join(certs,'privkey.pem')),{code:'ENOENT'})
})
test('incompatible Nginx config fails before writing certificates',async t=>{
  const {dir,certs,prepare}=await fixture(t),source=path.join(dir,'incompatible.conf')
  await fs.writeFile(source,'http {}')
  await assert.rejects(prepare({NGINX_SOURCE:source}))
  assert.deepEqual(await fs.readdir(certs),[])
})
test('external mode preserves HTTP config and does not create local certificates',async t=>{
  const {certs,dest,prepare}=await fixture(t),source=path.resolve('docker/nginx.http.conf')
  await prepare({TLS_EXTERNAL:'true',NGINX_SOURCE:source})
  assert.equal(await fs.readFile(dest,'utf8'),await fs.readFile(source,'utf8'))
  assert.deepEqual(await fs.readdir(certs),[])
})
