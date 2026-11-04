import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { resolveExecutable } from '../shared/trusted-executable.cjs'
function run(t, failCreate = false) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'na0149-helm-')); t.after(() => fs.rmSync(root, {recursive:true,force:true}))
 const record = path.join(root,'calls.jsonl')
 const programs = {}
 for (const name of ['kind','kubectl','helm']) {
  const file=path.join(root,name);programs[name]=file
  fs.writeFileSync(file,`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({name:${JSON.stringify(name)},args:args.filter(v=>!v.startsWith('--from-literal='))})+'\\n');
if(${JSON.stringify(name)}==='kind'&&args[0]==='create'&&${failCreate})process.exit(17);
if(args.includes('pod'))console.log('pod-fixture');else if(args.includes('pvc'))console.log('pvc-fixture');else if(args.includes('deployment')||args.includes('list'))console.log('smollm2:135m');else if(args.includes('run'))console.log('fixture');\n`,{mode:0o700})
 }
 const result=spawnSync(resolveExecutable('bash'),['tools/deploy/helm-ollama-kind-certification.sh'],{encoding:'utf8',timeout:10000,env:{...process.env,KIND_BIN:programs.kind,KUBECTL_BIN:programs.kubectl,HELM_BIN:programs.helm,CLUSTER_NAME:'na0149-fixture'}})
 return {result,calls:fs.readFileSync(record,'utf8').trim().split('\n').map(line=>JSON.parse(line))}
}
test('all kubectl and Helm operations bind to the newly created kind context',t=>{
 const {result,calls}=run(t);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).rollback,true)
 const kube=calls.filter(call=>call.name==='kubectl'),helm=calls.filter(call=>call.name==='helm')
 assert.ok(kube.length>=10);assert.equal(helm.length,3)
 for(const call of kube)assert.deepEqual(call.args.slice(0,2),['--context','kind-na0149-fixture'])
 for(const call of helm)assert.deepEqual(call.args.slice(0,2),['--kube-context','kind-na0149-fixture'])
 assert.deepEqual(calls.at(-1),{name:'kind',args:['delete','cluster','--name','na0149-fixture']})
})
test('failed cluster creation never deletes an existing cluster or submits a secret',t=>{
 const {result,calls}=run(t,true);assert.equal(result.status,17);assert.equal(calls.length,1);assert.deepEqual(calls[0].args.slice(0,2),['create','cluster'])
})
