const assert = require('node:assert/strict')
const {createRequire}=require('node:module')
const {resolve,join}=require('node:path')
if(!process.argv[2]) throw new Error('Pass the baseline checkout containing minimatch 10')
const old=createRequire(join(resolve(process.argv[2]),'package.json'))('minimatch')
const current=createRequire(join(process.cwd(),'package.json'))('minimatch')
let cases=0; const pruningDifferences=[]
for(const pattern of ['src/**/*.ts','src/*.{ts,tsx}','!src/private/**','!!src/private/**','**/!(*.test).ts','/tmp/**/a.ts','./src/*.ts','src/[ab]/*.ts','**/*.ts','src/**/nested/*','src/**/.hidden/**/*']) {
 for(const path of ['src','src/a','src/private','src/private/nested','src/a.test.ts','src/b.ts','src/a.tsx','other','/tmp','/tmp/x','src/.hidden','src/a/nested/file','src/a/nested']) {
  const a=new old.Minimatch(pattern),b=new current.Minimatch(pattern)
  const expected=a.set.some(row=>a.matchOne(path.split('/'),row,true))
  const actual=b.match(path,true)!==b.negate
  if(actual!==expected) {
   assert.equal(pattern,'src/**/nested/*');assert.equal(path,'src/.hidden');assert.equal(expected,true);assert.equal(actual,false)
   for(const suffix of ['/nested/a.ts','/a/nested/b.ts']) {assert.equal(a.match(path+suffix),false);assert.equal(b.match(path+suffix),false)}
   pruningDifferences.push({pattern,path,old:expected,current:actual,finalDescendantMatches:false})
  }
  cases++
 }
}
console.log(JSON.stringify({partialMatchesCompared:cases,pruningDifferences,passed:true,scope:"ordinary child paths; root-only and **/../ optimization intentionally not claimed equivalent"}))
