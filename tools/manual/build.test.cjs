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
