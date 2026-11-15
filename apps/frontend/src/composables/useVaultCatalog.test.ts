vi.mock('@/services/features.service', () => ({ featuresService: { get: vi.fn() } }))
vi.mock('@/services/pem-key.service', () => ({ pemKeyService: { list: vi.fn() } }))
vi.mock('@/services/secret.service', () => ({ secretService: { list: vi.fn() } }))
import { describe, expect, it, vi } from 'vitest'
import { useVaultCatalog, type VaultCatalogDependencies } from './useVaultCatalog'
import { secretFixture, pemFixture } from '@/services/vault-catalog.fixtures'
const options = { includeRevoked: false, canListPem: true }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function dependencies() {
  return { features: vi.fn<VaultCatalogDependencies['features']>().mockResolvedValue({ secretsLicensed: true }),
    secrets: vi.fn<VaultCatalogDependencies['secrets']>().mockResolvedValue([secretFixture]),
    pemKeys: vi.fn<VaultCatalogDependencies['pemKeys']>().mockResolvedValue([pemFixture]) }
}
describe('Vault catalogue request isolation', () => {
  it('checks licensing before secrets, while PEM loads independently', async () => {
    const deps = dependencies(), feature = deferred<{ secretsLicensed: boolean }>()
    deps.features.mockReturnValue(feature.promise)
    const catalog = useVaultCatalog(deps), loading = catalog.load(options)
    await Promise.resolve()
    expect(catalog.pemState.value).toBe('ready')
    expect(deps.secrets).not.toHaveBeenCalled()
    feature.resolve({ secretsLicensed: true }); await loading
    expect(deps.secrets).toHaveBeenCalledWith(false)
    expect(catalog.entries.value).toHaveLength(2)
    expect(catalog.loading.value).toBe(false)
  })
  it.each([false, true])('does not dispatch Secrets for unlicensed/guided=%s', async guided => {
    const deps = dependencies()
    deps.features.mockResolvedValue({ secretsLicensed: guided, ...(guided ? { trial: { resources: [], experience: 'guided' as const } } : {}) })
    const catalog = useVaultCatalog(deps); await catalog.load(options)
    expect(deps.secrets).not.toHaveBeenCalled()
    expect(catalog.secretState.value).toBe('unlicensed')
    expect(catalog.entries.value.map(e => e.kind)).toEqual(['pem'])
  })
  it('permits full trials and respects PEM permission and revoked selection', async () => {
    const deps = dependencies(); deps.features.mockResolvedValue({ secretsLicensed: true, trial: { resources: [], experience: 'full' } })
    const catalog = useVaultCatalog(deps); await catalog.load({ includeRevoked: true, canListPem: false })
    expect(deps.secrets).toHaveBeenCalledWith(true)
    expect(deps.pemKeys).not.toHaveBeenCalled()
    expect(catalog.pemState.value).toBe('hidden')
  })
  it.each(['features', 'secrets', 'pemKeys'] as const)('isolates %s failure and recovers on retry', async source => {
    const deps = dependencies(); deps[source].mockRejectedValueOnce(new Error('offline'))
    const catalog = useVaultCatalog(deps); await catalog.load(options)
    expect(source === 'pemKeys' ? catalog.pemState.value : catalog.secretState.value).toBe('error')
    expect(catalog.entries.value).toHaveLength(1)
    if (source === 'features') expect(deps.secrets).not.toHaveBeenCalled()
    await catalog.load(options)
    expect(catalog.entries.value).toHaveLength(2)
  })
  it('rejects malformed public responses independently', async () => {
    const deps = dependencies(); deps.secrets.mockResolvedValue([{}]); deps.pemKeys.mockResolvedValue([{}])
    const catalog = useVaultCatalog(deps); await catalog.load(options)
    expect(catalog.secretState.value).toBe('error'); expect(catalog.pemState.value).toBe('error')
    expect(catalog.entries.value).toEqual([])
  })
  it('clears previous context immediately and ignores late results/errors', async () => {
    const deps = dependencies(), catalog = useVaultCatalog(deps)
    await catalog.load(options)
    const oldSecrets = deferred<unknown>(), oldPem = deferred<unknown>()
    deps.secrets.mockReturnValueOnce(oldSecrets.promise); deps.pemKeys.mockReturnValueOnce(oldPem.promise)
    const oldLoad = catalog.load(options); await Promise.resolve()
    expect(catalog.entries.value).toEqual([])
    deps.secrets.mockResolvedValue([]); deps.pemKeys.mockResolvedValue([])
    await catalog.load(options)
    oldSecrets.resolve([secretFixture]); oldPem.reject(new Error('old tenant'))
    await oldLoad
    expect(catalog.entries.value).toEqual([])
    expect(catalog.secretState.value).toBe('ready'); expect(catalog.pemState.value).toBe('ready')
  })
  it('never dispatches Secrets following a stale feature response', async () => {
    const deps = dependencies(), oldFeature = deferred<{ secretsLicensed: boolean }>()
    deps.features.mockReturnValueOnce(oldFeature.promise)
    const catalog = useVaultCatalog(deps), oldLoad = catalog.load(options)
    deps.features.mockResolvedValue({ secretsLicensed: false }); await catalog.load(options)
    oldFeature.resolve({ secretsLicensed: true }); await oldLoad
    expect(deps.secrets).not.toHaveBeenCalled()
    expect(catalog.secretState.value).toBe('unlicensed')
  })
  it('disposal invalidates outstanding work and prevents future dispatch', async () => {
    const deps = dependencies(), feature = deferred<{ secretsLicensed: boolean }>(), pem = deferred<unknown>()
    deps.features.mockReturnValue(feature.promise); deps.pemKeys.mockReturnValue(pem.promise)
    const catalog = useVaultCatalog(deps), pending = catalog.load(options)
    catalog.dispose(); feature.resolve({ secretsLicensed: true }); pem.resolve([pemFixture]); await pending
    await catalog.load(options)
    expect(deps.features).toHaveBeenCalledTimes(1); expect(deps.secrets).not.toHaveBeenCalled()
    expect(catalog.entries.value).toEqual([]); expect(catalog.loading.value).toBe(false)
    expect(catalog.secretState.value).toBe('hidden'); expect(catalog.pemState.value).toBe('hidden')
  })
})
