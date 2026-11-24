<script setup lang="ts">
/**
 * NA-0199 — "Cofre (VaultNAccess)" in /admin/settings: the tenant's vault settings in the standard settings place.
 * Values are shown without unlocking; changes stay two-manager proposals made here by vault managers (embedded
 * VaultAdministration in `settings` mode). Administrators who are not managers read the values and are told who acts.
 */
import { computed, onMounted, ref } from 'vue'
import { NAlert, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { VaultSettings } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { createVaultTransport, type VaultTransport } from '@/services/vault-http'
import { formatDuration, vaultSettings } from '@/services/vault-manager'
import VaultAdministration from '@/components/vault/VaultAdministration.vue'

const props = defineProps<{ transport?: VaultTransport }>()
const { t } = useI18n(), auth = useAuthStore()
const transport = props.transport ?? createVaultTransport()
const state = ref<VaultSettings | 'denied' | 'unconfigured' | 'unknown' | null>(null)
const settings = computed(() => (state.value && typeof state.value === 'object' ? state.value : null))
const units = computed(() => ({ s: t('vaultAdministration.unitSeconds'), min: t('vaultAdministration.unitMinutes'), h: t('vaultAdministration.unitHours') }))
const onOff = (value: boolean): string => t(value ? 'vaultAdministration.on' : 'vaultAdministration.off')
const rows = computed(() => settings.value ? [
  { key: 'delivery', label: t('vaultSettings.delivery'), value: t('vaultSettings.deliveryValue', { reveal: onOff(settings.value.reveal), copy: onOff(settings.value.copy) }) },
  { key: 'quota', label: t('vaultSettings.quota'), value: String(settings.value.tenantQuota) },
  { key: 'confirmation', label: t('vaultSettings.confirmation'), value: formatDuration(settings.value.confirmationSeconds, units.value) },
  { key: 'proposal', label: t('vaultSettings.proposal'), value: formatDuration(settings.value.proposalSeconds, units.value) },
  { key: 'origin', label: t('vaultSettings.origin'), value: settings.value.origin },
  { key: 'webauthn', label: t('vaultSettings.webauthn'), value: t(settings.value.webauthn ? 'vaultSettings.webauthnOn' : 'vaultSettings.webauthnOff') },
] : [])
async function load(): Promise<void> {
  const reply = await vaultSettings(transport, auth)
  state.value = reply ?? 'unknown'
}
onMounted(() => { void load() })
defineExpose({ load })
</script>

<template>
  <div data-testid="vault-settings">
    <NText
      v-if="state === null"
      depth="3"
      class="block text-sm"
    >
      {{ t('vaultSettings.loading') }}
    </NText>
    <NAlert
      v-else-if="state === 'unconfigured'"
      type="info"
      data-testid="vault-settings-unconfigured"
    >
      {{ t('vaultSettings.unconfigured') }}
    </NAlert>
    <NAlert
      v-else-if="state === 'denied'"
      type="info"
    >
      {{ t('vaultSettings.denied') }}
    </NAlert>
    <NAlert
      v-else-if="state === 'unknown'"
      type="warning"
      role="alert"
    >
      {{ t('vaultSettings.unavailable') }}
    </NAlert>
    <template v-else-if="settings">
      <dl
        class="mb-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(12rem,auto)_1fr]"
        data-testid="vault-settings-values"
      >
        <template
          v-for="row in rows"
          :key="row.key"
        >
          <dt class="text-zinc-400">
            {{ row.label }}
          </dt>
          <dd
            class="break-words"
            :data-testid="`vault-settings-${row.key}`"
          >
            {{ row.value }}
          </dd>
        </template>
      </dl>
      <VaultAdministration
        v-if="settings.manager"
        settings
        @changed="load"
      />
      <NText
        v-else
        depth="3"
        class="block text-sm"
        data-testid="vault-settings-read-only"
      >
        {{ t('vaultSettings.readOnly') }}
      </NText>
    </template>
  </div>
</template>
