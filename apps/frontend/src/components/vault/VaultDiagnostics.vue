<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NAlert, NButton, NFormItem, NInputNumber, NSelect, NSpace } from 'naive-ui'
import { vaultDiagnostics } from '../../services/vault-diagnostics'
import { VaultClientError, type VaultPortalIdentity, type VaultTransport } from '../../services/vault-http'
import type { VaultDiagnostics } from '../../../../../packages/shared/src/schemas/vault-diagnostics.schema'
const props = defineProps<{
  transport: VaultTransport; identity: VaultPortalIdentity; clientId: string; sessionId: string
  users: ReadonlyArray<{ id: number; name: string }>; language?: string; secretId?: number
}>()
const emit = defineEmits<{ expired: [] }>()
const userId = ref<number | null>(null), itemId = ref<number | null>(props.secretId ?? null)
const result = ref<VaultDiagnostics | null>(null), busy = ref(false), failure = ref<'expired' | 'error' | null>(null)
const words = computed(() => props.language?.startsWith('en') ? {
  title: 'Access configuration', note: 'Configuration only. Current session, device, confirmation, license and other runtime conditions are not evaluated; delivery is not guaranteed.',
  user: 'User', item: 'Secret ID', run: 'Check configuration', empty: 'No authorized users available.',
  expired: 'Confirmation expired. Use the existing unlock controls.', error: 'Diagnosis unavailable for this user and item.',
  exists: 'User exists', active: 'User active', deleted: 'User deleted', reveal: 'Reveal policy', copy: 'Copy policy',
  grantReveal: 'Reveal grant', grantCopy: 'Copy grant', released: 'Item released', revoked: 'Item revoked', acl: 'User can identify item', yes: 'Yes', no: 'No',
} : {
  title: 'Configuração de acesso', note: 'Somente configuração. Sessão atual, dispositivo, confirmação, licença e outras condições de execução não são avaliados; a entrega não é garantida.',
  user: 'Usuário', item: 'ID do Secret', run: 'Consultar configuração', empty: 'Nenhum usuário autorizado disponível.',
  expired: 'Confirmação expirada. Use os controles de desbloqueio existentes.', error: 'Diagnóstico indisponível para este usuário e item.',
  exists: 'Usuário existe', active: 'Usuário ativo', deleted: 'Usuário excluído', reveal: 'Política de revelar', copy: 'Política de copiar',
  grantReveal: 'Concessão de revelar', grantCopy: 'Concessão de copiar', released: 'Item liberado', revoked: 'Item revogado', acl: 'Usuário pode identificar o item', yes: 'Sim', no: 'Não',
})
const options = computed(() => props.users.map(u => ({ label: u.name, value: u.id })))
const ready = computed(() => !!props.clientId && !!props.sessionId && props.users.some(u => u.id === userId.value)
  && Number.isSafeInteger(itemId.value) && (itemId.value ?? 0) > 0)
const rows = computed(() => {
  const r = result.value, w = words.value
  return r ? [[w.exists, r.user.exists], [w.active, r.user.active], [w.deleted, r.user.deleted],
    [w.reveal, r.policy.reveal], [w.copy, r.policy.copy], [w.grantReveal, r.grants.reveal], [w.grantCopy, r.grants.copy],
    [w.released, r.item.released], [w.revoked, r.item.revoked], [w.acl, r.acl]] as const : []
})
let generation = 0, abort: AbortController | undefined
function reset(): void { generation++; abort?.abort(); result.value = null; failure.value = null; busy.value = false }
watch(() => props.secretId, value => { itemId.value = value ?? null }, { flush: 'sync' })
watch(() => [props.identity, props.identity.tenantId, props.identity.userId, props.identity.accessToken,
  props.clientId, props.sessionId, props.transport, props.users, userId.value, itemId.value], reset, { deep: true, flush: 'sync' })
onBeforeUnmount(reset)
async function run(): Promise<void> {
  if (!ready.value || busy.value) return
  reset(); const version = generation; abort = new AbortController(); busy.value = true
  try {
    const reply = await vaultDiagnostics(props.transport, props.identity, props.clientId, props.sessionId,
      userId.value!, itemId.value!, abort.signal)
    if (version === generation) result.value = reply
  } catch (error) {
    if (version !== generation) return
    const expired = error instanceof VaultClientError && ['expired', 'locked', 'login'].includes(error.reason)
    failure.value = expired ? 'expired' : 'error'
    if (expired) emit('expired')
  } finally { if (version === generation) busy.value = false }
}
</script>
<template>
  <section
    class="vault-diagnostics"
    :aria-label="words.title"
    :aria-busy="busy"
  >
    <h3>{{ words.title }}</h3><p>{{ words.note }}</p>
    <p v-if="!users.length">
      {{ words.empty }}
    </p>
    <NSpace vertical>
      <NFormItem :label="words.user">
        <NSelect
          v-model:value="userId"
          :options="options"
          :input-props="{ 'aria-label': words.user }"
          filterable
        />
      </NFormItem>
      <NFormItem :label="words.item">
        <NInputNumber
          v-model:value="itemId"
          :min="1"
          :max="Number.MAX_SAFE_INTEGER"
          :precision="0"
          :input-props="{ 'aria-label': words.item }"
        />
      </NFormItem>
      <NButton
        :disabled="!ready || busy"
        :loading="busy"
        @click="run"
      >
        {{ words.run }}
      </NButton>
      <NAlert
        v-if="failure"
        type="warning"
        role="alert"
      >
        {{ words[failure] }}
      </NAlert>
      <dl
        v-if="result"
        aria-live="polite"
      >
        <template
          v-for="[label, value] in rows"
          :key="label"
        >
          <dt>{{ label }}</dt><dd>{{ value ? words.yes : words.no }}</dd>
        </template>
      </dl>
    </NSpace>
  </section>
</template>
<style scoped>
.vault-diagnostics { min-width: 0; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 16px; }
dd { margin: 0; }
</style>
