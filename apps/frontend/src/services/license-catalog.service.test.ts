import { describe, expect, it } from 'vitest'
import { licenseModuleCatalog, licenseProviderCatalog, moduleByKey, moduleDependents } from './license-catalog.service'

describe('license catalog', () => {
  it('provides friendly and unique labels for every module and provider', () => {
    expect(new Set(licenseModuleCatalog.map(item => item.key)).size).toBe(licenseModuleCatalog.length)
    expect(new Set(licenseProviderCatalog.map(item => item.key)).size).toBe(licenseProviderCatalog.length)
    expect(licenseModuleCatalog.every(item => item.label !== item.key && item.description.length > 20 && item.cases.length >= 2)).toBe(true)
    expect(licenseProviderCatalog.every(item => item.label !== item.key && item.description.length > 20 && item.cases.length >= 2)).toBe(true)
  })

  it('describes the dependency chain for automatic session summaries', () => {
    expect(moduleByKey('auditAiAutoSummary')?.dependsOn).toEqual(['sessionAudit', 'sessionAuditAi'])
    expect(moduleDependents('sessionAudit')).toContain('sessionAuditAi')
    expect(moduleDependents('localAi')).toEqual(expect.arrayContaining(['terminalAi', 'aiSshActions']))
  })
})
