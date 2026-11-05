const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = process.argv[2] || process.cwd()
const source = fs.readFileSync(path.join(root, 'apps/backend/src/modules/session-audit/session-audit-normalizer.ts'), 'utf8')
const declaration = source.split('\n').find(line => line.startsWith('const PAGER_STATUS_LINE = '))
if (!declaration) throw new Error('Pager declaration missing')
const current = vm.runInNewContext(declaration + ';PAGER_STATUS_LINE')
const previous = /^(?:lines?\s+\d+-\d+\/\d+.*|\(END\).*|--[Mm]ore--|END of file)$/
const whitespace = ['', ' ', '  ', '\t', '\r', '\n', '\u2028', '\u2029']
const digits = ['', '0', '1', '99', 'x', '１２']
const tails = ['', '999', ' (END)', ' text', '\n', '\r', '\u2028', '\u2029', '\u2028x', '\u2029x']
let cases = 0
function compare(value) {
  if (previous.test(value) !== current.test(value)) throw new Error('Pager behavior changed in synthetic case ' + cases)
  cases++
}
for (const prefix of ['line', 'lines', 'Line', 'linex']) {
  for (const space of whitespace) for (const first of digits) for (const last of digits) {
    for (const total of digits) for (const tail of tails) compare(prefix + space + first + '-' + last + '/' + total + tail)
  }
}
for (const prefix of ['(END)', '--More--', '--more--', '--MORE--', 'END of file', 'END OF FILE']) {
  for (const tail of tails) compare(prefix + tail)
}
console.log(JSON.stringify({ kind: 'bounded differential against original regular expression; no performance claim', cases, differences: 0 }))
