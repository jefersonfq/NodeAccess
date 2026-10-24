import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Provider, cidr, rules } from './provider.mjs'
const config = { networkCidr: '10.207.68.0/24', maxActiveTrials: 2, controls: ['gateway', 'api'], image: 'trial:test' }
const profile = { templateId: 'alpine-ssh-v1', machineCount: 1, networkCidr: config.networkCidr, maxSessions: 2 }
async function fixture(t, run = () => { throw Error('UNEXPECTED_COMMAND') }) {
  const stateDir = await mkdtemp(join(tmpdir(), 'na-trial-unit-'))
  t.after(() => rm(stateDir, { recursive: true, force: true }))
  return new Provider({ ...config, stateDir }, run)
}
test('CIDR allocator only accepts canonical private networks with room for controls and lab', () => {
  assert.deepEqual(cidr('10.207.68.0/28'), { start: 181355520, end: 181355535 })
  for (const value of ['0.0.0.0/0', '8.8.8.0/24', '10.0.0.1/24', '10.0.0.0/30', '10.0.999.0/24', '10.0.0.0/24/1']) assert.throws(() => cidr(value))
})
test('firewall permits only control initiated SSH and established replies, blocks host and subnet', () => {
  const entries = rules({ id: randomUUID(), subnet: '10.207.68.0/29', controlIps: ['10.207.68.2', '10.207.68.3'], hostIp: '10.207.68.4' })
  assert.equal(entries.length, 8)
  assert.equal(entries.filter(([chain]) => chain === 'DOCKER-USER').length, 6)
  assert.ok(entries[1][1].includes('ESTABLISHED'))
  assert.ok(!JSON.stringify(entries).includes('RELATED'))
  assert.deepEqual(entries.slice(-2).map(([chain, args]) => [chain, args.slice(0, 4)]), [['INPUT', ['-s', '10.207.68.0/29', '-j', 'DROP']], ['OUTPUT', ['-d', '10.207.68.0/29', '-j', 'DROP']]])
})
test('invalid template, quotas and fields never invoke Docker', async t => {
  const provider = await fixture(t)
  for (const changes of [{ templateId: 'arbitrary' }, { machineCount: 2 }, { maxSessions: 3 }, { networkCidr: '10.0.0.0/24' }, { image: 'evil' }]) await assert.rejects(provider.ensure(randomUUID(), { ...profile, ...changes }), /INVALID_PROFILE/)
})
test('DELETE before PUT leaves durable tombstone and never resurrects a trial after restart', async t => {
  const provider = await fixture(t), id = randomUUID()
  assert.equal((await provider.remove(id)).state, 'removed')
  const restarted = new Provider(provider.config, provider.run)
  assert.equal((await restarted.ensure(id, profile)).state, 'removed')
  assert.equal((await restarted.remove(id)).state, 'removed')
  assert.deepEqual(JSON.parse(await readFile(join(provider.config.stateDir, `${id}.json`))), { id, phase: 'removed' })
})
test('Docker inspection error cannot become false deletion confirmation', async t => {
  const provider = await fixture(t, async () => { throw Error('DOCKER_TIMEOUT') }), id = randomUUID()
  await provider.save({ id, phase: 'ready', container: 'owned', network: 'owned' })
  await assert.rejects(provider.remove(id), /DOCKER_TIMEOUT/)
  assert.equal((await provider.load(id)).phase, 'removing')
  await assert.rejects(provider.ensure(id, profile), /REMOVAL_PENDING/)
})
test('foreign container with colliding name is never deleted', async t => {
  const calls = [], provider = await fixture(t, async (file, args) => { calls.push([file, args]); return JSON.stringify([{ Config: { Labels: { 'io.nodeaccess.trial': 'other' } } }]) }), id = randomUUID()
  await provider.save({ id, phase: 'ready', container: 'foreign' })
  await assert.rejects(provider.remove(id), /OWNERSHIP_MISMATCH/)
  assert.equal(calls.length, 1)
  assert.equal((await provider.load(id)).phase, 'removing')
})
test('allocation skips overlapping Docker networks and persisted labs', async t => {
  const provider = await fixture(t, async (_file, args) => args[1] === 'ls' ? 'existing' : JSON.stringify([{ IPAM: { Config: [{ Subnet: '10.207.68.0/29' }] } }]))
  const first = await provider.allocate(randomUUID(), profile), second = await provider.allocate(randomUUID(), profile)
  assert.equal(first.subnet, '10.207.68.16/28')
  assert.equal(second.subnet, '10.207.68.32/28')
  assert.equal(first.machines[0].hostIp, '10.207.68.20')
  assert.notEqual(first.machines[0].password, second.machines[0].password)
  await assert.rejects(provider.allocate(randomUUID(), profile), /CAPACITY/)
})
test('serialized errors do not block subsequent cleanup operations', async t => {
  const provider = await fixture(t), id = randomUUID()
  const results = await Promise.allSettled([provider.ensure(id, { ...profile, machineCount: 3 }), provider.remove(id)])
  assert.deepEqual(results.map(r => r.status), ['rejected', 'fulfilled'])
})
test('incremental provisioning preserves existing credentials through partial failure and retry', async t => {
  const provider = await fixture(t), id = randomUUID()
  provider.config.maxMachinesPerTrial = 3
  provider.preflight = () => Promise.resolve()
  provider.filter = () => Promise.resolve()
  provider.inspect = () => Promise.resolve({ Internal: true, Driver: 'bridge', Options: { 'com.docker.network.bridge.enable_icc': 'false' }, EnableIPv6: false, Labels: { 'io.nodeaccess.trial': id }, IPAM: { Config: [{ Subnet: '10.207.68.0/28' }] } })
  provider.run = async (_file, args) => {
    if (args[0] === 'network' && args[1] === 'ls') return ''
    if (args[0] === 'inspect') return JSON.stringify([{ NetworkSettings: { Networks: { [`na-trial-${id}`]: { IPAddress: args[1] === 'gateway' ? '10.207.68.2' : '10.207.68.3' } } } }])
    throw Error('UNEXPECTED_MUTATION')
  }
  const host = state => ({ ip: state.hostIp, password: state.password, keyDir: state.keyDir })
  provider.prepareMachine = state => Promise.resolve(host(state))
  const first = await provider.ensure(id, profile)
  let fail = true
  provider.prepareMachine = state => state.container.endsWith('-1') && fail ? Promise.reject(Error('SECOND_MACHINE_FAILED')) : Promise.resolve(host(state))
  await assert.rejects(provider.ensure(id, { ...profile, machineCount: 2 }), /SECOND_MACHINE_FAILED/)
  const partial = await provider.load(id)
  assert.equal(partial.phase, 'preparing')
  assert.equal(partial.machines.length, 2)
  assert.deepEqual(host(partial.machines[0]), first.hosts[0])
  fail = false
  const expanded = await provider.ensure(id, { ...profile, machineCount: 2 })
  assert.equal(expanded.hosts.length, 2)
  assert.deepEqual(expanded.hosts[0], first.hosts[0])
  assert.deepEqual(expanded.hosts[1], host(partial.machines[1]))
  await assert.rejects(provider.ensure(id, profile), /MACHINE_COUNT_DECREASE/)
  await assert.rejects(provider.ensure(id, { ...profile, machineCount: 3 }), /MACHINE_CAPACITY/)
  assert.equal((await provider.load(id)).machines.length, 2)
})

test('machine policy requires exact daemon capabilities before any container execution', async t => {
  const provider = await fixture(t), id = randomUUID()
  const state = { id, container: 'owned', network: 'owned-network', hostIp: '10.207.68.4', keyDir: join(provider.config.stateDir, 'keys') }
  // Existing synthetic key keeps this test entirely independent of ssh-keygen/Docker.
  state.keyDir = provider.config.stateDir
  await writeFile(join(state.keyDir, 'hostkey'), 'synthetic unit fixture')
  const valid = {
    Config: { Labels: { 'io.nodeaccess.trial': id } }, Image: 'image-id', State: { Running: true },
    NetworkSettings: { Networks: { [state.network]: { IPAddress: state.hostIp } } },
    HostConfig: { ReadonlyRootfs: true, Privileged: false, NetworkMode: state.network,
      Memory: 134217728, MemorySwap: 134217728, NanoCpus: 250000000, PidsLimit: 64,
      CapDrop: ['ALL'], CapAdd: ['CAP_CHOWN', 'CAP_SETGID', 'CAP_SETUID', 'CAP_SYS_CHROOT'],
      SecurityOpt: ['no-new-privileges:true'], IpcMode: 'private', PortBindings: {},
      Tmpfs: { '/etc': '', '/home/demo': '', '/run': '', '/tmp': '' }, Dns: ['127.0.0.1'],
      Sysctls: { 'net.ipv6.conf.all.disable_ipv6': '1' }, RestartPolicy: { Name: 'no' } }
  }
  let inspected = valid, executionCalls = 0
  provider.inspect = async () => inspected
  provider.run = async (file, args) => {
    assert.equal(file, 'docker')
    if (args[0] === 'image' && args[1] === 'inspect') return JSON.stringify([{ Id: 'image-id' }])
    executionCalls++; throw Error('REACHED_CONTAINER_EXECUTION')
  }
  // A valid snapshot reaches the execution boundary; policy itself is never mocked.
  await assert.rejects(provider.prepareMachine(state, profile), /REACHED_CONTAINER_EXECUTION/)
  assert.ok(executionCalls > 0)
  for (const caps of [valid.HostConfig.CapAdd.filter(cap => cap !== 'CAP_CHOWN'), [...valid.HostConfig.CapAdd, 'CAP_NET_ADMIN'], [...valid.HostConfig.CapAdd, 'CAP_CHOWN']]) {
    inspected = { ...valid, HostConfig: { ...valid.HostConfig, CapAdd: caps } }; executionCalls = 0
    await assert.rejects(provider.prepareMachine(state, profile), /CONTAINER_POLICY_DRIFT/)
    assert.equal(executionCalls, 0)
  }
})
