import { mutationFiles, mutationThreshold } from './scope.mjs'

const recognized = new Set(['Killed', 'Survived', 'NoCoverage', 'Timeout', 'CompileError', 'RuntimeError', 'Ignored'])

/** A green runner exit is insufficient: require evidence for both selected modules. */
export function summarizeMutationReport(report) {
  if (!report || typeof report.files !== 'object' || report.files === null || Array.isArray(report.files)) {
    throw new Error('Missing mutation files')
  }
  const names = Object.keys(report.files).sort((left, right) => left.localeCompare(right, 'en'))
  if (JSON.stringify(names) !== JSON.stringify([...mutationFiles].sort((left, right) => left.localeCompare(right, 'en')))) throw new Error('Unexpected mutation scope')
  const counts = Object.fromEntries([...recognized].map(status => [status, 0]))
  const survivors = [], files = []
  for (const name of mutationFiles) {
    const mutants = report.files[name]?.mutants
    if (!Array.isArray(mutants) || !mutants.length) throw new Error(`No mutants for ${name}`)
    const seen = new Set(), perFile = { file: name, total: mutants.length, detected: 0, valid: 0 }
    for (const mutant of mutants) {
      if (!recognized.has(mutant.status) || typeof mutant.id !== 'string' || seen.has(mutant.id)) {
        throw new Error('Invalid mutation result')
      }
      seen.add(mutant.id); counts[mutant.status]++
      if (mutant.status !== 'CompileError' && mutant.status !== 'Ignored') perFile.valid++
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') perFile.detected++
      if (mutant.status === 'Survived' || mutant.status === 'NoCoverage') {
        // Deliberately omit source snippets, replacement strings and test output.
        survivors.push({ file: name, id: mutant.id, status: mutant.status, line: Number.isInteger(mutant.location?.start?.line) ? mutant.location.start.line : null })
      }
    }
    if (!perFile.valid) throw new Error(`No valid mutants for ${name}`)
    files.push({ ...perFile, score: perFile.detected * 100 / perFile.valid })
  }
  const valid = files.reduce((sum, file) => sum + file.valid, 0)
  const detected = files.reduce((sum, file) => sum + file.detected, 0)
  const score = detected * 100 / valid
  // These pure policies should not hang. Do not let timeouts inflate this pilot's score.
  const executionErrors = counts.Timeout + counts.RuntimeError + counts.Ignored
  return { threshold: mutationThreshold, counts, valid, detected, score, files, survivors,
    passed: executionErrors === 0 && score >= mutationThreshold && files.every(file => file.score >= mutationThreshold) }
}
