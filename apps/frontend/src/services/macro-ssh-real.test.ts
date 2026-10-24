import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, type ClientChannel } from 'ssh2'
import { MacroRunner, type MacroProgress } from './macro-runner'
import type { MacroStep } from '@nodeaccess/shared'
import { macroTemplate } from './macro-templates'

const enabled = process.env.MACRO_SSH_REAL === '1'
const docker = (...args: string[]) => execFileSync('docker', args, {encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
describe.skipIf(!enabled)('macros against disposable OpenSSH and PTY', () => {
  it('runs shell output, waits, fragmented edits, cancel, timeout and disconnect', async () => {
    const name = 'nodeaccess-macro-real-' + Date.now()
    const password = 'Disposable-macro-' + Date.now()
    docker('run','-d','--rm','--name',name,'-p','127.0.0.1::2222','-e','USER_NAME=macro','-e','PASSWORD_ACCESS=true','-e','SUDO_ACCESS=false','-e','USER_PASSWORD='+password,'lscr.io/linuxserver/openssh-server:latest')
    const client = new Client()
    client.on('error',()=>{})
    try {
      const port = Number(docker('port',name,'2222/tcp').split(':').at(-1))
      let connected = false
      for(let attempt=0;attempt<30;attempt++){
        try {
          await new Promise<void>((resolve,reject)=>{
            const ready=()=>{cleanup();resolve()},error=(err:Error)=>{cleanup();reject(err)}
            const cleanup=()=>{client.off('ready',ready);client.off('error',error)}
            client.once('ready',ready).once('error',error).connect({host:'127.0.0.1',port,username:'macro',password,readyTimeout:2000})
          });connected=true;break
        } catch { await delay(500) }
      }
      expect(connected).toBe(true)
      client.on('error',()=>{})
      const shell = await new Promise<ClientChannel>((resolve,reject)=>client.shell({term:'xterm',cols:80,rows:24},(err,channel)=>err?reject(err):resolve(channel)))
      let active: MacroRunner | null = null
      let closed = false
      shell.on('data',(chunk:Buffer)=>active?.push(chunk.toString()))
      shell.on('close',()=>{closed=true;active?.cancel()})
      const statuses: MacroProgress[] = []
      const send = (text:string)=>{if(closed)throw Error('disconnected');shell.write(text)}
      const matcher = (pattern:string,text:string)=>{const result=new RegExp(pattern).exec(text);return Promise.resolve(result?result.index+result[0].length:null)}
      const run = async(steps:MacroStep[])=>{
        active = new MacroRunner(steps,send,matcher,state=>statuses.push(state))
        const result=await active.run();active=null;return result
      }
      const sendStep=(text:string):MacroStep=>({type:'send',text,enter:true})
      const waitStep=(pattern:string,timeoutMs=5000):MacroStep=>({type:'wait',pattern,timeoutMs,mode:'literal',caseSensitive:true})
      // Split marker prevents echoed command text from satisfying the wait.
      expect((await run([sendStep("stty -echo; printf '\\nNA_%s\\n' BOOT"),waitStep('NA_BOOT')])).status).toBe('completed')
      expect((await run(macroTemplate('diagnostic'))).status).toBe('completed')
      expect((await run([sendStep("printf 'ab'; sleep 0.1; printf '\\bc\\n'"),waitStep('ac')])).status).toBe('completed')
      expect((await run([waitStep('NEVER',150)])).error).toBe('timeout')
      const cancelled=run([{type:'pause',durationMs:30000},sendStep('echo NEVER')])
      const currentRunner = (): MacroRunner | null => active
      currentRunner()?.cancel()
      expect((await cancelled).status).toBe('cancelled')
      // Recovery after timeout/cancel keeps the shell usable.
      expect((await run([sendStep("printf 'NA_%s\\n' RECOVERED"),waitStep('NA_RECOVERED')])).status).toBe('completed')
      const disconnected=run([waitStep('NEVER')])
      shell.end('exit\n')
      expect((await disconnected).status).toBe('cancelled')
      expect(statuses.some(state=>state.status==='failed')).toBe(true)
    } finally {
      client.end()
      docker('rm','-f',name)
    }
  }, 90000)
})
