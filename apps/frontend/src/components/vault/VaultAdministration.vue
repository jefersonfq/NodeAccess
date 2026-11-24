<script setup lang="ts">
/**
 * NA-0183 — vault permissions for managers: per-user reveal/copy/extension, proposed by one manager and approved
 * by another (server rules unchanged). Shown only to vault managers; every action needs a fresh identity
 * confirmation and every approval locks the vault for everyone (policy version bump).
 * NA-0186 — `userId` focuses the same section on one user (Users tab); without it the section also shows
 * the tenant's confirmation time for reveal/copy, changed by the same two-manager flow.
 * NA-0188 — "vault manager" is a per-user permission changed by the same flow; the tenant sets how long proposals stay
 * open (2 min–24 h); managers see how many proposals await them before unlocking; actions nobody could approve are
 * disabled with the reason (the server refuses them too); a NodeAccess admin who is not a manager gets an explanation.
 * NA-0196 — tenant delivery policy (reveal, copy, quota) and released items are changed here by the same flow; `item`
 * focuses the section on one Secret (vault list → Actions → Item delivery).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NAlert, NButton, NCheckbox, NFormItem, NInput, NInputNumber, NSelect, NSpace, NText } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { VaultAdministrationChange, VaultAdministrationOverview, VaultGrantAction } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { createVaultDelivery, type VaultDelivery } from '@/services/vault-delivery'
import { createVaultTransport, type VaultPortalIdentity, type VaultTransport } from '@/services/vault-http'
import { useVaultProviderStepUp } from '@/composables/useVaultProviderStepUp'
import { browserWebauthn } from '@/services/vault-webauthn'
import { formatDuration, hasApprover, vaultAdministrationStatus, vaultPortalIdentity } from '@/services/vault-manager'

/** `review`: Users-tab review of pending changes — opens at once and shows only the proposals (no table or tenant settings). */
const props = defineProps<{ transport?: VaultTransport; delivery?: VaultDelivery; userId?: number; review?: boolean; item?: { id: number; name: string } }>()
/** `changed`: an approval was applied (the page refreshes what users may reveal/copy). */
const emit = defineEmits<{ changed: [] }>()
const { t } = useI18n(), auth = useAuthStore()
const transport = props.transport ?? createVaultTransport()
const identity = (): VaultPortalIdentity | null => vaultPortalIdentity(auth)
const delivery = props.delivery ?? createVaultDelivery({ identity, webauthn: browserWebauthn }), state = delivery.state
const { googleTarget, googlePending, totpPending, token: providerToken, confirm: confirmProvider, submitTotp } = useVaultProviderStepUp(delivery)
const manager = ref(false), pendingCount = ref(0), managerIds = ref<number[]>([]), detected = ref(false), opened = ref(false), overview = ref<VaultAdministrationOverview | null>(null), notice = ref<'' | 'proposed' | 'applied'>('')
const password = ref(''), token = ref(''), now = ref(Date.now()), minutes = ref<number | null>(null), windowSeconds = ref<number | null>(null)
const actions: VaultGrantAction[] = ['reveal', 'copy', 'extension']
const busy = computed(() => state.phase === 'unlocking' || state.phase === 'delivering')
const unlocked = computed(() => state.phase === 'unlocked' || state.phase === 'delivering')
const me = computed(() => auth.user?.id)
const focused = computed(() => props.userId !== undefined)
const itemFocus = computed(() => props.item !== undefined)
const compact = computed(() => focused.value || itemFocus.value || props.review === true)
/** Element ids per instance: the page section and a window (item, user, review) can be on screen together. */
const idp = props.item ? `-item-${props.item.id}` : props.userId !== undefined ? `-user-${props.userId}` : props.review ? '-review' : ''
const users = computed(() => overview.value?.users.filter(u => !focused.value || u.id === props.userId) ?? [])
const proposals = computed(() => overview.value?.proposals.filter(p => {
  if (itemFocus.value) return p.change.kind === 'item' && p.change.secretId === props.item?.id
  return !focused.value || ((p.change.kind === 'grant' || p.change.kind === 'manager') && p.change.userId === props.userId)
}) ?? [])
/** NA-0196: released items and the tenant delivery policy (from the unlocked overview). */
const released = computed(() => overview.value?.items ?? [])
const itemReleased = computed(() => released.value.some(i => i.id === props.item?.id))
const policyNow = computed(() => overview.value?.policy ?? null)
const policyReveal = ref(false), policyCopy = ref(false), policyQuota = ref<number | null>(null)
const policyChanged = computed(() => !!policyNow.value && policyQuota.value !== null && (policyReveal.value !== policyNow.value.reveal
  || policyCopy.value !== policyNow.value.copy || policyQuota.value !== policyNow.value.tenantQuota))
const currentMinutes = computed(() => overview.value ? overview.value.policy.confirmationSeconds / 60 : null)
const currentWindow = computed(() => overview.value?.policy.proposalSeconds ?? null)
/** Managers from the unlocked overview (fresh), else from the status read. */
const managers = computed(() => overview.value ? overview.value.users.filter(u => u.manager).map(u => u.id) : managerIds.value)
const units = computed(() => ({ s: t('vaultAdministration.unitSeconds'), min: t('vaultAdministration.unitMinutes'), h: t('vaultAdministration.unitHours') }))
const duration = (seconds: number): string => formatDuration(seconds, units.value)
/** Proposal validity choices (2 min–24 h); the API accepts any whole minute in that range. */
const windowOptions = computed(() => [120, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400].map(value => ({ value, label: duration(value) })))
/** Guidance only: the server refuses what nobody could approve. */
const canPropose = (target?: number): boolean => hasApprover(managers.value, me.value, target)
const blocked = computed(() => users.value.some(u => u.id !== me.value && !canPropose(u.id)))
const nonManagerAdmin = computed(() => detected.value && !manager.value && auth.isAdmin && !compact.value)
let ticker: ReturnType<typeof setInterval> | undefined, clockSkew = 0

/** Unknown status (error, rate limit) keeps what was last known; at first it shows nothing, not even the explanation. */
async function detect(): Promise<void> {
  const status = await vaultAdministrationStatus(transport, auth)
  if (!status) return
  manager.value = status.manager; pendingCount.value = status.pending; managerIds.value = status.managers; detected.value = true
}
/** The vault client is registered only when a manager opens the section, or the Users-tab window for one user (shared hourly client quota). */
async function open(): Promise<void> {
  opened.value = true
  await delivery.prepare()
  // NA-0196: a session shared with the page (item window) may already be unlocked.
  if (unlocked.value && !overview.value) await load()
}
async function load(): Promise<void> {
  const reply = await delivery.administrationOverview()
  overview.value = reply
  if (reply) {
    clockSkew = reply.serverNow - Date.now(); minutes.value = reply.policy.confirmationSeconds / 60; windowSeconds.value = reply.policy.proposalSeconds
    policyReveal.value = reply.policy.reveal; policyCopy.value = reply.policy.copy; policyQuota.value = reply.policy.tenantQuota
  }
}
async function confirm(): Promise<void> {
  if (busy.value) return
  const p = password.value, otp = token.value
  password.value = ''; token.value = ''; notice.value = ''
  await delivery.unlock(p, otp)
  if (state.phase === 'unlocked') await load()
}
/** NA-0198: Windows Hello / passkey instead of the password form. */
async function confirmWithWebauthn(): Promise<void> {
  if (busy.value) return
  notice.value = ''; password.value = ''; token.value = ''
  await delivery.unlockWithWebauthn()
  if (state.phase === 'unlocked') await load()
}
async function confirmWithProvider(): Promise<void> {
  if (busy.value) return
  notice.value = ''
  await confirmProvider()
  if (state.phase === 'unlocked') await load()
}
async function submit(change: VaultAdministrationChange): Promise<void> {
  if (await delivery.proposeChange(change)) { notice.value = 'proposed'; await load() }
}
async function propose(userId: number, action: VaultGrantAction, enabled: boolean): Promise<void> {
  if (busy.value || userId === me.value || !canPropose(userId) || waiting({ kind: 'grant', userId, action, enabled })) return
  await submit({ kind: 'grant', userId, action, enabled })
}
async function proposeManager(userId: number, enabled: boolean): Promise<void> {
  if (busy.value || userId === me.value || !canPropose(userId)) return
  await submit({ kind: 'manager', userId, enabled })
}
async function proposeWindow(): Promise<void> {
  const value = windowSeconds.value
  if (busy.value || value === null || value === currentWindow.value || !canPropose()) return
  await submit({ kind: 'proposalWindow', seconds: value })
}
async function proposeConfirmation(): Promise<void> {
  const value = minutes.value
  if (busy.value || value === null || !Number.isInteger(value) || value < 1 || value > 15 || value === currentMinutes.value || !canPropose()) return
  await submit({ kind: 'confirmation', seconds: value * 60 })
}
async function proposePolicy(): Promise<void> {
  const quota = policyQuota.value
  if (busy.value || !policyChanged.value || quota === null || !Number.isInteger(quota) || quota < 1 || quota > 300 || !canPropose()) return
  const change = { kind: 'policy' as const, reveal: policyReveal.value, copy: policyCopy.value, tenantQuota: quota }
  if (waiting(change)) return
  await submit(change)
}
async function proposeItem(secretId: number, enabled: boolean): Promise<void> {
  if (busy.value || !canPropose() || waiting({ kind: 'item', secretId, enabled })) return
  await submit({ kind: 'item', secretId, enabled })
}
async function approve(reference: string): Promise<void> {
  if (busy.value) return
  if (await delivery.approveProposal(reference)) { notice.value = 'applied'; overview.value = null; void detect(); emit('changed') }
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
  if (change.kind === 'confirmation') return t('vaultAdministration.proposalConfirmation', { minutes: change.seconds / 60 })
  if (change.kind === 'proposalWindow') return t('vaultAdministration.proposalWindow', { time: duration(change.seconds) })
  if (change.kind === 'manager') return t(change.enabled ? 'vaultAdministration.proposalManagerAdd' : 'vaultAdministration.proposalManagerRemove', { user: userName(proposal, change.userId) })
  if (change.kind === 'item') {
    const name = proposal.item?.alias ?? t('vaultAdministration.unknownItem', { id: change.secretId })
    return t(change.enabled ? 'vaultAdministration.proposalItemRelease' : 'vaultAdministration.proposalItemWithdraw', { item: name })
  }
  if (change.kind === 'policy') return t('vaultAdministration.proposalPolicy', { reveal: t(change.reveal ? 'vaultAdministration.on' : 'vaultAdministration.off'),
    copy: t(change.copy ? 'vaultAdministration.on' : 'vaultAdministration.off'), quota: change.tenantQuota })
  return t('vaultAdministration.proposalGrant', { action: t(`vaultAdministration.${change.action}`), user: userName(proposal, change.userId),
    state: t(change.enabled ? 'vaultAdministration.proposeEnable' : 'vaultAdministration.proposeDisable') })
}
/** Every proposal is approved here with its content on screen (NA-0196: tenant policy and items included). */
function approvable(change: VaultAdministrationChange, mine: boolean): boolean {
  if (mine) return false
  if (change.kind === 'confirmation' || change.kind === 'proposalWindow' || change.kind === 'policy' || change.kind === 'item') return true
  return (change.kind === 'grant' || change.kind === 'manager') && change.userId !== me.value
}
/** NA-0196: an identical proposal already waiting replaces the button (no duplicate proposals for the approver to untangle). */
function waiting(change: VaultAdministrationChange): boolean {
  // Key order independent: the same fields with the same values.
  const key = (c: VaultAdministrationChange): string => JSON.stringify(Object.entries(c).sort(([x], [y]) => x.localeCompare(y)))
  const wanted = key(change)
  return overview.value?.proposals.some(p => key(p.change) === wanted) ?? false
}
const forMe = (change: VaultAdministrationChange): boolean => (change.kind === 'grant' || change.kind === 'manager') && change.userId === me.value
const steps = ['step1', 'step2', 'step3'] as const
onMounted(() => { if (focused.value || itemFocus.value || props.review) void open() })
const remaining = (expiresAt: number): string => duration(Math.max(0, Math.ceil((expiresAt - now.value - clockSkew) / 1000)))
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
    <h2
      v-if="!compact"
      class="mb-1 text-base font-semibold"
    >
      {{ t('vaultAdministration.title') }}
    </h2>
    <p
      v-if="itemFocus"
      class="mb-3 text-sm text-gray-400"
      data-testid="vault-administration-how"
    >
      {{ t('vaultAdministration.itemIntro') }}
    </p>
    <div
      v-else
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
      {{ t(`vaultAdministration.${notice}`, { time: duration(currentWindow ?? 120) }) }}
    </NAlert>
    <NAlert
      v-if="pendingCount > 0 && !overview && !compact"
      class="mb-3"
      type="info"
      data-testid="vault-administration-pending-count"
    >
      {{ t('vaultAdministration.pendingCount', { count: pendingCount }, pendingCount) }}
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
        v-if="state.webauthn"
        class="mb-3"
        data-testid="vault-administration-webauthn"
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
            :label-props="{ for: `vault-administration-provider-otp${idp}` }"
          >
            <NInput
              v-model:value="providerToken"
              :input-props="{ id: `vault-administration-provider-otp${idp}`, autocomplete: 'one-time-code', inputmode: 'numeric' }"
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
          :label-props="{ for: `vault-administration-password${idp}` }"
          :show-feedback="false"
        >
          <NInput
            v-model:value="password"
            type="password"
            :input-props="{ id: `vault-administration-password${idp}`, autocomplete: 'current-password' }"
          />
        </NFormItem>
        <NFormItem
          :label="t('vaultDelivery.otp')"
          :label-props="{ for: `vault-administration-otp${idp}` }"
          :show-feedback="false"
        >
          <NInput
            v-model:value="token"
            :input-props="{ id: `vault-administration-otp${idp}`, autocomplete: 'one-time-code', inputmode: 'numeric' }"
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
      <div
        v-if="itemFocus"
        class="mb-4"
        data-testid="vault-administration-item"
      >
        <p class="mb-2 text-sm">
          {{ t(itemReleased ? 'vaultAdministration.itemReleased' : 'vaultAdministration.itemNotReleased', { item: item?.name }) }}
        </p>
        <p class="mb-2 text-sm text-gray-400">
          {{ t('vaultAdministration.itemHint') }}
        </p>
        <NText
          v-if="waiting({ kind: 'item', secretId: item!.id, enabled: !itemReleased })"
          depth="3"
          data-testid="vault-administration-item-waiting"
        >
          {{ t('vaultAdministration.waiting') }}
        </NText>
        <NButton
          v-else
          size="small"
          :type="itemReleased ? 'default' : 'primary'"
          :disabled="busy || !canPropose()"
          :aria-describedby="canPropose() ? undefined : `vault-administration-blocked${idp}`"
          data-testid="vault-administration-item-propose"
          @click="proposeItem(item!.id, !itemReleased)"
        >
          {{ t(itemReleased ? 'vaultAdministration.itemWithdraw' : 'vaultAdministration.itemRelease') }}
        </NButton>
      </div>
      <h3 class="mb-2 text-sm font-semibold">
        {{ t('vaultAdministration.pending') }}
      </h3>
      <NText
        v-if="!proposals.length"
        depth="3"
        class="mb-4 block"
      >
        {{ t('vaultAdministration.noPending') }}
      </NText>
      <ul
        v-else
        class="mb-4 space-y-2"
      >
        <li
          v-for="proposal in proposals"
          :key="proposal.reference"
          class="flex flex-wrap items-center gap-3"
          :data-testid="`vault-administration-proposal-${proposal.reference}`"
        >
          <span>{{ describe(proposal) }}</span>
          <NText depth="3">
            {{ t('vaultAdministration.proposedBy', { name: proposal.proposedBy.name, time: remaining(proposal.expiresAt) }) }}
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
            v-else-if="forMe(proposal.change)"
            depth="3"
            :data-testid="`vault-administration-beneficiary-${proposal.reference}`"
          >
            {{ t('vaultAdministration.beneficiary') }}
          </NText>
        </li>
      </ul>
      <div
        v-if="!review && !itemFocus"
        class="overflow-x-auto"
      >
        <table class="w-full min-w-[44rem] text-sm">
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
              <th class="py-1 pr-3">
                {{ t('vaultAdministration.manager') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in users"
              :key="user.id"
              :data-testid="`vault-administration-user-${user.id}`"
            >
              <td class="min-w-[10rem] py-1 pr-3">
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
                <NText
                  v-if="user.id !== me && waiting({ kind: 'grant', userId: user.id, action, enabled: !user.grants[action] })"
                  depth="3"
                  :data-testid="`vault-administration-waiting-${user.id}-${action}`"
                >
                  {{ t('vaultAdministration.waiting') }}
                </NText>
                <NButton
                  v-else-if="user.id !== me"
                  size="tiny"
                  :disabled="busy || !canPropose(user.id)"
                  :aria-describedby="canPropose(user.id) ? undefined : `vault-administration-blocked${idp}`"
                  :data-testid="`vault-administration-propose-${user.id}-${action}`"
                  @click="propose(user.id, action, !user.grants[action])"
                >
                  {{ t(user.grants[action] ? 'vaultAdministration.proposeDisable' : 'vaultAdministration.proposeEnable') }}
                </NButton>
              </td>
              <td class="py-1 pr-3">
                <span class="mr-2">{{ t(user.manager ? 'vaultAdministration.enabled' : 'vaultAdministration.disabled') }}</span>
                <NText
                  v-if="user.id !== me && waiting({ kind: 'manager', userId: user.id, enabled: !user.manager })"
                  depth="3"
                >
                  {{ t('vaultAdministration.waiting') }}
                </NText>
                <NButton
                  v-else-if="user.id !== me"
                  size="tiny"
                  :disabled="busy || !canPropose(user.id)"
                  :aria-describedby="canPropose(user.id) ? undefined : `vault-administration-blocked${idp}`"
                  :data-testid="`vault-administration-manager-${user.id}`"
                  @click="proposeManager(user.id, !user.manager)"
                >
                  {{ t(user.manager ? 'vaultAdministration.proposeDisable' : 'vaultAdministration.proposeEnable') }}
                </NButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="(blocked && !review && !itemFocus) || (itemFocus && !canPropose())"
        :id="`vault-administration-blocked${idp}`"
        class="mt-2 text-sm text-gray-400"
        data-testid="vault-administration-blocked"
      >
        {{ t('vaultAdministration.blockedHint') }}
      </p>
      <div
        v-if="!compact && policyNow"
        class="mt-4"
        data-testid="vault-administration-policy"
      >
        <h3 class="mb-1 text-sm font-semibold">
          {{ t('vaultAdministration.policyTitle') }}
        </h3>
        <p class="mb-2 text-sm text-gray-400">
          {{ t('vaultAdministration.policyHint', { reveal: t(policyNow.reveal ? 'vaultAdministration.on' : 'vaultAdministration.off'),
                                                   copy: t(policyNow.copy ? 'vaultAdministration.on' : 'vaultAdministration.off') }) }}
        </p>
        <form
          class="flex flex-wrap items-end gap-3"
          @submit.prevent="proposePolicy"
        >
          <NCheckbox
            v-model:checked="policyReveal"
            data-testid="vault-administration-policy-reveal"
          >
            {{ t('vaultAdministration.policyReveal') }}
          </NCheckbox>
          <NCheckbox
            v-model:checked="policyCopy"
            data-testid="vault-administration-policy-copy"
          >
            {{ t('vaultAdministration.policyCopy') }}
          </NCheckbox>
          <NFormItem
            :label="t('vaultAdministration.policyQuota')"
            :label-props="{ for: `vault-administration-quota${idp}` }"
            :show-feedback="false"
          >
            <NInputNumber
              v-model:value="policyQuota"
              :min="1"
              :max="300"
              :precision="0"
              :input-props="{ id: `vault-administration-quota${idp}` }"
            />
          </NFormItem>
          <NButton
            size="small"
            attr-type="submit"
            :disabled="busy || !policyChanged || !canPropose()"
            data-testid="vault-administration-policy-propose"
          >
            {{ t('vaultAdministration.policyPropose') }}
          </NButton>
        </form>
      </div>
      <div
        v-if="!compact"
        class="mt-4"
        data-testid="vault-administration-items"
      >
        <h3 class="mb-1 text-sm font-semibold">
          {{ t('vaultAdministration.itemsTitle', { count: released.length }) }}
        </h3>
        <p class="mb-2 text-sm text-gray-400">
          {{ t('vaultAdministration.itemsHint') }}
        </p>
        <ul
          v-if="released.length"
          class="space-y-1"
        >
          <li
            v-for="entry in released"
            :key="entry.id"
            class="flex flex-wrap items-center gap-3"
            :data-testid="`vault-administration-released-${entry.id}`"
          >
            <code>{{ entry.alias }}</code>
            <NText
              v-if="waiting({ kind: 'item', secretId: entry.id, enabled: false })"
              depth="3"
            >
              {{ t('vaultAdministration.waiting') }}
            </NText>
            <NButton
              v-else
              size="tiny"
              :disabled="busy || !canPropose()"
              :aria-label="`${t('vaultAdministration.itemWithdraw')}: ${entry.alias}`"
              @click="proposeItem(entry.id, false)"
            >
              {{ t('vaultAdministration.itemWithdraw') }}
            </NButton>
          </li>
        </ul>
      </div>
      <div
        v-if="!compact"
        class="mt-4"
        data-testid="vault-administration-confirmation"
      >
        <h3 class="mb-1 text-sm font-semibold">
          {{ t('vaultAdministration.confirmationTitle') }}
        </h3>
        <p class="mb-2 text-sm text-gray-400">
          {{ t('vaultAdministration.confirmationHint', { minutes: currentMinutes }) }}
        </p>
        <form
          class="flex flex-wrap items-end gap-3"
          @submit.prevent="proposeConfirmation"
        >
          <NFormItem
            :label="t('vaultAdministration.confirmationMinutes')"
            :label-props="{ for: `vault-administration-minutes${idp}` }"
            :show-feedback="false"
          >
            <NInputNumber
              v-model:value="minutes"
              :min="1"
              :max="15"
              :precision="0"
              :input-props="{ id: `vault-administration-minutes${idp}` }"
            />
          </NFormItem>
          <NButton
            size="small"
            attr-type="submit"
            :disabled="busy || minutes === null || minutes === currentMinutes || !canPropose()"
            data-testid="vault-administration-confirmation-propose"
          >
            {{ t('vaultAdministration.confirmationPropose') }}
          </NButton>
        </form>
      </div>
      <div
        v-if="!compact"
        class="mt-4"
        data-testid="vault-administration-window"
      >
        <h3 class="mb-1 text-sm font-semibold">
          {{ t('vaultAdministration.windowTitle') }}
        </h3>
        <p class="mb-2 text-sm text-gray-400">
          {{ t('vaultAdministration.windowHint', { time: duration(currentWindow ?? 120) }) }}
        </p>
        <form
          class="flex flex-wrap items-end gap-3"
          @submit.prevent="proposeWindow"
        >
          <NFormItem
            :label="t('vaultAdministration.windowLabel')"
            :label-props="{ for: `vault-administration-window${idp}` }"
            :show-feedback="false"
          >
            <NSelect
              v-model:value="windowSeconds"
              class="min-w-[10rem]"
              :options="windowOptions"
              :input-props="{ id: `vault-administration-window${idp}` }"
              data-testid="vault-administration-window-select"
            />
          </NFormItem>
          <NButton
            size="small"
            attr-type="submit"
            :disabled="busy || windowSeconds === null || windowSeconds === currentWindow || !canPropose()"
            data-testid="vault-administration-window-propose"
          >
            {{ t('vaultAdministration.windowPropose') }}
          </NButton>
        </form>
      </div>
    </template>
  </section>
  <p
    v-else-if="nonManagerAdmin"
    class="mb-4 text-sm text-gray-400"
    data-testid="vault-administration-not-manager"
  >
    {{ t('vaultAdministration.notManager') }}
  </p>
</template>
