import { lstat, mkdir, open, rename, unlink, realpath } from 'node:fs/promises'
import { resolve, dirname, join, basename } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { spawnSync } from 'node:child_process'

export const DEFAULT_RUNTIME = '/home/jeferson/services/sonarqube'
export function failure(code) { const error = new Error(code); error.code = code; return error }
export async function privateDirectory(value, owner, create = false) {
  const path = resolve(value)
  if(create){
    const parent=await directoryHandle(dirname(path),owner)
    let child
    try{
      const anchored=`/proc/self/fd/${parent.fd}/${basename(path)}`
      await mkdir(anchored,{mode:0o700})
      child=await open(anchored,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
      if(owner&&process.getuid()===0)await child.chown(owner.uid,owner.gid)
    }finally{await child?.close();await parent.close()}
  }
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path || (stat.mode & 0o077)
    || (owner && stat.uid !== owner.uid)) throw failure('PRIVATE_DIRECTORY_REQUIRED')
  return { path, uid: stat.uid, gid: stat.gid }
}
async function directoryHandle(path,owner,{publicDirectory=false}={}) {
  const directory=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
  const stat=await directory.stat()
  if(!stat.isDirectory()||(owner&&stat.uid!==owner.uid)||(stat.mode&(publicDirectory?0o022:0o077))){await directory.close();throw failure('UNSAFE_PARENT')}
  return directory
}
async function withPrivateFile(path,{privateMode=true,owner={uid:process.getuid(),gid:process.getgid()}},consume){
  const directory=await directoryHandle(dirname(path),owner)
  let file
  try{
    file=await open(`/proc/self/fd/${directory.fd}/${basename(path)}`,constants.O_RDONLY|constants.O_NOFOLLOW)
    const stat=await file.stat()
    if(!stat.isFile()||(privateMode&&stat.mode&0o077)||stat.uid!==owner.uid)throw failure('UNSAFE_FILE')
    return await consume(file,stat)
  }catch(error){if(error.code==='ELOOP')throw failure('UNSAFE_FILE');throw error}
  finally{await file?.close();await directory.close()}
}
export async function readFileSafe(path,options={}){
  return withPrivateFile(path,options,async(file,stat)=>{
    if(stat.size>(options.maxBytes??512*1024*1024))throw failure('FILE_SIZE_LIMIT')
    const chunks=[];let size=0
    for await(const chunk of file.createReadStream({autoClose:false})){size+=chunk.length;if(size>(options.maxBytes??512*1024*1024))throw failure('FILE_SIZE_LIMIT');chunks.push(chunk)}
    return Buffer.concat(chunks)
  })
}
export async function writePrivate(path, content, owner, {publicDirectory=false}={}) {
  const fileOwner=owner===undefined?{uid:process.getuid(),gid:process.getgid()}:owner
  const directory=await directoryHandle(dirname(path),fileOwner,{publicDirectory})
  const base=`/proc/self/fd/${directory.fd}`,target=join(base,basename(path)),temporary=join(base,`.write-${randomUUID()}`)
  let file
  try {
    const previous=await lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e})
    if(previous&&(!previous.isFile()||previous.isSymbolicLink()||previous.uid!==fileOwner.uid))throw failure('UNSAFE_FILE')
    file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
    await file.writeFile(typeof content==='object'&&!Buffer.isBuffer(content)?JSON.stringify(content,null,2)+'\n':content)
    if(process.getuid()===0)await file.chown(fileOwner.uid,fileOwner.gid)
    await file.sync();await file.close();file=undefined
    await rename(temporary,target);await directory.sync()
  }finally{await file?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e});await directory.close()}
}
export async function digest(path,owner){
 return withPrivateFile(path,{owner},async file=>{const hash=createHash('sha256');for await(const chunk of file.createReadStream({autoClose:false}))hash.update(chunk);return hash.digest('hex')})
}
export async function privateLock(path,owner){
 const directory=await directoryHandle(dirname(path),owner),anchored=`/proc/self/fd/${directory.fd}/${basename(path)}`
 let file
 try{file=await open(anchored,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)}catch(error){await directory.close();throw error}
 return {async close(){try{await file.close();await unlink(anchored)}finally{await directory.close()}}}
}
export async function privateInput(path,owner,consume){return withPrivateFile(path,{owner},file=>consume(file.fd))}
export async function privateOutput(path,owner,produce){
 const directory=await directoryHandle(dirname(path),owner);let file
 try{
  file=await open(`/proc/self/fd/${directory.fd}/${basename(path)}`,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
  if(process.getuid()===0)await file.chown(owner.uid,owner.gid)
  await produce(file.fd);await file.sync()
 }finally{await file?.close();await directory.close()}
}
export function docker(args, { input, inputFile, output, timeout = 120_000 } = {}) {
  const result = spawnSync('/usr/bin/docker', args, { input, encoding: output === undefined ? 'utf8' : undefined,
    stdio: [inputFile ?? 'pipe', output ?? 'pipe', 'pipe'], timeout, maxBuffer: 8 * 1024 * 1024, shell: false })
  if (result.status !== 0) { const error=failure('DOCKER_OPERATION_FAILED'); error.operation=args.slice(0,3).join(' '); throw error }
  return output === undefined ? result.stdout.trim() : undefined
}
export function localOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw failure('LOOPBACK_REQUIRED')
  return url.origin
}
export function api(origin, credentials) {
  const base = localOrigin(origin)
  const authorization = credentials.token ? `Bearer ${credentials.token}` : `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64')}`
  return async (path, parameters = {}, method = 'GET') => {
    if (!path.startsWith('/api/') || path.startsWith('//')) throw failure('API_PATH_INVALID')
    const url = new URL(path, base), body = new URLSearchParams(parameters)
    if (method === 'GET') url.search = body.toString()
    const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: authorization, Accept: 'application/json', ...(method === 'POST' ? {'Content-Type':'application/x-www-form-urlencoded'} : {}) },
      ...(method === 'POST' ? {body} : {}) })
    let data = null
    if (response.status !== 204) { try { data = await response.json() } catch {} }
    return { status: response.status, data, endpoint:path }
  }
}
export function requireOk(response) { if(response.status<200||response.status>=300){const error=failure('SONAR_API_FAILED');error.operation=response.endpoint;error.status=response.status;throw error}return response.data }
export async function runtimeCredentials(runtime) {
  const owner = await privateDirectory(runtime)
  const credentials = JSON.parse(await readFileSafe(join(runtime, 'credentials.json'), {owner}))
  for (const key of ['admin_login','admin_password','review_login','review_password','analysis_token','review_token']) if (typeof credentials[key] !== 'string' || !credentials[key]) throw failure('CREDENTIALS_INVALID')
  return {owner, credentials}
}
