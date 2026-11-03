import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { startServer, configureProject, api } from './ci-server.mjs'

async function fakeSonar(t, { privateProject = true, anonymous = false, token = true, status = 'UP', absentAnyone = false } = {}) {
  const calls = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const url = new URL(req.url, 'http://localhost')
    calls.push({ path: url.pathname, body: Object.fromEntries(new URLSearchParams(body)), auth: req.headers.authorization })
    let value = {}
    if (url.pathname === '/api/system/status') value = { status }
    if (url.pathname === '/api/user_tokens/generate') value = token ? { token: `ephemeral-${calls.length}` } : {}
    if (url.pathname === '/api/projects/search') value = { components: [{ visibility: privateProject ? 'private' : 'public' }] }
    if (url.pathname === '/api/issues/search' && !req.headers.authorization && !anonymous) res.statusCode = 401
    if (url.pathname === '/api/fail') res.statusCode = 403
    if (absentAnyone && url.pathname === '/api/permissions/remove_group' && new URLSearchParams(body).get('groupName') === 'Anyone') res.statusCode = 404
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return { port: server.address().port, calls, server }
}
function dockerStub(port, commands, fail = () => false) {
  return async (args, env) => {
    commands.push({ args, env })
    if (fail(args)) throw new Error('simulated Docker failure')
    return args[0] === 'port' ? `127.0.0.1:${port}` : 'owned'
  }
}
test('bootstrap configures a private project with separate least-privilege tokens and removes only owned resources', async t => {
  const sonar = await fakeSonar(t), commands = []
  const instance = await startServer({ runDocker: dockerStub(sonar.port, commands), kernel: async () => '524288', wait: async () => {} })
  const tokens = await configureProject(instance)
  assert.notEqual(tokens.scan, tokens.review)
  assert.equal(sonar.calls.find(c => c.path === '/api/projects/create').body.visibility, 'private')
  const grants = sonar.calls.filter(c => c.path === '/api/permissions/add_user')
  assert.deepEqual(grants.map(c => [c.body.login, c.body.permission]), [['ci-scan', 'scan'], ['ci-review', 'user']])
  assert.equal(sonar.calls.filter(c => c.path === '/api/user_tokens/generate')[0].body.type, 'PROJECT_ANALYSIS_TOKEN')
  assert.equal(sonar.calls.find(c => c.path === '/api/settings/set' && c.body.key === 'sonar.qualitygate.ignoreSmallChanges').body.value, 'false')
  const runs = commands.filter(c => c.args[0] === 'run')
  assert.equal(runs.length, 2)
  assert.ok(runs.every(c => !c.args.includes(c.env.POSTGRES_PASSWORD ?? c.env.SONAR_JDBC_PASSWORD)))
  assert.ok(runs.every(c => c.args.includes(instance.owner) || c.args.includes(`nodeaccess.ci.owner=${instance.owner}`)))
  await instance.cleanup()
  assert.equal(commands.filter(c => c.args[0] === 'rm').length, 2)
  assert.ok(commands.filter(c => c.args[0] === 'rm').every(c => c.args.at(-1).startsWith(instance.owner)))
  assert.deepEqual(commands.at(-1).args, ['network', 'rm', instance.owner])
})
test('rejects low kernel limit without creating Docker resources', async () => {
  let calls = 0
  await assert.rejects(startServer({ kernel: async () => '1', runDocker: async () => { calls++ } }), /KERNEL/)
  assert.equal(calls, 0)
})
test('failed startup cleans its containers and network', async () => {
  const commands = []
  await assert.rejects(startServer({ kernel: async () => '524288', wait: async () => {},
    runDocker: dockerStub(32145, commands, args => args[0] === 'run' && args.at(-1).startsWith('sonarqube:')) }), /simulated/)
  assert.equal(commands.filter(c => c.args[0] === 'rm').length, 2)
  assert.equal(commands.at(-1).args[0], 'network')
})
test('configuration rejects public project, anonymous access, and absent token', async t => {
  for (const options of [{ privateProject: false }, { anonymous: true }, { token: false }]) {
    const sonar = await fakeSonar(t, options)
    await assert.rejects(configureProject({ server: `http://127.0.0.1:${sonar.port}`, admin: api(`http://127.0.0.1:${sonar.port}`, 'admin', 'ephemeral') }), /CI_(PRIVATE|ANONYMOUS|TOKEN)/)
  }
})
test('API failures expose codes only, never server content or credentials', async t => {
  const sonar = await fakeSonar(t)
  await assert.rejects(api(`http://127.0.0.1:${sonar.port}`, 'admin', 'private')('/api/fail'), /^Error: CI_API_HTTP_403__API_FAIL$/)
})

test('absent virtual Anyone group is tolerated only after explicit 404 and anonymous access remains denied', async t => {
  const sonar = await fakeSonar(t, { absentAnyone: true })
  const server = `http://127.0.0.1:${sonar.port}`
  const tokens = await configureProject({ server, admin: api(server, 'admin', 'ephemeral') })
  assert.ok(tokens.scan); assert.ok(tokens.review)
  assert.ok(sonar.calls.some(call => call.path === '/api/issues/search' && !call.auth))
})
