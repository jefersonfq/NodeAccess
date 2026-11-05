import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { mutationInputs, mutationFiles } from '../mutation/scope.mjs'
import { summarizeMutationReport } from '../mutation/report.mjs'

function regularFile(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path) || stat.size > 2 * 1024 * 1024) {
    throw new Error('Unsafe assurance evidence')
  }
  return readFileSync(path)
}
const digest = data => createHash('sha256').update(data).digest('hex')

export function verifiedMutationEvidence(root, { runId, head, startedAt }) {
  try {
    const proof = JSON.parse(regularFile(join(root, 'artifacts/mutation/summary.json')))
    const reportBytes = regularFile(join(root, 'artifacts/mutation/mutation.json'))
    if (proof.reportSha256 !== digest(reportBytes)) return false
    const raw = JSON.parse(reportBytes.toString('utf8')), measured = summarizeMutationReport(raw)
    const fingerprint = createHash('sha256')
    for (const file of mutationInputs) fingerprint.update(file).update('\0').update(regularFile(join(root, file))).update('\0')
    if (proof.inputFingerprint !== fingerprint.digest('hex') || !isDeepStrictEqual(proof.scope, [...mutationFiles])) return false
    if (!measured.passed || !Object.entries(measured).every(([key, value]) => isDeepStrictEqual(proof[key], value))) return false
    if (!mutationFiles.every(file => raw.files[file].source === regularFile(join(root, file)).toString('utf8'))) return false
    const started = Date.parse(proof.startedAt), finished = Date.parse(proof.finishedAt)
    return proof.schemaVersion === 1 && proof.runId === runId && proof.head === head
      && proof.passed === true && proof.exitCode === 0 && proof.orphanedWorkers === false && proof.interrupted === false
      && Number.isFinite(started) && started >= Date.parse(startedAt) && finished >= started && finished <= Date.now()
  } catch { return false }
}

function xmlEscape(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Accept only the single-source XML shape produced by the reviewed Python tracer. */
function validZapXml(xml, root, proof, sourceLines) {
  if (xml.includes('<!') || !xml.endsWith('</coverage>')) return false
  const filenames = [...xml.matchAll(/filename="([^"]+)"/g)].map(match => match[1])
  if (filenames.length !== 1 || filenames[0] !== 'tools/security/zap-driver.py') return false
  if (!xml.includes(`<sources><source>${xmlEscape(root)}</source></sources>`)) return false
  if (!xml.includes(`lines-valid="${proof.totalLines}" lines-covered="${proof.executedLines}"`)) return false
  const lines = [...xml.matchAll(/<line number="([0-9]+)" hits="([0-9]+)"\s*\/>/g)]
  if (lines.length !== proof.totalLines || xml.split('<line ').length - 1 !== lines.length) return false
  const numbers = lines.map(line => Number(line[1])), hits = lines.map(line => Number(line[2]))
  return new Set(numbers).size === numbers.length
    && numbers.every(line => Number.isSafeInteger(line) && line > 0 && line <= sourceLines)
    && hits.every(hit => Number.isSafeInteger(hit) && hit >= 0)
    && hits.filter(hit => hit > 0).length === proof.executedLines
}

export function verifiedZapPythonEvidence(root, output, runId) {
  try {
    const proof = JSON.parse(regularFile(join(output, 'zap-python-proof.json')))
    const driver = regularFile(join(root, 'tools/security/zap-driver.py'))
    const helper = regularFile(join(root, 'tools/security/zap-driver.test.py'))
    const report = regularFile(join(output, 'zap-python.xml'))
    return proof.runId === runId && proof.passed === true
      && Number.isSafeInteger(proof.testsRun) && proof.testsRun > 0
      && Number.isSafeInteger(proof.totalLines) && proof.totalLines > 0
      && Number.isSafeInteger(proof.executedLines) && proof.executedLines > 0 && proof.executedLines <= proof.totalLines
      && proof.driverSha256 === digest(driver) && proof.helperSha256 === digest(helper) && proof.reportSha256 === digest(report)
      && validZapXml(report.toString('utf8'), root, proof, driver.toString('utf8').split('\n').length)
  } catch { return false }
}
