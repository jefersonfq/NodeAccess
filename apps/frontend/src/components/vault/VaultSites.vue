<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { z } from 'zod'
import { useThemeVars } from 'naive-ui'
import SitePanel from '../../../../extension/src/popup/SitePanel.vue'
import type { SitesClient, SiteHostOption, SiteWriteAccess } from '../../../../extension/src/core/sites-port'
import { VaultSiteCreateSchema, VaultSiteUpdateSchema, VaultSiteListSchema, VaultSiteListReplySchema, VaultSiteVersionSchema, vaultSiteUrl } from '../../../../../packages/shared/src/schemas/vault-sites.schema'
import { VaultExtensionWriteAccessSchema } from '@nodeaccess/shared'
import { useAuthStore } from '@/stores/auth'
import { vaultPortalIdentity } from '@/services/vault-manager'
import { createVaultTransport, VaultClientError, type VaultTransport } from '@/services/vault-http'

const props = defineProps<{ transport?: VaultTransport }>()
const auth = useAuthStore(), router = useRouter(), { locale } = useI18n()
const theme = useThemeVars()
const panelTheme = computed(() => ({
  '--surface': theme.value.cardColor,
  '--bg': theme.value.bodyColor,
  '--border': theme.value.borderColor,
  '--muted': theme.value.textColor2,
  '--primary': theme.value.primaryColorPressed,
  '--primary-hover': theme.value.primaryColorPressed,
  '--primary-text': theme.value.baseColor,
  color: theme.value.textColor2,
  backgroundColor: theme.value.bodyColor,
}))
const transport = props.transport ?? createVaultTransport()
const identity = computed(() => vaultPortalIdentity(auth))
const revision = ref(0), hosts = ref<SiteHostOption[]>([]), hostsFailed = ref(false)
const writeAccess = ref<SiteWriteAccess>({ groups: [], tenant: false })
const client = shallowRef<SitesClient | null>(null)
const hostsSchema = z.object({ hosts: z.array(z.object({ id: z.number().int().positive().max(2147483647), name: z.string() }).strict()).max(50) }).strict()
let controller = new AbortController(), alive = true, hostsRead = 0
function assertCurrent(who: NonNullable<typeof identity.value>, signal: AbortSignal): void {
  if (!alive || signal.aborted || identity.value !== who) throw new VaultClientError('login')
}
watch(identity, who => {
  controller.abort(); controller = new AbortController()
  revision.value++; writeAccess.value = { groups: [], tenant: false }; hosts.value = []; hostsFailed.value = false; client.value = null
  if (!who) return
  const signal = controller.signal
  async function post(path: string, body: object): Promise<unknown> {
    assertCurrent(who!, signal)
    const reply = await transport.post(path, body, who!, undefined, signal)
    assertCurrent(who!, signal)
    return reply
  }
  client.value = {
    async list(query): Promise<ReturnType<typeof VaultSiteListReplySchema.parse>> { return VaultSiteListReplySchema.parse(await post('sites/list', VaultSiteListSchema.parse(query))) },
    async create(input): Promise<unknown> { return VaultSiteVersionSchema.parse(await post('sites/create', VaultSiteCreateSchema.parse(input))) },
    async update(input): Promise<unknown> { return VaultSiteVersionSchema.parse(await post('sites/update', VaultSiteUpdateSchema.parse(input))) },
  }
  void post('sites/write-access', {}).then(reply => {
    assertCurrent(who, signal); writeAccess.value = VaultExtensionWriteAccessSchema.parse(reply)
  }).catch(() => { /* Personal creation remains available; unknown shared rights grant nothing. */ })
  void loadHosts('')
}, { immediate: true, flush: 'sync' })
async function loadHosts(q: string): Promise<void> {
  const who = identity.value, signal = controller.signal, read = ++hostsRead
  if (!who || q.length > 200) return
  hostsFailed.value = false
  try {
    const reply = await transport.post('sites/hosts', { q: q.trim() }, who, undefined, signal)
    assertCurrent(who, signal)
    if (read === hostsRead) hosts.value = hostsSchema.parse(reply).hosts
  } catch { if (alive && !signal.aborted && read === hostsRead) hostsFailed.value = true }
}
function connect(hostId: number): void {
  if (!identity.value || !Number.isSafeInteger(hostId) || hostId < 1 || hostId > 2147483647) return
  void router.push({ path: '/hosts', query: { hostId: String(hostId), connect: '1' } })
}
function open(url: string): void {
  if (!identity.value) return
  try { window.open(vaultSiteUrl(url), '_blank', 'noopener,noreferrer') } catch { /* Reject unsafe destinations. */ }
}
onBeforeUnmount(() => { alive = false; controller.abort(); client.value = null; hosts.value = [] })
</script>

<template>
  <div
    v-if="identity && client"
    data-testid="vault-sites"
    class="max-w-2xl min-w-0"
    :style="panelTheme"
  >
    <p
      v-if="hostsFailed"
      role="status"
      class="mb-2 text-sm"
    >
      {{ locale.toLowerCase().startsWith('pt') ? 'Hosts indisponíveis. Você pode salvar o site sem vincular um host.' : 'Hosts unavailable. You can save the site without linking a host.' }}
    </p>
    <SitePanel
      :key="revision"
      :client="client"
      :locale="locale"
      :host-options="hosts"
      :write-access="writeAccess"
      :fill-enabled="false"
      @search-hosts="loadHosts"
      @connect="connect"
      @open="open"
    />
  </div>
</template>
