import { describe, expect, it } from 'vitest'
import { jsonFenceBody, trimTrailingSlashes } from './linear-text.js'
import { findHostLinkTemplateTokens } from '@nodeaccess/shared'

describe('linear delimiter scans', () => {
  it('preserves URLs and removes only trailing slash runs', () => {
    for (const input of ['', '/', 'https://example.test/', 'https://example.test/a///', 'a/ b']) {
      expect(trimTrailingSlashes(input)).toBe(input.replace(/\/+$/, ''))
    }
    expect(trimTrailingSlashes('x' + '/'.repeat(100_000))).toBe('x')
  })
  it('reads JSON fences without retrying malformed delimiters', () => {
    expect(jsonFenceBody('text ```JSON\n {"a":1} \n``` rest')).toBe('{"a":1}')
    expect(jsonFenceBody('```json {} ```', true)).toBe('{}')
    expect(jsonFenceBody('```json {} ``` trailing', true)).toBeUndefined()
    expect(jsonFenceBody('```' + ' '.repeat(100_000))).toBeUndefined()
    expect(jsonFenceBody('```json```')).toBe('')
  })
  it('preserves token matching for nested and malformed templates', () => {
    for (const input of ['{{HOST.IP}} {{UNKNOWN}}', '{{}}', '{{{}}', '{{a}{{foo}}', '{{a{{b}}', '{{a}}{{b}}', 'x{{a}z}}']) {
      expect(findHostLinkTemplateTokens(input)).toEqual(input.match(/\{\{[^}]+\}\}/g) ?? [])
    }
    expect(findHostLinkTemplateTokens('{{'.repeat(100_000))).toEqual([])
  })
})
