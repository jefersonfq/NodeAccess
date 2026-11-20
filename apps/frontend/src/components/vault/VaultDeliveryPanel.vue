<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NFormItem, NInput, NModal, NSpace, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { createVaultDelivery } from '@/services/vault-delivery'
import { VaultClientError, type VaultPortalIdentity } from '@/services/vault-http'
import { openVaultProviderWindow, requestGoogleIdToken } from '@/services/vault-provider-confirm'

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
// NA-0184: OIDC/Google sessions confirm identity at the provider instead of the password form.
const provider = computed(() => state.stepUp === 'provider')
const googleTarget = ref<HTMLElement | null>(null), googlePending = ref(false), totpPending = ref(false)
let totpWaiter: { resolve(value: string): void; reject(error: unknown): void } | null = null
const available = computed(() => secure.value && !busy.value)
const title = computed(() => `${t(`vaultDelivery.${action.value}`)}: ${itemName.value}`)
function cancelProvider(): void {
  const waiter = totpWaiter; totpWaiter = null
  totpPending.value = false; googlePending.value = false
  waiter?.reject(new VaultClientError('locked'))
}
function clearForm(): void { password.value = ''; token.value = ''; cancelProvider() }
function reset(): void { ++intent; clearForm(); dialog.value = false; itemId = 0; itemName.value = ''; delivery.lock() }
function close(): void { ++intent; clearForm(); dialog.value = false; itemId = 0; itemName.value = ''; delivery.dismiss() }
function request(nextAction: 'reveal' | 'copy', id: number, name: string): void {
  if (busy.value || !secure.value) return
  delivery.dismiss(); ++intent; clearForm(); itemId = id; itemName.value = name; action.value = nextAction; dialog.value = true
  delivery.tick()
  if (state.phase === 'unlocked') void delivery.deliver(nextAction, id)
  else if (state.phase === 'locked') void delivery.prepare()
}
async function confirmProvider(): Promise<void> {
  const current = intent, selected = itemId, nextAction = action.value
  await delivery.unlockWithProvider({
    redirect: (url, signal) => openVaultProviderWindow(url, signal),
    google: async (clientId, nonce, signal) => {
      googlePending.value = true
      await nextTick()
      try {
        if (!googleTarget.value) throw new VaultClientError('unavailable')
        return await requestGoogleIdToken(googleTarget.value, clientId, nonce, signal)
      } finally { googlePending.value = false }
    },
    totp: signal => new Promise<string>((resolve, reject) => {
      token.value = ''; totpPending.value = true; totpWaiter = { resolve, reject }
      signal.addEventListener('abort', cancelProvider, { once: true })
    }),
  })
  token.value = ''; totpPending.value = false; googlePending.value = false
  if (current === intent && dialog.value && state.phase === 'unlocked') await delivery.deliver(nextAction, selected)
}
function submitTotp(): void {
  const waiter = totpWaiter, value = token.value
  totpWaiter = null; totpPending.value = false; token.value = ''
  waiter?.resolve(value)
}
async function unlock(): Promise<void> {
  const current = intent, selected = itemId, nextAction = action.value
  const pending = delivery.unlock(password.value, token.value)
  clearForm()
  await pending
  if (current === intent && dialog.value && state.phase === 'unlocked') await delivery.deliver(nextAction, selected)
}
// The provider window/Google prompt takes focus; no plaintext exists while waiting, so only that wait is exempt.
function blurred(): void { if (!state.providerPending) reset() }
function visibility(): void { if (document.visibilityState !== 'visible') blurred(); else delivery.tick() }
watch(() => [auth.user?.id, auth.user?.tenantId, auth.user?.actingTenantId, auth.refreshToken, auth.isManagingTenant], reset, { flush: 'sync' })
onMounted(() => {
  ticker = setInterval(() => delivery.tick(), 250)
  window.addEventListener('blur', blurred)
  window.addEventListener('pagehide', reset)
  window.addEventListener('nodeaccess:tenant-context-changed', reset)
  document.addEventListener('visibilitychange', visibility)
})
onBeforeUnmount(() => {
  reset(); delivery.dispose(); clearInterval(ticker)
  window.removeEventListener('blur', blurred)
  window.removeEventListener('pagehide', reset)
  window.removeEventListener('nodeaccess:tenant-context-changed', reset)
  document.removeEventListener('visibilitychange', visibility)
})
defineExpose({ request, lock: reset, available })
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
    <NAlert
      v-if="!secure"
      type="warning"
      role="alert"
      class="w-full"
    >
      {{ t('vaultDelivery.https') }}
    </NAlert>
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
          {{ t(provider ? 'vaultDelivery.providerPolicyHint' : 'vaultDelivery.policyHint') }}
        </p>
        <NAlert
          v-if="state.error"
          class="mb-4"
          type="warning"
          role="alert"
        >
          {{ t(`vaultDelivery.errors.${state.error}`) }}
        </NAlert>
        <div
          v-if="provider && (state.phase === 'locked' || state.phase === 'unlocking')"
          data-testid="vault-provider-step-up"
        >
          <div
            v-show="googlePending"
            ref="googleTarget"
            class="mb-3"
          />
          <form
            v-if="totpPending"
            autocomplete="off"
            @submit.prevent="submitTotp"
          >
            <NFormItem
              :label="t('vaultDelivery.otp')"
              :label-props="{ for: 'vault-provider-otp' }"
            >
              <NInput
                v-model:value="token"
                :input-props="{ id: 'vault-provider-otp', inputmode: 'numeric', autocomplete: 'off', maxlength: 6 }"
              />
            </NFormItem>
            <NButton
              attr-type="submit"
              type="primary"
              :disabled="!/^\d{6}$/.test(token)"
            >
              {{ t('vaultDelivery.unlock') }}
            </NButton>
          </form>
          <NSpace v-else>
            <NButton
              type="primary"
              :loading="state.phase === 'unlocking'"
              :disabled="state.phase === 'unlocking'"
              @click="confirmProvider"
            >
              {{ t('vaultDelivery.providerConfirm') }}
            </NButton>
            <NButton
              v-if="state.providerPending"
              @click="reset"
            >
              {{ t('vaultDelivery.providerCancel') }}
            </NButton>
          </NSpace>
        </div>
        <form
          v-else-if="state.phase === 'locked' || state.phase === 'unlocking'"
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
