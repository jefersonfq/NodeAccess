<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { GroupPublic, TerminalHighlightRule, UserPublic } from '@nodeaccess/shared'
import { NAlert, NButton, NCard, NEmpty, NForm, NFormItem, NInput, NModal, NSelect, NSpin, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import { terminalHighlightService, type EffectiveTerminalHighlights, type TerminalHighlightAdoption, type TerminalHighlightHealth, type TerminalHighlightTemplate, type TerminalHighlightTemplateVersion } from '@/services/terminal-highlight.service'
import { userService } from '@/services/user.service'
import { groupService } from '@/services/group.service'
import TerminalHighlightPresetPicker from '@/components/TerminalHighlightPresetPicker.vue'
import { createHighlightPreset } from '@/services/terminal-highlight-presets'
import TerminalHighlightRuleEditor from '@/components/TerminalHighlightRuleEditor.vue'
import TerminalHighlightEffectiveRules from '@/components/TerminalHighlightEffectiveRules.vue'

const message = useMessage()
const dialog = useDialog()
const loading = ref(true)
const saving = ref(false)
const loadError = ref(false)
const selectedUserId = ref<number | null>(null)
const effective = ref<EffectiveTerminalHighlights | null>(null)
const previewLoading = ref(false)
const previewError = ref(false)
let previewRequest = 0
async function loadPreview() {
  const request = ++previewRequest
  effective.value = null
  previewError.value = false
  previewLoading.value = selectedUserId.value !== null
  if (selectedUserId.value === null) return
  try {
    const response = await terminalHighlightService.effectiveForUser(selectedUserId.value)
    if (request === previewRequest) effective.value = response.data
  } catch { if (request === previewRequest) previewError.value = true }
  finally { if (request === previewRequest) previewLoading.value = false }
}
watch(selectedUserId, loadPreview)
const templates = ref<TerminalHighlightTemplate[]>([])
const telemetry = ref<TerminalHighlightHealth[]>([])
const adoption = ref<TerminalHighlightAdoption | null>(null)
const cacheStatus = ref<{ ttlMs: number; entries: number; oldestExpiresAt: string | null } | null>(null)
const users = ref<UserPublic[]>([])
const groups = ref<GroupPublic[]>([])
const versions = ref<TerminalHighlightTemplateVersion[]>([])
const versionTemplate = ref<TerminalHighlightTemplate | null>(null)
const showTemplate = ref(false)
const showPresetLibrary = ref(false)
const editingTemplateId = ref<number | null>(null)
const templateForm = ref({ name: '', description: '', active: true, rules: [] as TerminalHighlightRule[], userIds: [] as number[], groupIds: [] as number[] })
const userOptions = computed(() => users.value.map((user) => ({ label: `${user.name} · ${user.email}`, value: user.id })))
const groupOptions = computed(() => groups.value.map((group) => ({ label: group.name, value: group.id })))

function validateRules(rules: TerminalHighlightRule[]) {
  if (rules.some((rule) => !rule.name.trim() || !rule.pattern)) return 'Informe nome e expressão em todas as regras.'
  for (const rule of rules) {
    if (rule.mode !== 'regex') continue
    try { new RegExp(rule.pattern) } catch { return `Regex inválido: ${rule.name}` }
  }
  return null
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [templateResponse, userResponse, groupResponse, telemetryResponse, cacheResponse, adoptionResponse] = await Promise.all([
      terminalHighlightService.listTemplates(), userService.list({ limit: 500 }), groupService.list(), terminalHighlightService.telemetrySummary(), terminalHighlightService.cacheStatus(), terminalHighlightService.adoptionSummary(),
    ])
    templates.value = templateResponse.data
    users.value = userResponse.data.data
    groups.value = groupResponse.data
    telemetry.value = telemetryResponse.data
    cacheStatus.value = cacheResponse.data
    adoption.value = adoptionResponse.data
  } catch { loadError.value = true }
  finally { loading.value = false }
}

// Keep dialogs and drafts available on failure; report every async action.
async function runAction(action: () => Promise<unknown>, success: string) {
  if (saving.value) return false
  saving.value = true
  try {
    await action()
    message.success(success)
    await load()
    await loadPreview()
    return true
  } catch (error: any) {
    message.error(error?.response?.data?.message ?? 'Não foi possível concluir a ação. Tente novamente.')
    return false
  } finally { saving.value = false }
}

function newTemplate() {
  showPresetLibrary.value = false
  editingTemplateId.value = null
  templateForm.value = { name: '', description: '', active: true, rules: [], userIds: [], groupIds: [] }
  showTemplate.value = true
}
function editTemplate(template: TerminalHighlightTemplate) {
  showPresetLibrary.value = false
  editingTemplateId.value = template.id
  templateForm.value = { name: template.name, description: template.description ?? '', active: template.active, rules: template.rules.map(rule => ({ ...rule })), userIds: [...template.userIds], groupIds: [...template.groupIds] }
  showTemplate.value = true
}
function choosePreset(id: string) {
  if (saving.value) return
  const apply = () => {
    templateForm.value = { ...templateForm.value, ...createHighlightPreset(id) }
    showPresetLibrary.value = false
  }
  if (templateForm.value.name || templateForm.value.description || templateForm.value.rules.length) {
    dialog.warning({ title: 'Substituir rascunho pelo modelo?', content: 'Nome, descrição e regras deste rascunho serão substituídos. Status, usuários e grupos selecionados serão preservados. Nada será aplicado antes de salvar.', positiveText: 'Substituir rascunho', negativeText: 'Manter rascunho', onPositiveClick: apply })
  } else apply()
}
async function saveTemplate() {
  const error = validateRules(templateForm.value.rules)
  if (!templateForm.value.name.trim()) return message.warning('Informe o nome do template.')
  if (error) return message.warning(error)
  const dto = { ...templateForm.value, description: templateForm.value.description || null }
  await runAction(async () => {
    if (editingTemplateId.value) await terminalHighlightService.updateTemplate(editingTemplateId.value, dto)
    else await terminalHighlightService.createTemplate(dto)
    showTemplate.value = false
  }, 'Template salvo e usuários vinculados foram notificados.')
}
function removeTemplate(template: TerminalHighlightTemplate) {
  dialog.warning({ title: 'Excluir template?', content: `O destaque “${template.name}” será removido dos usuários e grupos vinculados. As regras pessoais serão preservadas.`, positiveText: 'Excluir', negativeText: 'Cancelar', onPositiveClick: () => runAction(() => terminalHighlightService.removeTemplate(template.id), 'Template excluído.') })
}
function metric(templateId: number) { return telemetry.value.find((item) => item.templateId === templateId) }
function hotRule(template: TerminalHighlightTemplate) {
  const hottest = metric(template.id)?.hotRuleIds?.[0]
  return hottest ? { name: template.rules.find((rule) => rule.id === hottest.ruleId)?.name ?? hottest.ruleId, hits: hottest.hits } : null
}
async function duplicateTemplate(template: TerminalHighlightTemplate) { await runAction(() => terminalHighlightService.duplicateTemplate(template.id), 'Cópia criada inativa para revisão.') }
async function showVersions(template: TerminalHighlightTemplate) {
  try {
    versions.value = (await terminalHighlightService.templateVersions(template.id)).data
    versionTemplate.value = template
  } catch { message.error('Não foi possível carregar o histórico. Tente novamente.') }
}
function restoreVersion(version: number) {
  const template = versionTemplate.value
  if (!template) return
  dialog.warning({ title: 'Restaurar versão?', content: 'As regras e os vínculos de usuários e grupos serão substituídos pelos desta versão.', positiveText: 'Restaurar', negativeText: 'Cancelar', onPositiveClick: () => runAction(async () => {
    await terminalHighlightService.restoreTemplateVersion(template.id, version)
    versionTemplate.value = null
  }, `Versão ${version} restaurada como uma nova revisão.`) })
}
function exportGovernance() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), adoption: adoption.value, templates: templates.value, telemetry: telemetry.value }, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = `nodeaccess-destaques-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(href)
}
async function clearCache() {
  await runAction(() => terminalHighlightService.clearCache(), 'Cache limpo. Terminais conectados receberam o evento de atualização.')
}
onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-5 p-4 md:p-6" data-terminal-highlights-admin-page="true">
    <header>
      <h1 class="text-2xl font-semibold text-white">Destaques do terminal · Administração</h1>
      <p class="mt-1 text-sm text-gray-400">Gerencie templates da organização, atribua a usuários e grupos e confira a configuração de cada usuário.</p>
    </header>
    <RouterLink :to="{ name: 'terminal-highlights' }" class="inline-block text-sm text-emerald-400 underline focus-visible:outline">Meus destaques pessoais</RouterLink>
    <NAlert type="info">Atribuição direta prevalece sobre grupo, que prevalece sobre regras pessoais. O usuário pode desligar todos os destaques; atribuição não significa aplicação obrigatória.</NAlert>
    <NAlert v-if="loadError" type="error" title="Não foi possível carregar a gestão de destaques."><NButton @click="load">Tentar novamente</NButton></NAlert>
    <NSpin :show="loading">
      <div v-if="!loading && !loadError" class="space-y-5">
      <div v-if="adoption" class="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" aria-label="Indicadores de adoção">
        <NCard size="small" v-for="item in [{ label: 'Usuários configurados', value: adoption.configuredUsers }, { label: 'Ativos em 30 dias', value: adoption.activeUsers30d }, { label: 'Templates', value: adoption.templates }, { label: 'Vínculos diretos', value: adoption.userAssignments }, { label: 'Vínculos por grupo', value: adoption.groupAssignments }, { label: 'Desativaram', value: adoption.disabledUsers }]" :key="item.label"><div class="text-xl font-semibold text-white">{{ item.value }}</div><div class="text-xs text-gray-400">{{ item.label }}</div></NCard>
      </div>
      <NCard title="Configuração por usuário" :bordered="false" class="na-card">
        <NFormItem label="Usuário para consulta"><NSelect v-model:value="selectedUserId" clearable filterable :options="userOptions" placeholder="Selecione um usuário" :input-props="{ 'aria-label': 'Usuário para consulta' }" /></NFormItem>
        <NButton class="mb-4" :disabled="selectedUserId === null || previewLoading" @click="loadPreview">Atualizar consulta</NButton>
        <NSpin :show="previewLoading">
          <NAlert v-if="previewError" type="error" title="Não foi possível consultar este usuário."><NButton @click="loadPreview">Recarregar configuração</NButton></NAlert>
          <TerminalHighlightEffectiveRules v-else-if="effective" :effective="effective" />
          <NEmpty v-else-if="!previewLoading" description="Selecione um usuário para ver templates, regras pessoais e precedência." />
        </NSpin>
      </NCard>

      <NCard title="Templates da organização" :bordered="false" class="na-card mt-5">
        <div class="mb-4 flex flex-wrap items-center gap-2"><NTag size="small">Cache: {{ cacheStatus?.entries ?? 0 }} · {{ Math.round((cacheStatus?.ttlMs ?? 0) / 1000) }}s</NTag><NButton size="small" @click="exportGovernance">Exportar diagnóstico</NButton><NButton size="small" :disabled="saving" @click="clearCache">Limpar cache</NButton><NButton type="primary" :disabled="saving" @click="newTemplate">Novo template</NButton></div>
        <NEmpty v-if="!templates.length" description="Nenhum template administrativo configurado." />
        <div v-else class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div v-for="template in templates" :key="template.id" class="na-item rounded-xl border border-gray-800 p-4">
            <div class="flex items-start justify-between gap-3">
              <div><div class="font-medium text-white">{{ template.name }}</div><div class="mt-1 text-xs text-gray-400">{{ template.description || 'Sem descrição' }}</div></div>
              <NTag :type="template.active ? 'success' : 'default'">{{ template.active ? 'Ativo' : 'Inativo' }}</NTag>
            </div>
            <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-400"><span>{{ template.rules.length }} regras</span><span>•</span><span>{{ template.userIds.length }} usuários</span><span>•</span><span>{{ template.groupIds.length }} grupos</span><template v-if="metric(template.id)"><span>•</span><NTag size="tiny" :type="metric(template.id)!.health === 'healthy' ? 'success' : metric(template.id)!.health === 'attention' ? 'warning' : 'error'">{{ metric(template.id)!.health === 'healthy' ? 'Saudável' : metric(template.id)!.health === 'attention' ? 'Atenção' : 'Revisar' }}</NTag><span>média {{ metric(template.id)!.averageMs.toFixed(1) }} ms</span></template></div>
            <NAlert v-if="metric(template.id)?.budgetExceededCount" class="mt-3" type="warning" :title="`${metric(template.id)!.budgetExceededCount} amostras excederam o orçamento de 8 ms`" />
            <div v-if="metric(template.id)" class="mt-2 text-xs text-gray-400">{{ metric(template.id)!.recommendation }}</div>
            <div v-if="hotRule(template)" class="mt-1 text-xs text-gray-500">Regra mais acionada: {{ hotRule(template)!.name }} · {{ hotRule(template)!.hits }} amostras</div>
            <div class="mt-4 flex flex-wrap gap-2"><NButton size="small" :disabled="saving" @click="editTemplate(template)">Editar e vincular</NButton><NButton size="small" :disabled="saving" @click="duplicateTemplate(template)">Duplicar</NButton><NButton size="small" :disabled="saving" @click="showVersions(template)">Histórico</NButton><NButton size="small" quaternary type="error" :disabled="saving" @click="removeTemplate(template)">Excluir</NButton></div>
          </div>
        </div>
      </NCard>
      </div>
    </NSpin>

    <NModal :show="showTemplate" @update:show="value => { if (!saving) showTemplate = value }" :mask-closable="!saving" :close-on-esc="!saving" :closable="!saving" preset="card" :title="editingTemplateId ? 'Editar template' : 'Novo template'" style="width:min(900px,94vw)">
      <NButton v-if="!editingTemplateId" class="mb-3" :disabled="saving" :aria-expanded="showPresetLibrary" @click="showPresetLibrary = !showPresetLibrary">{{ showPresetLibrary ? 'Fechar biblioteca' : 'Usar modelo pronto' }}</NButton>
      <TerminalHighlightPresetPicker v-if="showPresetLibrary && !editingTemplateId" :disabled="saving" @choose="choosePreset" />
      <NForm label-placement="top" :disabled="saving">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2"><NFormItem label="Nome"><NInput v-model:value="templateForm.name" /></NFormItem><NFormItem label="Status"><NSwitch v-model:value="templateForm.active" /></NFormItem></div>
        <NFormItem label="Descrição"><NInput v-model:value="templateForm.description" /></NFormItem>
        <NFormItem label="Usuários vinculados"><NSelect v-model:value="templateForm.userIds" multiple filterable :options="userOptions" placeholder="Selecione um ou mais usuários" :input-props="{ 'aria-label': 'Usuários vinculados' }" /></NFormItem>
        <NFormItem label="Grupos vinculados"><NSelect v-model:value="templateForm.groupIds" multiple filterable :options="groupOptions" placeholder="Selecione equipes inteiras" :input-props="{ 'aria-label': 'Grupos vinculados' }" /></NFormItem>
        <NFormItem label="Regras"><TerminalHighlightRuleEditor v-model="templateForm.rules" :disabled="saving" class="w-full" /></NFormItem>
      </NForm>
      <template #footer><div class="flex justify-end gap-2"><NButton :disabled="saving" @click="showTemplate = false">Cancelar</NButton><NButton type="primary" :loading="saving" @click="saveTemplate">Salvar e aplicar</NButton></div></template>
    </NModal>
    <NModal :show="!!versionTemplate" preset="card" title="Histórico do template" style="width:min(720px,94vw)" @update:show="(show) => { if (!show) versionTemplate = null }">
      <NEmpty v-if="!versions.length" description="Nenhuma versão registrada." />
      <div v-else class="space-y-2"><div v-for="version in versions" :key="version.id" class="na-item flex items-center justify-between gap-3 rounded-lg border border-gray-800 p-3"><div><div class="text-sm font-medium text-white">Versão {{ version.version }}</div><div class="text-xs text-gray-400">{{ new Date(version.createdAt).toLocaleString() }} · {{ version.rules.length }} regras</div></div><NButton size="small" :disabled="saving" @click="restoreVersion(version.version)">Restaurar</NButton></div></div>
    </NModal>
  </div>
</template>
