/** Opt-in ownership migration on one disposable volume; never loads .env. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

if (process.env.RUN_NONROOT_REAL !== 'true') throw new Error('Set RUN_NONROOT_REAL=true for isolated volume tests')
const root = resolve(import.meta.dirname, '../..')
const image = process.env.STACK_BACKEND_IMAGE || 'nodeaccess-backend:security-local'
const volume = `na-nonroot-${randomBytes(8).toString('hex')}`
const temporary = mkdtempSync(resolve(tmpdir(), 'na-nonroot-'))
const output = resolve(process.env.NONROOT_OUTPUT || '/tmp/nodeaccess-nonroot-report.json')
const report = { passed: false, image, runnerUid: process.getuid(), checks: [] }
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const base = ['run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '-v', `${volume}:/migration`]
const owner = [...base, '--user', '0:0', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '-v', `${temporary}:/state`, '-v', `${root}/scripts/deploy/runtime-permissions.mjs:/maintenance.mjs:ro`]
const node = (user, script) => docker([...base, '--user', user, image, 'node', '-e', script])
// Inventory is intentionally root-owned 0600. Read only its test state in an
// isolated reader; never relax permissions to accommodate an unprivileged CI.
const inventoryState = () => {
  if (process.getuid() !== 0) assert.throws(() => readFileSync(resolve(temporary, 'permissions.json')), { code: 'EACCES' })
  return docker(['run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
    '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges:true',
    '-v', `${temporary}:/state:ro`, image, 'node', '-e',
    `const fs=require('fs'),assert=require('assert/strict');const file='/state/permissions.json';const stat=fs.statSync(file);assert.equal(stat.uid,0);assert.equal(stat.mode&511,384);console.log(JSON.parse(fs.readFileSync(file,'utf8')).state)`])
}

try {
  docker(['volume', 'create', '--label', 'nodeaccess.disposable=nonroot', volume])
  node('0:0', `const fs=require('fs'),crypto=require('crypto');fs.mkdirSync('/migration/audit',{mode:448});fs.writeFileSync('/migration/audit/record.json','preserve audit',{mode:384});const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});fs.writeFileSync('/migration/host-key',pair.privateKey,{mode:384});`)
  const snapshot = `const fs=require('fs'),c=require('crypto');console.log(JSON.stringify(['','/audit','/audit/record.json','/host-key'].map(p=>{const s=fs.statSync('/migration'+p);return {path:p,uid:s.uid,gid:s.gid,mode:s.mode&511,hash:s.isFile()?c.createHash('sha256').update(fs.readFileSync('/migration'+p)).digest('hex'):null}})))`
  const before = JSON.parse(node('0:0', snapshot))
  node('1000:1000', `try{require('fs').readFileSync('/migration/host-key');process.exit(1)}catch(e){if(e.code!=='EACCES')throw e}`)
  report.checks.push('Old root-owned host key denied to UID1000 before preparation')
  docker([...owner, image, 'node', '/maintenance.mjs', 'prepare'])
  assert.equal(inventoryState(), 'applied')
  report.checks.push('Root-owned 0600 inventory remains private and is inspected through a read-only isolated container')
  node('1000:1000', `const fs=require('fs');if(process.getuid()!==1000)throw Error('UID');if(fs.readFileSync('/migration/audit/record.json','utf8')!=='preserve audit')throw Error('content');const key=require('ssh2').utils.parseKey(fs.readFileSync('/migration/host-key'));if(key instanceof Error)throw key;fs.writeFileSync('/migration/new-avatar.json','new data',{mode:384});fs.writeFileSync('/migration/audit/new.json','new audit',{mode:384});`)
  report.checks.push('UID1000 reads audit and parses native SSH private key, writes avatar and audit data with all capabilities dropped')
  assert.throws(() => docker([...owner, image, 'node', '/maintenance.mjs', 'prepare']))
  report.checks.push('Existing recovery inventory cannot be overwritten')
  docker([...owner, image, 'node', '/maintenance.mjs', 'restore'])
  assert.deepEqual(JSON.parse(node('0:0', snapshot)), before)
  node('0:0', `const fs=require('fs');if(fs.readFileSync('/migration/new-avatar.json','utf8')!=='new data')throw Error('new file lost');if(fs.statSync('/migration/new-avatar.json').uid!==0)throw Error('new file must inherit original parent owner');if(fs.readFileSync('/migration/audit/new.json','utf8')!=='new audit')throw Error('new audit lost')`)
  assert.equal(inventoryState(), 'restored')
  report.checks.push('Rollback restores every original owner/mode/content hash and preserves new data')
  report.passed = true
} catch (error) {
  report.error = error.message.split('\n')[0]
  process.exitCode = 1
} finally {
  try { docker(['volume', 'rm', volume]) } catch { /* only our disposable volume */ }
  rmSync(temporary, { recursive: true, force: true })
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
