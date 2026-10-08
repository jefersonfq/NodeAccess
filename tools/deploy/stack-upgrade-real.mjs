/** Opt-in. Creates only random, labelled disposable Docker resources; never uses .env. */
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { Redis } from 'ioredis'
import bcrypt from 'bcrypt'

if (process.env.RUN_STACK_UPGRADE_REAL !== 'true') throw Error('Set RUN_STACK_UPGRADE_REAL=true for disposable Docker tests')
const root = resolve(import.meta.dirname, '../..')
const images = JSON.parse(readFileSync(resolve(root, 'docker/stack-images.json')))
const prefix = `na-stack-test-${randomBytes(6).toString('hex')}`
const password = randomBytes(24).toString('hex')
Object.assign(process.env, { DATABASE_URL: 'mysql://unused:unused@127.0.0.1:1/unused', REDIS_URL: 'redis://127.0.0.1:1',
  JWT_SECRET: randomBytes(32).toString('hex'), PEM_ENCRYPTION_KEY: randomBytes(32).toString('hex'), NODE_ENV: 'test' })
const { encrypt, decrypt } = await import('../../apps/backend/src/shared/crypto.ts')
const resources = { containers: new Set(), volumes: new Set() }
const report = { passed: false, images, checks: [], versions: {} }
const output = resolve(process.env.STACK_TEST_OUTPUT || '/tmp/nodeaccess-stack-upgrade')
mkdirSync(output, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 240_000, maxBuffer: 64 * 1024 * 1024, ...options })
}
const docker = (args, options) => run('docker', args, options)
const sql = (name, query) => docker(['exec', '-e', `MYSQL_PWD=${password}`, name, 'mysql', '--protocol=socket', '-uroot', '-N', '-B', '-e', query]).trim()
function volume(suffix) {
  const name = `${prefix}-${suffix}`
  docker(['volume', 'create', '--label', `nodeaccess.stack-test=${prefix}`, name])
  resources.volumes.add(name); return name
}
function stop(name) { docker(['rm', '-f', name]); resources.containers.delete(name) }
async function mysql(suffix, image, vol) {
  const name = `${prefix}-${suffix}`
  const upgraded = image === images.mysql
  docker(['run', '-d', '--name', name, '--label', `nodeaccess.stack-test=${prefix}`, '--memory', '1g',
    '-p', '127.0.0.1::3306', '-v', `${vol}:/var/lib/mysql`,
    ...(upgraded ? ['-v', `${root}/docker/mysql/include.cnf:/etc/mysql/nodeaccess.cnf:ro`, '-v', `${root}/docker/mysql/conf.d:/etc/mysql/conf.d:ro`] : []),
    '-e', `MYSQL_ROOT_PASSWORD=${password}`, '-e', 'MYSQL_ROOT_HOST=%', '-e', 'MYSQL_DATABASE=stack_test',
    '-e', 'MYSQL_USER=stack_app', '-e', `MYSQL_PASSWORD=${password}`, image,
    ...(upgraded ? ['--defaults-extra-file=/etc/mysql/nodeaccess.cnf'] : []),
    '--innodb-buffer-pool-size=128M', '--innodb-buffer-pool-instances=1', '--max-connections=80'])
  resources.containers.add(name)
  for (let i = 0; i < 100; i++) {
    if (docker(['inspect', '--format', '{{.State.Running}}', name]).trim() !== 'true') {
      writeFileSync(resolve(output, `${suffix}-failure.log`), docker(['logs', name]).replaceAll(password, '[disposable]'))
      throw Error(`MySQL exited before readiness: ${name}; log saved in ${output}`)
    }
    try {
      sql(name, 'SELECT 1')
      const port = docker(['port', name, '3306/tcp']).trim().split(':').at(-1)
      // Both vendors briefly expose only a bootstrap socket; wait for real TCP as well.
      const url = `mysql://stack_app:${password}@127.0.0.1:${port}/stack_test`
      const db = new PrismaClient({ datasources: { db: { url } } })
      try { await db.$queryRaw`SELECT 1`; return { name, url } } finally { await db.$disconnect() }
    } catch { await sleep(1000) }
  }
  throw Error(`MySQL readiness deadline: ${name}; inspect docker logs`)
}
function migrate(url) {
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/backend/prisma/schema.prisma'], {
    env: { ...process.env, DATABASE_URL: url }, timeout: 240_000,
  })
}
let expected, hostId
async function contract(url, seed = false) {
  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    if (seed) {
      const tenant = await db.tenant.create({ data: { name: 'Migração 日本語 ação 🔒', slug: prefix } })
      const user = await db.user.create({ data: { tenantId: tenant.id, name: 'Compatibility', email: 'lab@example.invalid',
        passwordHash: await bcrypt.hash(password, 6), preferencesJson: { nested: { unicode: 'ação 日本語', enabled: true }, items: [1, 2] } } })
      const host = await db.host.create({ data: { tenantId: tenant.id, ownerId: user.id, name: 'Disposable SSH', ip: '192.0.2.1', sshUser: 'lab', authType: 'PASSWORD', scope: 'PERSONAL' } })
      hostId = host.id
      const payload = encrypt('segredo de teste 日本語 🔒')
      await db.secret.create({ data: { tenantId: tenant.id, alias: 'Migration fixture', encryptedValue: payload.encrypted, iv: payload.iv } })
    }
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: prefix }, include: { users: true, hosts: true } })
    assert(await bcrypt.compare(password, tenant.users[0].passwordHash))
    assert.equal(tenant.hosts[0].id, hostId)
    assert.equal(tenant.users[0].preferencesJson.nested.unicode, 'ação 日本語')
    const secret = await db.secret.findFirstOrThrow({ where: { tenantId: tenant.id, alias: 'Migration fixture' } })
    assert.equal(decrypt({ encrypted: secret.encryptedValue, iv: secret.iv }), 'segredo de teste 日本語 🔒')
    const snapshot = JSON.stringify(tenant)
    if (seed) expected = snapshot; else assert.equal(snapshot, expected, 'All seeded values, relations and timestamps survive')
    await assert.rejects(db.$transaction(async tx => {
      await tx.host.update({ where: { id: hostId }, data: { name: 'must roll back' } }); throw Error('rollback test')
    }), /rollback test/)
    assert.equal((await db.host.findUniqueOrThrow({ where: { id: hostId } })).name, 'Disposable SSH')
    await assert.rejects(db.tenant.create({ data: { name: 'Duplicate', slug: prefix } }), error => error.code === 'P2002')
    await assert.rejects(db.host.create({ data: { tenantId: 2147483647, name: 'Invalid FK', ip: '192.0.2.2', sshUser: 'lab', authType: 'PASSWORD', scope: 'GLOBAL' } }), error => error.code === 'P2003')
    const invalid = await db.$queryRaw`SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`
    assert.equal(Number(invalid[0].n), 0)
    report.checks.push({ databaseContract: seed ? 'baseline' : 'migrated/restored', passed: true })
  } finally { await db.$disconnect() }
}
function fingerprint(name) {
  const tables = sql(name, "SELECT table_name FROM information_schema.tables WHERE table_schema='stack_test' ORDER BY table_name").split('\n')
  const rows = sql(name, tables.map(table => `SELECT '${table}', COUNT(*) FROM stack_test.\`${table}\``).join(' UNION ALL '))
  return createHash('sha256').update(rows).digest('hex')
}
async function redis(nameSuffix, image, vol) {
  const name = `${prefix}-${nameSuffix}`
  docker(['run', '-d', '--name', name, '--label', `nodeaccess.stack-test=${prefix}`, '-p', '127.0.0.1::6379',
    '-v', `${vol}:/data`, image, 'redis-server', '--appendonly', 'yes'])
  resources.containers.add(name)
  const port = docker(['port', name, '6379/tcp']).trim().split(':').at(-1)
  const client = new Redis(`redis://127.0.0.1:${port}`, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000 })
  client.on('error', () => {})
  await client.connect(); return { name, client }
}
try {
  console.log('[stack] MySQL 8.0 baseline, migrations and application data')
  const vol = volume('mysql'), baseline = await mysql('mysql80', 'mysql:8.0', vol)
  report.versions.mysqlBefore = sql(baseline.name, 'SELECT VERSION()')
  migrate(baseline.url); await contract(baseline.url, true)
  const before = fingerprint(baseline.name)
  // Reproduce the historical installer and exercise the actual replacement script.
  sql(baseline.name, `ALTER USER 'stack_app'@'%' IDENTIFIED WITH mysql_native_password BY '${password}'`)
  assert.equal(sql(baseline.name, "SELECT plugin FROM mysql.user WHERE User='stack_app'"), 'mysql_native_password')
  docker(['exec', '-i', baseline.name, 'sh', '-s'], { input: readFileSync(resolve(root, 'scripts/deploy/configure-mysql-auth.sh'), 'utf8') })
  assert.equal(sql(baseline.name, "SELECT plugin FROM mysql.user WHERE User='stack_app'"), 'caching_sha2_password')
  await contract(baseline.url)
  const dump = docker(['exec', '-e', `MYSQL_PWD=${password}`, baseline.name, 'mysqldump', '-uroot', '--single-transaction', '--quick',
    '--no-tablespaces', '--set-gtid-purged=OFF', '--routines', '--triggers', '--events', '--hex-blob', 'stack_test'])
  const zipped = gzipSync(dump); writeFileSync(resolve(output, 'disposable-backup.sql.gz'), zipped, { mode: 0o600 })
  report.backupSha256 = createHash('sha256').update(zipped).digest('hex')
  stop(baseline.name)
  console.log('[stack] Upgrade existing disposable volume to MySQL 8.4')
  const upgraded = await mysql('mysql84', images.mysql, vol)
  report.versions.mysqlAfter = sql(upgraded.name, 'SELECT VERSION()')
  assert.match(report.versions.mysqlAfter, /^8\.4\.12/)
  assert.equal(sql(upgraded.name, 'SELECT @@transaction_isolation'), 'READ-COMMITTED', 'Mounted NodeAccess configuration is loaded')
  assert.equal(fingerprint(upgraded.name), before); migrate(upgraded.url); await contract(upgraded.url)
  report.checks.push({ physicalUpgrade: '8.0 -> 8.4', migrationIdempotency: true, allTableCountsPreserved: true })
  stop(upgraded.name)
  for (const [label, image] of [['restore84', images.mysql], ['rollback80', 'mysql:8.0']]) {
    console.log(`[stack] Logical backup restore into separate ${label} volume`)
    const restored = await mysql(label, image, volume(label))
    docker(['exec', '-i', '-e', `MYSQL_PWD=${password}`, restored.name, 'mysql', '-uroot', 'stack_test'], { input: gunzipSync(zipped) })
    assert.equal(fingerprint(restored.name), before); await contract(restored.url)
    report.checks.push({ restore: label, allTableCountsPreserved: true, passed: true }); stop(restored.name)
  }
  console.log('[stack] Redis persisted state upgrade and command contracts')
  const rv = volume('redis'), old = await redis('redis7', 'redis:7-alpine', rv)
  await old.client.set('stack:persist', 'ação 日本語'); await old.client.set('stack:ttl', 'temporary', 'EX', 300)
  await old.client.hset('stack:hash', 'user', '42'); await old.client.zadd('stack:zset', 1, 'session')
  await old.client.save(); await old.client.quit(); docker(['stop', old.name]); stop(old.name)
  const next = await redis('redis8', images.redis, rv), client = next.client
  assert.equal(await client.get('stack:persist'), 'ação 日本語'); assert((await client.ttl('stack:ttl')) > 0)
  assert.equal(await client.hget('stack:hash', 'user'), '42'); assert.deepEqual(await client.zrange('stack:zset', 0, -1), ['session'])
  assert.equal(await client.set('stack:lock', 'owner', 'PX', 1000, 'NX'), 'OK')
  assert.equal(await client.set('stack:lock', 'other', 'PX', 1000, 'NX'), null)
  assert.equal(await client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, 'stack:lock', 'other'), 0)
  assert.equal(await client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", 1, 'stack:lock', 'owner'), 1)
  const sub = client.duplicate(); await sub.subscribe('stack:events')
  const message = new Promise(resolve => sub.once('message', (_channel, body) => resolve(body)))
  await client.publish('stack:events', 'event'); assert.equal(await Promise.race([message, sleep(3000).then(() => 'timeout')]), 'event')
  await sub.quit(); report.versions.redisAfter = (await client.info('server')).match(/redis_version:([^\r\n]+)/)[1]
  await client.quit(); report.checks.push({ redis: 'AOF/RDB, TTL, hashes, sorted sets, atomic locks, Lua and pubsub', passed: true })
  report.passed = true
} catch (error) {
  report.error = error.message.replaceAll(password, '[disposable]')
  throw error
} finally {
  writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  for (const name of resources.containers) try { docker(['rm', '-f', name]) } catch { /* cleanup owned resources only */ }
  for (const name of resources.volumes) try { docker(['volume', 'rm', name]) } catch { /* no prune */ }
}
console.log(JSON.stringify(report, null, 2))
