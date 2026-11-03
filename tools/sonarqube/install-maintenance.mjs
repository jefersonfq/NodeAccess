import {lstat,mkdir,chmod,readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {writePrivate,failure} from './maintenance-common.mjs'
const destination='/usr/local/lib/nodeaccess-sonarqube-maintenance'
export async function installMaintenance(){
 if(process.getuid()!==0)throw failure('ROOT_REQUIRED')
 for(const path of ['/usr','/usr/local','/usr/local/lib','/etc','/etc/cron.d']){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw failure('UNTRUSTED_INSTALL_PARENT')}
 await mkdir(destination,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e})
 const stat=await lstat(destination);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077))throw failure('UNTRUSTED_INSTALL_DIRECTORY')
 const release=join(destination,`release-${randomUUID()}`);await mkdir(release,{mode:0o700})
 const source=dirname(fileURLToPath(import.meta.url)),owner={uid:0,gid:0}
 for(const name of ['maintenance-common.mjs','recovery.mjs','token-maintenance.mjs','maintenance.mjs'])await writePrivate(join(release,name),await readFile(join(source,name)),owner)
 await writePrivate(join(release,'node'),await readFile(process.execPath),owner);await chmod(join(release,'node'),0o700)
 const cron=`# NodeAccess NA-0091: local backup and scoped-token renewal. No kernel changes.\nSHELL=/bin/sh\nPATH=/usr/bin:/bin\n20 3 * * * root ${release}/node ${release}/maintenance.mjs >/dev/null 2>&1\n`
 const target='/etc/cron.d/nodeaccess-sonarqube-maintenance'
 await writePrivate(target,cron,owner,{publicDirectory:true});await chmod(target,0o644)
 return {installed:true,schedule:'03:20 daily (host timezone)',runtime:release,status:'/home/jeferson/services/sonarqube/maintenance-status.json'}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await installMaintenance()))}catch(error){console.error(error.code??'INSTALL_FAILED');process.exitCode=1}}
