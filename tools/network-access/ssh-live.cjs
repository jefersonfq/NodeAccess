// Opt-in gateway test. Refuses any target outside the disposable loopback SSH lab.
const assert=require('node:assert/strict'),jwt=require('jsonwebtoken'),{WebSocket}=require('ws'),fs=require('node:fs')
if(process.env.RUN_NETWORK_SSH_LIVE!=='true')throw Error('Set RUN_NETWORK_SSH_LIVE=true with a disposable HOST_ID')
const hostId=Number(process.env.HOST_ID),api=process.env.API_BASE||'http://127.0.0.1:3020',gateway=process.env.GATEWAY_BASE||'ws://127.0.0.1:3019'
const token=jwt.sign({sub:process.env.ADMIN_USER_ID||'1',tenantId:Number(process.env.TENANT_ID||1),role:'admin',email:process.env.ADMIN_EMAIL||'admin@nodeaccess.local',stage:'authenticated',sessionVersion:0,canManageHosts:true,canViewLiveSessions:true},process.env.JWT_SECRET,{expiresIn:'10m'})
const headers={authorization:'Bearer '+token,'content-type':'application/json'}
let socket,original
async function profile(value){const r=await fetch(`${api}/api/v1/hosts/${hostId}`,{method:'PATCH',headers,body:JSON.stringify({deviceProfile:value})});assert.equal(r.status,200,await r.text())}
;(async()=>{
 const response=await fetch(`${api}/api/v1/hosts/${hostId}`,{headers});assert.equal(response.status,200)
 const host=await response.json();assert.equal(host.ip,'127.0.0.1');assert.equal(host.port,2249);original=host.deviceProfile??'server_ssh'
 try{
  await profile('network_generic')
  const read=await fetch(`${api}/api/v1/hosts/${hostId}`,{headers});assert.equal((await read.json()).deviceProfile,'network_generic')
  const sftp=await fetch(`${api}/api/v1/sftp/${hostId}/list?path=/`,{headers});assert.equal(sftp.status,403);assert.match(await sftp.text(),/SFTP indisponível/)
  const controls=[],output=[]
  await new Promise((resolve,reject)=>{
   const deadline=setTimeout(()=>reject(Error('Gateway network-profile test timeout')),20000)
   socket=new WebSocket(`${gateway}/ws/ssh/${hostId}?token=${encodeURIComponent(token)}&cols=100&rows=30`)
   socket.on('error',reject)
   socket.on('message',(data,isBinary)=>{
    if(isBinary){output.push(data.toString());return}
    let msg;try{msg=JSON.parse(data.toString())}catch{return}
    controls.push(msg)
    if(msg.type==='connected'){
     socket.send(JSON.stringify({type:'sftp_list',requestId:'profile-sftp',path:'/'}))
     socket.send(JSON.stringify({type:'snippet_input',snippetId:1,executionId:'network-test',text:'printf do-not-run\r'}))
     socket.send(Buffer.from("printf 'network-profile-ok\\n'\r"))
     setTimeout(()=>{clearTimeout(deadline);resolve()},1500)
    }
   })
  })
  fs.writeFileSync('/tmp/nodeaccess-network-ssh-debug.json',JSON.stringify({controls:controls.map(m=>({type:m.type,code:m.code,status:m.status,ok:m.ok})),output:output.join('')},null,2))
  assert.ok(controls.some(m=>m.type==='sftp_result'&&m.code==='SFTP_UNAVAILABLE'&&!m.ok))
  assert.ok(controls.some(m=>m.code==='DEVICE_PROFILE_AUTOMATION_UNSUPPORTED'))
  assert.ok(!controls.some(m=>m.type==='sftp_status'&&m.status==='warming'))
  assert.ok(output.join('').includes('network-profile-ok'))
  assert.ok(!output.join('').includes('do-not-run'))
  assert.equal(socket.readyState,WebSocket.OPEN)
  const report={ok:true,hostId,apiPersistsProfile:true,apiSftpDenied:true,websocketSftpDenied:true,noSftpWarmup:true,serverSnippetDenied:true,realSshInputWorks:true,sessionPreserved:true}
  fs.writeFileSync('/tmp/nodeaccess-network-ssh.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
 }finally{socket?.close();if(original)await profile(original)}
})().catch(e=>{socket?.terminate();console.error(e.message);process.exitCode=1})
