/** Opt-in destructive only to fresh na0068-provider-* fixtures + own UUID labels.
 * TRIAL_PROVIDER_REAL=1 node --test scripts/trial-lab/provider.blackbox.test.mjs
 * Requires local Docker image na0068-trial-ssh:test, root iptables, bridge-nf=1.
 * Never use this harness against a remote Docker context or production daemon.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:https'
import { createServer } from 'node:net'
import { Duplex } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from 'ssh2'
import { Provider } from './provider.mjs'
const exec = promisify(execFile)
const run = async (file, args) => (await exec(file, args, { timeout: 30000, maxBuffer: 2**20 })).stdout.trim()
const enabled = process.env.TRIAL_PROVIDER_REAL === '1'

test('real HTTPS provider isolates two labs and preserves tombstones across restart', { skip: !enabled, timeout: 180000 }, async () => {
  assert.ok(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'), 'Local Docker daemon required')
  const context = JSON.parse(await run('docker', ['context', 'inspect']))[0]
  assert.ok(context.Endpoints.docker.Host.startsWith('unix://'), 'Local Docker context required')
  const dir = await mkdtemp(join(tmpdir(), 'na0068-provider-proof-'))
  const prefix = `na0068-provider-${randomUUID().slice(0,8)}`
  const controls = [`${prefix}-gateway`, `${prefix}-api`]
  const controlNet = `${prefix}-control`
  const foreign = `${prefix}-foreign`
  const ids = [randomUUID(), randomUUID(), randomUUID()]
  const token = randomBytes(32).toString('hex')
  let child
  let hostListener
  let cert
  let providerPort
  let configPath
  const owned = new Set()
  function http(method, id, body, suppliedToken = token) {
    return new Promise((yes, no) => {
      const req = request({ hostname: '127.0.0.1', port: providerPort, path: `/v1/labs/${id}`, method, ca: cert, headers: { authorization: `Bearer ${suppliedToken}`, 'idempotency-key': id, 'content-type': 'application/json' }, timeout: 45000 }, res => {
        let raw = ''; res.on('data', chunk => { raw += chunk }); res.on('end', () => { try { yes({ status: res.statusCode, body: JSON.parse(raw) }) } catch { no(Error('Provider returned malformed JSON')) } })
      })
      req.on('timeout', () => req.destroy(Error('Provider timeout'))); req.on('error', () => no(Error('Provider connection failed')))
      req.end(body === undefined ? undefined : JSON.stringify(body))
    })
  }
  async function start() {
    child = spawn(process.execPath, ['scripts/trial-lab/provider.mjs', configPath], { cwd: resolve('.'), stdio: ['ignore', 'ignore', 'pipe'] })
    let failed = ''; child.stderr.on('data', chunk => { failed += chunk.toString().slice(0,1000) })
    for (let attempt=0; attempt<100; attempt++) {
      if (child.exitCode !== null) throw Error(`Provider failed to start: ${failed.slice(0,300)}`)
      if (await http('PUT', ids[0], {}, 'wrong-token').then(r => r.status === 401, () => false)) return
      await delay(100)
    }
    throw Error('Provider startup timeout')
  }
  async function stop(signal = 'SIGTERM') {
    if (!child || child.exitCode !== null) return
    const exit = new Promise(resolveExit => child.once('exit', resolveExit)); child.kill(signal); await exit
  }
  const profile = { templateId: 'alpine-ssh-v1', machineCount: 1, networkCidr: '10.207.68.0/24', maxSessions: 2 }
  async function shell(host, command) {
    const proxy = spawn('docker', ['exec', '-i', controls[0], 'node', '-e', 'const s=require("net").connect(+process.argv[2],process.argv[1]);process.stdin.pipe(s);s.pipe(process.stdout);s.on("error",()=>process.exit(2));', host.ip, String(host.port)], { stdio: ['pipe','pipe','ignore'] })
    const sock = Duplex.from({ readable: proxy.stdout, writable: proxy.stdin })
    const client = new Client()
    try {
      await new Promise((yes,no) => { client.on('ready',yes).on('error',()=>no(Error('Real SSH login failed'))); client.connect({ sock, username: host.sshUser, password: host.password, readyTimeout: 10000, hostVerifier: key => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/,'')}` === host.fingerprint.replace(/=+$/,'') }) })
      if (typeof command === 'function') return await command(client)
      return await new Promise((yes,no) => client.exec(command, (error, stream) => {
        if (error) return no(Error('SSH command failed'))
        let output=''; stream.on('data', chunk=>{output+=chunk}); stream.on('close', code=>yes({code,output})); stream.on('error',no)
      }))
    } finally { client.end(); sock.destroy(); proxy.kill() }
  }
  try {
    const reserve = createServer(); await new Promise(resolveListen=>reserve.listen(0,'127.0.0.1',resolveListen)); providerPort=reserve.address().port; await new Promise(resolveClose=>reserve.close(resolveClose))
    await run('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'tls.key'),'-out',join(dir,'tls.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'])
    cert=await readFile(join(dir,'tls.crt'))
    await run('docker',['network','create','--internal',controlNet]); owned.add(controlNet)
    for (const name of controls) {
      await run('docker',['run','-d','--name',name,'--network',controlNet,'--cap-drop','ALL','--read-only','node:24.21.0-alpine','node','-e','require("net").createServer(s=>s.end("CONTROL\\n")).listen(8080,"0.0.0.0");']); owned.add(name)
    }
    configPath=join(dir,'config.json')
    await writeFile(configPath,JSON.stringify({stateDir:join(dir,'state'),token,bind:'127.0.0.1',port:providerPort,tlsKey:join(dir,'tls.key'),tlsCert:join(dir,'tls.crt'),controls,image:'na0068-trial-ssh:test',networkCidr:profile.networkCidr,maxActiveTrials:2,maxMachinesPerTrial:2,maxTotalMachines:3}),{mode:0o600})
    await start()
    assert.equal((await http('PUT',ids[0],{...profile,templateId:'../../production'})).status,503)
    // Kill after durable PREPARING state, before provisioning can report ready.
    const interruptedPut = http('PUT',ids[0],profile).catch(()=>null)
    for (let i=0;i<100;i++) { if(await readFile(join(dir,'state',`${ids[0]}.json`),'utf8').then(raw=>JSON.parse(raw).phase==='preparing',()=>false)) break; await delay(5) }
    assert.equal(JSON.parse(await readFile(join(dir,'state',`${ids[0]}.json`),'utf8')).phase,'preparing')
    await stop('SIGKILL'); await interruptedPut; await start()
    const first=await http('PUT',ids[0],profile); if(first.status!==200) { const diagnostic=new Provider(JSON.parse(await readFile(configPath,'utf8'))); await diagnostic.ensure(ids[0],profile).catch(error=>console.error('Diagnostic:', error.message.split('\n')[0])); } assert.equal(first.status,200); assert.equal(first.body.state,'ready')
    const again=await http('PUT',ids[0],profile); assert.deepEqual(again.body,first.body)
    const second=await http('PUT',ids[1],profile); assert.equal(second.status,200); assert.equal(second.body.state,'ready')
    assert.notEqual(first.body.hosts[0].password,second.body.hosts[0].password)
    assert.notEqual(first.body.hosts[0].fingerprint,second.body.hosts[0].fingerprint)
    assert.equal((await http('PUT',ids[2],profile)).status,503)
    const grownProfile = {...profile,machineCount:2}
    const grown=await http('PUT',ids[0],grownProfile); assert.equal(grown.status,200); assert.equal(grown.body.hosts.length,2)
    assert.deepEqual(grown.body.hosts[0],first.body.hosts[0])
    assert.equal((await http('PUT',ids[0],profile)).status,409)
    assert.equal((await http('PUT',ids[1],grownProfile)).status,503)
    const state=JSON.parse(await readFile(join(dir,'state',`${ids[0]}.json`),'utf8'))
    const [container]=JSON.parse(await run('docker',['inspect',state.machines[0].container]))
    assert.equal(container.HostConfig.ReadonlyRootfs,true); assert.equal(container.HostConfig.Privileged,false)
    assert.equal(container.HostConfig.Memory,128*1024*1024); assert.equal(container.HostConfig.PidsLimit,64)
    assert.deepEqual(container.HostConfig.PortBindings,{})
    assert.deepEqual(container.HostConfig.Dns,['127.0.0.1'])
    assert.equal(container.HostConfig.Sysctls['net.ipv6.conf.all.disable_ipv6'],'1')
    assert.ok(!container.Mounts.some(m=>m.Type==='bind'))
    const identity=await shell(first.body.hosts[0],'id -u; grep CapEff /proc/self/status; grep NoNewPrivs /proc/self/status; test ! -e /var/run/docker.sock; cat /proc/1/root/run/hostkey >/dev/null 2>&1 && exit 92; cat /etc/shadow >/dev/null 2>&1 && exit 93; touch /etc/forbidden 2>/dev/null && exit 91; printf secure')
    assert.equal(identity.code,0); assert.match(identity.output,/1000/); assert.match(identity.output,/CapEff:\s+0000000000000000/); assert.match(identity.output,/NoNewPrivs:\s+1/)
    const sftpText=await shell(first.body.hosts[0],client=>new Promise((yes,no)=>client.sftp((error,sftp)=>{
      if(error)return no(error)
      sftp.writeFile('/home/demo/blackbox.txt','isolated SFTP fixture',writeError=>{if(writeError)return no(writeError);sftp.readFile('/home/demo/blackbox.txt',(readError,data)=>readError?no(readError):yes(data.toString()))})
    })))
    assert.equal(sftpText,'isolated SFTP fixture')
    const dns=await shell(first.body.hosts[0],"timeout 3 nslookup example.com >/dev/null 2>&1; echo dns_status:$?")
    assert.doesNotMatch(dns.output,/dns_status:0(?:\s|$)/)
    hostListener=createServer(socket=>socket.end('HOST')); await new Promise(resolveListen=>hostListener.listen(0,'0.0.0.0',resolveListen)); const hostPort=hostListener.address().port
    const hostGateway=state.subnet.split('/')[0].replace(/\d+$/,n=>String(Number(n)+1))
    const controlsState=JSON.parse(await run('docker',['inspect',controls[0]]))[0]
    const outsideIp=controlsState.NetworkSettings.Networks[controlNet].IPAddress
    const destinations=[[outsideIp,8080],[hostGateway,hostPort],[state.controlIps[0],8080],[state.controlIps[1],8080],[second.body.hosts[0].ip,2222]]
    for(const [ip,port] of destinations) {
      const probe=await shell(first.body.hosts[0],`if timeout 2 bash -c 'echo probe >/dev/tcp/${ip}/${port}' 2>/dev/null; then echo REACHABLE; else echo BLOCKED; fi`)
      assert.equal(probe.code,0); assert.match(probe.output,/BLOCKED/); assert.doesNotMatch(probe.output,/REACHABLE/)
    }
    // A deployment may recreate controls; the provider must reconnect the new container.
    await run('docker',['rm','-f',controls[0]])
    await run('docker',['run','-d','--name',controls[0],'--network',controlNet,'--cap-drop','ALL','--read-only','node:24.21.0-alpine','node','-e','require("net").createServer(s=>s.end("CONTROL\\n")).listen(8080,"0.0.0.0");'])
    assert.deepEqual((await http('PUT',ids[0],grownProfile)).body,grown.body)
    assert.deepEqual((await http('PUT',ids[1],profile)).body,second.body)
    assert.equal((await shell(first.body.hosts[0],'echo reconnected')).code,0)
    await stop('SIGKILL'); await start()
    assert.deepEqual((await http('PUT',ids[0],grownProfile)).body,grown.body)
    const interruptedDelete=http('DELETE',ids[0]).catch(()=>null)
    for(let i=0;i<100;i++){ if(await readFile(join(dir,'state',`${ids[0]}.json`),'utf8').then(raw=>JSON.parse(raw).phase==='removing',()=>false))break;await delay(2) }
    assert.equal(JSON.parse(await readFile(join(dir,'state',`${ids[0]}.json`),'utf8')).phase,'removing')
    await stop('SIGKILL'); await interruptedDelete; await start()
    assert.equal((await http('PUT',ids[0],grownProfile)).status,503)
    assert.equal((await http('DELETE',ids[0])).body.state,'removed')
    assert.equal((await http('DELETE',ids[0])).body.state,'removed')
    await stop('SIGKILL'); await start()
    assert.equal((await http('PUT',ids[0],profile)).body.state,'removed')
    assert.equal((await http('DELETE',ids[2])).body.state,'removed')
    assert.equal((await http('PUT',ids[2],profile)).body.state,'removed')
    assert.equal((await shell(second.body.hosts[0],'echo still-isolated')).code,0)
    // Unexpected foreign endpoints must never be disconnected/destroyed by DELETE.
    const secondState=JSON.parse(await readFile(join(dir,'state',`${ids[1]}.json`),'utf8'))
    await run('docker',['run','-d','--name',foreign,'--network',secondState.network,'--cap-drop','ALL','--read-only','node:24.21.0-alpine','node','-e','setInterval(()=>{},1000)']);owned.add(foreign)
    assert.equal((await http('DELETE',ids[1])).status,503)
    const foreignState=JSON.parse(await run('docker',['inspect',foreign]))[0]
    assert.equal(foreignState.State.Running,true); assert.ok(foreignState.NetworkSettings.Networks[secondState.network])
    await run('docker',['rm','-f',foreign]);owned.delete(foreign)
    assert.equal((await http('DELETE',ids[1])).body.state,'removed')
  } finally {
    if(owned.has(foreign)) await run('docker',['rm','-f',foreign]).catch(()=>{})
    if (child?.exitCode===null) {
      for(const id of ids) await http('DELETE',id).catch(()=>{})
      await stop()
    }
    if(configPath) {
      const recovery = new Provider(JSON.parse(await readFile(configPath, 'utf8')))
      for (const id of ids) await recovery.remove(id).catch(() => {})
    }
    if(hostListener) await new Promise(resolveClose=>hostListener.close(resolveClose))
    for(const name of controls) if(owned.has(name)) await run('docker',['rm','-f',name]).catch(()=>{})
    if(owned.has(controlNet)) await run('docker',['network','rm',controlNet]).catch(()=>{})
    // Keep state/tombstones on failed cleanup to allow a scoped recovery; never global prune.
    const remaining=(await run('docker',['ps','-a','--filter','label=io.nodeaccess.trial','--format','{{.Names}}'])).split('\n')
    const networks = await run('docker',['network','ls','--format','{{.Name}}'])
    const filters = await run('iptables',['-S'])
    if(!ids.some(id=>remaining.some(name=>name.startsWith(`na-trial-${id}`)) || networks.includes(id) || filters.includes(id))) await rm(dir,{recursive:true,force:true})
    else console.error(`Own fixture cleanup pending; recovery state retained at ${dir}`)
  }
})
