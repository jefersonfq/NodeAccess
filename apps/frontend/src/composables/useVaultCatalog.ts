import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { featuresService, type Features } from '@/services/features.service'
import { pemKeyService } from '@/services/pem-key.service'
import { secretService } from '@/services/secret.service'
import { isGuidedTrial } from '@/services/trial-experience'
import { pemEntries, secretEntries, type VaultEntry } from '@/services/vault-catalog'

export type VaultSourceState = 'loading' | 'ready' | 'error' | 'unlicensed' | 'hidden'
export interface VaultCatalogDependencies {
  features: () => Promise<Pick<Features, 'secretsLicensed' | 'trial'>>
  secrets: (includeRevoked: boolean) => Promise<unknown>
  pemKeys: () => Promise<unknown>
}
const defaultDependencies: VaultCatalogDependencies = {
  features: () => featuresService.get(),
  secrets: (includeRevoked) => secretService.list(includeRevoked).then(({ data }) => data),
  pemKeys: () => pemKeyService.list().then(({ data }) => data),
}

export interface VaultCatalog {
  entries: ComputedRef<VaultEntry[]>
  secretState: Ref<VaultSourceState>
  pemState: Ref<VaultSourceState>
  loading: Ref<boolean>
  generation: Ref<number>
  load: (options: { includeRevoked: boolean; canListPem: boolean }) => Promise<void>
  dispose: () => void
}
// Page-local state. A generation protects both request dispatch and completion.
export function useVaultCatalog(dependencies: VaultCatalogDependencies = defaultDependencies): VaultCatalog {
  const secrets = ref<VaultEntry[]>([])
  const pemKeys = ref<VaultEntry[]>([])
  const secretState = ref<VaultSourceState>('loading')
  const pemState = ref<VaultSourceState>('loading')
  const loading = ref(false)
  const generation = ref(0)
  let active = true
  const entries = computed(() => [...secrets.value, ...pemKeys.value])
  const current = (request: number): boolean => active && generation.value === request

  async function loadSecrets(request: number, includeRevoked: boolean): Promise<void> {
    try {
      const features = await dependencies.features()
      if (!current(request)) return
      if (!features.secretsLicensed || isGuidedTrial(features.trial ?? null)) {
        secretState.value = 'unlicensed'
        return
      }
      const data = await dependencies.secrets(includeRevoked)
      if (!current(request)) return
      secrets.value = secretEntries(data)
      secretState.value = 'ready'
    } catch {
      if (current(request)) secretState.value = 'error'
    }
  }
  async function loadPemKeys(request: number, allowed: boolean): Promise<void> {
    if (!allowed) { pemState.value = 'hidden'; return }
    try {
      const data = await dependencies.pemKeys()
      if (!current(request)) return
      pemKeys.value = pemEntries(data)
      pemState.value = 'ready'
    } catch {
      if (current(request)) pemState.value = 'error'
    }
  }
  async function load(options: { includeRevoked: boolean; canListPem: boolean }): Promise<void> {
    if (!active) return
    const request = ++generation.value
    secrets.value = []
    pemKeys.value = []
    secretState.value = 'loading'
    pemState.value = 'loading'
    loading.value = true
    await Promise.all([loadSecrets(request, options.includeRevoked), loadPemKeys(request, options.canListPem)])
    if (current(request)) loading.value = false
  }
  function dispose(): void {
    active = false
    generation.value++
    secrets.value = []
    pemKeys.value = []
    secretState.value = 'hidden'
    pemState.value = 'hidden'
    loading.value = false
  }
  return { entries, secretState, pemState, loading, generation, load, dispose }
}
