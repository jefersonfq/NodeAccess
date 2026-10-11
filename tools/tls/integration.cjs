/* Isolated opt-in: real Nginx, certificate worker, TLS, WebSocket and disposable SSH/PTTY. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),tls=require('node:tls'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const {execFileSync,spawn}=require('node:child_process'),{WebSocketServer,WebSocket}=require('ws'),{Server:SSHServer,Client:SSHClient}=require('ssh2')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodeaccess-tls-integration-')),suffix=crypto.randomBytes(4).toString('hex'),front=`na-tls-front-${suffix}`,agent=`na-tls-agent-${suffix}`,pebble=`na-tls-pebble-${suffix}`
const image=process.env.TLS_TEST_IMAGE||'nodeaccess-tls-agent:test',domain='tls.example.test',gatewayPath=`/ws/${crypto.randomUUID()}`,password=crypto.randomBytes(32).toString('hex')
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
const openssl=(...args)=>execFileSync('openssl',args[0]==='req'?[...args,'-config',path.join(root,'req.cnf')]:args,{cwd:root,stdio:'ignore'})
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function until(fn,timeout=60000){let lastError;const deadline=Date.now()+timeout;while(Date.now()<deadline){try{const value=await fn();if(value)return value}catch(e){lastError=e};await wait(200)}throw Error('Timed out waiting for fixture: '+(lastError?.message||'condition false'))}
const runnerUid=process.getuid(),runnerGid=process.getgid()
// Only the disposable control socket is handed to the runner; its mode stays 0660.
// Waiting for a response inside the container avoids chowning a stale startup socket.
async function grantRunnerControlAccess(){
 await until(()=>{
  docker('exec',agent,'node','-e',`const http=require('node:http'),fs=require('node:fs');const socket='/run/nodeaccess-tls/control.sock';const req=http.get({socketPath:socket,path:'/status'},res=>{res.resume();res.on('end',()=>{if(res.statusCode!==200){process.exitCode=1;return}fs.chownSync(socket,Number(process.argv[1]),Number(process.argv[2]))})});req.on('error',()=>{process.exitCode=1});req.setTimeout(2000,()=>req.destroy(new Error('fixture socket timeout')));`,String(runnerUid),String(runnerGid))
  const stat=fs.statSync(path.join(root,'control/control.sock'))
  assert.equal(stat.uid,runnerUid);assert.equal(stat.gid,runnerGid);assert.equal(stat.mode&0o777,0o660)
  return true
 })
}
const readFixtureState=()=>docker('exec',agent,'cat','/var/lib/nodeaccess-tls/state.json')
let sshServer,gateway,websocket;const clients=[],shells=[]
async function main(){
 fs.writeFileSync(path.join(root,'req.cnf'),'[req]\ndistinguished_name=dn\n[dn]\n')
 fs.mkdirSync(path.join(root,'certs/managed/versions/bootstrap'),{recursive:true});for(const dir of ['state','control','challenge','acme'])fs.mkdirSync(path.join(root,dir))
 openssl('req','-x509','-newkey','rsa:2048','-nodes','-days','90','-subj','/CN=TLS test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-addext','subjectKeyIdentifier=hash','-keyout','ca.key','-out','ca.pem')
 fs.writeFileSync(path.join(root,'ext.cnf'),`subjectAltName=DNS:${domain}\nbasicConstraints=critical,CA:FALSE\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`)
 for(const name of ['old','new']){openssl('req','-new','-newkey','rsa:2048','-nodes','-subj',`/CN=${domain}`,'-keyout',`${name}.key`,'-out',`${name}.csr`);openssl('x509','-req','-in',`${name}.csr`,'-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','60','-extfile','ext.cnf','-out',`${name}.pem`)}
 const ca=fs.readFileSync(path.join(root,'ca.pem')),oldCert=fs.readFileSync(path.join(root,'old.pem'))
 fs.writeFileSync(path.join(root,'certs/fullchain.pem'),Buffer.concat([oldCert,ca]));fs.copyFileSync(path.join(root,'old.key'),path.join(root,'certs/privkey.pem'))
 fs.writeFileSync(path.join(root,'ssh.key'),crypto.createPrivateKey(fs.readFileSync(path.join(root,'old.key'))).export({format:'pem',type:'pkcs1'}))
 let sshConnections=0,wsConnections=0
 sshServer=new SSHServer({hostKeys:[fs.readFileSync(path.join(root,'ssh.key'))]},client=>{
  sshConnections++;clients.push(client)
  client.on('error',()=>{}).on('authentication',ctx=>ctx.method==='password'&&ctx.password===password?ctx.accept():ctx.reject()).on('ready',()=>client.on('session',accept=>{
   const session=accept();session.on('pty',(accept)=>accept());session.on('shell',accept=>{const stream=accept(),shell=spawn('script',['-qfc','/bin/bash --noprofile --norc','/dev/null'],{env:{...process.env,PS1:'test$ '}});shells.push(shell);shell.stdout.pipe(stream);shell.stderr.pipe(stream);stream.pipe(shell.stdin);stream.on('close',()=>shell.kill());shell.on('exit',()=>stream.end())})
  }))
 });await new Promise(r=>sshServer.listen(0,'127.0.0.1',r))
 gateway=new WebSocketServer({port:0,host:'0.0.0.0',verifyClient:info=>info.req.url===gatewayPath});await new Promise(r=>gateway.once('listening',r))
 gateway.on('connection',ws=>{wsConnections++;const ssh=new SSHClient();clients.push(ssh);ssh.on('error',()=>ws.close());ssh.on('ready',()=>ssh.shell({term:'xterm',cols:100,rows:30},(err,stream)=>{if(err)return ws.close();stream.on('data',d=>{if(ws.readyState===1)ws.send(d)});ws.on('message',d=>stream.write(d));ws.on('close',()=>ssh.end())}));ssh.connect({host:'127.0.0.1',port:sshServer.address().port,username:'test',password})})
 execFileSync(process.execPath,['tools/tls/prepare.mjs'],{env:{...process.env,TLS_DOMAIN:domain,TLS_EXTERNAL:'false',CERTS_DIR:path.join(root,'certs'),NGINX_SOURCE:path.resolve('docker/nginx.https.conf'),NGINX_DEST:path.join(root,'nginx.conf')},stdio:'pipe'})
 let config=fs.readFileSync(path.join(root,'nginx.conf'),'utf8').replaceAll('api:3000',`host.docker.internal:${gateway.address().port}`).replaceAll('ssh-gateway:3001',`host.docker.internal:${gateway.address().port}`)
 fs.writeFileSync(path.join(root,'nginx.conf'),config)
 docker('run','-d','--name',front,'--add-host','host.docker.internal:host-gateway','--add-host',`${domain}:127.0.0.1`,'-p','127.0.0.1::443','-p','127.0.0.1::80','-v',`${root}/certs:/etc/nginx/certs:ro`,'-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'-v',`${root}/challenge:/var/www/acme:ro`,'--entrypoint','nginx',image,'-g','daemon off;')
 const port=Number(docker('port',front,'443/tcp').split(':').pop()),httpPort=Number(docker('port',front,'80/tcp').split(':').pop())
 const inspect=()=>new Promise((resolve,reject)=>{const s=tls.connect({host:'127.0.0.1',port,servername:domain,ca:fs.existsSync(path.join(root,'trust.pem'))?fs.readFileSync(path.join(root,'trust.pem')):ca},()=>{resolve(s.getPeerCertificate().fingerprint256);s.end()});s.on('error',e=>{const c=s.getPeerCertificate();e.message+=' peer='+JSON.stringify({subject:c?.subject,issuer:c?.issuer});reject(e)})})
 try{execFileSync('openssl',['verify','-CAfile',path.join(root,'ca.pem'),path.join(root,'old.pem')],{stdio:'pipe'})}catch(e){throw Error('Fixture CA validation: '+e.stderr)}
 const oldFingerprint=await until(inspect)
 fs.writeFileSync(path.join(root,'pebble.json'),JSON.stringify({pebble:{listenAddress:':14000',managementListenAddress:':15000',certificate:'/fixture/old.pem',privateKey:'/fixture/old.key',httpPort:80,tlsPort:443,ocspResponderURL:'',externalAccountBindingRequired:false}}))
 docker('run','-d','--name',pebble,'--network',`container:${front}`,'-e','PEBBLE_VA_NOSLEEP=1','-e','PEBBLE_WFE_NONCEREJECT=0','-e','PEBBLE_AUTHZREUSE=0','-v',`${root}:/fixture:ro`,'ghcr.io/letsencrypt/pebble:latest','-config','/fixture/pebble.json')
 await wait(1000)
 const pebbleRoot=docker('run','--rm','--network',`container:${front}`,'-v',`${root}/ca.pem:/fixture/ca.pem:ro`,'--entrypoint','node',image,'-e',`require('https').get({host:'127.0.0.1',port:15000,path:'/roots/0',servername:'${domain}',ca:require('fs').readFileSync('/fixture/ca.pem')},r=>r.pipe(process.stdout)).on('error',e=>{console.error(e.message);process.exitCode=1})`)
 fs.writeFileSync(path.join(root,'trust.pem'),ca.toString()+pebbleRoot+'\n')
 const startAgent=async(stateReadOnly=false,certReadOnly=false)=>{docker('run','-d','--name',agent,'--pid',`container:${front}`,'--network',`container:${front}`,'--read-only','--cap-drop','ALL','--cap-add','KILL','--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','--cap-add','SETUID','--cap-add','SETGID','--security-opt','no-new-privileges:true','--tmpfs','/tmp','--tmpfs','/run','--tmpfs','/var/cache/nginx','-e',`TLS_DOMAIN=${domain}`,'-e','TLS_TRUST_FILE=/fixture/trust.pem','-e','NODE_EXTRA_CA_CERTS=/fixture/trust.pem','-e',`TLS_ACME_DIRECTORY=https://${domain}:14000/dir`,'-e','REQUESTS_CA_BUNDLE=/fixture/trust.pem','-v',`${root}/certs:/etc/nginx/certs${certReadOnly?":ro":""}`,'-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'-v',`${root}/state:/var/lib/nodeaccess-tls${stateReadOnly?":ro":""}`,'-v',`${root}/control:/run/nodeaccess-tls`,'-v',`${root}/challenge:/var/www/acme`,'-v',`${root}/acme:/var/lib/nodeaccess-acme`,'-v',`${root}/trust.pem:/fixture/trust.pem:ro`,'--entrypoint','sh',image,'/opt/nodeaccess-tls/entrypoint.sh');await grantRunnerControlAccess()}
 const request=(method,url,body)=>new Promise((resolve,reject)=>{const req=http.request({socketPath:path.join(root,'control/control.sock'),path:url,method,headers:{'Content-Type':'application/json','X-NodeAccess-Actor':'integration'}},res=>{let data='';res.on('data',d=>data+=d);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data)}))});req.on('error',reject);req.end(body?JSON.stringify(body):undefined)})
 for(let attempt=0;attempt<3;attempt++){await startAgent();await until(async()=>(await request('GET','/status')).status===200);if(attempt<2)docker('rm','-f',agent)}
 const savedState=readFixtureState()
 assert.throws(()=>docker('exec',agent,'sh','/opt/nodeaccess-tls/entrypoint.sh'),e=>String(e.stderr).includes('Another TLS worker'))
 assert.equal(readFixtureState(),savedState)
 fs.mkdirSync(path.join(root,'challenge/.well-known/acme-challenge'),{recursive:true});fs.writeFileSync(path.join(root,'challenge/.well-known/acme-challenge/probe'),'challenge-ok')
 assert.equal(await (await fetch(`http://127.0.0.1:${httpPort}/.well-known/acme-challenge/probe`)).text(),'challenge-ok')
 websocket=new WebSocket(`wss://127.0.0.1:${port}${gatewayPath}`,{servername:domain,ca});await new Promise((resolve,reject)=>{websocket.once('open',resolve);websocket.once('error',reject)})
 let output='';websocket.on('message',d=>output+=d);await until(()=>output.length>0)
 const shellProbe=async()=>{const marker=crypto.randomBytes(8).toString('hex');websocket.send(`printf '%s%s\\n' '${marker.slice(0,8)}' '${marker.slice(8)}'\r`);await until(()=>output.includes(marker))}
 await shellProbe()
 try{docker('exec',agent,'nginx','-t')}catch(e){throw Error('Worker nginx validation: '+e.stderr)}
 const submit=async body=>{const r=await request('POST','/operations',{requestId:crypto.randomUUID(),expectedFingerprint:await inspect(),...body});assert.equal(r.status,202,JSON.stringify(r));return until(async()=>{const state=(await request('GET','/status')).data;return state.job.id===r.data.id&&state.job.status!=='running'?state:null})}
 let state=await submit({action:'validate',certificate:fs.readFileSync(path.join(root,'new.pem'),'utf8')+ca.toString(),privateKey:fs.readFileSync(path.join(root,'new.key'),'utf8')});assert.equal(state.job.status,'succeeded',JSON.stringify(state.job));const candidate=state.candidate
 state=await submit({action:'apply',candidateId:candidate.id});assert.equal(state.job.status,'succeeded',JSON.stringify(state.job));assert.equal(await inspect(),candidate.fingerprint);assert.notEqual(candidate.fingerprint,oldFingerprint);await shellProbe();assert.equal(wsConnections,1);assert.equal(sshConnections,1)
 state=await submit({action:'validate',certificate:oldCert.toString()+ca.toString(),privateKey:fs.readFileSync(path.join(root,'old.key'),'utf8')});assert.equal(state.job.status,'succeeded')
 // Inject a syntax error in the test-only config. Existing workers keep serving TLS and SSH.
 fs.appendFileSync(path.join(root,'nginx.conf'),'\ninvalid_test_directive;\n')
 state=await submit({action:'apply',candidateId:state.candidate.id});assert.equal(state.job.status,'failed');assert.equal(state.job.error.code,'ROLLBACK_FAILED');assert.equal(await inspect(),candidate.fingerprint);await shellProbe()
 fs.writeFileSync(path.join(root,'nginx.conf'),config)
 docker('restart',agent);await grantRunnerControlAccess();await until(async()=>{const s=(await request('GET','/status')).data;return s.job.status==='failed'&&!s.recoveryRequired})
 assert.equal(await inspect(),candidate.fingerprint);await shellProbe()
 assert.equal(sshConnections,1);assert.equal(wsConnections,1)
 state=await submit({action:'automatic',email:'ops@example.test',agreeTerms:true});assert.equal(state.job.status,'succeeded',JSON.stringify(state.job));assert.equal(state.mode,'automatic');const issuedFingerprint=await inspect();assert.notEqual(issuedFingerprint,candidate.fingerprint);await shellProbe()
 state=await submit({action:'renew'});assert.equal(state.job.status,'succeeded',JSON.stringify(state.job));assert.equal(await inspect(),issuedFingerprint);await shellProbe()
 state=await submit({action:'simulate'});assert.equal(state.job.status,'succeeded',JSON.stringify(state.job));await shellProbe()
 fs.writeFileSync(path.join(root,'nginx.conf'),config.replace('try_files $uri =404;', 'return 404;'));docker('exec',front,'nginx','-s','reload');await wait(300)
 state=await submit({action:'simulate'});assert.equal(state.job.status,'failed');assert.equal(state.job.error.code,'HTTP01_LOCAL_FAILED');assert.equal(await inspect(),issuedFingerprint);await shellProbe()
 fs.writeFileSync(path.join(root,'nginx.conf'),config);docker('exec',front,'nginx','-s','reload');await wait(300)
 state=await submit({action:'simulate'});assert.equal(state.job.status,'succeeded',JSON.stringify(state.job));await shellProbe();assert.equal(sshConnections,1);assert.equal(wsConnections,1)
 // A real read-only state volume must leave both certificate and live shell untouched.
 const committed=readFixtureState()
 docker('rm','-f',agent);await startAgent(true)
 await until(async()=>{const status=(await request('GET','/status')).data;return status.alerts?.some(alert=>alert.code==='STORAGE_READ_ONLY')})
 assert.equal(readFixtureState(),committed)
 assert.equal((await request('POST','/operations',{action:'check',requestId:crypto.randomUUID()})).status,409)
 assert.equal(await inspect(),issuedFingerprint);await shellProbe()
 docker('rm','-f',agent);await startAgent()
 await until(async()=>{const status=(await request('GET','/status')).data;return status.available&&!status.recoveryRequired})
 docker('rm','-f',agent);await startAgent(false,true)
 await until(async()=>(await request('GET','/status')).data.available)
 state=await submit({action:'validate',certificate:oldCert.toString()+ca.toString(),privateKey:fs.readFileSync(path.join(root,'old.key'),'utf8')})
 assert.equal(state.job.error.code,'STORAGE_READ_ONLY');assert.equal(await inspect(),issuedFingerprint);await shellProbe()
 docker('rm','-f',agent);await startAgent()
 await until(async()=>{const status=(await request('GET','/status')).data;return status.available&&!status.recoveryRequired})
 const events=(await request('GET','/events')).data.events;assert.ok(events.some(event=>event.type==='operation.completed'))
 assert.ok(!JSON.stringify(events).includes('PRIVATE KEY'));await shellProbe()
 const report={passed:true,runnerSocketOwnership:true,readOnlyVolumeRecovery:true,readOnlyCertificatesRecovery:true,durableAuditOutbox:true,installationPreparation:true,repeatedStartup:true,singleWorkerLock:true,realNginx:true,realCertbotAcme:true,realHttp01:true,blockedChallengeRecovery:true,dryRun:true,realTlsSwap:true,workerPrivileges:true,acmeWebroot:true,realSshPty:true,websocketPreserved:true,sshConnections,wsConnections,failedConfigPreservesLiveSession:true,workerRestartRecovery:true}
 fs.writeFileSync('/tmp/nodeaccess-tls-integration.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}
main().catch(e=>{console.error(e.message);const log=path.join(root,"acme/logs/letsencrypt.log");if(fs.existsSync(log))console.error(fs.readFileSync(log,"utf8").split("\n").filter(line=>/SSLError|CERTIFICATE_VERIFY_FAILED|requests.exceptions|urllib3.exceptions/.test(line)).slice(-8).join("\n"));try{console.error(docker('inspect',agent,'--format','{{json .State}}'));console.error(docker('exec',agent,'sh','-c','ps; ls -ld /run/nodeaccess-tls /var/lib/nodeaccess-tls; ls -l /run/nodeaccess-tls /var/lib/nodeaccess-tls'))}catch{};try{console.error(docker('logs','--tail','15',front))}catch{};try{execFileSync('docker',['logs','--tail','15',agent],{stdio:'inherit'})}catch{};try{console.error(docker('logs','--tail','15',pebble))}catch{};process.exitCode=1}).finally(async()=>{websocket?.terminate();for(const c of clients)c.end();for(const shell of shells)shell.kill();gateway?.close();sshServer?.close();for(const name of [agent,pebble,front])try{docker('rm','-f',name)}catch{};/* Worker state stays private during tests; return only the disposable tree for host cleanup. */try{docker('run','--rm','-v',`${root}:/fixture`,'--entrypoint','chown',image,'-R',`${runnerUid}:${runnerGid}`,'/fixture')}catch{};fs.rmSync(root,{recursive:true,force:true})})
