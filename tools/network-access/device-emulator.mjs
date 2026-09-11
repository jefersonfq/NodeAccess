// Laboratory CLI, NOT Cisco/Juniper firmware. Never executes OS commands.
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import ssh2 from 'ssh2'
const { Server, Client } = ssh2
import { createTacacsServer } from '../../apps/backend/src/modules/network-access/tacacs-server.ts'

export async function runDeviceEmulation({ service, probe, setCommands }) {
  let primary=createTacacsServer(service)
  await new Promise(resolve=>primary.server.listen(0,'127.0.0.1',resolve))
  const secondary=createTacacsServer(service)
  await new Promise(resolve=>secondary.server.listen(0,'127.0.0.1',resolve))
  const secondaryPort=secondary.server.address().port
  let firstPort=primary.server.address().port, hostname='lab-switch', fallbackCalls=0, denied=0
  const checks=[]
  const aaa=async(action,extra={})=>{
    const first=await probe(action,{...extra,port:firstPort})
    // Explicit denials never fall back to a different policy/identity.
    if(!first.unavailable&&first.status!==({pap:7,ascii:7,authorize:17,accounting:2}[action]))return first
    fallbackCalls++;return probe(action,{...extra,port:secondaryPort})
  }
  const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'})
  const sockets=new Set(),ssh=new Server({hostKeys:[key]},connection=>{
    sockets.add(connection);connection.on('close',()=>sockets.delete(connection));connection.on('error',()=>{})
    let username=''
    connection.on('authentication',ctx=>{
      if(ctx.method!=='password')return ctx.reject(['password'])
      void aaa('pap',{username:ctx.username,password:ctx.password}).then(result=>{if(result.valid){username=ctx.username;ctx.accept()}else ctx.reject()}).catch(()=>ctx.reject())
    })
    connection.on('ready',()=>connection.on('session',accept=>{
      const session=accept();session.on('pty',accept=>accept())
      session.on('shell',accept=>{
        const stream=accept();let buffer='',chain=Promise.resolve()
        stream.write('NodeAccess laboratory CLI (simulated device)\r\n'+hostname+'# ')
        stream.on('data',data=>{
          buffer+=data.toString()
          if(buffer.length>4096){stream.end();return}
          const lines=buffer.split(/\r?\n/);buffer=lines.pop()
          for(const line of lines)chain=chain.then(async()=>{
            const tokens=line.trim().split(/\s+/),args=['service=shell','cmd='+tokens[0],...tokens.slice(1).map(t=>'cmd-arg='+t)]
            const authorized=await aaa('authorize',{username,args})
            if(!authorized.valid){denied++;stream.write('% AAA denied or unavailable\r\n'+hostname+'# ');return}
            const audit=await aaa('accounting',{username,args,flags:2})
            if(!audit.valid){stream.write('% Accounting unavailable; command not executed\r\n'+hostname+'# ');return}
            let output='% Unsupported laboratory command'
            if(line==='show version')output='NodeAccess simulated network OS 1.0'
            if(line==='show interfaces')output='Ethernet0 up; Ethernet1 down'
            if(tokens[0]==='hostname'&&tokens.length===2&&/^[a-z0-9-]+$/.test(tokens[1])){hostname=tokens[1];output='Hostname updated'}
            stream.write(output+'\r\n'+hostname+'# ')
          }).catch(()=>stream.end())
        })
      })
    }))
  })
  await new Promise(resolve=>ssh.listen(0,'127.0.0.1',resolve))
  const connect=async(password='disposable-aaa-password')=>{
    const c=new Client()
    await new Promise((resolve,reject)=>{c.once('ready',resolve);c.once('error',reject);c.connect({host:'127.0.0.1',port:ssh.address().port,username:'alice',password,readyTimeout:8000})}).catch(e=>{c.destroy();throw e})
    return c
  }
  const shell=async()=>{
    const client=await connect(),stream=await new Promise((resolve,reject)=>client.shell((e,s)=>e?reject(e):resolve(s)))
    let buffer=''
    stream.on('data',data=>buffer+=data.toString())
    const wait=async expected=>{const until=Date.now()+8000;while(!buffer.includes(expected)){if(Date.now()>until)throw Error('Emulated CLI response deadline exceeded');await new Promise(r=>setTimeout(r,10))}const result=buffer;buffer='';return result}
    await wait('# ')
    return {client,command:async command=>{stream.write(command+'\n');return wait('# ')}}
  }
  let session
  try{
    await assert.rejects(connect('wrong-password'));assert.equal(fallbackCalls,0);checks.push('SSH password denial does not trigger AAA fallback')
    session=await shell()
    assert.match(await session.command('show version'),/simulated network OS/)
    assert.match(await session.command('hostname changed'),/AAA denied/);assert.equal(hostname,'lab-switch')
    checks.push('SSH query allowed and unauthorized configuration never changes device state')
    await setCommands([['show','version'],['show','interfaces'],['hostname','changed']])
    assert.match(await session.command('hostname changed'),/Hostname updated/);assert.equal(hostname,'changed')
    checks.push('explicit configuration grant changes simulated device state')
    await setCommands([['show','version']])
    assert.match(await session.command('show interfaces'),/AAA denied/)
    checks.push('policy revocation takes effect inside an already open SSH session')
    await primary.close()
    assert.match(await session.command('show version'),/simulated network OS/);assert.ok(fallbackCalls>0)
    checks.push('closed primary AAA listener uses secondary service over TCP')
    await secondary.close()
    assert.match(await session.command('hostname changed'),/AAA denied/);assert.equal(hostname,'changed')
    checks.push('both AAA services unavailable never permit a configuration command')
    primary=createTacacsServer(service)
    await new Promise(resolve=>primary.server.listen(0,'127.0.0.1',resolve));firstPort=primary.server.address().port
    assert.match(await session.command('show version'),/simulated network OS/)
    checks.push('existing SSH session recovers when primary AAA returns')
    return {ok:true,checks,denied,fallbackCalls,firmware:false,transport:'real SSH + independent Python TACACS+ client',primaryOutage:'primary TCP listener closed; independent listeners share one laboratory process/database'}
  }finally{
    session?.client.destroy();for(const socket of sockets)socket.end()
    await new Promise(resolve=>ssh.close(resolve));if(secondary.server.listening)await secondary.close();if(primary.server.listening)await primary.close()
    await setCommands([['show','version']])
  }
}
