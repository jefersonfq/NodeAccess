// Read the small literal grammar needed by accessibility fixtures. Never execute source code.
function parseFixtureExpression(source) {
  let index = 0
  const fail = () => { throw new Error('Unsupported fixture expression') }
  const space = () => { while (index < source.length && /\s/.test(source[index])) index += 1 }
  const consume = character => { space(); if (source[index++] !== character) fail() }
  function identifier() {
    space()
    const start = index
    if (!/[A-Za-z_$]/.test(source[index] || '')) fail()
    while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1
    return source.slice(start, index)
  }
  function string() {
    const quote = source[index++]
    let value = ''
    while (index < source.length) {
      const character = source[index++]
      if (character === quote) return value
      if (character !== '\\') { value += character; continue }
      const escaped = source[index++]
      const escapes = { n: '\n', r: '\r', t: '\t', "'": "'", '"': '"', '\\': '\\' }
      if (!Object.hasOwn(escapes, escaped)) fail()
      value += escapes[escaped]
    }
    fail()
  }
  function expression(depth = 0) {
    if (depth > 4) fail()
    space()
    const first = source[index]
    if (first === "'" || first === '"') return string()
    if (first === '{') {
      index += 1
      const result = Object.create(null)
      space()
      while (source[index] !== '}') {
        const key = source[index] === "'" || source[index] === '"' ? string() : identifier()
        consume(':')
        result[key] = expression(depth + 1)
        space()
        if (source[index] !== ',') break
        index += 1
        space()
      }
      consume('}')
      return result
    }
    const name = identifier()
    if (name === 't' || name === '$t') {
      consume('(')
      const key = expression(depth + 1)
      if (typeof key !== 'string') fail()
      consume(')')
      return key
    }
    if (name === 'option') {
      consume('.')
      if (identifier() !== 'label') fail()
      return 'Modo de ação'
    }
    fail()
  }
  const result = expression()
  space()
  if (index !== source.length) fail()
  return result
}
module.exports = { parseFixtureExpression }
