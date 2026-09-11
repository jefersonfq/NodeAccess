import { describe, expect, it } from 'vitest'
import { normalizeHostSearchTerms } from './host.repository'

describe('normalizeHostSearchTerms', () => {
  it('keeps the literal query and adds a dot-normalized IPv4 alternative', () => {
    expect(normalizeHostSearchTerms('172,31,1,20')).toEqual(['172,31,1,20', '172.31.1.20'])
    expect(normalizeHostSearchTerms('172,31.1,20')).toEqual(['172,31.1,20', '172.31.1.20'])
  })

  it('does not alter commas in host names', () => {
    expect(normalizeHostSearchTerms('Servidor, produção')).toEqual(['Servidor, produção'])
  })

  it('trims input and avoids duplicate alternatives for dotted IPs', () => {
    expect(normalizeHostSearchTerms(' 172.31.1.20 ')).toEqual(['172.31.1.20'])
    expect(normalizeHostSearchTerms('   ')).toEqual([])
  })
})
