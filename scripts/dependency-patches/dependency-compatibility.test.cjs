const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdir } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const vm = require('node:vm')
const req = createRequire(join(process.cwd(), 'package.json'))
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', resolve)) }
function close(server) { return new Promise(resolve => server.close(resolve)) }
test('minimatch named/class APIs match expected Vue/TS/ESLint path patterns', () => {
 const { minimatch, Minimatch } = req('minimatch')
 for (const [path, pattern, options, expected] of [
 ['apps/a.vue','**/*.vue',{},true],['apps/a.ts','**/*.{ts,vue}',{},true],['apps/a.js','**/*.ts',{},false],
 ['.config.ts','*.ts',{dot:true},true],['.config.ts','*.ts',{},false],['data-tenant','data-*',{},true],
 ['aria-label','data-*',{},false],['src/a.test.ts','**/!(*.test).ts',{},false],['src/a.ts','**/!(*.test).ts',{},true],
 ['a/b/c.ts','**/*.ts',{matchBase:true},true],['src/Foo.vue','**/*.vue',{nocase:true},true],
 ]) { assert.equal(minimatch(path,pattern,options),expected); assert.equal(new Minimatch(pattern,options).match(path),expected) }
})
test('minimatch adversarial preprocessing stays bounded with unchanged basic negative', () => {
 execFileSync(process.execPath,['-e',`const assert=require('node:assert/strict'); const {minimatch}=require('minimatch');assert.equal(minimatch('safe-file','**/../'.repeat(100)+'missing',{optimizationLevel:2}),false)`],{cwd:process.cwd(),timeout:3000,stdio:'pipe'})
})
test('glob discovery and already-aborted traversal preserve filesystem and avoid reads', async () => {
 const { glob } = req('glob'), root = mkdtempSync(join(tmpdir(),'na0128-glob-'))
 try {
 mkdirSync(join(root,'nested')); writeFileSync(join(root,'nested','ok.txt'),'ok'); writeFileSync(join(root,'.hidden'),'hidden')
 assert.deepEqual(await glob('**/**',{cwd:root,nodir:true,dot:false,ignore:['**/*.tmp']}),['nested/ok.txt'])
 let reads = 0; const controller = new AbortController(); controller.abort(new Error('fixture-abort'))
 await assert.rejects(glob('**/*',{cwd:root,signal:controller.signal,fs:{readdir(...args){reads++; return readdir(...args)}}}),/fixture-abort/)
 await new Promise(resolve=>setTimeout(resolve,30)); assert.equal(reads,0)
 const active = new AbortController(); let activeReads=0
 await assert.rejects(glob('**/*',{cwd:root,signal:active.signal,fs:{readdir(...args){activeReads++; if(activeReads===1) active.abort(new Error('midwalk-abort')); return readdir(...args)}}}),/midwalk-abort/)
 const readsAtReject=activeReads; await new Promise(resolve=>setTimeout(resolve,30)); assert.equal(activeReads,readsAtReject); assert.equal(activeReads,1)
 } finally { rmSync(root,{recursive:true,force:true}) }
})
test('Fastify static real loopback supports enumerated routes, ignores, 404 and swagger assets', {timeout:10000}, async () => {
 const fastify = req('fastify')({forceCloseConnections:true}), root = mkdtempSync(join(tmpdir(),'na0128-static-'))
 try {
 writeFileSync(join(root,'index.html'),'fixture-index'); writeFileSync(join(root,'hidden.tmp'),'hidden')
 await fastify.register(req('@fastify/static'),{root,prefix:'/files/',wildcard:false,globIgnore:['**/*.tmp']})
 await fastify.register(req('@fastify/swagger'),{openapi:{info:{title:'Fixture',version:'1'}}})
 await fastify.register(req('@fastify/swagger-ui'),{routePrefix:'/docs'})
 await fastify.listen({port:0,host:'127.0.0.1'})
 const base=`http://127.0.0.1:${fastify.server.address().port}`
 assert.equal(await (await fetch(base+'/files/index.html',{signal:AbortSignal.timeout(3000)})).text(),'fixture-index')
 assert.equal((await fetch(base+'/files/hidden.tmp',{signal:AbortSignal.timeout(3000)})).status,404)
 assert.equal((await fetch(base+'/files/missing',{signal:AbortSignal.timeout(3000)})).status,404)
 assert.equal((await fetch(base+'/docs/',{signal:AbortSignal.timeout(3000)})).status,200)
 assert.equal((await fetch(base+'/docs/static/swagger-ui.css',{signal:AbortSignal.timeout(3000)})).status,200)
 } finally { await fastify.close(); rmSync(root,{recursive:true,force:true}) }
})
test('follow-redirects strips cross-realm sensitive header and retains harmless header', {timeout:10000}, async () => {
 let observed
 const destination=http.createServer((request,response)=>{observed=request.headers;response.end('ok')})
 const origin=http.createServer((request,response)=>{response.writeHead(302,{Location:`http://127.0.0.1:${destination.address().port}/`});response.end()})
 try { await listen(destination); await listen(origin)
 await new Promise((resolve,reject)=>req('follow-redirects').http.get(`http://127.0.0.1:${origin.address().port}/`,{timeout:3000,sensitiveHeaders:vm.runInNewContext("['X-Fixture-Key']"),headers:{'X-Fixture-Key':'synthetic','X-Harmless':'retained'}},response=>{response.resume();response.on('end',resolve)}).on('timeout',function(){this.destroy(new Error('fixture request timeout'))}).on('error',reject))
 assert.equal(observed['x-fixture-key'],undefined); assert.equal(observed['x-harmless'],'retained')
 } finally { await close(origin);await close(destination) }
})
test('Joi email multiple handles large whitespace and preserves valid/custom separator cases', () => {
 execFileSync(process.execPath,['-e',`const assert=require('node:assert/strict'),Joi=require('joi'),schema=Joi.string().email({multiple:true,tlds:{allow:false}});assert.ok(schema.validate(' '.repeat(200000)).error);assert.equal(schema.validate('a@example.test, b@example.test').error,undefined);assert.equal(Joi.string().email({multiple:true,separator:';',tlds:{allow:false}}).validate('a@example.test; b@example.test').error,undefined)`],{cwd:process.cwd(),timeout:3000,stdio:'pipe'})
})
