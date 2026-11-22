<script setup lang="ts">
/**
 * NA-0183 — vault permissions for managers: per-user reveal/copy/extension, proposed by one manager and approved
 * by another (server rules unchanged). Shown only to vault managers; every action needs a fresh identity
 * confirmation and every approval locks the vault for everyone (policy version bump).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NAlert, NButton, NFormItem, NInput, NSpace, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { VaultAdministrationStatusSchema, type VaultAdministrationChange, type VaultAdministrationOverview, type VaultGrantAction } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { createVaultDelivery, type VaultDelivery } from '@/services/vault-delivery'
import { createVaultTransport, type VaultPortalIdentity, type VaultTransport } from '@/services/vault-http'
import { useVaultProviderStepUp } from '@/composables/useVaultProviderStepUp'

const props = defineProps<{ transport?: VaultTransport; delivery?: VaultDelivery }>()
const { t } = useI18n(), auth = useAuthStore()
const transport = props.transport ?? createVaultTransport()
function identity(): VaultPortalIdentity | null {
  const u = auth.user
  // Same HTTPS requirement as every vault request: nothing is sent from an insecure page.
  const secure = globalThis.isSecureContext === true && typeof window !== 'undefined' && window.location?.protocol === 'https:'
  if (!secure || !u || u.actingTenantId !== undefined || auth.isManagingTenant || !auth.accessToken || !auth.refreshToken) return null
  return { userId: u.id, tenantId: u.tenantId, accessToken: auth.accessToken, refreshToken: auth.refreshToken, origin: window.location.origin }
}
const delivery = props.delivery ?? createVaultDelivery({ identity }), state = delivery.state
const { googleTarget, googlePending, totpPending, token: providerToken, confirm: confirmProvider, submitTotp } = useVaultProviderStepUp(delivery)
const manager = ref(false), opened = ref(false), overview = ref<VaultAdministrationOverview | null>(null), notice = ref<'' | 'proposed' | 'applied'>('')
const password = ref(''), token = ref(''), now = ref(Date.now())
const actions: VaultGrantAction[] = ['reveal', 'copy', 'extension']
const busy = computed(() => state.phase === 'unlocking' || state.phase === 'delivering')
const unlocked = computed(() => state.phase === 'unlocked' || state.phase === 'delivering')
const me = computed(() => auth.user?.id)
let ticker: ReturnType<typeof setInterval> | undefined, clockSkew = 0

async function detect(): Promise<void> {
  const who = identity()
  if (!who) { manager.value = false; return }
  try { manager.value = VaultAdministrationStatusSchema.parse(await transport.post('administration/status', {}, who)).manager } catch { manager.value = false }
}
/** The vault client is registered only when a manager opens the section (shared hourly client quota). */
async function open(): Promise<void> {
  opened.value = true
  await delivery.prepare()
}
async function load(): Promise<void> {
  const reply = await delivery.administrationOverview()
  overview.value = reply
  if (reply) clockSkew = reply.serverNow - Date.now()
}
async function confirm(): Promise<void> {
  if (busy.value) return
  const p = password.value, otp = token.value
  password.value = ''; token.value = ''; notice.value = ''
  await delivery.unlock(p, otp)
  if (state.phase === 'unlocked') await load()
}
async function confirmWithProvider(): Promise<void> {
  if (busy.value) return
  notice.value = ''
  await confirmProvider()
  if (state.phase === 'unlocked') await load()
}
async function propose(userId: number, action: VaultGrantAction, enabled: boolean): Promise<void> {
  if (busy.value || userId === me.value) return
  const change: VaultAdministrationChange = { kind: 'grant', userId, action, enabled }
  if (await delivery.proposeChange(change)) { notice.value = 'proposed'; await load() }
}
async function approve(reference: string): Promise<void> {
  if (busy.value) return
  if (await delivery.approveProposal(reference)) { notice.value = 'applied'; overview.value = null }
}
function lock(): void { delivery.lock(); overview.value = null; password.value = ''; token.value = '' }
type Proposal = VaultAdministrationOverview['proposals'][number]
function userName(proposal: Proposal, id: number): string {
  const b = proposal.beneficiary
  if (b?.id === id) return `${b.name} <${b.email}>`
  return overview.value?.users.find(u => u.id === id)?.name ?? t('vaultAdministration.unknownUser', { id })
}
function describe(proposal: Proposal): string {
  const change = proposal.change
  if (change.kind !== 'grant') return t('vaultAdministration.proposalOther')
  return t('vaultAdministration.proposalGrant', { action: t(`vaultAdministration.${change.action}`), user: userName(proposal, change.userId),
    state: t(change.enabled ? 'vaultAdministration.proposeEnable' : 'vaultAdministration.proposeDisable') })
}
/** Only permission proposals are approved here, with their content on screen; policy/item changes stay in the API. */
function approvable(change: VaultAdministrationChange, mine: boolean): boolean {
  return !mine && change.kind === 'grant' && change.userId !== me.value
}
const steps = ['step1', 'step2', 'step3'] as const
const remaining = (expiresAt: number): number => Math.max(0, Math.ceil((expiresAt - now.value - clockSkew) / 1000))
onMounted(() => {
  void detect()
  ticker = setInterval(() => {
    now.value = Date.now(); delivery.tick()
    if (state.phase === 'locked') overview.value = null
  }, 1000)
})
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); password.value = ''; token.value = ''; if (!props.delivery) delivery.dispose() })
defineExpose({ detect })
</script>

<template>
  <section
    v-if="manager"
    class="mb-4 rounded border border-gray-700 p-4"
    data-testid="vault-administration"
  >
    <h2 class="mb-1 text-base font-semibold">
      {{ t('vaultAdministration.title') }}
    </h2>
    <div
      class="mb-3 text-sm text-gray-400"
      data-testid="vault-administration-how"
    >
      <p>{{ t('vaultAdministration.intro') }}</p>
      <p
        v-for="step in steps"
        :key="step"
      >
        {{ t(`vaultAdministration.${step}`) }}
      </p>
    </div>
    <NAlert
      v-if="notice"
      class="mb-3"
      :type="notice === 'applied' ? 'success' : 'info'"
      role="status"
      data-testid="vault-administration-notice"
    >
      {{ t(`vaultAdministration.${notice}`) }}
    </NAlert>
    <NAlert
      v-if="state.error"
      class="mb-3"
      type="warning"
      role="alert"
    >
      {{ t(`vaultDelivery.errors.${state.error}`) }}
    </NAlert>
    <NButton
      v-if="!opened"
      type="primary"
      data-testid="vault-administration-open"
      @click="open"
    >
      {{ t('vaultAdministration.open') }}
    </NButton>
    <template v-else-if="!unlocked || !overview">
      <p class="mb-3 text-sm">
        {{ t('vaultAdministration.confirmHint') }}
      </p>
      <div
        v-if="state.stepUp === 'provider'"
        data-testid="vault-administration-provider"
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
            :label-props="{ for: 'vault-administration-provider-otp' }"
          >
            <NInput
              v-model:value="providerToken"
              :input-props="{ id: 'vault-administration-provider-otp', autocomplete: 'one-time-code', inputmode: 'numeric' }"
              maxlength="6"
            />
          </NFormItem>
          <NButton
            type="primary"
            attr-type="submit"
          >
            {{ t('vaultAdministration.confirm') }}
          </NButton>
        </form>
        <NButton
          v-else
          type="primary"
          :loading="busy"
          data-testid="vault-administration-confirm"
          @click="confirmWithProvider"
        >
          {{ t('vaultAdministration.confirmProvider') }}
        </NButton>
      </div>
      <form
        v-else
        class="flex flex-wrap items-end gap-3"
        autocomplete="off"
        @submit.prevent="confirm"
      >
        <NFormItem
          :label="t('vaultDelivery.password')"
          :label-props="{ for: 'vault-administration-password' }"
          :show-feedback="false"
        >
          <NInput
            v-model:value="password"
            type="password"
            :input-props="{ id: 'vault-administration-password', autocomplete: 'current-password' }"
          />
        </NFormItem>
        <NFormItem
          :label="t('vaultDelivery.otp')"
          :label-props="{ for: 'vault-administration-otp' }"
          :show-feedback="false"
        >
          <NInput
            v-model:value="token"
            :input-props="{ id: 'vault-administration-otp', autocomplete: 'one-time-code', inputmode: 'numeric' }"
            maxlength="6"
          />
        </NFormItem>
        <NButton
          type="primary"
          attr-type="submit"
          :loading="busy"
          :disabled="!password || !/^\d{6}$/.test(token)"
          data-testid="vault-administration-confirm"
        >
          {{ t('vaultAdministration.confirm') }}
        </NButton>
      </form>
    </template>
    <template v-else>
      <NSpace class="mb-3">
        <NButton
          size="small"
          :disabled="busy"
          @click="load"
        >
          {{ t('vaultAdministration.reload') }}
        </NButton>
        <NButton
          size="small"
          :disabled="busy"
          data-testid="vault-administration-lock"
          @click="lock"
        >
          {{ t('vaultAdministration.lock') }}
        </NButton>
      </NSpace>
      <h3 class="mb-2 text-sm font-semibold">
        {{ t('vaultAdministration.pending') }}
      </h3>
      <NText
        v-if="!overview.proposals.length"
        depth="3"
      >
        {{ t('vaultAdministration.noPending') }}
      </NText>
      <ul
        v-else
        class="mb-4 space-y-2"
      >
        <li
          v-for="proposal in overview.proposals"
          :key="proposal.reference"
          class="flex flex-wrap items-center gap-3"
          :data-testid="`vault-administration-proposal-${proposal.reference}`"
        >
          <span>{{ describe(proposal) }}</span>
          <NText depth="3">
            {{ t('vaultAdministration.proposedBy', { name: proposal.proposedBy.name, seconds: remaining(proposal.expiresAt) }) }}
          </NText>
          <NButton
            v-if="approvable(proposal.change, proposal.mine)"
            size="small"
            type="primary"
            :loading="busy"
            :data-testid="`vault-administration-approve-${proposal.reference}`"
            @click="approve(proposal.reference)"
          >
            {{ t('vaultAdministration.approve') }}
          </NButton>
          <NText
            v-else-if="proposal.mine"
            depth="3"
          >
            {{ t('vaultAdministration.yours') }}
          </NText>
          <NText
            v-else-if="proposal.change.kind === 'grant' && proposal.change.userId === me"
            depth="3"
            :data-testid="`vault-administration-beneficiary-${proposal.reference}`"
          >
            {{ t('vaultAdministration.beneficiary') }}
          </NText>
        </li>
      </ul>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left">
              <th class="py-1 pr-3">
                {{ t('vaultAdministration.user') }}
              </th>
              <th
                v-for="action in actions"
                :key="action"
                class="py-1 pr-3"
              >
                {{ t(`vaultAdministration.${action}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in overview.users"
              :key="user.id"
              :data-testid="`vault-administration-user-${user.id}`"
            >
              <td class="py-1 pr-3">
                {{ user.name }}
                <NText depth="3">
                  {{ user.id === me ? `(${t('vaultAdministration.you')})` : user.email }}
                </NText>
              </td>
              <td
                v-for="action in actions"
                :key="action"
                class="py-1 pr-3"
              >
                <span class="mr-2">{{ t(user.grants[action] ? 'vaultAdministration.enabled' : 'vaultAdministration.disabled') }}</span>
                <NButton
                  v-if="user.id !== me"
                  size="tiny"
                  :disabled="busy"
                  :data-testid="`vault-administration-propose-${user.id}-${action}`"
                  @click="propose(user.id, action, !user.grants[action])"
                >
                  {{ t(user.grants[action] ? 'vaultAdministration.proposeDisable' : 'vaultAdministration.proposeEnable') }}
                </NButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
