<script setup lang="ts">
/**
 * NA-0183 — consent page for the VaultNAccess browser extension (opened by chrome.identity.launchWebAuthFlow).
 * Requires the vault step-up of the user's login method; the one-time code goes only to the exact
 * https://<extension-id>.chromiumapp.org/ redirect and nothing is stored in this page or in browser storage.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NAlert, NButton, NCard, NFormItem, NInput, NSpace, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { VaultExtensionConnectRequestSchema, type VaultExtensionConnectRequest } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { createVaultDelivery } from '@/services/vault-delivery'
import { VaultClientError, type VaultPortalIdentity } from '@/services/vault-http'
import { openVaultProviderWindow, requestGoogleIdToken } from '@/services/vault-provider-confirm'
import { extensionConsentRequest, extensionReturnUrl, fingerprint } from '@/services/vault-extension-consent'

const { t } = useI18n(), auth = useAuthStore(), route = useRoute()
const secure = computed(() => globalThis.isSecureContext === true && typeof window !== 'undefined' && window.location?.protocol === 'https:')
function identity(): VaultPortalIdentity | null {
  const u = auth.user
  if (!secure.value || !u || u.actingTenantId !== undefined || auth.isManagingTenant || !auth.accessToken || !auth.refreshToken) return null
  return { userId: u.id, tenantId: u.tenantId, accessToken: auth.accessToken, refreshToken: auth.refreshToken, origin: window.location.origin }
}
const request = ref<VaultExtensionConnectRequest | null>(extensionConsentRequest(route.query, VaultExtensionConnectRequestSchema))
const delivery = createVaultDelivery({ identity }), state = delivery.state
const password = ref(''), token = ref(''), done = ref(false)
const provider = computed(() => state.stepUp === 'provider')
const busy = computed(() => state.phase === 'unlocking' || state.phase === 'delivering')
const googleTarget = ref<HTMLElement | null>(null), googlePending = ref(false), totpPending = ref(false)
let totpWaiter: { resolve(value: string): void; reject(error: unknown): void } | null = null
let ticker: ReturnType<typeof setInterval> | undefined

function leave(params: Record<string, string>): void {
  if (!request.value) return
  done.value = true
  window.location.replace(extensionReturnUrl(request.value.redirectUri, { ...params, state: request.value.state }))
}
function deny(): void { password.value = ''; token.value = ''; delivery.lock(); leave({ error: 'access_denied' }) }
async function finish(): Promise<void> {
  if (!request.value || state.phase !== 'unlocked') return
  const { extensionId, redirectUri, state: oauthState, codeChallenge, deviceJkt } = request.value
  const code = await delivery.authorizeExtension({ extensionId, redirectUri, state: oauthState, codeChallenge, deviceJkt })
  if (code) leave({ code })
}
async function allow(): Promise<void> {
  if (busy.value || !request.value) return
  const p = password.value, otp = token.value
  password.value = ''; token.value = ''
  await delivery.unlock(p, otp)
  await finish()
}
function cancelProvider(): void {
  const waiter = totpWaiter; totpWaiter = null
  totpPending.value = false; googlePending.value = false
  waiter?.reject(new VaultClientError('locked'))
}
async function allowWithProvider(): Promise<void> {
  if (busy.value || !request.value) return
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
  token.value = ''; totpPending.value = false
  await finish()
}
function submitTotp(): void {
  const waiter = totpWaiter, value = token.value
  totpWaiter = null; token.value = ''; totpPending.value = false
  waiter?.resolve(value)
}
onMounted(() => {
  if (request.value) void delivery.prepare()
  ticker = setInterval(() => delivery.tick(), 1000)
})
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); cancelProvider(); password.value = ''; token.value = ''; delivery.dispose() })
</script>

<template>
  <div
    class="mx-auto max-w-xl p-6"
    data-testid="vault-extension-connect"
  >
    <NCard :title="t('vaultExtension.connectTitle')">
      <NAlert
        v-if="!request"
        type="error"
        role="alert"
        data-testid="vault-extension-invalid"
      >
        {{ t('vaultExtension.invalidRequest') }}
      </NAlert>
      <NAlert
        v-else-if="!secure"
        type="warning"
        role="alert"
      >
        {{ t('vaultDelivery.https') }}
      </NAlert>
      <template v-else>
        <p class="mb-3">
          {{ t('vaultExtension.connectIntro') }}
        </p>
        <dl class="mb-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt>
            <NText depth="3">
              {{ t('vaultExtension.extensionId') }}
            </NText>
          </dt>
          <dd><code data-testid="vault-extension-id">{{ request.extensionId }}</code></dd>
          <dt>
            <NText depth="3">
              {{ t('vaultExtension.device') }}
            </NText>
          </dt>
          <dd><code data-testid="vault-extension-device">{{ fingerprint(request.deviceJkt) }}</code></dd>
          <dt>
            <NText depth="3">
              {{ t('vaultExtension.account') }}
            </NText>
          </dt>
          <dd>{{ auth.user?.email }}</dd>
        </dl>
        <p class="mb-4 text-sm text-gray-400">
          {{ t('vaultExtension.scopeHint') }}
        </p>
        <NAlert
          v-if="state.error"
          class="mb-4"
          type="warning"
          role="alert"
          data-testid="vault-extension-error"
        >
          {{ t(state.error === 'denied' ? 'vaultExtension.denied' : `vaultDelivery.errors.${state.error}`) }}
        </NAlert>
        <NAlert
          v-if="done"
          class="mb-4"
          type="success"
          role="status"
        >
          {{ t('vaultExtension.returning') }}
        </NAlert>
        <div
          v-else-if="provider"
          data-testid="vault-extension-provider"
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
              :label-props="{ for: 'vault-extension-provider-otp' }"
            >
              <NInput
                v-model:value="token"
                :input-props="{ id: 'vault-extension-provider-otp', autocomplete: 'one-time-code', inputmode: 'numeric' }"
                maxlength="6"
              />
            </NFormItem>
            <NButton
              type="primary"
              attr-type="submit"
            >
              {{ t('vaultDelivery.unlock') }}
            </NButton>
          </form>
          <NSpace v-else>
            <NButton
              type="primary"
              :loading="busy"
              data-testid="vault-extension-allow"
              @click="allowWithProvider"
            >
              {{ t('vaultExtension.allowProvider') }}
            </NButton>
            <NButton
              :disabled="busy"
              data-testid="vault-extension-deny"
              @click="deny"
            >
              {{ t('vaultExtension.deny') }}
            </NButton>
          </NSpace>
        </div>
        <form
          v-else
          autocomplete="off"
          @submit.prevent="allow"
        >
          <NFormItem
            :label="t('vaultDelivery.password')"
            :label-props="{ for: 'vault-extension-password' }"
          >
            <NInput
              v-model:value="password"
              type="password"
              :input-props="{ id: 'vault-extension-password', autocomplete: 'current-password' }"
            />
          </NFormItem>
          <NFormItem
            :label="t('vaultDelivery.otp')"
            :label-props="{ for: 'vault-extension-otp' }"
          >
            <NInput
              v-model:value="token"
              :input-props="{ id: 'vault-extension-otp', autocomplete: 'one-time-code', inputmode: 'numeric' }"
              maxlength="6"
            />
          </NFormItem>
          <NSpace>
            <NButton
              type="primary"
              attr-type="submit"
              :loading="busy"
              :disabled="!password || !/^\d{6}$/.test(token)"
              data-testid="vault-extension-allow"
            >
              {{ t('vaultExtension.allow') }}
            </NButton>
            <NButton
              :disabled="busy"
              data-testid="vault-extension-deny"
              @click="deny"
            >
              {{ t('vaultExtension.deny') }}
            </NButton>
          </NSpace>
        </form>
      </template>
    </NCard>
  </div>
</template>
