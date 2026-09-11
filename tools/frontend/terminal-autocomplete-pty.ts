import { spawnSync } from 'node:child_process'
import { terminalCompletionInsertion } from '../../apps/frontend/src/services/terminal-autocomplete.service'
const cases = [
  { name: 'middle suffix', line: 'ls /tmp/old.txt', cursor: 6, expected: 'ls /tmp/report.txt', replace: true },
  { name: 'start of line', line: 'ls old', cursor: 0, expected: 'ls new', replace: true },
  { name: 'escaped parent', line: 'cat /tmp/team\\ docs/re', cursor: 22, expected: 'cat /tmp/team\\ docs/report.txt', replace: true },
  { name: 'literal case', line: 'DF', cursor: 2, expected: 'df -h', replace: false },
  { name: 'append only', line: 'pw', cursor: 2, expected: 'pwd', replace: false },
].map(c => ({ ...c, cursor: Math.min(c.cursor, c.line.length), insertion: terminalCompletionInsertion(c.line.slice(0, c.cursor), c.expected, c.replace) }))
if (cases.some(c => /[\r\n]/.test(c.insertion))) throw new Error('Insertion contains submission bytes')
const result = spawnSync('python3', ['tools/frontend/terminal-autocomplete-pty.py'], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 15000 })
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error) throw result.error
process.exit(result.status ?? 1)
