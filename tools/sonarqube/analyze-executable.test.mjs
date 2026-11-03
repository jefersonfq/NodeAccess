import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, npmCliPath } from './analyze.mjs'
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'na0132-runner-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,'src'));mkdirSync(join(root,'coverage'));writeFileSync(join(root,'sonar-project.properties'),'sonar.sources=src\n');writeFileSync(join(root,'coverage/lcov.info'),'SF:src/fixture.js\nDA:1,1\nend_of_record\n')
 const cli=join(root,'npm-cli.js'), report=join(root,'report.json')
 writeFileSync(cli,`const fs=require('node:fs');fs.writeFileSync(process.env.FIXTURE_REPORT,JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),host:process.env.SONAR_HOST_URL,tokenInherited:process.env.SONAR_TOKEN==='fixture',executable:process.execPath}));process.exit(Number(process.env.FIXTURE_EXIT||0))`)
 return {root,cli,report,env:{...process.env,npm_execpath:cli,SONAR_TOKEN:'fixture',SONAR_HOST_URL:'http://localhost:9000',FIXTURE_REPORT:report}}
}
test('real Node executes explicit npm CLI despite a poisoned PATH and preserves pinned argv/environment',t=>{
 const f=fixture(t),marker=join(f.root,'hijacked');writeFileSync(join(f.root,'npm'),`#!/bin/sh\ntouch '${marker}'\nexit 99\n`,{mode:0o755})
 assert.equal(main([],{root:f.root,env:{...f.env,PATH:f.root}}),0)
 const data=JSON.parse(readFileSync(f.report,'utf8'))
 assert.deepEqual(data.argv,['exec','--yes','--package=@sonar/scan@5.0.2','--','sonar-scanner-npm','-Dsonar.qualitygate.wait=true','-Dsonar.qualitygate.timeout=600'])
 assert.equal(data.cwd,f.root);assert.equal(data.host,'http://127.0.0.1:9000');assert.equal(data.tokenInherited,true);assert.equal(data.executable,process.execPath);assert.ok(!data.argv.includes('fixture'));assert.equal(existsSync(marker),false)
})
test('standard runtime-relative fallback resolves without searching PATH',t=>{
 const f=fixture(t),prefix=join(f.root,'runtime');mkdirSync(join(prefix,'lib/node_modules/npm/bin'),{recursive:true});const cli=join(prefix,'lib/node_modules/npm/bin/npm-cli.js');writeFileSync(cli,'// fixture');assert.equal(npmCliPath({PATH:f.root},join(prefix,'bin/node')),cli)
})
test('relative, missing, directory and unexpected CLI paths fail closed',t=>{
 const f=fixture(t);mkdirSync(join(f.root,'directory/npm-cli.js'),{recursive:true});writeFileSync(join(f.root,'other.js'),'throw Error("should not execute")')
 for(const path of ['npm-cli.js',join(f.root,'missing/npm-cli.js'),join(f.root,'directory/npm-cli.js'),join(f.root,'other.js')]) assert.throws(()=>npmCliPath({npm_execpath:path}))
 assert.throws(()=>npmCliPath({PATH:f.root},join(f.root,'missing/bin/node')),/unavailable/)
 assert.equal(existsSync(f.report),false)
})
test('explicit symlink resolves to the real regular npm CLI',t=>{
 const f=fixture(t),link=join(f.root,'npm-link');symlinkSync(f.cli,link);assert.equal(npmCliPath({npm_execpath:link}),f.cli)
})
test('scanner exit status and process failure remain failures',t=>{
 const f=fixture(t);assert.equal(main([],{root:f.root,env:{...f.env,FIXTURE_EXIT:'7'}}),7)
 writeFileSync(f.cli,'process.kill(process.pid,"SIGTERM")');assert.equal(main([],{root:f.root,env:f.env}),1)
})
test('argument and preflight guards prevent any CLI execution; check remains read-only',t=>{
 const f=fixture(t);assert.equal(main(['--token=unreviewed'],{root:f.root,env:f.env}),1);assert.equal(main([],{root:f.root,env:{...f.env,SONAR_TOKEN:''}}),1);assert.equal(existsSync(f.report),false)
 assert.equal(main(['--check'],{root:f.root,env:{...f.env,npm_execpath:'missing'}}),0);assert.equal(existsSync(f.report),false)
})
