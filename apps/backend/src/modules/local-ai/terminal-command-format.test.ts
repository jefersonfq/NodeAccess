import { describe, expect, it } from 'vitest'
import { normalizeSuggestedCommand, isInsertableSuggestedCommand } from './terminal-command-format.js'
describe('generated command presentation', () => {
  it.each(['`ss -lntup`', '```bash\nss -lntup\n```', '```sh\r\nss -lntup\r\n```', '```\nss -lntup\n```'])('unwraps single-command Markdown %j before policy', value => {
    expect(normalizeSuggestedCommand(value)).toBe('ss -lntup')
  })
  it('does not flatten a fenced script', () => {
    const value = '```bash\npwd\nwhoami\n```'
    expect(isInsertableSuggestedCommand(normalizeSuggestedCommand(value))).toBe(false)
  })

  it.each(['"pwd"', "'pwd'"])('normalizes a quoted executable: %s', command => {
    expect(normalizeSuggestedCommand(command)).toBe('pwd')
  })
  it.each(['"ambiguous command"', "'/opt/my tools/check'", 'pwd\nwhoami', 'pwd\x1b[A', 'pwd\u2028whoami', ''])('rejects ambiguous presentation or terminal controls: %s', command => {
    expect(isInsertableSuggestedCommand(command)).toBe(false)
  })
  it('allows internal argument quotes after normalization', () => {
    expect(isInsertableSuggestedCommand(normalizeSuggestedCommand("'grep \"two words\" file'"))).toBe(true)
  })

  it.each(['"ss -lntup"', "'ss -lntup'", '  ss -lntup  '])('normalizes %s', value => {
    expect(normalizeSuggestedCommand(value)).toBe('ss -lntup')
  })
  it.each(['grep "two words" file', "printf '%s' hello", '"/opt/my tools/check"', '"ss -lntup" && whoami', 'ss -lntup\nwhoami'])('preserves shell syntax for policy: %s', value => {
    expect(normalizeSuggestedCommand(value)).toBe(value)
  })
})
