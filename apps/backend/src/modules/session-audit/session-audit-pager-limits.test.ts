import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { expect, it } from 'vitest'

it('preserves large Unicode content and filters valid pager states within a bounded subprocess', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nodeaccess-pager-regression-'))
  try {
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}')
    for (const name of ['normalizer', 'input', 'history', 'search']) {
      const source = readFileSync(new URL('./session-audit-' + name + '.ts', import.meta.url), 'utf8')
      writeFileSync(join(directory, 'session-audit-' + name + '.js'), transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
      }).outputText)
    }
    const moduleUrl = pathToFileURL(join(directory, 'session-audit-normalizer.js')).href
    const program = [
      'import { summarizeInteractiveOutput } from ' + JSON.stringify(moduleUrl),
      'const contents = ["\\u2028", "\\u2029"].map(separator => "lines 1-2/" + "9".repeat(1_000_000) + separator + "kept")',
      'const preserved = contents.map(content => summarizeInteractiveOutput("less file", content).endsWith(content))',
      'const statuses = ["line 1-2/3", "lines 1-2/300 (END)", "lines 1-2/3 trailing text", "(END)", "--More--", "--more--", "END of file"]',
      'const filtered = statuses.map(status => !summarizeInteractiveOutput("less file", "content\\n" + status).includes(status))',
      'console.log(JSON.stringify({ preserved, filtered }))',
    ].join('\n')
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 4096,
    })) as { preserved: boolean[]; filtered: boolean[] }
    expect(result.preserved).toEqual([true, true])
    expect(result.filtered).toEqual(Array.from({ length: 7 }, () => true))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 10000)
