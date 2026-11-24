<script setup lang="ts">
/**
 * NA-0200 (E5b, contract SEC-16) — the extension asks for a proof from the portal: this page shows which device asks
 * (the identifier in the extension footer), confirms the user's identity with the vault step-up (Windows Hello when
 * registered, password + code, or the login provider) and approves the request once. The extension redeems it with its
 * own key; this page never sees an extension token, and nothing is kept after it.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NAlert, NButton, NCard, NFormItem, NInput, NSpace, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { createVaultDelivery } from '@/services/vault-delivery'
import { createVaultTransport, type VaultTransport } from '@/services/vault-http'
import { vaultPortalIdentity } from '@/services/vault-manager'
import { browserWebauthn } from '@/services/vault-webauthn'
import { fingerprint } from '@/services/vault-extension-consent'
import { useVaultProviderStepUp } from '@/composables/useVaultProviderStepUp'

const props = defineProps<{ transport?: VaultTransport }>()
const { t } = useI18n(), auth = useAuthStore(), route = useRoute()
const transport = props.transport ?? createVaultTransport()
const identity = (): ReturnType<typeof vaultPortalIdentity> => vaultPortalIdentity(auth)
const request = computed(() => (typeof route.query.request === 'string' && /^[A-Za-z0-9_-]{43}$/.test(route.query.request) ? route.query.request : null))
const delivery = createVaultDelivery({ identity, transport, webauthn: browserWebauthn }), state = delivery.state
const device = ref(''), status = ref<'loading' | 'ready' | 'invalid' | 'insecure' | 'approved'>('loading')
const password = ref(''), token = ref('')
const busy = computed(() => state.phase === 'unlocking' || state.phase === 'delivering')
const provider = computed(() => state.stepUp === 'provider')
const { googleTarget, googlePending, totpPending, token: providerToken, confirm: confirmProvider, submitTotp } = useVaultProviderStepUp(delivery)
let ticker: ReturnType<typeof setInterval> | undefined

async function load(): Promise<void> {
  const who = identity()
  if (!who) { status.value = 'insecure'; return }
  if (!request.value) { status.value = 'invalid'; return }
  try {
    const info = await transport.post<{ device?: unknown }>('extension/proof-info', { request: request.value }, who)
    if (typeof info?.device !== 'string') { status.value = 'invalid'; return }
    device.value = info.device; status.value = 'ready'
    void delivery.prepare()
  } catch { status.value = 'invalid' }
}
async function approve(): Promise<void> {
  if (!request.value || state.phase !== 'unlocked') return
  if (await delivery.approveExtensionProof(request.value)) status.value = 'approved'
}
async function confirm(): Promise<void> {
  if (busy.value) return
  const p = password.value, otp = token.value
  password.value = ''; token.value = ''
  await delivery.unlock(p, otp)
  await approve()
}
async function confirmWithWebauthn(): Promise<void> {
  if (busy.value) return
  password.value = ''; token.value = ''
  await delivery.unlockWithWebauthn()
  await approve()
}
async function confirmWithProvider(): Promise<void> {
  if (busy.value) return
  await confirmProvider()
  await approve()
}
onMounted(() => { void load(); ticker = setInterval(() => delivery.tick(), 1000) })
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); password.value = ''; token.value = ''; delivery.dispose() })
defineExpose({ load, confirm, confirmWithWebauthn, confirmWithProvider })
</script>

<template>
  <div
    class="mx-auto max-w-xl p-4 sm:p-8"
    data-testid="vault-extension-confirm"
  >
    <NCard :title="t('vaultExtension.confirmTitle')">
      <NText
        v-if="status === 'loading'"
        depth="3"
      >
        {{ t('vaultExtension.confirmLoading') }}
      </NText>
      <NAlert
        v-else-if="status === 'insecure'"
        type="warning"
        role="alert"
      >
        {{ t('vaultDelivery.https') }}
      </NAlert>
      <NAlert
        v-else-if="status === 'invalid'"
        type="warning"
        role="alert"
        data-testid="vault-extension-confirm-invalid"
      >
        {{ t('vaultExtension.confirmInvalid') }}
      </NAlert>
      <NAlert
        v-else-if="status === 'approved'"
        type="success"
        role="status"
        data-testid="vault-extension-confirm-done"
      >
        {{ t('vaultExtension.confirmDone') }}
      </NAlert>
      <template v-else>
        <p class="mb-3 text-sm">
          {{ t('vaultExtension.confirmIntro') }}
        </p>
        <p class="mb-4 text-sm">
          {{ t('vaultExtension.device') }}: <code data-testid="vault-extension-confirm-device">{{ fingerprint(device) }}</code>
        </p>
        <NAlert
          v-if="state.error"
          class="mb-3"
          type="warning"
          role="alert"
        >
          {{ t(`vaultDelivery.errors.${state.error}`) }}
        </NAlert>
        <div
          v-if="state.webauthn"
          class="mb-4"
        >
          <NButton
            type="primary"
            :loading="busy && state.providerPending"
            :disabled="busy"
            data-testid="vault-extension-confirm-webauthn"
            @click="confirmWithWebauthn"
          >
            {{ t('vaultDelivery.webauthnUnlock') }}
          </NButton>
          <p class="mt-2 text-sm text-gray-400">
            {{ t('vaultDelivery.webauthnOr') }}
          </p>
        </div>
        <div v-if="provider">
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
              :label-props="{ for: 'vault-extension-confirm-provider-otp' }"
            >
              <NInput
                v-model:value="providerToken"
                :input-props="{ id: 'vault-extension-confirm-provider-otp', inputmode: 'numeric', autocomplete: 'off', maxlength: 6 }"
              />
            </NFormItem>
            <NButton
              attr-type="submit"
              type="primary"
            >
              {{ t('vaultDelivery.unlock') }}
            </NButton>
          </form>
          <NButton
            v-else
            type="primary"
            :loading="busy"
            @click="confirmWithProvider"
          >
            {{ t('vaultDelivery.providerConfirm') }}
          </NButton>
        </div>
        <form
          v-else
          autocomplete="off"
          @submit.prevent="confirm"
        >
          <NFormItem
            :label="t('vaultDelivery.password')"
            :label-props="{ for: 'vault-extension-confirm-password' }"
          >
            <NInput
              v-model:value="password"
              type="password"
              :disabled="busy"
              :input-props="{ id: 'vault-extension-confirm-password', autocomplete: 'off', maxlength: 1024 }"
            />
          </NFormItem>
          <NFormItem
            :label="t('vaultDelivery.otp')"
            :label-props="{ for: 'vault-extension-confirm-otp' }"
          >
            <NInput
              v-model:value="token"
              :disabled="busy"
              :input-props="{ id: 'vault-extension-confirm-otp', inputmode: 'numeric', autocomplete: 'off', maxlength: 6 }"
            />
          </NFormItem>
          <NSpace>
            <NButton
              attr-type="submit"
              type="primary"
              :loading="busy"
              :disabled="!password || !/^\d{6}$/.test(token)"
              data-testid="vault-extension-confirm-submit"
            >
              {{ t('vaultExtension.confirmSubmit') }}
            </NButton>
          </NSpace>
        </form>
      </template>
    </NCard>
  </div>
</template>
