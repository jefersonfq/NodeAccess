const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseFixtureExpression: parse } = require('./sonar-fixture-expression.cjs')

test('parses names, translations and native input props without evaluating JavaScript', () => {
  assert.equal(parse("$t('snippets.kind.label')"), 'snippets.kind.label')
  assert.equal(parse('option.label'), 'Modo de ação')
  const props = parse("{ id: 'field', 'aria-label': t('username'), autocomplete: 'username' }")
  assert.deepEqual({...props}, {id:'field', 'aria-label':'username', autocomplete:'username'})
  assert.equal(parse("'a\\'b'"), "a'b")
})
test('rejects executable expressions, suffixes and unsupported syntax', () => {
  for (const text of ['process.exit()', '(()=>{throw Error()})()', "t('x'); process.exit()", 'option.constructor', "{label: require('fs')}", "t('unfinished)", "'unclosed", "{label:'x'"]) assert.throws(() => parse(text))
})
test('uses a null-prototype dictionary and bounds nested input', () => {
  const props = parse("{'__proto__':'literal'}")
  assert.equal(Object.getPrototypeOf(props), null)
  assert.equal(props.__proto__, 'literal')
  assert.throws(() => parse('{x:'.repeat(10) + "'a'" + '}'.repeat(10)))
})
