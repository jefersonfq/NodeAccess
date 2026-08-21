<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NCheckbox, NDescriptions, NDescriptionsItem, NDrawer, NDrawerContent, NInputNumber, NModal, NPopconfirm, NSelect, NSpin, NTag, NTooltip, useMessage } from 'naive-ui'
import { settingsService, type SettingsData, type UpdateLicenseSettingsPayload } from '@/services/settings.service'
import { featuresService } from '@/services/features.service'
import { licenseCategoryLabels, licenseModuleCatalog, licenseProviderCatalog, moduleByKey, moduleDependents, type LicenseCatalogItem, type LicenseCategoryKey, type LicenseModuleKey } from '@/services/license-catalog.service'

const props = defineProps<{ show: boolean; tenantId: number | null; tenantName: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const message = useMessage()
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const license = ref<SettingsData['license'] | null>(null)
const form = ref<UpdateLicenseSettingsPayload | null>(null)
const limitHosts = ref(false)
const initialState = ref('')
const helpItem = ref<(LicenseCatalogItem & { kind: 'module' | 'provider' }) | null>(null)

const categories = (Object.keys(licenseCategoryLabels) as LicenseCategoryKey[]).map(key => ({ key, label: licenseCategoryLabels[key], items: licenseModuleCatalog.filter(item => item.category === key) }))
const validLimits = computed(() => !!form.value && !!license.value && form.value.maxUsers >= license.value.activeUsers && (!limitHosts.value || (form.value.maxHosts !== null && form.value.maxHosts >= license.value.registeredHosts)))
const currentState = computed(() => form.value ? JSON.stringify({ form: form.value, limitHosts: limitHosts.value }) : '')
const hasChanges = computed(() => !!initialState.value && currentState.value !== initialState.value)
const canSave = computed(() => validLimits.value && hasChanges.value)
const enabledModuleCount = computed(() => licenseModuleCatalog.filter(item => isModuleEnabled(item.key)).length)
const enabledProviderCount = computed(() => licenseProviderCatalog.filter(item => form.value?.integrationEntitlements[item.key] === true).length)
const changeSummary = computed(() => {
  if (!form.value || !initialState.value) return []
  const initial = JSON.parse(initialState.value) as { form: UpdateLicenseSettingsPayload; limitHosts: boolean }
  const changes: string[] = []
  if (initial.form.maxUsers !== form.value.maxUsers) changes.push(`Usuários: ${initial.form.maxUsers} → ${form.value.maxUsers}`)
  const oldHosts = initial.limitHosts ? initial.form.maxHosts : '∞'
  const newHosts = limitHosts.value ? form.value.maxHosts : '∞'
  if (oldHosts !== newHosts) changes.push(`Hosts: ${oldHosts} → ${newHosts}`)
  for (const item of licenseModuleCatalog) {
    const before = moduleValue(initial.form, item.key)
    const after = isModuleEnabled(item.key)
    if (before !== after) changes.push(`${item.label}: ${after ? 'habilitar' : 'desabilitar'}`)
  }
  for (const item of licenseProviderCatalog) {
    const before = initial.form.integrationEntitlements[item.key] === true
    const after = form.value.integrationEntitlements[item.key] === true
    if (before !== after) changes.push(`${item.label}: ${after ? 'habilitar' : 'desabilitar'}`)
  }
  return changes
})

watch(() => [props.show, props.tenantId] as const, ([show, tenantId]) => {
  if (show && tenantId) void load(tenantId)
  if (!show) helpItem.value = null
}, { immediate: true })

function moduleValue(target: UpdateLicenseSettingsPayload, key: LicenseModuleKey): boolean {
  if (key === 'multiConnect') return target.multiConnect
  if (key === 'sessionAudit') return target.sessionAuditEnabled
  if (key === 'sessionAuditAi') return target.sessionAuditAiEnabled
  if (key === 'auditAiAutoSummary') return target.sessionAuditAiAutoSummaryEnabled
  return target.featureEntitlements[key] === true
}
function isModuleEnabled(key: LicenseModuleKey) { return form.value ? moduleValue(form.value, key) : false }
function assignModule(key: LicenseModuleKey, enabled: boolean) {
  if (!form.value) return
  if (key === 'multiConnect') form.value.multiConnect = enabled
  else if (key === 'sessionAudit') form.value.sessionAuditEnabled = enabled
  else if (key === 'sessionAuditAi') form.value.sessionAuditAiEnabled = enabled
  else if (key === 'auditAiAutoSummary') form.value.sessionAuditAiAutoSummaryEnabled = enabled
  else form.value.featureEntitlements[key] = enabled
}
function toggleModule(key: LicenseModuleKey, enabled: boolean) {
  if (!form.value) return
  const changed: string[] = []
  if (enabled) {
    for (const dependency of moduleByKey(key)?.dependsOn ?? []) {
      if (!isModuleEnabled(dependency)) { assignModule(dependency, true); changed.push(moduleByKey(dependency)?.label ?? dependency) }
    }
  } else {
    const queue = [...moduleDependents(key)]
    const visited = new Set<LicenseModuleKey>()
    while (queue.length) {
      const dependent = queue.shift()!
      if (visited.has(dependent)) continue
      visited.add(dependent)
      if (isModuleEnabled(dependent)) { assignModule(dependent, false); changed.push(moduleByKey(dependent)?.label ?? dependent) }
      queue.push(...moduleDependents(dependent))
    }
    if (key === 'integrations') for (const provider of licenseProviderCatalog) form.value.integrationEntitlements[provider.key] = false
  }
  assignModule(key, enabled)
  if (changed.length) message.info(`${enabled ? 'Dependências habilitadas' : 'Recursos dependentes desabilitados'}: ${changed.join(', ')}.`)
}
function dependencyLabels(key: LicenseModuleKey) { return moduleByKey(key)?.dependsOn?.map(dependency => moduleByKey(dependency)?.label ?? dependency).join(', ') ?? '' }
function showCases(item: LicenseCatalogItem, kind: 'module' | 'provider') { helpItem.value = { ...item, kind } }

async function load(tenantId: number) {
  loading.value = true; error.value = null; initialState.value = ''
  try {
    const { data } = await settingsService.getTenantLicense(tenantId)
    license.value = data
    limitHosts.value = data.maxHosts !== null
    form.value = { maxUsers: data.maxUsers, maxHosts: data.maxHosts, multiConnect: data.multiConnect, sessionAuditEnabled: data.sessionAuditEnabled, sessionAuditAiEnabled: data.sessionAuditAiEnabled, sessionAuditAiProvider: data.sessionAuditAiProvider, sessionAuditAiAutoSummaryEnabled: data.sessionAuditAiAutoSummaryEnabled, featureEntitlements: { ...data.featureEntitlements }, integrationEntitlements: { ...data.integrationEntitlements } }
    initialState.value = currentState.value
  } catch { error.value = 'Não foi possível carregar a licença deste tenant.' }
  finally { loading.value = false }
}
async function save() {
  if (!props.tenantId || !form.value || !canSave.value) return
  saving.value = true; error.value = null
  try {
    const payload = { ...form.value, maxHosts: limitHosts.value ? form.value.maxHosts : null, sessionAuditAiEnabled: form.value.sessionAuditEnabled && form.value.sessionAuditAiEnabled, sessionAuditAiAutoSummaryEnabled: form.value.sessionAuditEnabled && form.value.sessionAuditAiEnabled && form.value.sessionAuditAiAutoSummaryEnabled, integrationEntitlements: Object.fromEntries(licenseProviderCatalog.map(({ key }) => [key, form.value!.featureEntitlements.integrations === true && form.value!.integrationEntitlements[key] === true])) }
    const { data } = await settingsService.updateTenantLicense(props.tenantId, payload)
    license.value = data
    form.value = { ...payload, featureEntitlements: { ...payload.featureEntitlements }, integrationEntitlements: { ...payload.integrationEntitlements } }
    limitHosts.value = data.maxHosts !== null
    initialState.value = currentState.value
    featuresService.notifyUpdated()
    message.success('Licença atualizada. Limites e recursos já estão em vigor.')
    emit('saved')
  } catch (err: unknown) {
    const apiError = err as { response?: { data?: { message?: string } } }
    error.value = apiError.response?.data?.message ?? 'Não foi possível atualizar a licença.'
  } finally { saving.value = false }
}
</script>

<template>
  <NModal :show="show" :mask-closable="true" @update:show="value => { if (!value) emit('close') }">
    <NCard data-testid="tenant-license-editor" :title="`Contrato e licença · ${tenantName}`" class="license-editor w-[min(96vw,1080px)]" :bordered="false" role="dialog" aria-modal="true" closable @close="emit('close')">
      <NSpin :show="loading">
        <NAlert v-if="error" type="error" class="mb-4" data-testid="license-error">{{ error }}</NAlert>
        <template v-if="license && form">
          <p class="mb-4 text-sm text-zinc-400">Defina limites e recursos deste tenant. Use o ícone de ajuda para uma explicação rápida.</p>
          <NDescriptions :column="2" label-placement="top" class="mb-5" responsive="screen">
            <NDescriptionsItem label="Usuários em uso">{{ license.activeUsers }} / {{ form.maxUsers }}</NDescriptionsItem>
            <NDescriptionsItem label="Hosts registrados">{{ license.registeredHosts }} / {{ limitHosts ? form.maxHosts : '∞' }}</NDescriptionsItem>
          </NDescriptions>

          <section aria-labelledby="license-limits-title">
            <h2 id="license-limits-title" class="mb-3 text-sm font-semibold">Limites contratados</h2>
            <div class="grid gap-4 md:grid-cols-2">
              <label class="text-sm text-zinc-300">Quantidade máxima de usuários
                <NInputNumber v-model:value="form.maxUsers" data-testid="license-max-users" class="mt-1 w-full" :min="Math.max(1, license.activeUsers)" />
                <span class="mt-1 block text-xs text-zinc-500">Não pode ser menor que os {{ license.activeUsers }} usuários atualmente ativos.</span>
              </label>
              <div><NCheckbox v-model:checked="limitHosts">Definir limite de hosts</NCheckbox><NInputNumber v-if="limitHosts" v-model:value="form.maxHosts" data-testid="license-max-hosts" class="mt-2 w-full" :min="Math.max(1, license.registeredHosts)" /><span class="mt-1 block text-xs text-zinc-500">{{ limitHosts ? `Mínimo atual: ${license.registeredHosts} hosts.` : 'Sem limite contratual de hosts.' }}</span></div>
            </div>
          </section>

          <section class="mt-6" aria-labelledby="license-modules-title">
            <div class="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 id="license-modules-title" class="text-sm font-semibold">Recursos licenciados</h2><p class="text-xs text-zinc-500">{{ enabledModuleCount }} de {{ licenseModuleCatalog.length }} recursos habilitados</p></div><NTag size="small" :type="hasChanges ? 'warning' : 'default'">{{ hasChanges ? `${changeSummary.length} alteração(ões) pendente(s)` : 'Contrato sem alterações' }}</NTag></div>
            <div class="space-y-4">
              <div v-for="category in categories" :key="category.key" class="rounded-lg border border-zinc-700 p-3" :data-license-category="category.key">
                <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">{{ category.label }}</h3>
                <div class="grid gap-2 md:grid-cols-2">
                  <article v-for="item in category.items" :key="item.key" class="license-option rounded-md border border-zinc-800 p-3" :data-license-module="item.key">
                    <div class="flex items-start gap-2"><NCheckbox :checked="isModuleEnabled(item.key)" :aria-label="item.label" @update:checked="toggleModule(item.key, $event)" /><div class="min-w-0 flex-1"><div class="flex items-center gap-1.5"><span class="text-sm font-medium">{{ item.label }}</span><NTooltip trigger="hover"><template #trigger><button type="button" class="license-help" :aria-label="`Sobre ${item.label}: ${item.description}`">?</button></template><span class="block max-w-64">{{ item.description }}</span></NTooltip></div><p class="mt-1 text-xs text-zinc-400">{{ item.description }}</p><p v-if="item.dependsOn?.length" class="mt-1 text-xs text-amber-500">Requer: {{ dependencyLabels(item.key) }}</p><NButton text type="primary" size="tiny" class="mt-1" :data-license-cases="item.key" @click="showCases(item, 'module')">Ver casos práticos</NButton></div></div>
                  </article>
                </div>
              </div>
            </div>
          </section>

          <section class="mt-5 rounded-lg border border-zinc-700 p-3" aria-labelledby="license-providers-title" data-testid="license-providers">
            <div class="mb-3"><h2 id="license-providers-title" class="text-sm font-semibold">Integrações disponíveis</h2><p class="text-xs text-zinc-500">{{ enabledProviderCount }} de {{ licenseProviderCatalog.length }} conectores habilitados</p></div>
            <NAlert v-if="!form.featureEntitlements.integrations" type="info" class="mb-3">Habilite <strong>Integrações externas</strong> para selecionar conectores.</NAlert>
            <div class="grid gap-2 md:grid-cols-2"><article v-for="item in licenseProviderCatalog" :key="item.key" class="license-option rounded-md border border-zinc-800 p-3" :data-license-provider="item.key"><div class="flex items-start gap-2"><NCheckbox v-model:checked="form.integrationEntitlements[item.key]" :disabled="!form.featureEntitlements.integrations" :aria-label="item.label" /><div class="min-w-0 flex-1"><div class="flex items-center gap-1.5"><span class="text-sm font-medium">{{ item.label }}</span><NTooltip trigger="hover"><template #trigger><button type="button" class="license-help" :aria-label="`Sobre ${item.label}: ${item.description}`">?</button></template>{{ item.description }}</NTooltip></div><p class="mt-1 text-xs text-zinc-400">{{ item.description }}</p><NButton text type="primary" size="tiny" class="mt-1" :data-license-cases="item.key" @click="showCases(item, 'provider')">Ver casos práticos</NButton></div></div></article></div>
          </section>

          <section v-if="form.sessionAuditAiEnabled" class="mt-5 rounded-lg border border-zinc-700 p-3" aria-labelledby="license-ai-provider-title"><label id="license-ai-provider-title" class="text-sm font-medium">Provider para análise de sessões</label><p class="mb-2 text-xs text-zinc-500">“Automático” usa a configuração efetiva da plataforma.</p><NSelect v-model:value="form.sessionAuditAiProvider" data-testid="license-ai-provider" :options="[{ label: 'Automático', value: 'automatic' }, { label: 'OpenAI', value: 'openai' }, { label: 'IA local', value: 'local_ai' }]" /></section>
        </template>
      </NSpin>
      <template #footer><div class="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><span class="text-xs text-zinc-500">As alterações entram em vigor imediatamente.</span><div class="flex justify-end gap-2"><NButton @click="emit('close')">Cancelar</NButton><NPopconfirm :disabled="!canSave" @positive-click="save"><template #trigger><NButton data-testid="save-tenant-license" type="primary" :loading="saving" :disabled="!canSave">Revisar e aplicar{{ changeSummary.length ? ` (${changeSummary.length})` : '' }}</NButton></template><div class="max-w-80" data-testid="license-change-summary"><strong>Aplicar estas alterações agora?</strong><ul class="mt-2 list-disc space-y-1 pl-4 text-xs"><li v-for="change in changeSummary" :key="change">{{ change }}</li></ul></div></NPopconfirm></div></div></template>
    </NCard>
  </NModal>

  <NDrawer :show="helpItem !== null" width="min(92vw, 460px)" placement="right" @update:show="value => { if (!value) helpItem = null }"><NDrawerContent v-if="helpItem" :title="helpItem.label" closable data-testid="license-practical-cases"><NTag size="small" :type="helpItem.kind === 'provider' ? 'info' : 'success'">{{ helpItem.kind === 'provider' ? 'Integração' : 'Recurso' }}</NTag><p class="mt-4 text-sm text-zinc-300">{{ helpItem.description }}</p><h2 class="mb-2 mt-6 text-sm font-semibold">Casos práticos que resolve</h2><ul class="space-y-2"><li v-for="practicalCase in helpItem.cases" :key="practicalCase" class="rounded-md border border-zinc-700 p-3 text-sm">{{ practicalCase }}</li></ul><NAlert v-if="helpItem.dependsOn?.length" type="info" class="mt-5">Este recurso também habilita: {{ helpItem.dependsOn.map(key => moduleByKey(key)?.label ?? key).join(', ') }}.</NAlert></NDrawerContent></NDrawer>
</template>

<style scoped>
.license-help { display: inline-grid; width: 1.15rem; height: 1.15rem; place-items: center; border: 1px solid currentColor; border-radius: 999px; color: #71717a; font-size: .7rem; line-height: 1; }
.license-help:hover, .license-help:focus-visible { color: #818cf8; outline: 2px solid #818cf8; outline-offset: 2px; }
</style>
