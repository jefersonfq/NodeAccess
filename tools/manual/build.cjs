const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { marked } = require('marked')
const root = path.resolve(__dirname, '../..')
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
function loadManual(version = 'dev', builtAt = new Date().toISOString()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/manual/manifest.json'), 'utf8'))
  const seen = new Set()
  const articles = manifest.map(entry => {
    assert.match(entry.id, /^[a-z-]+$/)
    assert.ok(!seen.has(entry.id), `Duplicate chapter: ${entry.id}`); seen.add(entry.id)
    const markdown = fs.readFileSync(path.join(root, `docs/manual/${entry.id}.md`), 'utf8')
    assert.ok(!/<script|<iframe|javascript:|\son\w+\s*=/i.test(markdown), 'Manual accepts reviewed repository content only')
    for (const section of ['Quando usar', 'Antes de começar', 'Passo a passo', 'Exemplo de uso', 'Se algo não funcionar', 'Resultado esperado']) {
      assert.ok(markdown.includes(section), `${entry.id}: missing ${section}`)
    }
    for(const file of entry.sourceFiles) assert.ok(fs.existsSync(path.join(root,file)), `Missing mapped source ${file}`)
    const sourceHash = digest(entry.sourceFiles.map(file => fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')).join('\n'))
    const flow = `/manual-assets/${entry.id}-flow.svg`
    assert.ok(fs.existsSync(path.join(root,'apps/frontend/public',flow)))
    const screenshot = `/manual-assets/${entry.id}.png`
    return {...entry, html: marked.parse(markdown, {mangle:false}), text:markdown.replace(/[#*|]/g,' '), flow,
      screenshot: fs.existsSync(path.join(root,'apps/frontend/public',screenshot)) ? screenshot : null,
      assetHash: digest(Buffer.concat([fs.readFileSync(path.join(root,'apps/frontend/public',flow)),fs.existsSync(path.join(root,'apps/frontend/public',screenshot)) ? fs.readFileSync(path.join(root,'apps/frontend/public',screenshot)) : Buffer.alloc(0)])),
      sourceHash, reviewCurrent: entry.reviewedSourceHash === sourceHash,
    }
  })
  for(const article of articles) for(const match of article.html.matchAll(/href="\/manual\/([^"#]+)"/g)) assert.ok(seen.has(match[1]), `Broken chapter link: ${match[1]}`)
  return {version,builtAt,contentHash:digest(JSON.stringify(articles)).slice(0,12),articles}
}
function manualPlugin() {
  let version = 'dev'
  const builtAt = new Date().toISOString()
  return {
    name:'nodeaccess-manual',
    configResolved(config) { version = config.env.VITE_APP_VERSION || process.env.APP_VERSION || 'dev' },
    resolveId(id) { if(id==='virtual:nodeaccess-manual') return '\0nodeaccess-manual' },
    load(id) { if(id==='\0nodeaccess-manual') return `export default ${JSON.stringify(loadManual(version,builtAt))}` },
    generateBundle() {
      const {articles,...metadata} = loadManual(version,builtAt)
      this.emitFile({type:'asset',fileName:'manual-version.json',source:JSON.stringify({...metadata,chapters:articles.map(a=>({id:a.id,reviewedAt:a.reviewedAt,reviewCurrent:a.reviewCurrent}))},null,2)})
    },
  }
}
module.exports = { loadManual, manualPlugin }
if (require.main === module) {
  const manual = loadManual(process.env.VITE_APP_VERSION || process.env.APP_VERSION || 'dev')
  if (process.argv.includes('--check-reviewed')) {
    const stale = manual.articles.filter(a=>!a.reviewCurrent)
    assert.equal(stale.length,0,`Revisar capítulos e suas evidências: ${stale.map(a=>a.id).join(', ')}`)
  }
  console.log(JSON.stringify({version:manual.version,chapters:manual.articles.map(a=>({id:a.id,reviewCurrent:a.reviewCurrent}))},null,2))
}
