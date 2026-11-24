<script setup lang="ts">
/**
 * NA-0198 — Windows Hello / passkey for the vault: a header button opens the signed-in user's credentials. Registering and
 * removing need the identity confirmed in this window (fresh authorization); the action asked for runs right after it.
 * Hidden when the browser cannot run WebAuthn or the page is not the vault origin over HTTPS.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NAlert, NButton, NFormItem, NInput, NModal, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { createVaultDelivery, type VaultDelivery, type VaultWebauthnCeremony, type VaultWebauthnCredentialView } from '@/services/vault-delivery'
import { vaultPortalIdentity } from '@/services/vault-manager'
import { browserWebauthn } from '@/services/vault-webauthn'
import { useVaultProviderStepUp } from '@/composables/useVaultProviderStepUp'

const props = defineProps<{ delivery?: VaultDelivery; ceremony?: VaultWebauthnCeremony }>()
const { t, d } = useI18n(), auth = useAuthStore()
const ceremony = props.ceremony ?? browserWebauthn
const delivery = props.delivery ?? createVaultDelivery({ identity: () => vaultPortalIdentity(auth), webauthn: ceremony }), state = delivery.state
const { googleTarget, googlePending, totpPending, token: providerToken, confirm: confirmProvider, submitTotp } = useVaultProviderStepUp(delivery)
const open = ref(false), known = ref(false), supported = ref(false), credentials = ref<VaultWebauthnCredentialView[]>([])
const name = ref(''), password = ref(''), token = ref(''), pending = ref<{ kind: 'register' } | { kind: 'remove'; id: string } | null>(null), done = ref<'' | 'registered' | 'removed'>('')
const busy = computed(() => state.phase === 'unlocking' || state.phase === 'delivering')
const confirming = computed(() => pending.value !== null && state.phase !== 'unlocked' && state.phase !== 'delivering')
let ticker: ReturnType<typeof setInterval> | undefined

async function load(): Promise<void> {
  if (!ceremony.available()) { known.value = false; return }
  const listed = await delivery.listWebauthn()
  if (!listed) return
  known.value = true; supported.value = listed.supported; credentials.value = listed.credentials
}
function defaultName(): string {
  const agent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const system = /Windows/.test(agent) ? 'Windows' : /Mac OS X/.test(agent) ? 'macOS' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Linux/.test(agent) ? 'Linux' : ''
  const browser = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : ''
  return [system, browser].filter(Boolean).join(' · ') || t('vaultWebauthn.defaultName')
}
function show(): void { open.value = true; done.value = ''; if (!name.value) name.value = defaultName(); void load(); void delivery.prepare() }
async function run(): Promise<void> {
  const action = pending.value
  if (!action || state.phase !== 'unlocked') return
  pending.value = null
  const ok = action.kind === 'register' ? await delivery.registerWebauthn(name.value.trim()) : await delivery.removeWebauthn(action.id)
  if (ok) done.value = action.kind === 'register' ? 'registered' : 'removed'
  await load()
}
async function ask(action: { kind: 'register' } | { kind: 'remove'; id: string }): Promise<void> {
  if (busy.value || (action.kind === 'register' && !name.value.trim())) return
  done.value = ''; pending.value = action
  // A session from a minute ago is no longer fresh: the server asks again and the action waits for it.
  if (state.phase === 'unlocked') await run()
}
async function confirm(): Promise<void> {
  if (busy.value) return
  const p = password.value, otp = token.value
  password.value = ''; token.value = ''
  await delivery.unlock(p, otp)
  await run()
}
async function confirmWithWebauthn(): Promise<void> {
  if (busy.value) return
  await delivery.unlockWithWebauthn()
  await run()
}
async function confirmWithProvider(): Promise<void> {
  if (busy.value) return
  await confirmProvider()
  await run()
}
function cancel(): void { pending.value = null; password.value = ''; token.value = '' }
function close(value: boolean): void { open.value = value; if (!value) { cancel(); delivery.lock() } }
onMounted(() => { void load(); ticker = setInterval(() => delivery.tick(), 1000) })
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); password.value = ''; token.value = ''; if (!props.delivery) delivery.dispose() })
defineExpose({ load, show, ask, confirm, confirmWithWebauthn, confirmWithProvider, cancel })
</script>

<template>
  <NButton
    v-if="known"
    secondary
    data-testid="vault-webauthn-open"
    @click="show"
  >
    {{ t('vaultWebauthn.button', { count: credentials.length }) }}
  </NButton>
  <NModal
    :show="open"
    preset="card"
    :title="t('vaultWebauthn.title')"
    style="width: min(640px, 100vw)"
    data-testid="vault-webauthn-modal"
    @update:show="close"
  >
    <p class="mb-3 text-sm text-gray-400">
      {{ t('vaultWebauthn.intro') }}
    </p>
    <NAlert
      v-if="!supported"
      type="info"
      class="mb-3"
      data-testid="vault-webauthn-unsupported"
    >
      {{ t('vaultWebauthn.unsupported') }}
    </NAlert>
    <template v-else>
      <NAlert
        v-if="done"
        class="mb-3"
        type="success"
        role="status"
        data-testid="vault-webauthn-done"
      >
        {{ t(`vaultWebauthn.${done}`) }}
      </NAlert>
      <NAlert
        v-if="state.error"
        class="mb-3"
        type="warning"
        role="alert"
      >
        {{ t(`vaultDelivery.errors.${state.error}`) }}
      </NAlert>
      <form
        v-if="confirming"
        class="mb-4 rounded border border-gray-700 p-3"
        autocomplete="off"
        data-testid="vault-webauthn-confirm"
        @submit.prevent="confirm"
      >
        <p class="mb-2 text-sm">
          {{ t('vaultWebauthn.confirmHint') }}
        </p>
        <div
          v-if="state.webauthn"
          class="mb-3"
        >
          <NButton
            type="primary"
            :loading="busy && state.providerPending"
            :disabled="busy"
            @click="confirmWithWebauthn"
          >
            {{ t('vaultDelivery.webauthnUnlock') }}
          </NButton>
          <p class="mt-2 text-sm text-gray-400">
            {{ t('vaultDelivery.webauthnOr') }}
          </p>
        </div>
        <div
          v-if="state.stepUp === 'provider'"
          data-testid="vault-webauthn-provider"
        >
          <div
            v-show="googlePending"
            ref="googleTarget"
            class="mb-3"
          />
          <div
            v-if="totpPending"
            class="flex flex-wrap items-end gap-3"
          >
            <NFormItem
              :label="t('vaultDelivery.otp')"
              :label-props="{ for: 'vault-webauthn-provider-otp' }"
              :show-feedback="false"
            >
              <NInput
                v-model:value="providerToken"
                :input-props="{ id: 'vault-webauthn-provider-otp', autocomplete: 'one-time-code', inputmode: 'numeric' }"
                maxlength="6"
              />
            </NFormItem>
            <NButton
              type="primary"
              @click="submitTotp"
            >
              {{ t('vaultWebauthn.confirm') }}
            </NButton>
          </div>
          <NButton
            v-else
            type="primary"
            :loading="busy"
            @click="confirmWithProvider"
          >
            {{ t('vaultAdministration.confirmProvider') }}
          </NButton>
        </div>
        <div
          v-else
          class="flex flex-wrap items-end gap-3"
        >
          <NFormItem
            :label="t('vaultDelivery.password')"
            :label-props="{ for: 'vault-webauthn-password' }"
            :show-feedback="false"
          >
            <NInput
              v-model:value="password"
              type="password"
              :input-props="{ id: 'vault-webauthn-password', autocomplete: 'current-password' }"
            />
          </NFormItem>
          <NFormItem
            :label="t('vaultDelivery.otp')"
            :label-props="{ for: 'vault-webauthn-otp' }"
            :show-feedback="false"
          >
            <NInput
              v-model:value="token"
              :input-props="{ id: 'vault-webauthn-otp', autocomplete: 'one-time-code', inputmode: 'numeric' }"
              maxlength="6"
            />
          </NFormItem>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="busy"
            :disabled="!password || !/^\d{6}$/.test(token)"
            data-testid="vault-webauthn-confirm-submit"
          >
            {{ t('vaultWebauthn.confirm') }}
          </NButton>
        </div>
        <NButton
          class="mt-2"
          text
          @click="cancel"
        >
          {{ t('vaultWebauthn.cancel') }}
        </NButton>
      </form>
      <h3 class="mb-2 text-sm font-semibold">
        {{ t('vaultWebauthn.listTitle') }}
      </h3>
      <NText
        v-if="!credentials.length"
        depth="3"
        class="mb-3 block"
      >
        {{ t('vaultWebauthn.empty') }}
      </NText>
      <ul
        v-else
        class="mb-4 space-y-2"
      >
        <li
          v-for="credential in credentials"
          :key="credential.id"
          class="flex flex-wrap items-center gap-3"
          :data-testid="`vault-webauthn-credential-${credential.name}`"
        >
          <span class="font-medium">{{ credential.name }}</span>
          <NText depth="3">
            {{ credential.lastUsedAt ? t('vaultWebauthn.lastUsed', { date: d(new Date(credential.lastUsedAt), 'short') })
              : t('vaultWebauthn.created', { date: d(new Date(credential.createdAt), 'short') }) }}
          </NText>
          <NButton
            size="small"
            :disabled="busy"
            :aria-label="`${t('vaultWebauthn.remove')}: ${credential.name}`"
            @click="ask({ kind: 'remove', id: credential.id })"
          >
            {{ t('vaultWebauthn.remove') }}
          </NButton>
        </li>
      </ul>
      <form
        class="flex flex-wrap items-end gap-3"
        autocomplete="off"
        @submit.prevent="ask({ kind: 'register' })"
      >
        <NFormItem
          :label="t('vaultWebauthn.name')"
          :label-props="{ for: 'vault-webauthn-name' }"
          :show-feedback="false"
        >
          <NInput
            v-model:value="name"
            maxlength="80"
            :input-props="{ id: 'vault-webauthn-name' }"
          />
        </NFormItem>
        <NButton
          type="primary"
          attr-type="submit"
          :loading="busy && pending === null"
          :disabled="busy || !name.trim()"
          data-testid="vault-webauthn-register"
        >
          {{ t('vaultWebauthn.register') }}
        </NButton>
      </form>
    </template>
  </NModal>
</template>
