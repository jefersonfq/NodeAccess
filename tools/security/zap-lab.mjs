import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { artifactPath } from '../shared/private-artifacts.cjs'
import { resolveExecutable } from '../shared/trusted-executable.cjs'
import { createZapProcessRunner } from './zap-process.mjs'
import { assertZapTarget, summarizeZapReport, zapTarget } from './zap-policy.mjs'

function ownedResourceIds(output) {
  const ids = new Set(output.split(/\s+/).filter(Boolean))
  for (const id of ids) {
    if (!/^(?:sha256:)?[a-f0-9]{12,64}$/.test(id)) throw new Error('Invalid owned resource ID')
  }
  return ids
}

export async function runZapLab({ root = resolve(import.meta.dirname, '../..'), output = resolve(root, 'artifacts/security/zap'), processRunner, pause = ms => new Promise(done => setTimeout(done, ms)) } = {}) {
assertZapTarget(zapTarget)
const policy = JSON.parse(readFileSync(resolve(root, 'security/zap-image.json'), 'utf8'))
if (!/^zaproxy\/zap-stable@sha256:[a-f0-9]{64}$/.test(policy.image)) throw new Error('ZAP image must have an immutable official digest')
const dockerBin = resolveExecutable('docker')
const prefix = `na-zap-${randomBytes(6).toString('hex')}`
let privateDir
mkdirSync(output, { recursive: true, mode: 0o700 })
const lockPath = resolve(output, '.lock')
const lock = openSync(lockPath, 'wx', 0o600)
closeSync(lock)
const secrets = []
const report = { schemaVersion: 1, passed: false, startedAt: new Date().toISOString(), scope: 'Passive HTTP inspection of a disposable NodeAccess stack; no active scan, SSH or WebSocket assessment', cleanup: 'pending', images: {} }
let stage = 'configuration'
const runner = processRunner ?? createZapProcessRunner({ cwd: root })
const cancel = () => runner.cancel()
process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
const command = runner.run
const docker = (args, options) => command(dockerBin, args, options)
async function until(action, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    if (runner.cancelled) throw new Error('ZAP execution cancelled')
    try { return await action() } catch { if (runner.cancelled) throw new Error('ZAP execution cancelled'); if (i === attempts - 1) throw new Error(`Readiness deadline at ${stage}`); await pause(1000) }
  }
}
async function start(role, image, args = [], entry = []) {
  const name = `${prefix}-${role}`
  await docker(['create', '--name', name, '--network', prefix, '--network-alias', role, '--label', `nodeaccess.zap=${prefix}`,
    '--cpus', '2', '--memory', role === 'scanner' ? '2g' : '1g', ...args, image, ...entry])
  await docker(['start', name])
  return name
}
async function build(role, dockerfile, target) {
  stage = `build-${role}`
  const image = `${prefix}-${role}:candidate`
  await docker(['build', '-f', dockerfile, '--target', target, '--label', `nodeaccess.zap=${prefix}`, '-t', image, '.'], { timeout: 900_000, maxBuffer: 64 * 1024 * 1024 })
  report.images[role] = { id: await docker(['image', 'inspect', '--format', '{{.Id}}', image]), builtFromCandidate: true }
  return image
}
try {
  privateDir = mkdtempSync(resolve(tmpdir(), `${prefix}-`))
  report.sourceSha = await command(resolveExecutable('git'), ['rev-parse', 'HEAD'])
  report.includesWorkingTree = Boolean(await command(resolveExecutable('git'), ['status', '--porcelain', '--untracked-files=normal']))
  const backend = await build('backend', 'docker/backend.Dockerfile', 'runtime')
  const frontend = await build('frontend', 'docker/frontend.Dockerfile', 'prod')
  const mysqlImage = await build('mysql', 'docker/state.Dockerfile', 'mysql')
  const redisImage = await build('redis', 'docker/state.Dockerfile', 'redis')
  stage = 'scanner-image'
  await docker(['pull', policy.image], { timeout: 300_000 })
  report.images.scanner = { ref: policy.image, id: await docker(['image', 'inspect', '--format', '{{.Id}}', policy.image]) }
  stage = 'network'
  await docker(['network', 'create', '--internal', '--label', `nodeaccess.zap=${prefix}`, prefix])
  assert.equal(await docker(['network', 'inspect', '--format', '{{.Internal}}', prefix]), 'true')
  const password = randomBytes(24).toString('hex'), jwt = randomBytes(32).toString('hex')
  secrets.push(password, jwt)
  const mysql = await start('mysql', mysqlImage, ['-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', 'MYSQL_DATABASE=zap_test', '-e', 'MYSQL_USER=zap_app', '-e', `MYSQL_PASSWORD=${password}`], ['--innodb-buffer-pool-size=128M', '--max-connections=40'])
  await start('redis', redisImage)
  stage = 'database-readiness'
  await until(() => docker(['exec', mysql, 'mysql', '--protocol=TCP', '-h127.0.0.1', '-uzap_app', `-p${password}`, '-Dzap_test', '-e', 'SELECT 1']), 120)
  const env = ['-e', `DATABASE_URL=mysql://zap_app:${password}@mysql:3306/zap_test`, '-e', 'REDIS_URL=redis://redis:6379', '-e', `JWT_SECRET=${jwt}`, '-e', `PEM_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`, '-e', 'APP_URL=https://web', '-e', 'SESSION_AUDIT_STORAGE_DIR=/tmp/nodeaccess-zap-audit']
  stage = 'migrations'
  const migration = `${prefix}-migration`
  await docker(['create', '--name', migration, '--label', `nodeaccess.zap=${prefix}`, '--network', prefix, '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp', ...env, backend, 'node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'])
  await docker(['start', '-a', migration])
  assert.equal(await docker(['inspect', '--format', '{{.State.ExitCode}}', migration]), '0')
  stage = 'api'
  const api = await start('api', backend, ['--network-alias', 'ssh-gateway', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', ...env, '-e', 'APP_MODE=api'])
  await until(() => docker(['exec', api, 'node', '-e', "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]))
  stage = 'fixture'
  const seed = `const fs=require('node:fs');const {PrismaClient}=require('@prisma/client');const bcrypt=require('bcrypt');const s=require('speakeasy');(async()=>{const p=new PrismaClient();try{const input=JSON.parse(fs.readFileSync(0,'utf8'));const t=await p.tenant.create({data:{name:'ZAP disposable',slug:input.slug}});const mfaSecret=s.generateSecret({length:20}).base32;await p.user.create({data:{tenantId:t.id,name:'ZAP disposable',email:'zap@example.invalid',passwordHash:bcrypt.hashSync(input.password,6),role:'ADMIN',mfaEnabled:true,mfaSecret}});process.stdout.write(JSON.stringify({email:'zap@example.invalid',slug:t.slug,password:input.password,mfaSecret}));}finally{await p.$disconnect()}})().catch(()=>process.exit(1));`
  const fixture = JSON.parse(await docker(['exec', '-i', api, 'node', '-e', seed], { input: JSON.stringify({ slug: prefix, password }) }))
  secrets.push(fixture.mfaSecret)
  stage = 'certificates'
  await command(resolveExecutable('openssl'), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=web', '-addext', 'subjectAltName=DNS:web', '-keyout', resolve(privateDir, 'privkey.pem'), '-out', resolve(privateDir, 'fullchain.pem')])
  await start('web', frontend, ['-v', `${privateDir}:/etc/nginx/certs:ro`])
  stage = 'scanner'
  const scanner = await start('scanner', policy.image, ['-v', `${resolve(root, 'tools/security/zap-driver.py')}:/zap/wrk/driver.py:ro`], ['zap.sh', '-Xmx1024m', '-daemon', '-host', '127.0.0.1', '-port', '8080', '-config', 'api.disablekey=true', '-config', 'autoupdate.checkOnStart=false', '-config', 'autoupdate.downloadNewRelease=false', '-config', 'autoupdate.installAddonUpdates=false', '-config', 'database.recoverylog=false'])
  stage = 'passive-inspection'
  const result = await docker(['exec', '-i', scanner, 'python3', '/zap/wrk/driver.py'], { input: JSON.stringify(fixture), timeout: 420_000 })
  const parsed = summarizeZapReport(JSON.parse(result))
  Object.assign(report, parsed)
  if (!parsed.passed) report.failure = 'Unreviewed Medium/High alerts'
} catch (error) {
  report.passed = false
  report.failure = secrets.reduce((value, secret) => value.replaceAll(secret, '[redacted]'), String(error.message)).slice(0, 300)
  report.failedStage = stage
  if (error.privateDiagnostic) writeFileSync(artifactPath(`${prefix}-failure.log`), secrets.reduce((value, secret) => value.replaceAll(secret, '[redacted]'), error.privateDiagnostic), { mode: 0o600 })
  if (Number.isInteger(error.exitCode)) report.commandExitCode = error.exitCode
} finally {
  stage = 'cleanup'
  runner.beginCleanup()
  const failed = []
  for (const [kind, list, remove] of [
    ['container', ['ps', '-aq'], ['rm', '-f', '-v']],
    ['network', ['network', 'ls', '-q'], ['network', 'rm']],
    ['image', ['image', 'ls', '-q'], ['image', 'rm']],
  ]) {
    try {
      const owned = await docker([...list, '--filter', `label=nodeaccess.zap=${prefix}`], { timeout: 10_000 })
      for (const id of ownedResourceIds(owned)) {
        await docker([...remove, id], { timeout: 10_000 })
      }
    } catch { failed.push(kind) }
  }
  if (privateDir) rmSync(privateDir, { recursive: true, force: true })
  unlinkSync(lockPath)
  runner.dispose()
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel)
  report.cancelled = runner.cancelled
  report.cleanup = failed.length ? 'failed' : 'complete'
  if (failed.length || runner.cancelled) report.passed = false
  report.finishedAt = new Date().toISOString()
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
}
return report
}
