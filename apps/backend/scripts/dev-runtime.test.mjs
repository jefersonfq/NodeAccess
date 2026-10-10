import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { loadDevelopmentEnvironment, checkDevelopmentDatabase, withDevelopmentPool } from './dev-runtime.mjs'

function fixture(t, content) {
  const dir = mkdtempSync(join(tmpdir(), 'nodeaccess-dev-env-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'local.env')
  writeFileSync(path, content)
  return path
}

test('arquivo explícito prevalece sobre Docker herdado sem alterar process.env', t => {
  const path = fixture(t, 'DATABASE_URL=mysql://local:password@127.0.0.1:3306/local\nREDIS_URL=redis://localhost:6379\n')
  const inherited = { NODEACCESS_DEV_ENV_FILE: path, DATABASE_URL: 'mysql://docker:secret@mysql:3306/db', PATH: '/bin' }
  const result = loadDevelopmentEnvironment(inherited)
  assert.equal(new URL(result.DATABASE_URL).hostname, '127.0.0.1')
  assert.equal(result.PATH, '/bin')
  assert.equal(new URL(inherited.DATABASE_URL).hostname, 'mysql')
})
test('arquivo ausente falha sem usar silenciosamente ambiente herdado', () => {
  assert.throws(() => loadDevelopmentEnvironment({ NODEACCESS_DEV_ENV_FILE: '/nonexistent/nodeaccess.env' }), /ausente/)
})
test('arquivo sem DATABASE_URL falha mesmo com URL herdada', t => {
  const path = fixture(t, 'NODE_ENV=development\n')
  assert.throws(() => loadDevelopmentEnvironment({ NODEACCESS_DEV_ENV_FILE: path, DATABASE_URL: 'mysql://localhost/db' }), /Defina DATABASE_URL/)
})
test('URL inválida não expõe conteúdo secreto', () => {
  assert.throws(() => checkDevelopmentDatabase({ DATABASE_URL: 'private-secret' }), error => !error.message.includes('private-secret'))
})
for (const failure of ['ENOTFOUND', 'ECONNREFUSED', 'timeout']) {
  test(`falha ${failure} orienta usuário e fecha socket sem expor credenciais`, async () => {
    const socket = new EventEmitter()
    let destroyed = false
    socket.destroy = () => { destroyed = true }
    socket.setTimeout = () => queueMicrotask(() => failure === 'timeout' ? socket.emit('timeout') : socket.emit('error', { code: failure }))
    await assert.rejects(checkDevelopmentDatabase({ DATABASE_URL: 'mysql://user:private-secret@mysql/db' }, () => socket), error => error.message.includes(failure) && error.message.includes('127.0.0.1') && !error.message.includes('private-secret'))
    assert.equal(destroyed, true)
  })
}
test('conexões concorrentes têm sucesso contra servidor TCP descartável', async () => {
  const server = createServer(socket => socket.end())
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const environment = { DATABASE_URL: `mysql://user:password@127.0.0.1:${server.address().port}/test` }
    await Promise.all(Array.from({ length: 5 }, () => checkDevelopmentDatabase(environment)))
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('pool local limitado por processo sem mutar a entrada', () => {
  const source = { DATABASE_URL: 'mysql://user:secret@localhost/db' }
  const result = withDevelopmentPool(source)
  const params = new URL(result.DATABASE_URL).searchParams
  assert.equal(params.get('connection_limit'), '5')
  assert.equal(params.get('pool_timeout'), '10')
  assert.equal(source.DATABASE_URL, 'mysql://user:secret@localhost/db')
})
test('preserva credenciais escapadas, TLS, socket e parâmetros explícitos inclusive zero', () => {
  const database = 'mysql://u:p%40%23%2F@localhost/db?connection_limit=0&pool_timeout=0&sslaccept=strict&socket=%2Ftmp%2Fmysql.sock'
  const result = withDevelopmentPool({ DATABASE_URL: database, NODEACCESS_DEV_DB_CONNECTION_LIMIT: 'invalid' })
  const before = new URL(database)
  const after = new URL(result.DATABASE_URL)
  assert.equal(after.password, before.password)
  assert.deepEqual([...after.searchParams], [...before.searchParams])
})
test('override local prevalece sobre herdado e é aplicado sem regravar arquivo', t => {
  const path = fixture(t, 'DATABASE_URL=mysql://localhost/db\nNODEACCESS_DEV_DB_CONNECTION_LIMIT=7\nNODEACCESS_DEV_DB_POOL_TIMEOUT=20\n')
  const result = loadDevelopmentEnvironment({ NODEACCESS_DEV_ENV_FILE: path, NODEACCESS_DEV_DB_CONNECTION_LIMIT: '2' })
  const params = new URL(result.DATABASE_URL).searchParams
  assert.equal(params.get('connection_limit'), '7')
  assert.equal(params.get('pool_timeout'), '20')
})
for (const mode of ['production', 'test']) {
  test(`não modifica configuração ${mode}`, () => {
    const source = { NODE_ENV: mode, DATABASE_URL: 'mysql://localhost/db', NODEACCESS_DEV_DB_CONNECTION_LIMIT: 'invalid' }
    assert.deepEqual(withDevelopmentPool(source), source)
  })
}
for (const value of ['0', '-1', '1.5', 'Infinity', '101', '', 'private-secret']) {
  test(`rejeita limite inválido (${value === 'private-secret' ? 'texto' : value}) sem credenciais`, () => {
    assert.throws(() => withDevelopmentPool({ DATABASE_URL: 'mysql://user:private-secret@localhost/db', NODEACCESS_DEV_DB_CONNECTION_LIMIT: value }),
      error => error.message.includes('NODEACCESS_DEV_DB_CONNECTION_LIMIT') && !error.message.includes('private-secret'))
  })
}
test('rejeita timeout e URL inválidos sem revelar valores', () => {
  assert.throws(() => withDevelopmentPool({ DATABASE_URL: 'mysql://localhost/db', NODEACCESS_DEV_DB_POOL_TIMEOUT: '301' }), /POOL_TIMEOUT/)
  assert.throws(() => withDevelopmentPool({ DATABASE_URL: 'private-secret' }), error => !error.message.includes('private-secret'))
})
