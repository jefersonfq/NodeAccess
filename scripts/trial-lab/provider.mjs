#!/usr/bin/env node
import { createServer } from 'node:https'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, rm, readdir, open } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
const exec = promisify(execFile)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const OWNER = 'io.nodeaccess.trial'
const number = ip => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0)
const address = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.')
export function cidr(value) {
  if (typeof value !== 'string' || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value)) throw Error('PRIVATE_CIDR_REQUIRED')
  const [ip, mask, extra] = value.split('/')
  if (extra || !/^\d+$/.test(mask ?? '') || +mask < 16 || +mask > 28 || ip.split('.').length !== 4 || ip.split('.').some(p => !/^\d+$/.test(p) || +p > 255)) throw Error('INVALID_CIDR')
  const size = 2 ** (32 - +mask), start = Math.floor(number(ip) / size) * size
  if (number(ip) !== start) throw Error('CIDR_MUST_BE_NETWORK')
  return { start, end: start + size - 1 }
}
export function rules(state) {
  const tag = `${OWNER}:${state.id}`, net = state.subnet
  const tagged = args => [...args, '-m', 'comment', '--comment', tag]
  return [
    ...(state.machines ?? [{ hostIp: state.hostIp }]).flatMap(machine => state.controlIps.flatMap(ip => [
      ['DOCKER-USER', tagged(['-s', ip, '-d', machine.hostIp, '-p', 'tcp', '--dport', '2222', '-m', 'conntrack', '--ctstate', 'NEW,ESTABLISHED', '-j', 'ACCEPT'])],
      ['DOCKER-USER', tagged(['-s', machine.hostIp, '-d', ip, '-p', 'tcp', '--sport', '2222', '-m', 'conntrack', '--ctstate', 'ESTABLISHED', '-j', 'ACCEPT'])],
    ])),
    ['DOCKER-USER', tagged(['-s', net, '-j', 'DROP'])],
    ['DOCKER-USER', tagged(['-d', net, '-j', 'DROP'])],
    ['INPUT', tagged(['-s', net, '-j', 'DROP'])],
    ['OUTPUT', tagged(['-d', net, '-j', 'DROP'])],
  ]
}
export async function command(file, args, input) {
  if (input === undefined) return (await exec(file, args, { timeout: 30_000, maxBuffer: 1_048_576 })).stdout.trim()
  return new Promise((yes, no) => {
    const child = execFile(file, args, { timeout: 30_000, maxBuffer: 1_048_576 }, (error, stdout) => error ? no(Error('COMMAND_FAILED')) : yes(stdout.trim()))
    child.stdin.end(input)
  })
}
export class Provider {
  constructor(config, run = command) { this.config = { maxMachinesPerTrial: 1, maxTotalMachines: 2, ...config }; this.run = run; this.tail = Promise.resolve() }
  serial(action) { const next = this.tail.then(action); this.tail = next.catch(() => {}); return next }
  async save(state) {
    const file = join(this.config.stateDir, `${state.id}.json`)
    const handle = await open(`${file}.tmp`, 'w', 0o600)
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync() } finally { await handle.close() }
    await rename(`${file}.tmp`, file)
    const directory = await open(this.config.stateDir, 'r'); try { await directory.sync() } finally { await directory.close() }
  }
  async load(id) { try { return JSON.parse(await readFile(join(this.config.stateDir, `${id}.json`), 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
  async states() { const files = await readdir(this.config.stateDir); return Promise.all(files.filter(f => UUID.test(f.slice(0, -5)) && f.endsWith('.json')).map(f => this.load(f.slice(0, -5)))) }
  async preflight() {
    cidr(this.config.networkCidr)
    if (!this.config.controls.length || this.config.controls.length > 2 || !Number.isInteger(this.config.maxActiveTrials) || this.config.maxActiveTrials < 1 || this.config.maxActiveTrials > 20 || !Number.isInteger(this.config.maxMachinesPerTrial) || this.config.maxMachinesPerTrial < 1 || this.config.maxMachinesPerTrial > 10 || !Number.isInteger(this.config.maxTotalMachines) || this.config.maxTotalMachines < 1 || this.config.maxTotalMachines > 20) throw Error('INVALID_OPERATOR_CONFIG')
    if ((await this.run('sysctl', ['-n', 'net.bridge.bridge-nf-call-iptables'])) !== '1') throw Error('BRIDGE_FILTER_REQUIRED')
    await this.run('iptables', ['-w', '5', '-S', 'DOCKER-USER'])
    for (const name of this.config.controls) {
      const [c] = JSON.parse(await this.run('docker', ['inspect', name]))
      if (!c?.State?.Running || c.HostConfig.NetworkMode === 'host') throw Error('CONTROL_CONTAINER_INVALID')
    }
    await this.run('docker', ['image', 'inspect', this.config.image])
  }
  async filter(state, remove = false) {
    // Prepend reverse order so narrow allow rules precede subnet drops.
    const entries = remove ? rules(state) : rules(state).reverse()
    for (const [chain, args] of entries) {
      const exists = await this.run('iptables', ['-w', '5', '-C', chain, ...args]).then(() => true, () => false)
      if (remove && exists) await this.run('iptables', ['-w', '5', '-D', chain, ...args])
      if (!remove && !exists) await this.run('iptables', ['-w', '5', '-I', chain, '1', ...args])
    }
    if (!remove) for (const [chain, args] of rules(state)) await this.run('iptables', ['-w', '5', '-C', chain, ...args])
  }
  async inspect(kind, name) { try { return JSON.parse(await this.run('docker', [kind, 'inspect', name]))[0] } catch (error) { if (/No such (object|container|network)/i.test(error.stderr ?? '') || (kind === 'network' && (error.stderr ?? '').includes(`network ${name} not found`))) return null; throw error } }
  own(item, id) { if (item && (item.Config?.Labels ?? item.Labels)?.[OWNER] !== id) throw Error('OWNERSHIP_MISMATCH') }
  async allocate(id, request) {
    const states = await this.states()
    if (states.filter(s => s.phase !== 'removed').length >= this.config.maxActiveTrials) throw Error('CAPACITY')
    if (states.filter(s => s.phase !== 'removed').reduce((n, s) => n + (s.machines?.length ?? 0), 0) + request.machineCount > this.config.maxTotalMachines) throw Error('MACHINE_CAPACITY')
    const pool = cidr(this.config.networkCidr), occupied = states.filter(s => s.phase !== 'removed').map(s => cidr(s.subnet))
    const ids = (await this.run('docker', ['network', 'ls', '-q'])).split(/\s+/).filter(Boolean)
    if (ids.length) for (const n of JSON.parse(await this.run('docker', ['network', 'inspect', ...ids]))) {
      for (const item of n.IPAM?.Config ?? []) if (item.Subnet && !item.Subnet.includes(':')) {
        const [ip, mask] = item.Subnet.split('/'), size = 2 ** (32 - +mask), start = Math.floor(number(ip) / size) * size
        occupied.push({ start, end: start + size - 1 })
      }
    }
    let start = pool.start
    while (start + 15 <= pool.end && occupied.some(r => start <= r.end && start + 15 >= r.start)) start += 16
    if (start + 15 > pool.end) throw Error('NETWORK_CAPACITY')
    const state = { id, phase: 'preparing', request, subnet: `${address(start)}/28`, controlIps: this.config.controls.map((_, i) => address(start + 2 + i)), network: `na-trial-${id}`, keyDir: join(this.config.stateDir, id), machines: [] }
    for (let index = 0; index < request.machineCount; index++) state.machines.push(this.machine(state, index))
    await this.save(state)
    return state
  }
  machine(state, index) { return { hostIp: address(cidr(state.subnet).start + 4 + index), password: randomBytes(32).toString('hex'), container: `na-trial-${state.id}-${index}`, keyDir: join(state.keyDir, String(index)) } }
  async ensure(id, request) { return this.serial(async () => {
    if (!UUID.test(id)) throw Error('INVALID_ID')
    if (!request || Object.keys(request).sort().join(',') !== 'machineCount,maxSessions,networkCidr,templateId' || request.templateId !== 'alpine-ssh-v1' || !Number.isInteger(request.machineCount) || request.machineCount < 1 || request.machineCount > this.config.maxMachinesPerTrial || request.networkCidr !== this.config.networkCidr || !Number.isInteger(request.maxSessions) || request.maxSessions < 1 || request.maxSessions > 2) throw Error('INVALID_PROFILE')
    let state = await this.load(id)
    if (state?.phase === 'removing') throw Error('REMOVAL_PENDING')
    if (state?.phase === 'removed') return { trialId: id, state: 'removed', isolated: true, hosts: [] }
    if (state && ['templateId', 'networkCidr', 'maxSessions'].some(key => state.request[key] !== request[key])) throw Error('PROFILE_CHANGED')
    if (state && request.machineCount < state.machines.length) throw Error('MACHINE_COUNT_DECREASE')
    await this.preflight()
    state ??= await this.allocate(id, request)
    if (request.machineCount > state.machines.length) {
      const states = await this.states()
      const total = states.filter(s => s.phase !== 'removed').reduce((n, s) => n + s.machines.length, 0)
      if (total + request.machineCount - state.machines.length > this.config.maxTotalMachines) throw Error('MACHINE_CAPACITY')
      for (let index = state.machines.length; index < request.machineCount; index++) state.machines.push(this.machine(state, index))
      state.request = request; state.phase = 'preparing'; await this.save(state)
    }
    await this.filter(state)
    let network = await this.inspect('network', state.network)
    this.own(network, id)
    if (!network) {
      await this.run('docker', ['network', 'create', '--internal', '--subnet', state.subnet, '--label', `${OWNER}=${id}`, '--opt', 'com.docker.network.bridge.enable_icc=false', state.network])
      network = await this.inspect('network', state.network)
    }
    if (!network?.Internal || network.Driver !== 'bridge' || network.Options?.['com.docker.network.bridge.enable_icc'] !== 'false' || network.EnableIPv6 || network.IPAM?.Config?.[0]?.Subnet !== state.subnet) throw Error('NETWORK_NOT_ISOLATED')
    for (const [index, control] of this.config.controls.entries()) {
      const [current] = JSON.parse(await this.run('docker', ['inspect', control]))
      const attachment = current.NetworkSettings.Networks[state.network]
      if (attachment && attachment.IPAddress !== state.controlIps[index]) throw Error('CONTROL_IP_CHANGED')
      if (!attachment) await this.run('docker', ['network', 'connect', '--ip', state.controlIps[index], state.network, control])
    }
    const hosts = []
    for (const machine of state.machines) hosts.push(await this.prepareMachine({ ...state, ...machine }, request))
    await this.filter(state)
    state.phase = 'ready'; await this.save(state)
    return { trialId: id, state: 'ready', isolated: true, hosts }
  }) }
  async prepareMachine(state, request) {
    const id = state.id
    await mkdir(state.keyDir, { recursive: true, mode: 0o700 })
    const key = join(state.keyDir, 'hostkey')
    try { await readFile(key) } catch (e) { if (e.code !== 'ENOENT') throw e; await this.run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key]) }
    let container = await this.inspect('container', state.container)
    this.own(container, id)
    if (!container) {
      await this.run('docker', ['create', '--name', state.container, '--label', `${OWNER}=${id}`, '--network', state.network, '--ip', state.hostIp,
        '--read-only', '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'SYS_CHROOT', '--cap-add', 'CHOWN', '--security-opt', 'no-new-privileges:true',
        '--memory', '128m', '--memory-swap', '128m', '--cpus', '0.25', '--pids-limit', '64', '--ulimit', 'nofile=256:256',
        '--tmpfs', '/etc:rw,nosuid,noexec,size=8m,mode=755', '--tmpfs', '/run:rw,nosuid,noexec,size=4m,mode=755',
        '--tmpfs', '/tmp:rw,nosuid,noexec,size=16m,mode=1777', '--tmpfs', '/home/demo:rw,nosuid,size=32m,mode=700,uid=1000,gid=1000',
        '--dns', '127.0.0.1', '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1', '--restart', 'no', '--log-driver', 'none', this.config.image])
      container = await this.inspect('container', state.container)
    }
    const hc = container.HostConfig, expectedCaps = ['CHOWN', 'SETGID', 'SETUID', 'SYS_CHROOT']
    const image = JSON.parse(await this.run('docker', ['image', 'inspect', this.config.image]))[0]
    if (container.Image !== image.Id || !hc.ReadonlyRootfs || hc.Privileged || hc.NetworkMode !== state.network
      || hc.Memory !== 134217728 || hc.MemorySwap !== 134217728 || hc.NanoCpus !== 250000000 || hc.PidsLimit !== 64
      || JSON.stringify([...(hc.CapDrop ?? [])].sort()) !== '["ALL"]'
      || JSON.stringify((hc.CapAdd ?? []).map(cap => cap.replace(/^CAP_/, '')).sort()) !== JSON.stringify(expectedCaps)
      || JSON.stringify(hc.SecurityOpt) !== '["no-new-privileges:true"]' || hc.Binds?.length || hc.VolumesFrom?.length || hc.Devices?.length || hc.DeviceRequests?.length || hc.PidMode || hc.IpcMode !== 'private' || Object.keys(hc.PortBindings ?? {}).length
      || Object.keys(container.NetworkSettings.Networks).length !== 1
      || container.NetworkSettings.Networks[state.network]?.IPAddress && container.NetworkSettings.Networks[state.network].IPAddress !== state.hostIp
      || Object.keys(hc.Tmpfs ?? {}).sort().join(',') !== '/etc,/home/demo,/run,/tmp'
      || hc.Dns?.join(',') !== '127.0.0.1' || hc.Sysctls?.['net.ipv6.conf.all.disable_ipv6'] !== '1'
      || hc.RestartPolicy?.Name !== 'no') throw Error('CONTAINER_POLICY_DRIFT')
    if (!container.State.Running) await this.run('docker', ['start', state.container])
    const initialized = await this.run('docker', ['exec', state.container, 'test', '-f', '/run/lab-ready']).then(() => true, () => false)
    if (!initialized) {
      const sshConfig = `Port 2222\nListenAddress 0.0.0.0\nHostKey /run/hostkey\nPidFile /run/sshd.pid\nPermitRootLogin no\nPasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM no\nAllowUsers demo\nAllowTcpForwarding no\nAllowAgentForwarding no\nX11Forwarding no\nPermitTunnel no\nPermitUserRC no\nDisableForwarding yes\nMaxSessions ${request.maxSessions}\nMaxAuthTries 3\nLoginGraceTime 20\nSubsystem sftp internal-sftp\n`
      const privateKey = (await readFile(key)).toString('base64')
      await this.run('docker', ['exec', '-i', state.container, 'sh', '-eu'], `while [ ! -f /etc/shadow ]; do sleep 0.1; done\nprintf '%s\\n' 'demo:${state.password}' | chpasswd\nprintf '%s' '${privateKey}' | base64 -d > /run/hostkey\nchmod 600 /run/hostkey\nprintf '%s' '${Buffer.from(sshConfig).toString('base64')}' | base64 -d > /run/sshd_config\n/usr/sbin/sshd -t -f /run/sshd_config\ntouch /run/lab-ready\n`)
    }
    await this.run('docker', ['exec', state.container, 'sh', '-ec', 'for i in $(seq 1 50); do grep -q "00000000:08AE.* 0A " /proc/net/tcp && exit 0; sleep 0.1; done; exit 1'])
    const fingerprint = (await this.run('ssh-keygen', ['-lf', `${key}.pub`, '-E', 'sha256'])).split(/\s+/)[1]
    return { name: 'Linux demonstração', ip: state.hostIp, port: 2222, sshUser: 'demo', password: state.password, fingerprint }
  }
  async remove(id) { return this.serial(async () => {
    if (!UUID.test(id)) throw Error('INVALID_ID')
    const state = await this.load(id) ?? { id, phase: 'removing' }
    state.phase = 'removing'; await this.save(state)
    if (state.network || state.container) {
      for (const machine of state.machines ?? [state]) {
        const container = await this.inspect('container', machine.container); this.own(container, id)
        if (container) await this.run('docker', ['rm', '-f', machine.container])
      }
      const network = await this.inspect('network', state.network); this.own(network, id)
      if (network) {
        for (const [endpoint, metadata] of Object.entries(network.Containers ?? {})) {
          if (!this.config.controls.includes(metadata.Name)) throw Error('FOREIGN_NETWORK_ENDPOINT')
          await this.run('docker', ['network', 'disconnect', '-f', state.network, endpoint])
        }
        await this.run('docker', ['network', 'rm', state.network])
      }
      await this.filter(state, true)
      await rm(state.keyDir, { recursive: true, force: true })
    }
    await this.save({ id, phase: 'removed' })
    return { trialId: id, state: 'removed', isolated: true, hosts: [] }
  }) }
}
export async function serve(config) {
  if (typeof config.token !== 'string' || config.token.length < 32 || !['127.0.0.1', '::1'].includes(config.bind)) throw Error('LOCAL_BIND_AND_TOKEN_REQUIRED')
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
  const provider = new Provider(config)
  const server = createServer({ key: await readFile(config.tlsKey), cert: await readFile(config.tlsCert) }, async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
    try {
      const expected = Buffer.from(`Bearer ${config.token}`), actual = Buffer.from(req.headers.authorization ?? '')
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return reply(401, { error: 'UNAUTHORIZED' })
      const match = /^\/v1\/labs\/([a-f0-9-]+)$/.exec(req.url ?? '')
      if (!match || !UUID.test(match[1]) || req.headers['idempotency-key'] !== match[1] || !['PUT', 'DELETE'].includes(req.method)) return reply(400, { error: 'INVALID_REQUEST' })
      let body = '', length = 0
      for await (const chunk of req) { length += chunk.length; if (length > 2048) return reply(413, { error: 'BODY_LIMIT' }); body += chunk }
      const result = req.method === 'DELETE' ? await provider.remove(match[1]) : await provider.ensure(match[1], JSON.parse(body))
      reply(200, result)
    } catch (error) { reply(error.message === 'MACHINE_COUNT_DECREASE' ? 409 : 503, { error: error.message === 'MACHINE_COUNT_DECREASE' ? 'MACHINE_COUNT_DECREASE' : 'LAB_UNAVAILABLE' }) }
  })
  server.requestTimeout = 10_000; server.headersTimeout = 10_000
  await new Promise((yes, no) => { server.once('error', no); server.listen(config.port, config.bind, yes) })
  const close = () => server.close(() => process.exit(0))
  process.on('SIGTERM', close); process.on('SIGINT', close)
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
  if (process.argv[3] !== '--locked') {
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
    process.execve('/usr/bin/flock', ['flock', '--nonblock', '--no-fork', join(config.stateDir, '.instance.lock'), process.execPath, resolve(process.argv[1]), resolve(process.argv[2]), '--locked'], process.env)
    throw Error('FLOCK_EXEC_REQUIRED')
  }
  await serve(config)
}
