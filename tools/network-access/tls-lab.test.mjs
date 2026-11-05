import test from 'node:test'
import assert from 'node:assert/strict'
import { runTlsCoverageLab } from './tls-lab.mjs'

// Explicit opt-in: ordinary unit tests must not provision Docker or contact a DB.
test('real isolated TLS AAA labs produce verified coverage and remove owned resources', {
  skip: process.env.NODEACCESS_TLS_COVERAGE !== 'true', timeout: 900_000,
}, async () => {
  const report = await runTlsCoverageLab()
  assert.equal(report.passed, true)
  assert.equal(report.isolated, true)
  assert.equal(report.cleanupVerified, true)
  assert.deepEqual(report.checks, ['live', 'health', 'soak', 'watchdog'])
  console.log(JSON.stringify(report))
})

test('lab rejects non-loopback publications and invalid opt-in before provisioning', async () => {
  const { loopbackPort } = await import('./tls-lab.mjs')
  assert.equal(loopbackPort('127.0.0.1:49152\n'), 49152)
  for (const value of ['0.0.0.0:3306', '[::]:3306', '127.0.0.1:0', '127.0.0.1:65536']) {
    assert.throws(() => loopbackPort(value), /NON_LOOPBACK_PORT/)
  }
  await assert.rejects(runTlsCoverageLab({}), /OPT_IN_REQUIRED/)
  await assert.rejects(runTlsCoverageLab({ NODEACCESS_TLS_COVERAGE: 'true', NODEACCESS_TLS_COVERAGE_RUN_ID: 'invalid' }), /INVALID_RUN_ID/)
})

test('Docker endpoint resolution rejects remote hosts and pins local context precedence', async () => {
  const { resolveLocalDockerEndpoint, dockerLocalEnvironment } = await import('./tls-lab.mjs')
  const unused = async () => { throw new Error('Unexpected context lookup') }
  for (const host of ['tcp://127.0.0.1:2375', 'ssh://remote', 'npipe:////./pipe/docker_engine',
    'unix://relative/socket', 'unix:///tmp/socket?remote=true', 'unix:///tmp/socket\n', 'invalid']) {
    await assert.rejects(resolveLocalDockerEndpoint({ DOCKER_HOST: host }, unused), /LOCAL_DOCKER_REQUIRED/)
  }
  for (const host of ['unix:///var/run/docker.sock', 'unix:///run/user/1000/docker.sock']) {
    assert.equal(await resolveLocalDockerEndpoint({ DOCKER_HOST: host }, unused), host)
  }
  const calls = []
  const lookup = async name => { calls.push(name); return name === 'remote' ? 'ssh://remote' : 'unix:///run/user/1000/docker.sock' }
  await assert.rejects(resolveLocalDockerEndpoint({ DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'unix:///var/run/docker.sock' }, lookup), /LOCAL_DOCKER_REQUIRED/)
  assert.equal(await resolveLocalDockerEndpoint({ DOCKER_CONTEXT: 'local', DOCKER_HOST: 'tcp://remote:2375' }, lookup), 'unix:///run/user/1000/docker.sock')
  assert.equal(await resolveLocalDockerEndpoint({}, lookup), 'unix:///run/user/1000/docker.sock')
  await assert.rejects(resolveLocalDockerEndpoint({}, async () => 'tcp://remote:2375'), /LOCAL_DOCKER_REQUIRED/)
  assert.deepEqual(calls, ['remote', 'local', undefined])
  assert.deepEqual(dockerLocalEnvironment({ PATH: '/usr/bin', HOME: '/tmp/home', DOCKER_CONFIG: '/tmp/config',
    DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'ssh://remote', DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: '/tmp/certs' }),
  { PATH: '/usr/bin', HOME: '/tmp/home', DOCKER_CONFIG: '/tmp/config' })
})
