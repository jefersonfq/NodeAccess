<script setup lang="ts">
/**
 * NA-0194: how to install the VaultNAccess extension published by this NodeAccess (operator release).
 * Hidden when nothing is published. Administrators also see the Chrome/Edge policy value for managed installs.
 */
import { computed, onMounted, ref } from 'vue'
import { NButton, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const BASE = '/api/v1/vault-security/extension'
interface PackageInfo { available: true; version: string; extensionId: string; zip: { sha256: string; size: number }; zipUrl: string; crxUrl: string; updateUrl: string }
const { t } = useI18n(), auth = useAuthStore()
const info = ref<PackageInfo | null>(null), copied = ref('')
const origin = (): string => (typeof window !== 'undefined' ? window.location.origin : '')
const policy = computed(() => (info.value ? `${info.value.extensionId};${origin()}${info.value.updateUrl}` : ''))
const sizeKb = computed(() => (info.value ? Math.max(1, Math.round(info.value.zip.size / 1024)) : 0))
function valid(value: unknown): value is PackageInfo {
  const v = value as Partial<PackageInfo> | null
  return !!v && v.available === true && typeof v.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v.version) && typeof v.extensionId === 'string' && /^[a-p]{32}$/.test(v.extensionId)
    && typeof v.zip?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.zip.sha256) && typeof v.zip.size === 'number'
    && v.zipUrl === `${BASE}/package.zip` && v.crxUrl === `${BASE}/package.crx` && v.updateUrl === `${BASE}/update.xml`
}
async function load(): Promise<void> {
  // Outside HTTPS the vault page makes no Vault API request (contract of the HTTP boundary); the extension needs HTTPS anyway.
  // Same rule as every vault request: browsers treat http://localhost as a secure context, so the scheme is checked too.
  if (typeof window === 'undefined' || !window.isSecureContext || window.location?.protocol !== 'https:') { info.value = null; return }
  try {
    const { data } = await api.get<unknown>('/vault-security/extension/package')
    info.value = valid(data) ? data : null
  } catch { info.value = null }
}
async function copy(kind: 'policy' | 'sha256', value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); copied.value = kind } catch { copied.value = '' }
}
onMounted(() => { void load() })
defineExpose({ load, copy })
</script>

<template>
  <section
    v-if="info"
    class="mb-4 rounded border border-gray-700 p-4"
    data-testid="vault-extension-install"
  >
    <h2 class="mb-1 text-base font-semibold">
      {{ t('vaultExtension.installTitle') }}
    </h2>
    <p class="mb-3 text-sm text-gray-400">
      {{ t('vaultExtension.installIntro') }}
    </p>
    <p
      class="mb-3 text-sm"
      data-testid="vault-extension-install-version"
    >
      {{ t('vaultExtension.installVersion') }}: <strong>{{ info.version }}</strong>
    </p>
    <NButton
      tag="a"
      type="primary"
      :href="info.zipUrl"
      download
      data-testid="vault-extension-install-download"
    >
      {{ t('vaultExtension.installDownload', { size: sizeKb }) }}
    </NButton>
    <details
      class="mt-3 text-sm"
      data-testid="vault-extension-install-first"
    >
      <summary class="cursor-pointer">
        {{ t('vaultExtension.installStepsTitle') }}
      </summary>
      <ol class="mt-2 list-decimal space-y-2 pl-5">
        <li>{{ t('vaultExtension.installStep1') }}</li>
        <li>{{ t('vaultExtension.installStep2') }}</li>
        <li>{{ t('vaultExtension.installStep3') }}</li>
        <li>{{ t('vaultExtension.installStep4') }}</li>
      </ol>
    </details>
    <details
      class="mt-3 text-sm"
      data-testid="vault-extension-install-update"
    >
      <summary class="cursor-pointer">
        {{ t('vaultExtension.installUpdateTitle') }}
      </summary>
      <p class="mt-2">
        {{ t('vaultExtension.installUpdateIntro') }}
      </p>
      <ol class="mt-2 list-decimal space-y-2 pl-5">
        <li>{{ t('vaultExtension.installUpdateStep1') }}</li>
        <li>{{ t('vaultExtension.installUpdateStep2') }}</li>
        <li>{{ t('vaultExtension.installUpdateStep3') }}</li>
        <li>{{ t('vaultExtension.installUpdateStep4') }}</li>
      </ol>
      <p class="mt-2">
        {{ t('vaultExtension.installUpdateRecovery') }}
      </p>
    </details>
    <details
      class="mt-3 text-sm"
      data-testid="vault-extension-install-details"
    >
      <summary class="cursor-pointer">
        {{ t('vaultExtension.installDetailsTitle') }}
      </summary>
      <dl class="mt-2 space-y-2">
        <dt>{{ t('vaultExtension.installId') }}</dt>
        <dd>
          <code
            class="break-all"
            data-testid="vault-extension-install-id"
          >{{ info.extensionId }}</code>
        </dd>
        <dt>SHA-256</dt>
        <dd class="flex flex-wrap items-center gap-2">
          <code
            class="break-all"
            data-testid="vault-extension-install-sha256"
          >{{ info.zip.sha256 }}</code>
          <NButton
            size="tiny"
            @click="copy('sha256', info.zip.sha256)"
          >
            {{ copied === 'sha256' ? t('vaultExtension.installCopied') : t('vaultExtension.installCopy') }}
          </NButton>
        </dd>
      </dl>
    </details>
    <details
      v-if="auth.isAdmin"
      class="mt-3 text-sm"
      data-testid="vault-extension-install-policy"
    >
      <summary class="cursor-pointer">
        {{ t('vaultExtension.installPolicyTitle') }}
      </summary>
      <p class="mt-2 text-gray-300">
        {{ t('vaultExtension.installPolicyHint') }}
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <code class="break-all">{{ policy }}</code>
        <NButton
          size="tiny"
          @click="copy('policy', policy)"
        >
          {{ copied === 'policy' ? t('vaultExtension.installCopied') : t('vaultExtension.installCopy') }}
        </NButton>
      </div>
      <NText
        depth="3"
        class="mt-2 block"
      >
        {{ t('vaultExtension.installPolicyNote') }}
      </NText>
    </details>
  </section>
</template>
