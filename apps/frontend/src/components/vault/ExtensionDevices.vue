<script setup lang="ts">
/** NA-0183: the signed-in user's browser-extension devices; hidden when the server has the extension disabled.
 * NA-0196: a header button (next to Import PEM key) opens them in a window instead of a block on the page; the
 * identifier is the one the extension shows, so the user knows which browser is revoked. */
import { computed, onMounted, ref } from 'vue'
import { NButton, NModal, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { VaultExtensionDevicesReplySchema, type VaultExtensionDevice } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { createVaultTransport, VaultClientError, type VaultPortalIdentity, type VaultTransport } from '@/services/vault-http'
import { fingerprint } from '@/services/vault-extension-consent'

const props = defineProps<{ transport?: VaultTransport }>()
const { t, d } = useI18n(), auth = useAuthStore()
const transport = props.transport ?? createVaultTransport()
const devices = ref<VaultExtensionDevice[]>([]), available = ref(false), error = ref(''), busy = ref(''), open = ref(false)
const active = computed(() => devices.value.filter(device => device.state === 'ACTIVE'))
function identity(): VaultPortalIdentity | null {
  const u = auth.user
  // Same HTTPS requirement as every vault request: nothing is sent from an insecure page.
  const secure = globalThis.isSecureContext === true && typeof window !== 'undefined' && window.location?.protocol === 'https:'
  if (!secure || !u || u.actingTenantId !== undefined || auth.isManagingTenant || !auth.accessToken || !auth.refreshToken) return null
  return { userId: u.id, tenantId: u.tenantId, accessToken: auth.accessToken, refreshToken: auth.refreshToken, origin: window.location.origin }
}
async function load(): Promise<void> {
  const who = identity()
  if (!who) { available.value = false; return }
  try {
    devices.value = VaultExtensionDevicesReplySchema.parse(await transport.post('extension/devices', {}, who)).devices
    available.value = true; error.value = ''
  } catch (failure) {
    // Disabled on the server, or vault not provisioned for this tenant: nothing to show.
    available.value = false
    if (failure instanceof VaultClientError && failure.reason !== 'unsupported' && failure.reason !== 'denied') error.value = failure.reason
  }
}
async function revoke(jkt: string): Promise<void> {
  const who = identity()
  if (!who || busy.value) return
  busy.value = jkt
  try { await transport.post('extension/devices/revoke', { jkt }, who); await load() } catch { error.value = 'unavailable' } finally { busy.value = '' }
}
onMounted(() => { void load() })
defineExpose({ load })
</script>

<template>
  <NButton
    v-if="available"
    secondary
    data-testid="vault-extension-devices-open"
    @click="open = true; load()"
  >
    {{ t('vaultExtension.devicesButton', { count: active.length }) }}
  </NButton>
  <NModal
    :show="open"
    preset="card"
    :title="t('vaultExtension.devicesTitle')"
    style="width: min(620px, 100vw)"
    @update:show="(value: boolean) => { open = value }"
  >
    <section data-testid="vault-extension-devices">
      <p class="mb-3 text-sm text-gray-400">
        {{ t('vaultExtension.devicesHint') }}
      </p>
      <NText
        v-if="!active.length"
        depth="3"
      >
        {{ t('vaultExtension.noDevices') }}
      </NText>
      <ul
        v-else
        class="space-y-2"
      >
        <li
          v-for="device in active"
          :key="device.jkt"
          class="flex flex-wrap items-center gap-3"
        >
          <code>{{ fingerprint(device.jkt) }}</code>
          <NText depth="3">
            {{ t('vaultExtension.connectedAt', { date: d(new Date(device.createdAt), 'short') }) }}
          </NText>
          <NButton
            size="small"
            :loading="busy === device.jkt"
            :data-testid="`vault-extension-revoke-${device.jkt}`"
            @click="revoke(device.jkt)"
          >
            {{ t('vaultExtension.revoke') }}
          </NButton>
        </li>
      </ul>
      <NText
        v-if="error"
        type="warning"
        role="alert"
      >
        {{ t(`vaultDelivery.errors.${error}`) }}
      </NText>
    </section>
  </NModal>
</template>
