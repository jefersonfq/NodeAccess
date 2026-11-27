const {test}=require('node:test')
const assert=require('node:assert/strict')
const {loadManual,manualPlugin}=require('./build.cjs')
test('build version is supplied by the application build and content remains stable',()=>{
 const a=loadManual('2.1.0','2026-09-24T00:00:00Z'),b=loadManual('2.1.1','2026-09-25T00:00:00Z')
 assert.equal(a.version,'2.1.0');assert.equal(b.version,'2.1.1');assert.equal(a.contentHash,b.contentHash)
 assert.equal(a.articles.length,5)
 for(const article of a.articles){assert.match(article.html,/<h2/);assert.ok(article.sourceHash);assert.ok(article.flow)}
})
test('the Vite plugin emits matching version metadata on every build',()=>{
 for(const version of ['2.0.3','2.0.4']){
  const plugin=manualPlugin();plugin.configResolved({env:{VITE_APP_VERSION:version}})
  assert.equal(plugin.resolveId('virtual:nodeaccess-manual'),'\0nodeaccess-manual')
  assert.ok(plugin.load('\0nodeaccess-manual').includes(`"version":"${version}"`))
  const emitted=[];plugin.generateBundle.call({emitFile:asset=>emitted.push(asset)})
  assert.equal(JSON.parse(emitted[0].source).version,version)
  assert.equal(emitted[0].fileName,'manual-version.json')
 }
})
test('browser manual omits internal evidence paths and hashes while retaining public content',()=>{
 const plugin=manualPlugin(), code=plugin.load('\0nodeaccess-manual')
 const projected=JSON.parse(code.slice('export default '.length)), internal=loadManual()
 assert.equal(projected.articles.length,internal.articles.length)
 for(let index=0;index<internal.articles.length;index++){
  const article=projected.articles[index], original=internal.articles[index]
  assert.equal(article.html,original.html);assert.deepEqual(article.journey,original.journey)
  assert.equal(article.screenshot,original.screenshot);assert.equal(article.reviewCurrent,original.reviewCurrent)
  assert.deepEqual(Object.keys(article).sort(),['id','title','summary','journey','reviewedAt','html','text','flow','screenshot','reviewCurrent'].sort())
  for(const file of original.sourceFiles) assert.equal(code.includes(file),false)
 }
 for(const field of ['sourceFiles','sourceHash','reviewedSourceHash','assetHash']) assert.equal(code.includes(`"${field}"`),false)
})
