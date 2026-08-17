<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NAlert, NButton, NCheckbox, NDescriptions, NDescriptionsItem, NInputNumber, NModal, NCard, NPopconfirm, NSelect, NSpin, useMessage } from 'naive-ui'
import { settingsService, type SettingsData, type UpdateLicenseSettingsPayload } from '@/services/settings.service'
import { featuresService } from '@/services/features.service'

const props = defineProps<{ show: boolean; tenantId: number | null; tenantName: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const message = useMessage()
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const license = ref<SettingsData['license'] | null>(null)
const form = ref<UpdateLicenseSettingsPayload | null>(null)
const limitHosts = ref(false)

const featureKeys = ['agents', 'secrets', 'snippets', 'portForwarding', 'integrations', 'feedback', 'localAi', 'terminalAutocomplete', 'terminalAi', 'mcp', 'aiSshActions'] as const
const providerKeys = ['jira', 'google', 'ldap', 'onepassword', 'oidc', 'scim'] as const
const canSave = computed(() => !!form.value && !!license.value
  && form.value.maxUsers >= license.value.activeUsers
  && (!limitHosts.value || (form.value.maxHosts !== null && form.value.maxHosts >= license.value.registeredHosts)))

watch(() => [props.show, props.tenantId] as const, ([show, tenantId]) => {
  if (show && tenantId) void load(tenantId)
}, { immediate: true })

async function load(tenantId: number) {
  loading.value = true
  error.value = null
  try {
    const { data } = await settingsService.getTenantLicense(tenantId)
    license.value = data
    limitHosts.value = data.maxHosts !== null
    form.value = {
      maxUsers: data.maxUsers,
      maxHosts: data.maxHosts,
      multiConnect: data.multiConnect,
      sessionAuditEnabled: data.sessionAuditEnabled,
      sessionAuditAiEnabled: data.sessionAuditAiEnabled,
      sessionAuditAiProvider: data.sessionAuditAiProvider,
      sessionAuditAiAutoSummaryEnabled: data.sessionAuditAiAutoSummaryEnabled,
      featureEntitlements: { ...data.featureEntitlements },
      integrationEntitlements: { ...data.integrationEntitlements },
    }
  } catch {
    error.value = 'Não foi possível carregar a licença deste tenant.'
  } finally { loading.value = false }
}

async function save() {
  if (!props.tenantId || !form.value || !canSave.value) return
  saving.value = true
  error.value = null
  try {
    const payload = {
      ...form.value,
      maxHosts: limitHosts.value ? form.value.maxHosts : null,
      sessionAuditAiEnabled: form.value.sessionAuditEnabled && form.value.sessionAuditAiEnabled,
      sessionAuditAiAutoSummaryEnabled: form.value.sessionAuditEnabled && form.value.sessionAuditAiEnabled && form.value.sessionAuditAiAutoSummaryEnabled,
      integrationEntitlements: Object.fromEntries(providerKeys.map((key) => [key, form.value!.featureEntitlements.integrations === true && form.value!.integrationEntitlements[key] === true])),
    }
    const { data } = await settingsService.updateTenantLicense(props.tenantId, payload)
    license.value = data
    featuresService.notifyUpdated()
    message.success('Licença atualizada e enforcement efetivo imediatamente.')
    emit('saved')
  } catch (err: unknown) {
    const apiError = err as { response?: { data?: { message?: string } } }
    error.value = apiError.response?.data?.message ?? 'Não foi possível atualizar a licença.'
  } finally { saving.value = false }
}
</script>

<template>
  <NModal :show="show" :mask-closable="false" @esc="emit('close')">
    <NCard data-testid="tenant-license-editor" :title="`Licença · ${tenantName}`" class="w-[min(94vw,860px)]" :bordered="false" role="dialog" aria-modal="true">
      <NSpin :show="loading">
        <NAlert v-if="error" type="error" class="mb-4">{{ error }}</NAlert>
        <template v-if="license && form">
          <NDescriptions :column="2" label-placement="top" class="mb-5">
            <NDescriptionsItem label="Usuários ativos">{{ license.activeUsers }} / {{ form.maxUsers }}</NDescriptionsItem>
            <NDescriptionsItem label="Hosts registrados">{{ license.registeredHosts }} / {{ limitHosts ? form.maxHosts : '∞' }}</NDescriptionsItem>
          </NDescriptions>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="text-sm text-zinc-300">Limite contratado de usuários
              <NInputNumber v-model:value="form.maxUsers" data-testid="license-max-users" class="mt-1 w-full" :min="Math.max(1, license.activeUsers)" />
            </label>
            <div>
              <NCheckbox v-model:checked="limitHosts">Limitar hosts contratados</NCheckbox>
              <NInputNumber v-if="limitHosts" v-model:value="form.maxHosts" class="mt-2 w-full" :min="Math.max(1, license.registeredHosts)" />
            </div>
          </div>

          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <div class="rounded-lg border border-zinc-700 p-3">
              <div class="mb-3 text-sm font-semibold">Módulos licenciados</div>
              <div class="grid gap-2 sm:grid-cols-2">
                <NCheckbox v-for="key in featureKeys" :key="key" v-model:checked="form.featureEntitlements[key]">{{ key }}</NCheckbox>
                <NCheckbox v-model:checked="form.multiConnect">multiConnect</NCheckbox>
                <NCheckbox v-model:checked="form.sessionAuditEnabled">sessionAudit</NCheckbox>
                <NCheckbox v-model:checked="form.sessionAuditAiEnabled" :disabled="!form.sessionAuditEnabled">sessionAuditAi</NCheckbox>
                <NCheckbox v-model:checked="form.sessionAuditAiAutoSummaryEnabled" :disabled="!form.sessionAuditAiEnabled">auditAiAutoSummary</NCheckbox>
              </div>
              <NSelect v-if="form.sessionAuditAiEnabled" v-model:value="form.sessionAuditAiProvider" class="mt-3" :options="[{ label: 'Automático', value: 'automatic' }, { label: 'OpenAI', value: 'openai' }, { label: 'IA local', value: 'local_ai' }]" />
            </div>
            <div class="rounded-lg border border-zinc-700 p-3">
              <div class="mb-3 text-sm font-semibold">Providers de integração</div>
              <NAlert v-if="!form.featureEntitlements.integrations" type="info" class="mb-3">Habilite o módulo Integrações para licenciar providers.</NAlert>
              <div class="grid gap-2 sm:grid-cols-2">
                <NCheckbox v-for="key in providerKeys" :key="key" v-model:checked="form.integrationEntitlements[key]" :disabled="!form.featureEntitlements.integrations">{{ key }}</NCheckbox>
              </div>
            </div>
          </div>
        </template>
      </NSpin>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="emit('close')">Cancelar</NButton>
          <NPopconfirm :disabled="!canSave" @positive-click="save">
            <template #trigger><NButton data-testid="save-tenant-license" type="primary" :loading="saving" :disabled="!canSave">Aplicar contrato</NButton></template>
            A alteração afeta imediatamente quotas, módulos e providers deste tenant. Continuar?
          </NPopconfirm>
        </div>
      </template>
    </NCard>
  </NModal>
</template>
