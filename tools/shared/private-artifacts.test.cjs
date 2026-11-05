const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { artifactPath } = require('./private-artifacts.cjs')

test('private artifacts preserve basenames and create nested paths under owned 0700 root', () => {
  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'na-artifact-test-'))
  try {
    const root = path.join(lab, 'private')
    const file = artifactPath('nested/report.json', root)
    assert.equal(file, path.join(root, 'nested/report.json'))
    assert.equal(fs.statSync(root).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700)
    fs.writeFileSync(file, 'synthetic')
    assert.equal(artifactPath('nested/report.json', root), file)
    assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic')
  } finally { fs.rmSync(lab, { recursive: true, force: true }) }
})

test('refuses traversal and root/parent/leaf symlinks without changing their targets', () => {
  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'na-artifact-test-'))
  try {
    const root = path.join(lab, 'private'); fs.mkdirSync(root, { mode: 0o700 })
    const target = path.join(lab, 'untouched'); fs.writeFileSync(target, 'preserve')
    for (const name of ['../escape', '/absolute', 'a/../../escape', 'a\\..\\escape', 'bad\0name']) assert.throws(() => artifactPath(name, root))
    const rootLink = path.join(lab, 'link'); fs.symlinkSync(root, rootLink)
    assert.throws(() => artifactPath('x', rootLink), /private directory/)
    fs.symlinkSync(lab, path.join(root, 'parent'))
    assert.throws(() => artifactPath('parent/x', root), /symlinks/)
    fs.symlinkSync(target, path.join(root, 'leaf'))
    assert.throws(() => artifactPath('leaf', root), /symlinks/)
    assert.equal(fs.readFileSync(target, 'utf8'), 'preserve')
  } finally { fs.rmSync(lab, { recursive: true, force: true }) }
})

test('refuses a preexisting public artifact root rather than silently trusting it', () => {
  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'na-artifact-test-'))
  try {
    fs.chmodSync(lab, 0o755)
    assert.throws(() => artifactPath('result.json', lab), /private directory/)
    assert.equal(fs.statSync(lab).mode & 0o777, 0o755)
  } finally { fs.rmSync(lab, { recursive: true, force: true }) }
})
