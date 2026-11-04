'use strict'

function stripFingerprintPadding(value) {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 61) end--
  return value.slice(0, end)
}

function containsYearAndTime(value) {
  for (const line of value.split(/[\r\n\u2028\u2029]/)) {
    const year = /\d{4}/.exec(line)
    if (year && /\d{2}:\d{2}/.test(line.slice(year.index + 4))) return true
  }
  return false
}

module.exports = { stripFingerprintPadding, containsYearAndTime }
