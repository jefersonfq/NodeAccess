// Child process used only by the opt-in test suite; no network or production configuration.
import fs from 'node:fs/promises'
import path from 'node:path'
import {CertificateManager} from './manager.mjs'
const [root,stateDir,phase,certFile,keyFile]=process.argv.slice(2)
const pause=async name=>{if(name===phase){process.send({phase:name});await new Promise(()=>{})}}
const adapter={test:()=>pause('nginx'),reload:()=>pause('reload'),verify:()=>pause('verify'),validateChain:()=>pause('chain'),inspect:async()=>({})}
const manager=new CertificateManager({root,stateDir,domain:'tls.example.test',adapter})
await manager.init()
if(phase==='pointer'){const point=manager.point.bind(manager);manager.point=async target=>{await pause('pointer');await point(target)}}
const operation=phase==='chain'
 ? {action:'validate',certificate:await fs.readFile(certFile,'utf8'),privateKey:await fs.readFile(keyFile,'utf8')}
 : {action:'apply',candidateId:manager.state.candidate.id}
await manager.submit({...operation,expectedFingerprint:(await manager.active()).fingerprint},'user:1')
await manager.completion
