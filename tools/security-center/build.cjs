const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const repositoryRoot = path.resolve(__dirname, '../..')
const catalogFile = 'docs/security/controls-catalog.json'
const moduleId = '\0nodeaccess-security-center'
const states = new Set(['verified', 'partial', 'planned', 'unverified'])

function text(value) {
  assert.equal(typeof value, 'string', 'Security content must be text')
  assert.ok(value.trim().length > 0 && value.length <= 2000, 'Invalid security text length')
  assert.ok(!/[<>]/.test(value), 'Security content is plain text only')
  return value
}
function date(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10), value, 'Invalid review date')
  return value
}
function texts(value, allowEmpty = false) {
  assert.ok(Array.isArray(value) && value.length <= 20 && (allowEmpty || value.length > 0), 'Invalid security text list')
  return value.map(text)
}
function evidencePath(root, file) {
  assert.equal(typeof file, 'string')
  assert.ok(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'Evidence must stay inside repository')
  const absolute = fs.realpathSync(path.resolve(root, file))
  assert.ok(absolute.startsWith(`${fs.realpathSync(root)}${path.sep}`), 'Evidence must stay inside repository')
  assert.ok(fs.statSync(absolute).isFile(), 'Evidence must be a file')
  return absolute
}
function evidenceHash(root, files) {
  assert.ok(Array.isArray(files) && files.length > 0 && files.length <= 30, 'Evidence files required')
  assert.equal(new Set(files).size, files.length, 'Duplicate evidence file')
  const digest = createHash('sha256')
  for (const file of files) digest.update(file).update('\0').update(fs.readFileSync(evidencePath(root, file))).update('\0')
  return digest.digest('hex')
}
function verifyReview(control, root, reviewedAt) {
  const review = control.review
  assert.equal(review?.method, 'source-review', 'Source review required')
  assert.ok(date(review.reviewedAt) <= reviewedAt, 'Catalog review predates control review')
  assert.match(review.sourceRevision, /^[a-f0-9]{40}$/)
  text(review.scope)
  text(control.internalDescription)
  text(control.owner)
  assert.equal(review.testsExecuted, false, 'Editorial review must not claim test execution')
  assert.ok(Array.isArray(review.testFiles) && review.testFiles.length > 0, 'Mapped tests required')
  for (const file of review.testFiles) evidencePath(root, file)
  assert.equal(evidenceHash(root, review.sourceFiles), review.sourceHash, `Review is stale: ${control.id}`)
}
function projectCatalog(catalog, root = repositoryRoot) {
  assert.equal(catalog.schemaVersion, 1, 'Unsupported security catalog')
  const revision = text(catalog.revision), reviewedAt = date(catalog.reviewedAt)
  assert.ok(Array.isArray(catalog.controls) && catalog.controls.length > 0, 'Security controls required')
  const seen = new Set(), sections = []
  for (const control of catalog.controls) {
    assert.match(control.id, /^[a-z][a-z0-9-]*$/)
    assert.ok(!seen.has(control.id), 'Duplicate security control'); seen.add(control.id)
    assert.ok(states.has(control.state), 'Unknown security control state')
    if (control.state === 'planned' || control.state === 'unverified') continue
    verifyReview(control, root, reviewedAt)
    const content = control.public
    assert.ok(content && typeof content === 'object', 'Public content required')
    const conditions = texts(content.conditions, control.state === 'verified')
    sections.push({ id: control.id, title: text(content.title), summary: text(content.summary), details: texts(content.details), conditions })
  }
  assert.ok(sections.length > 0, 'No reviewed security content')
  return { revision, reviewedAt, sections, practices: texts(catalog.practices) }
}
function readCatalog(root) {
  return JSON.parse(fs.readFileSync(path.join(root, catalogFile), 'utf8'))
}
function loadSecurityCenter(root = repositoryRoot) {
  return projectCatalog(readCatalog(root), root)
}
function securityCenterPlugin(root = repositoryRoot) {
  let serving = false
  return {
    name: 'nodeaccess-security-center',
    configResolved(config) { serving = config.command === 'serve' },
    resolveId(id) { if (id === 'virtual:nodeaccess-security-center') return moduleId },
    load(id) {
      if (id !== moduleId) return undefined
      this.addWatchFile(path.join(root, catalogFile))
      try {
        const catalog = readCatalog(root)
        // Keep watching evidence even while its review is stale, so a corrected catalog can recover through HMR.
        for (const control of Array.isArray(catalog.controls) ? catalog.controls : []) {
          if (!control || !['verified', 'partial'].includes(control.state) || !Array.isArray(control.review?.sourceFiles)) continue
          for (const file of control.review.sourceFiles) {
            evidencePath(root, file)
            this.addWatchFile(path.resolve(root, file))
          }
        }
        return `export default ${JSON.stringify(projectCatalog(catalog, root))}`
      } catch (error) {
        if (!serving) throw error
        this.warn('Security Center content unavailable: review the catalog and its source evidence before publication.')
        // Never publish stale claims, review metadata or the validation error to the browser.
        return `export default ${JSON.stringify({ revision: '', reviewedAt: '', sections: [], practices: [], unavailable: true })}`
      }
    },
  }
}
module.exports = { projectCatalog, loadSecurityCenter, securityCenterPlugin, evidenceHash }
