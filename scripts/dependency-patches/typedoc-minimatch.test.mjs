import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { patchTypeDoc } from './typedoc-minimatch.mjs'
const originalBlock = `return mini.set.some((row) => mini.matchOne(
        childPath,
        row,
        /* partial */
        true
      ));`
const patchedBlock = 'return mini.match(childPath.join("/"), true) !== mini.negate;'
const installed = readFileSync(new URL('../../node_modules/typedoc/dist/node-utils.js', import.meta.url),'utf8')
const pristine = installed.replace(patchedBlock, originalBlock)
function fixture(t, version='0.28.20', source=pristine) {
 const root=mkdtempSync(join(tmpdir(),'na0128-patch-')); t.after(()=>rmSync(root,{recursive:true,force:true}))
 const dir=join(root,'node_modules/typedoc');mkdirSync(join(dir,'dist'),{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({version}));const file=join(dir,'dist/node-utils.js');writeFileSync(file,source);return {root,file}
}
test('patch replaces only removed traversal API and is idempotent', t=>{
 const {root,file}=fixture(t);assert.equal(patchTypeDoc(root),'applied');const after=readFileSync(file,'utf8');assert.equal(after,pristine.replace(originalBlock,patchedBlock));assert.equal(patchTypeDoc(root),'already-applied');assert.equal(readFileSync(file,'utf8'),after)
})
test('unknown source refuses mutation even if target text is present',t=>{const {root,file}=fixture(t,'0.28.20',pristine+'\n// unknown');assert.throws(()=>patchTypeDoc(root),/SOURCE_REVIEW_REQUIRED/);assert.equal(readFileSync(file,'utf8'),pristine+'\n// unknown')})
test('new upstream version requires review rather than silently applying stale patch',t=>{const {root,file}=fixture(t,'0.28.21');assert.throws(()=>patchTypeDoc(root),/VERSION_REVIEW_REQUIRED/);assert.equal(readFileSync(file,'utf8'),pristine)})
test('runtime without optional documentation tool needs no patch',t=>{const root=mkdtempSync(join(tmpdir(),'na0128-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));assert.equal(patchTypeDoc(root),'not-installed')})

test('real TypeDoc discovers nested package globs and excludes files with the patched public API', {timeout:30000}, t=>{
 const root=mkdtempSync(join(tmpdir(),'na0128-docs-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 for(const name of ['one','two']) {const dir=join(root,'packages',name,'src');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'index.ts'),`export const ${name}Value = 1`);writeFileSync(join(dir,'excluded.ts'),`export const ${name}Excluded = 2`)}
 const config=join(root,'tsconfig.json'), output=join(root,'docs.json');writeFileSync(config,JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',types:[],skipLibCheck:true},include:['packages/**/*.ts']}))
 execFileSync(process.execPath,[fileURLToPath(new URL('../../node_modules/typedoc/bin/typedoc',import.meta.url)), '--entryPoints',join(root,'packages/*/src/*.ts'),'--exclude','**/excluded.ts','--tsconfig',config,'--json',output],{cwd:root,timeout:25000,stdio:'pipe',encoding:'utf8'})
 const result=readFileSync(output,'utf8');assert.match(result,/oneValue/);assert.match(result,/twoValue/);assert.doesNotMatch(result,/oneExcluded|twoExcluded/)
})
