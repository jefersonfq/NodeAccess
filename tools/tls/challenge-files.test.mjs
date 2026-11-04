import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createChallengeFile } from './challenge-files.mjs'
async function fixture(t) { const root=await fs.mkdtemp(path.join(os.tmpdir(),'na0149-challenge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root }
test('challenge creates public nonce exclusively and removes only its own file',async t=>{
 const root=await fixture(t);const first=await createChallengeFile(root),second=await createChallengeFile(root)
 assert.notEqual(first.file,second.file);assert.equal(await fs.readFile(first.file,'utf8'),first.name);assert.equal((await fs.stat(first.file)).mode&0o777,0o644)
 await first.remove();await assert.rejects(fs.stat(first.file),{code:'ENOENT'});assert.equal(await fs.readFile(second.file,'utf8'),second.name);await second.remove()
})
test('rejects root and challenge symlinks without chmod or creating outside files',async t=>{
 const root=await fixture(t);const outside=await fixture(t);await fs.chmod(outside,0o750)
 const link=path.join(root,'link');await fs.symlink(outside,link)
 await assert.rejects(createChallengeFile(link),/UNSAFE_WEBROOT/)
 await fs.symlink(outside,path.join(root,'.well-known'));await assert.rejects(createChallengeFile(root),/UNSAFE_WEBROOT/)
 assert.equal((await fs.stat(outside)).mode&0o777,0o750);assert.deepEqual(await fs.readdir(outside),[])
})
test('rejects writable webroot and existing challenge directory without tightening it silently',async t=>{
 const root=await fixture(t);await fs.chmod(root,0o777);await assert.rejects(createChallengeFile(root),/UNSAFE_WEBROOT/);assert.equal((await fs.stat(root)).mode&0o777,0o777)
 await fs.chmod(root,0o700);const child=path.join(root,'.well-known');await fs.mkdir(child);await fs.chmod(child,0o777)
 await assert.rejects(createChallengeFile(root),/UNSAFE_WEBROOT/);assert.equal((await fs.stat(child)).mode&0o777,0o777);assert.deepEqual(await fs.readdir(child),[])
})


test('a distinct unprivileged HTTP reader can read the public nonce but cannot modify it', { skip: process.getuid?.() !== 0 }, async t => {
 const root = await fixture(t); await fs.chmod(root, 0o755)
 const challenge = await createChallengeFile(root)
 const source = `process.setgroups([]); process.setgid(65534); process.setuid(65534); const fs = require('node:fs'); const file = process.argv[1]; const content = fs.readFileSync(file, 'utf8'); let denied = false; try { fs.writeFileSync(file, 'changed') } catch (error) { denied = error.code === 'EACCES' } console.log(JSON.stringify({uid:process.getuid(),content,denied}));`
 const reader = spawnSync(process.execPath, ['-e', source, challenge.file], { encoding: 'utf8', timeout: 3000 })
 assert.equal(reader.status, 0, reader.stderr)
 const result = JSON.parse(reader.stdout)
 assert.equal(result.uid, 65534); assert.equal(result.content, challenge.name); assert.equal(result.denied, true)
 assert.equal(await fs.readFile(challenge.file, 'utf8'), challenge.name)
 for (const directory of [path.dirname(challenge.file), path.dirname(path.dirname(challenge.file))]) assert.equal((await fs.stat(directory)).mode & 0o777, 0o755)
 await challenge.remove(); await assert.rejects(fs.stat(challenge.file), { code: 'ENOENT' })
})
