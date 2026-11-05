import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import executable from '../shared/trusted-executable.cjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const images = {
  mysql: 'mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242',
  redis: 'redis@sha256:b51665e66f00759be7c3152ad5ac3c66fb2f619c13ef62dea7cc1f9914524635',
}
function command(binary, args, env, timeout = 120_000) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', bytes = 0, overflow = false, timedOut = false
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    const deadline = setTimeout(() => { timedOut = true; killGroup() }, timeout)
    const collect = (target, data) => {
      bytes += data.length
      if (bytes > 2 * 1024 * 1024) { overflow = true; killGroup(); return }
      if (target === 'stdout') stdout += data
      else stderr += data
    }
    child.stdout.on('data', data => collect('stdout', data))
    child.stderr.on('data', data => collect('stderr', data))
    child.on('error', () => { clearTimeout(deadline); reject(new Error('TLS_LAB_PROCESS_START_FAILED')) })
    child.on('close', code => { clearTimeout(deadline); resolveResult({ code, stdout, stderr, timedOut, overflow }) })
  })
}
function success(result, stage) {
  if (result.code !== 0 || result.timedOut || result.overflow) {
    const error = new Error(`TLS_LAB_${stage}_FAILED`)
    Object.defineProperty(error, 'diagnostic', { value: { stage, code: result.code, timedOut: result.timedOut, overflow: result.overflow,
      stdout: result.stdout.slice(-32_768), stderr: result.stderr.slice(-32_768) } })
    throw error
  }
  return result.stdout
}
export function loopbackPort(output) {
  const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(output)
  const port = Number(match?.[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TLS_LAB_NON_LOOPBACK_PORT')
  return port
}
// Docker contexts override DOCKER_HOST. Resolve once before creating any resource;
// all later commands use the validated host and a context-free environment.
export async function resolveLocalDockerEndpoint(environment, readContext) {
  let endpoint
  if (environment.DOCKER_CONTEXT) endpoint = await readContext(environment.DOCKER_CONTEXT)
  else if (environment.DOCKER_HOST) endpoint = environment.DOCKER_HOST
  else endpoint = await readContext()
  if (typeof endpoint !== 'string' || !/^unix:\/\/\/[^?#%]+$/.test(endpoint)
    || [...endpoint].some(character => character.charCodeAt(0) <= 32)) {
    throw new Error('TLS_LAB_LOCAL_DOCKER_REQUIRED')
  }
  return endpoint
}

export function dockerLocalEnvironment(environment) {
  return { PATH: environment.PATH, HOME: environment.HOME, DOCKER_CONFIG: environment.DOCKER_CONFIG }
}

const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds))

export async function runTlsCoverageLab(environment = process.env) {
  if (environment.NODEACCESS_TLS_COVERAGE !== 'true') throw new Error('TLS_LAB_OPT_IN_REQUIRED')
  const runId = environment.NODEACCESS_TLS_COVERAGE_RUN_ID || randomUUID()
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId)) throw new Error('TLS_LAB_INVALID_RUN_ID')
  const docker = executable.resolveExecutable('docker')
  const dockerEnv = dockerLocalEnvironment(environment)
  const endpoint = await resolveLocalDockerEndpoint(environment, async name => {
    const context = name || success(await command(docker, ['context', 'show'], dockerEnv), 'DOCKER_CONTEXT').trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(context)) throw new Error('TLS_LAB_INVALID_DOCKER_CONTEXT')
    const output = success(await command(docker, ['context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'], dockerEnv), 'DOCKER_ENDPOINT')
    return JSON.parse(output)
  })
  const python = executable.resolveExecutable('python3')
  const directory = mkdtempSync(join(tmpdir(), 'nodeaccess-tls-coverage-'))
  const reportPath = environment.NODEACCESS_TLS_COVERAGE_OUTPUT || join(tmpdir(), `nodeaccess-tls-coverage-${runId}.json`)
  const suffix = randomUUID().replaceAll('-', '')
  const names = [`na0169-tls-mysql-${suffix}`, `na0169-tls-redis-${suffix}`]
  // Never inherit a DB, Redis, daemon target or user key from the caller.
  const env = { PATH: environment.PATH, HOME: environment.HOME, NODE_ENV: 'test',
    NODE_V8_COVERAGE: environment.NODE_V8_COVERAGE,
    DATABASE_URL: '', REDIS_URL: '', REDIS_PASSWORD: '',
    JWT_SECRET: randomBytes(32).toString('hex'), PEM_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  }
  const invokeDocker = args => command(docker, ['--host', endpoint, ...args], dockerEnv)
  const report = { schemaVersion: 1, runId, passed: false, checks: [], isolated: true, cleanupVerified: false,
    startedAt: new Date().toISOString(), limitations: 'Disposable MySQL/Redis and synthetic devices; real TLS/Python/SSH. No vendor hardware, supervisor restart or production capacity certification.' }
  const attempted = []
  let failure
  try {
    const counts = join(directory, 'counts')
    mkdirSync(counts, { mode: 0o700 })
    const wrapper = join(directory, 'python')
    writeFileSync(wrapper, `#!${python}\nimport runpy\nrunpy.run_path(${JSON.stringify(join(root, 'tools/network-access/tls-python-coverage.py'))}, run_name='__main__')\n`, { mode: 0o700 })
    env.PYTHON = wrapper
    env.NODEACCESS_PYTHON_COUNTS = counts
    env.NODEACCESS_TLS_COVERAGE_RUN_ID = runId
    env.NODEACCESS_PYTHON_HELPER_COUNTS = join(directory, 'helper-counts.json')
    const mysqlPassword = randomBytes(24).toString('hex'), redisPassword = randomBytes(24).toString('hex')
    const mysqlEnv = join(directory, 'mysql.env'), redisConfig = join(directory, 'redis.conf')
    writeFileSync(mysqlEnv, `MYSQL_ROOT_PASSWORD=${mysqlPassword}\nMYSQL_DATABASE=nodeaccess_tls_lab\nMYSQL_USER=nodeaccess_lab\nMYSQL_PASSWORD=${mysqlPassword}\n`, { mode: 0o600 })
    writeFileSync(redisConfig, `bind 0.0.0.0\nprotected-mode yes\nport 6379\nrequirepass ${redisPassword}\nsave ""\nappendonly no\n`, { mode: 0o600 })
    const labels = ['--label', 'nodeaccess.change=NA-0169', '--label', `nodeaccess.tls-lab=${runId}`]
    attempted.push(names[0])
    success(await invokeDocker(['run', '-d', '--name', names[0], ...labels, '--cpus', '1', '--memory', '1g',
      '--env-file', mysqlEnv, '-p', '127.0.0.1::3306', images.mysql]), 'MYSQL_START')
    attempted.push(names[1])
    success(await invokeDocker(['run', '-d', '--name', names[1], ...labels, '--cpus', '0.5', '--memory', '128m',
      '--user', `${process.getuid()}:${process.getgid()}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--tmpfs', '/data:rw,noexec,nosuid,size=16m', '--mount', `type=bind,src=${redisConfig},dst=/run/tls-lab-redis.conf,readonly`,
      '-p', '127.0.0.1::6379', images.redis, 'redis-server', '/run/tls-lab-redis.conf']), 'REDIS_START')
    const mysqlPort = loopbackPort(success(await invokeDocker(['port', names[0], '3306/tcp']), 'MYSQL_PORT'))
    const redisPort = loopbackPort(success(await invokeDocker(['port', names[1], '6379/tcp']), 'REDIS_PORT'))
    env.DATABASE_URL = `mysql://nodeaccess_lab:${mysqlPassword}@127.0.0.1:${mysqlPort}/nodeaccess_tls_lab`
    env.REDIS_URL = `redis://127.0.0.1:${redisPort}`; env.REDIS_PASSWORD = redisPassword
    let ready = false
    for (let attempt = 0; attempt < 90; attempt++) {
      const ping = await invokeDocker(['exec', names[0], 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -h127.0.0.1 --silent'])
      if (ping.code === 0) { ready = true; break }
      await pause(1000)
    }
    assert.equal(ready, true, 'Disposable MySQL readiness failed')
    const preparationEnv = { ...env, NODE_V8_COVERAGE: undefined }
    success(await command(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/backend/prisma/schema.prisma'], preparationEnv, 180_000), 'MIGRATIONS')
    success(await command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/shared/tsconfig.json'], preparationEnv), 'SHARED_BUILD')
    success(await command(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'apps/backend/tsconfig.json'], preparationEnv, 300_000), 'BACKEND_BUILD')
    const liveReport = join(directory, 'live.json')
    success(await command(process.execPath, ['tools/network-access/live.mjs'], {
      ...env, RUN_NETWORK_ACCESS_LIVE: 'true', RUN_NETWORK_DEVICE_EMULATION: 'true', RUN_NETWORK_ACCESS_SOAK: 'true',
      NETWORK_SOAK_SECONDS: '30', NETWORK_SOAK_CLIENTS: '4', NETWORK_REPORT_PATH: liveReport,
    }, 180_000), 'LIVE')
    const live = JSON.parse(readFileSync(liveReport, 'utf8'))
    assert.equal(live.ok, true); assert.equal(live.emulation?.ok, true); assert.equal(live.soak?.ok, true)
    assert.equal(live.soak.phases.length, 3); assert.ok(live.soak.phases.every(phase => phase.requests > 0))
    report.checks.push('live')
    const health = success(await command(process.execPath, ['tools/network-access/health-live.mjs'], { ...env, RUN_NETWORK_HEALTH_LIVE: 'true' }), 'HEALTH')
    assert.equal(JSON.parse(health.trim().split('\n').at(-1)).ok, true)
    report.checks.push('health', 'soak')
    const watchdog = success(await command(process.execPath, ['tools/network-access/watchdog-live.mjs'], { ...env, RUN_NETWORK_WATCHDOG_LIVE: 'true' }), 'WATCHDOG')
    const watchdogResult = JSON.parse(watchdog.trim().split('\n').at(-1))
    assert.equal(watchdogResult.ok, true); assert.equal(watchdogResult.noAaaAcknowledgment, true)
    report.checks.push('watchdog')
    success(await command(python, ['tools/network-access/tls-python-coverage.test.py'], env), 'PYTHON_CONTRACTS')
    const pythonReport = success(await command(python, ['tools/network-access/tls-python-coverage.py', '--export', join(dirname(reportPath), 'python.xml')], env), 'PYTHON_COVERAGE')
    report.pythonCoverage = JSON.parse(pythonReport)
    assert.ok(report.pythonCoverage.executedLines > 0)
    report.requests = live.soak.phases.reduce((total, phase) => total + phase.requests, 0)
  } catch (error) { failure = error } finally {
    const cleanupFailures = []
    for (const name of attempted.reverse()) {
      try {
        const inspect = await invokeDocker(['inspect', '--format', '{{index .Config.Labels "nodeaccess.tls-lab"}}', name])
        if (inspect.code !== 0 && /No such (object|container)/i.test(inspect.stderr)) continue
        assert.equal(success(inspect, 'CLEANUP_INSPECT').trim(), runId, 'Refuse cleanup of a foreign container')
        success(await invokeDocker(['rm', '-f', '-v', name]), 'CLEANUP_REMOVE')
        const remaining = await invokeDocker(['inspect', name])
        assert.ok(remaining.code !== 0 && /No such (object|container)/i.test(remaining.stderr), 'Owned container still exists')
      } catch { cleanupFailures.push('OWNED_CONTAINER_CLEANUP_FAILED') }
    }
    try { rmSync(directory, { recursive: true, force: true }) } catch { cleanupFailures.push('PRIVATE_DIRECTORY_CLEANUP_FAILED') }
    report.cleanupVerified = cleanupFailures.length === 0
    report.passed = !failure && report.cleanupVerified && report.checks.length === 4
    report.finishedAt = new Date().toISOString()
    report.failure = failure ? 'LAB_EXECUTION_FAILED' : cleanupFailures[0] ?? null
    mkdirSync(dirname(reportPath), { recursive: true, mode: 0o700 })
    if (failure?.diagnostic) {
      const privateDiagnostics = mkdtempSync(join(dirname(reportPath), 'tls-lab-diagnostics-'))
      writeFileSync(join(privateDiagnostics, 'subprocess.json'), JSON.stringify(failure.diagnostic), { mode: 0o600, flag: 'wx' })
      report.diagnostic = { stage: failure.diagnostic.stage, code: failure.diagnostic.code,
        timedOut: failure.diagnostic.timedOut, overflow: failure.diagnostic.overflow, path: privateDiagnostics }
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    if (cleanupFailures.length) throw new Error('TLS_LAB_CLEANUP_FAILED')
  }
  if (failure) throw failure
  assert.equal(report.passed, true)
  return report
}
