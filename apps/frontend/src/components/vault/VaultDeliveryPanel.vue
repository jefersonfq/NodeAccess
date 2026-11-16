<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NFormItem, NInput, NModal, NSpace, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { createVaultDelivery } from '@/services/vault-delivery'
import type { VaultPortalIdentity } from '@/services/vault-http'

const { t } = useI18n(), auth = useAuthStore()
const secure = computed(() => globalThis.isSecureContext === true && typeof window !== 'undefined' && window.location?.protocol === 'https:')
function identity(): VaultPortalIdentity | null {
  const u = auth.user
  if (!secure.value || !u || u.actingTenantId !== undefined || auth.isManagingTenant || !auth.accessToken || !auth.refreshToken) return null
  return { userId: u.id, tenantId: u.tenantId, accessToken: auth.accessToken, refreshToken: auth.refreshToken, origin: window.location.origin }
}
const delivery = createVaultDelivery({ identity }), state = delivery.state
const dialog = ref(false), password = ref(''), token = ref(''), itemName = ref(''), action = ref<'reveal' | 'copy'>('reveal')
let itemId = 0, intent = 0, ticker: ReturnType<typeof setInterval> | undefined
const busy = computed(() => ['unlocking', 'delivering', 'copying'].includes(state.phase))
const title = computed(() => `${t(`vaultDelivery.${action.value}`)}: ${itemName.value}`)
function clearForm(): void { password.value = ''; token.value = '' }
function reset(): void { ++intent; clearForm(); dialog.value = false; itemId = 0; itemName.value = ''; delivery.lock() }
function close(): void { ++intent; clearForm(); dialog.value = false; itemId = 0; itemName.value = ''; delivery.dismiss() }
function request(nextAction: 'reveal' | 'copy', id: number, name: string): void {
  if (busy.value || !secure.value) return
  delivery.dismiss(); ++intent; clearForm(); itemId = id; itemName.value = name; action.value = nextAction; dialog.value = true
  delivery.tick()
  if (state.phase === 'unlocked') void delivery.deliver(nextAction, id)
}
async function unlock(): Promise<void> {
  const current = intent, selected = itemId, nextAction = action.value
  const pending = delivery.unlock(password.value, token.value)
  clearForm()
  await pending
  if (current === intent && dialog.value && state.phase === 'unlocked') await delivery.deliver(nextAction, selected)
}
function visibility(): void { if (document.visibilityState !== 'visible') reset(); else delivery.tick() }
watch(() => [auth.user?.id, auth.user?.tenantId, auth.user?.actingTenantId, auth.refreshToken, auth.isManagingTenant], reset, { flush: 'sync' })
onMounted(() => {
  ticker = setInterval(() => delivery.tick(), 250)
  window.addEventListener('blur', reset)
  window.addEventListener('pagehide', reset)
  window.addEventListener('nodeaccess:tenant-context-changed', reset)
  document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => {
  reset(); delivery.dispose(); clearInterval(ticker)
  window.removeEventListener('blur', reset)
  window.removeEventListener('pagehide', reset)
  window.removeEventListener('nodeaccess:tenant-context-changed', reset)
  document.removeEventListener('visibilitychange', visibility)
})
defineExpose({ request, lock: reset })
</script>

<template>
  <div
    class="mb-4 flex flex-wrap items-center gap-3"
    data-testid="vault-delivery-panel"
  >
    <NText
      depth="3"
      role="status"
    >
      {{ t(state.phase === 'locked' ? 'vaultDelivery.locked' : 'vaultDelivery.sessionActive') }}
    </NText>
    <NButton
      v-if="state.phase !== 'locked'"
      size="small"
      @click="reset"
    >
      {{ t('vaultDelivery.lock') }}
    </NButton>
    <NText
      v-if="!secure"
      depth="3"
    >
      {{ t('vaultDelivery.https') }}
    </NText>
    <NModal
      :show="dialog"
      :mask-closable="false"
      @update:show="(show: boolean) => { if (!show) close() }"
    >
      <NCard
        class="w-[min(95vw,32rem)]"
        :title="title"
        closable
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        @close="close"
      >
        <p class="mb-4 text-sm text-gray-400">
          {{ t('vaultDelivery.policyHint') }}
        </p>
        <NAlert
          v-if="state.error"
          class="mb-4"
          type="warning"
          role="alert"
        >
          {{ t(`vaultDelivery.errors.${state.error}`) }}
        </NAlert>
        <form
          v-if="state.phase === 'locked' || state.phase === 'unlocking'"
          autocomplete="off"
          @submit.prevent="unlock"
        >
          <NFormItem
            :label="t('vaultDelivery.password')"
            :label-props="{ for: 'vault-unlock-password' }"
          >
            <NInput
              v-model:value="password"
              type="password"
              :disabled="busy"
              :input-props="{ id: 'vault-unlock-password', autocomplete: 'off', maxlength: 1024 }"
            />
          </NFormItem>
          <NFormItem
            :label="t('vaultDelivery.otp')"
            :label-props="{ for: 'vault-unlock-otp' }"
          >
            <NInput
              v-model:value="token"
              :disabled="busy"
              :input-props="{ id: 'vault-unlock-otp', inputmode: 'numeric', autocomplete: 'off', maxlength: 6 }"
            />
          </NFormItem>
          <NButton
            attr-type="submit"
            type="primary"
            :loading="busy"
            :disabled="!password || !/^\d{6}$/.test(token)"
          >
            {{ t('vaultDelivery.unlock') }}
          </NButton>
        </form>
        <p
          v-if="state.phase === 'delivering'"
          role="status"
        >
          {{ t('vaultDelivery.delivering') }}
        </p>
        <div
          v-if="state.phase === 'revealed'"
          class="space-y-3"
        >
          <p class="text-sm text-gray-400">
            {{ t('vaultDelivery.revealHint') }}
          </p>
          <pre
            class="whitespace-pre-wrap break-all rounded bg-black/20 p-3 font-mono"
            data-testid="vault-revealed-value"
          >{{ state.value }}</pre>
          <NButton @click="delivery.dismiss">
            {{ t('vaultDelivery.hide') }}
          </NButton>
        </div>
        <div
          v-if="state.phase === 'copy-ready' || state.phase === 'copying'"
          class="space-y-3"
        >
          <p class="text-sm text-gray-400">
            {{ t('vaultDelivery.copyHint') }}
          </p>
          <NButton
            type="primary"
            :loading="state.phase === 'copying'"
            :disabled="state.phase === 'copying'"
            @click="delivery.confirmCopy"
          >
            {{ t('vaultDelivery.confirmCopy') }}
          </NButton>
        </div>
        <NAlert
          v-if="state.copied"
          type="success"
          role="status"
        >
          {{ t('vaultDelivery.copied') }}
        </NAlert>
        <p
          v-if="state.phase === 'unlocked' && !state.copied"
          class="text-sm"
          role="status"
        >
          {{ t('vaultDelivery.valueCleared') }}
        </p>
        <template #footer>
          <NSpace justify="end">
            <NButton @click="close">
              {{ t('common.close') }}
            </NButton>
          </NSpace>
        </template>
      </NCard>
    </NModal>
  </div>
</template>
