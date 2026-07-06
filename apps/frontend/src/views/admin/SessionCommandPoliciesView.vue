<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import type { GroupPublic, HostPublic, UserPublic } from '@nodeaccess/shared'
import { groupService } from '@/services/group.service'
import { hostService } from '@/services/host.service'
import { userService } from '@/services/user.service'
import {
  sessionCommandPolicyService,
  type CreateSessionCommandPolicyBindingDto,
  type CreateSessionCommandPolicyRuleDto,
  type EvaluateSessionCommandPolicyResponse,
  type SessionCommandPolicyBinding,
  type SessionCommandPolicyBindingTargetType,
  type SessionCommandPolicyGroup,
  type SessionCommandPolicyRule,
  type SessionCommandPolicyRuleAction,
  type SessionCommandPolicyRuleType,
} from '@/services/session-command-policy.service'

const message = useMessage()
const dialog = useDialog()

const policies = ref<SessionCommandPolicyGroup[]>([])
const selectedPolicyId = ref<number | null>(null)
const rules = ref<SessionCommandPolicyRule[]>([])
const bindings = ref<SessionCommandPolicyBinding[]>([])
const users = ref<UserPublic[]>([])
const groups = ref<GroupPublic[]>([])
const hosts = ref<HostPublic[]>([])

const loading = ref(false)
const detailsLoading = ref(false)
const savingPolicy = ref(false)
const savingRule = ref(false)
const savingBinding = ref(false)
const error = ref<string | null>(null)
const showHelp = ref(false)
const simulatorCommand = ref('')
const effectiveSimulatorCommand = ref('')
const effectiveSimulatorUserId = ref<number | null>(null)
const effectiveSimulatorHostId = ref<number | null>(null)
const effectiveSimulatorLoading = ref(false)
const effectiveSimulatorError = ref<string | null>(null)
const effectiveSimulatorResult = ref<EvaluateSessionCommandPolicyResponse | null>(null)

const policyForm = ref({
  name: '',
  description: '',
  enabled: true,
  priority: 100,
  defaultAction: 'allow' as 'allow' | 'block',
})

const ruleForm = ref<CreateSessionCommandPolicyRuleDto>({
  type: 'contains',
  pattern: '',
  action: 'block',
  message: 'Comando bloqueado pela política do NodeAccess.',
  priority: 100,
  enabled: true,
})

const bindingForm = ref<CreateSessionCommandPolicyBindingDto>({
  targetType: 'global',
  targetId: null,
})

const selectedPolicy = computed(() =>
  policies.value.find((policy) => policy.id === selectedPolicyId.value) ?? null,
)

const activeRulesCount = computed(() => rules.value.filter((rule) => rule.enabled).length)
const blockedRulesCount = computed(() => rules.value.filter((rule) => rule.enabled && rule.action === 'block').length)
const allowRulesCount = computed(() => rules.value.filter((rule) => rule.enabled && rule.action === 'allow').length)
const globalBindingsCount = computed(() => bindings.value.filter((binding) => binding.targetType === 'global').length)
const hasEffectiveBinding = computed(() => bindings.value.length > 0)
const selectedPolicyStatusType = computed(() => {
  if (!selectedPolicy.value?.enabled) return 'default'
  if (!hasEffectiveBinding.value) return 'warning'
  if (selectedPolicy.value.defaultAction === 'block') return 'error'
  return 'success'
})
const simulatorResult = computed(() => {
  const policy = selectedPolicy.value
  const command = simulatorCommand.value.trim()
  if (!policy || !command) return null

  const sortedRules = [...rules.value]
    .filter((rule) => rule.enabled)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      if (a.action === b.action) return 0
      return a.action === 'block' ? -1 : 1
    })

  const matchedRule = sortedRules.find((rule) => commandMatchesRule(command, rule))
  const action = matchedRule?.action ?? policy.defaultAction

  return {
    action,
    matchedRule,
    source: matchedRule ? 'rule' : 'default',
    message: matchedRule?.message ?? (action === 'block'
      ? 'Comando seria bloqueado pela ação padrão do grupo.'
      : 'Comando seria permitido pela ação padrão do grupo.'),
  }
})

const defaultActionOptions: SelectOption[] = [
  { label: 'Permitir quando nenhuma regra casar', value: 'allow' },
  { label: 'Bloquear quando nenhuma regra casar', value: 'block' },
]

const ruleTypeOptions: SelectOption[] = [
  { label: 'Contém', value: 'contains' },
  { label: 'Prefixo', value: 'prefix' },
  { label: 'Exato', value: 'exact' },
  { label: 'Regex', value: 'regex' },
]

const ruleActionOptions: SelectOption[] = [
  { label: 'Bloquear', value: 'block' },
  { label: 'Permitir', value: 'allow' },
]

const bindingTargetOptions: SelectOption[] = [
  { label: 'Todos os acessos', value: 'global' },
  { label: 'Usuário', value: 'user' },
  { label: 'Grupo de usuários', value: 'user_group' },
  { label: 'Host', value: 'host' },
  { label: 'Grupo de hosts', value: 'host_group' },
]

const helpQuickItems = ['group', 'rules', 'bindings'] as const
const helpDecisionItems = ['scope', 'priority', 'ruleOrder', 'defaultAction'] as const
const helpRuleTypes: SessionCommandPolicyRuleType[] = ['contains', 'prefix', 'exact', 'regex']
const helpTargets: SessionCommandPolicyBindingTargetType[] = ['global', 'user', 'user_group', 'host', 'host_group']
const helpActions: SessionCommandPolicyRuleAction[] = ['block', 'allow']

const helpQuickText = {
  group: {
    title: '1. Crie um grupo',
    description: 'Agrupe regras relacionadas e defina prioridade, status e ação padrão.',
  },
  rules: {
    title: '2. Adicione regras',
    description: 'Cadastre padrões de comando e escolha se cada regra bloqueia ou permite.',
  },
  bindings: {
    title: '3. Aplique vínculos',
    description: 'Vincule o grupo a todos os acessos, usuários, grupos, hosts ou grupos de hosts.',
  },
}

const helpDecisionText = {
  scope: {
    title: 'Vínculo',
    description: 'Define onde o grupo será avaliado. Sem vínculo, o grupo não participa da decisão.',
  },
  priority: {
    title: 'Prioridade do grupo',
    description: 'Ajuda a ordenar grupos aplicáveis. Número maior tem precedência.',
  },
  ruleOrder: {
    title: 'Prioridade da regra',
    description: 'Dentro do grupo, regras com número maior são avaliadas antes das demais.',
  },
  defaultAction: {
    title: 'Ação padrão',
    description: 'Resultado usado quando nenhuma regra ativa casar. Em múltiplos vínculos, vale o grupo aplicável de maior prioridade.',
  },
}

const targetOptions = computed<SelectOption[]>(() => {
  switch (bindingForm.value.targetType) {
    case 'user':
      return users.value.map((user) => ({ label: `${user.name} (${user.email})`, value: user.id }))
    case 'user_group':
    case 'host_group':
      return groups.value.map((group) => ({ label: group.name, value: group.id }))
    case 'host':
      return hosts.value.map((host) => ({ label: `${host.name} (${host.ip})`, value: host.id }))
    default:
      return []
  }
})

const effectiveUserOptions = computed<SelectOption[]>(() =>
  users.value.map((user) => ({ label: `${user.name} (${user.email})`, value: user.id })),
)

const effectiveHostOptions = computed<SelectOption[]>(() =>
  hosts.value.map((host) => ({ label: `${host.name} (${host.ip})`, value: host.id })),
)

const requiresTarget = computed(() => bindingForm.value.targetType !== 'global')
const canRunEffectiveSimulation = computed(() =>
  Boolean(effectiveSimulatorCommand.value.trim() && effectiveSimulatorUserId.value && effectiveSimulatorHostId.value),
)

const policyColumns = computed<DataTableColumns<SessionCommandPolicyGroup>>(() => [
  {
    title: 'Grupo',
    key: 'name',
    minWidth: 220,
    render: (row) => h(NSpace, { vertical: true, size: 2 }, () => [
      h(NText, { strong: true }, () => row.name),
      row.description ? h(NText, { depth: 3, class: 'text-xs' }, () => row.description) : null,
    ]),
  },
  {
    title: 'Status',
    key: 'enabled',
    width: 120,
    render: (row) => h(NTag, { size: 'small', type: row.enabled ? 'success' : 'default' }, () =>
      row.enabled ? 'Ativo' : 'Inativo',
    ),
  },
  { title: 'Prioridade', key: 'priority', width: 110 },
  {
    title: 'Padrão',
    key: 'defaultAction',
    width: 130,
    render: (row) => actionTag(row.defaultAction),
  },
  {
    title: 'Ações',
    key: 'actions',
    width: 190,
    render: (row) => h(NSpace, {}, () => [
      h(NButton, { size: 'small', onClick: () => selectPolicy(row.id) }, () => 'Editar'),
      h(NButton, { size: 'small', type: 'error', onClick: () => confirmDeletePolicy(row) }, () => 'Excluir'),
    ]),
  },
])

const ruleColumns = computed<DataTableColumns<SessionCommandPolicyRule>>(() => [
  {
    title: 'Regra',
    key: 'pattern',
    minWidth: 260,
    render: (row) => h(NSpace, { vertical: true, size: 2 }, () => [
      h(NSpace, { size: 6 }, () => [
        h(NTag, { size: 'small' }, () => ruleTypeLabel(row.type)),
        actionTag(row.action),
        h(NTag, { size: 'small', type: row.enabled ? 'success' : 'default' }, () => row.enabled ? 'Ativa' : 'Inativa'),
      ]),
      h('code', { class: 'policy-code' }, row.pattern),
      row.message ? h(NText, { depth: 3, class: 'text-xs' }, () => row.message) : null,
    ]),
  },
  { title: 'Prioridade', key: 'priority', width: 110 },
  {
    title: 'Ações',
    key: 'actions',
    width: 120,
    render: (row) => h(NButton, { size: 'small', type: 'error', onClick: () => confirmDeleteRule(row) }, () => 'Excluir'),
  },
])

const bindingColumns = computed<DataTableColumns<SessionCommandPolicyBinding>>(() => [
  {
    title: 'Vínculo',
    key: 'target',
    minWidth: 260,
    render: (row) => h(NSpace, { vertical: true, size: 2 }, () => [
      h(NTag, { size: 'small', type: row.targetType === 'global' ? 'info' : 'default' }, () => bindingTargetLabel(row.targetType)),
      h(NText, { depth: 3, class: 'text-xs' }, () => targetLabel(row)),
    ]),
  },
  {
    title: 'Ações',
    key: 'actions',
    width: 120,
    render: (row) => h(NButton, { size: 'small', type: 'error', onClick: () => confirmDeleteBinding(row) }, () => 'Excluir'),
  },
])

watch(() => bindingForm.value.targetType, () => {
  bindingForm.value.targetId = null
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const [policyRes, userRes, groupRes, hostRes] = await Promise.all([
      sessionCommandPolicyService.list(),
      userService.list({ limit: 200 }),
      groupService.list(),
      hostService.list({ limit: 300 }),
    ])
    policies.value = policyRes.data
    users.value = userRes.data.data
    groups.value = groupRes.data
    hosts.value = hostRes.data.data
    if (!selectedPolicyId.value && policies.value.length > 0) {
      selectedPolicyId.value = policies.value[0].id
    }
    syncPolicyForm()
    await loadDetails()
  } catch {
    error.value = 'Não foi possível carregar as políticas de bloqueio.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function resetPolicyForm() {
  selectedPolicyId.value = null
  policyForm.value = {
    name: '',
    description: '',
    enabled: true,
    priority: 100,
    defaultAction: 'allow',
  }
  rules.value = []
  bindings.value = []
}

function selectPolicy(policyId: number) {
  selectedPolicyId.value = policyId
  syncPolicyForm()
  void loadDetails()
}

function syncPolicyForm() {
  if (!selectedPolicy.value) return
  policyForm.value = {
    name: selectedPolicy.value.name,
    description: selectedPolicy.value.description ?? '',
    enabled: selectedPolicy.value.enabled,
    priority: selectedPolicy.value.priority,
    defaultAction: selectedPolicy.value.defaultAction,
  }
}

async function savePolicy() {
  if (!policyForm.value.name.trim()) {
    message.warning('Informe um nome para o grupo.')
    return
  }
  savingPolicy.value = true
  try {
    const payload = {
      name: policyForm.value.name.trim(),
      description: policyForm.value.description.trim() || null,
      enabled: policyForm.value.enabled,
      priority: policyForm.value.priority,
      defaultAction: policyForm.value.defaultAction,
    }
    if (selectedPolicy.value) {
      const { data } = await sessionCommandPolicyService.update(selectedPolicy.value.id, payload)
      policies.value = policies.value.map((policy) => policy.id === data.id ? data : policy)
      message.success('Grupo atualizado.')
    } else {
      const { data } = await sessionCommandPolicyService.create(payload)
      policies.value = [data, ...policies.value]
      selectedPolicyId.value = data.id
      syncPolicyForm()
      message.success('Grupo criado.')
    }
  } catch (err: unknown) {
    message.error(errorMessage(err, 'Não foi possível salvar o grupo.'))
  } finally {
    savingPolicy.value = false
  }
}

async function loadDetails() {
  if (!selectedPolicyId.value) return
  detailsLoading.value = true
  try {
    const [rulesRes, bindingsRes] = await Promise.all([
      sessionCommandPolicyService.listRules(selectedPolicyId.value),
      sessionCommandPolicyService.listBindings(selectedPolicyId.value),
    ])
    rules.value = rulesRes.data
    bindings.value = bindingsRes.data
  } catch {
    message.error('Não foi possível carregar regras e vínculos.')
  } finally {
    detailsLoading.value = false
  }
}

async function addRule() {
  if (!selectedPolicy.value) return
  if (!ruleForm.value.pattern.trim()) {
    message.warning('Informe o padrão da regra.')
    return
  }
  savingRule.value = true
  try {
    const { data } = await sessionCommandPolicyService.createRule(selectedPolicy.value.id, {
      ...ruleForm.value,
      pattern: ruleForm.value.pattern.trim(),
      message: ruleForm.value.message?.trim() || null,
    })
    rules.value = [...rules.value, data].sort((a, b) => b.priority - a.priority)
    ruleForm.value.pattern = ''
    message.success('Regra adicionada.')
  } catch (err: unknown) {
    message.error(errorMessage(err, 'Não foi possível adicionar a regra.'))
  } finally {
    savingRule.value = false
  }
}

async function addBinding() {
  if (!selectedPolicy.value) return
  if (requiresTarget.value && !bindingForm.value.targetId) {
    message.warning('Selecione o destino do vínculo.')
    return
  }
  savingBinding.value = true
  try {
    const { data } = await sessionCommandPolicyService.createBinding(selectedPolicy.value.id, {
      targetType: bindingForm.value.targetType,
      targetId: bindingForm.value.targetType === 'global' ? null : bindingForm.value.targetId,
    })
    bindings.value = [...bindings.value, data]
    bindingForm.value = { targetType: 'global', targetId: null }
    message.success('Vínculo adicionado.')
  } catch (err: unknown) {
    message.error(errorMessage(err, 'Não foi possível adicionar o vínculo.'))
  } finally {
    savingBinding.value = false
  }
}

async function runEffectiveSimulation() {
  if (!canRunEffectiveSimulation.value || !effectiveSimulatorUserId.value || !effectiveSimulatorHostId.value) return

  effectiveSimulatorLoading.value = true
  effectiveSimulatorError.value = null
  try {
    const { data } = await sessionCommandPolicyService.evaluate({
      command: effectiveSimulatorCommand.value.trim(),
      userId: effectiveSimulatorUserId.value,
      hostId: effectiveSimulatorHostId.value,
    })
    effectiveSimulatorResult.value = data
  } catch (err: unknown) {
    effectiveSimulatorResult.value = null
    effectiveSimulatorError.value = errorMessage(err, 'Não foi possível simular a política efetiva.')
  } finally {
    effectiveSimulatorLoading.value = false
  }
}

function confirmDeletePolicy(policy: SessionCommandPolicyGroup) {
  dialog.warning({
    title: `Excluir ${policy.name}?`,
    content: 'As regras e vínculos deste grupo também serão removidos.',
    positiveText: 'Excluir',
    negativeText: 'Cancelar',
    onPositiveClick: async () => {
      try {
        await sessionCommandPolicyService.delete(policy.id)
        policies.value = policies.value.filter((item) => item.id !== policy.id)
        if (selectedPolicyId.value === policy.id) resetPolicyForm()
        message.success('Grupo excluído.')
      } catch (err: unknown) {
        message.error(errorMessage(err, 'Não foi possível excluir o grupo.'))
      }
    },
  })
}

function confirmDeleteRule(rule: SessionCommandPolicyRule) {
  if (!selectedPolicy.value) return
  dialog.warning({
    title: 'Excluir regra?',
    content: rule.pattern,
    positiveText: 'Excluir',
    negativeText: 'Cancelar',
    onPositiveClick: async () => {
      try {
        await sessionCommandPolicyService.deleteRule(selectedPolicy.value!.id, rule.id)
        rules.value = rules.value.filter((item) => item.id !== rule.id)
        message.success('Regra excluída.')
      } catch (err: unknown) {
        message.error(errorMessage(err, 'Não foi possível excluir a regra.'))
      }
    },
  })
}

function confirmDeleteBinding(binding: SessionCommandPolicyBinding) {
  if (!selectedPolicy.value) return
  dialog.warning({
    title: 'Excluir vínculo?',
    content: targetLabel(binding),
    positiveText: 'Excluir',
    negativeText: 'Cancelar',
    onPositiveClick: async () => {
      try {
        await sessionCommandPolicyService.deleteBinding(selectedPolicy.value!.id, binding.id)
        bindings.value = bindings.value.filter((item) => item.id !== binding.id)
        message.success('Vínculo excluído.')
      } catch (err: unknown) {
        message.error(errorMessage(err, 'Não foi possível excluir o vínculo.'))
      }
    },
  })
}

function actionTag(action: SessionCommandPolicyRuleAction) {
  return h(NTag, { size: 'small', type: action === 'block' ? 'error' : 'success' }, () =>
    action === 'block' ? 'Bloquear' : 'Permitir',
  )
}

function actionHelpText(action: SessionCommandPolicyRuleAction) {
  return action === 'block'
    ? 'Interrompe o comando quando o padrão da regra casar.'
    : 'Permite exceções explícitas dentro de uma política mais restritiva.'
}

function ruleTypeLabel(type: SessionCommandPolicyRuleType) {
  const labels: Record<SessionCommandPolicyRuleType, string> = {
    contains: 'Contém',
    prefix: 'Prefixo',
    exact: 'Exato',
    regex: 'Regex',
  }
  return labels[type]
}

function ruleTypeHelpText(type: SessionCommandPolicyRuleType) {
  const labels: Record<SessionCommandPolicyRuleType, string> = {
    contains: 'Casa quando o comando contém o texto informado.',
    prefix: 'Casa quando o comando começa com o padrão informado.',
    exact: 'Casa apenas quando o comando é igual ao padrão.',
    regex: 'Usa expressão regular. Reserve para regras que exigem mais precisão.',
  }
  return labels[type]
}

function commandMatchesRule(command: string, rule: Pick<SessionCommandPolicyRule, 'type' | 'pattern'>) {
  const pattern = rule.pattern.trim()
  if (!pattern) return false
  if (rule.type === 'exact') return command === pattern
  if (rule.type === 'prefix') return command.startsWith(pattern)
  if (rule.type === 'contains') return command.includes(pattern)
  try {
    return new RegExp(pattern, 'i').test(command)
  } catch {
    return false
  }
}

function bindingTargetLabel(type: SessionCommandPolicyBindingTargetType) {
  const labels: Record<SessionCommandPolicyBindingTargetType, string> = {
    global: 'Todos os acessos',
    user: 'Usuário',
    user_group: 'Grupo de usuários',
    host: 'Host',
    host_group: 'Grupo de hosts',
  }
  return labels[type]
}

function bindingTargetHelpText(type: SessionCommandPolicyBindingTargetType) {
  const labels: Record<SessionCommandPolicyBindingTargetType, string> = {
    global: 'Aplica a política para qualquer usuário e host.',
    user: 'Aplica somente ao usuário selecionado.',
    user_group: 'Aplica aos usuários que pertencem ao grupo selecionado.',
    host: 'Aplica somente ao host selecionado.',
    host_group: 'Aplica aos hosts do grupo selecionado.',
  }
  return labels[type]
}

function targetLabel(binding: SessionCommandPolicyBinding) {
  if (binding.targetType === 'global') return 'Aplica para todos os usuários e hosts'
  if (!binding.targetId) return 'Destino não informado'
  if (binding.targetType === 'user') {
    const user = users.value.find((item) => item.id === binding.targetId)
    return user ? `${user.name} (${user.email})` : `Usuário #${binding.targetId}`
  }
  if (binding.targetType === 'host') {
    const host = hosts.value.find((item) => item.id === binding.targetId)
    return host ? `${host.name} (${host.ip})` : `Host #${binding.targetId}`
  }
  const group = groups.value.find((item) => item.id === binding.targetId)
  return group ? group.name : `Grupo #${binding.targetId}`
}

function errorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { message?: string } } }
  return e.response?.data?.message ?? fallback
}
</script>

<template>
  <div class="p-6 session-command-policies">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-white">Bloqueio de comandos SSH</h1>
        <NText depth="3" class="text-sm">
          Crie grupos de regras e aplique por usuário, grupo, host ou grupo de hosts.
        </NText>
      </div>
      <NSpace align="center">
        <NButton size="small" secondary @click="showHelp = true">Ajuda</NButton>
        <NButton @click="resetPolicyForm">Novo grupo</NButton>
      </NSpace>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <div class="policy-layout">
      <NCard :bordered="false" class="policy-card">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span>Grupos de bloqueio</span>
            <NButton size="small" :loading="loading" @click="load">Atualizar</NButton>
          </div>
        </template>
        <NDataTable
          :columns="policyColumns"
          :data="policies"
          :loading="loading"
          :row-key="(row) => row.id"
          size="small"
          :pagination="{ pageSize: 8 }"
          @row-click="(row) => selectPolicy(row.id)"
        />
      </NCard>

      <div class="policy-side">
        <NCard v-if="selectedPolicy" :bordered="false" class="policy-card">
          <div class="policy-summary">
            <div>
              <NText strong class="block text-sm">{{ selectedPolicy.name }}</NText>
              <NText depth="3" class="block text-xs">
                Resumo efetivo do grupo selecionado.
              </NText>
            </div>
            <div class="policy-summary-tags">
              <NTag size="small" :type="selectedPolicyStatusType">
                {{ selectedPolicy.enabled ? 'Ativo' : 'Inativo' }}
              </NTag>
              <NTag size="small" :type="selectedPolicy.defaultAction === 'block' ? 'error' : 'success'">
                Padrão: {{ selectedPolicy.defaultAction === 'block' ? 'Bloquear' : 'Permitir' }}
              </NTag>
              <NTag size="small">Prioridade {{ selectedPolicy.priority }}</NTag>
              <NTag size="small" :type="hasEffectiveBinding ? 'info' : 'warning'">
                {{ bindings.length }} vínculo(s)
              </NTag>
              <NTag size="small" type="error">{{ blockedRulesCount }} bloqueio(s)</NTag>
              <NTag size="small" type="success">{{ allowRulesCount }} permissão(ões)</NTag>
            </div>
          </div>
          <NAlert
            v-if="selectedPolicy.enabled && !hasEffectiveBinding"
            class="mt-3"
            type="warning"
            title="Este grupo ainda não está aplicado"
          >
            Adicione pelo menos um vínculo para que as regras participem da decisão no terminal.
          </NAlert>
          <NAlert
            v-else-if="selectedPolicy.enabled && selectedPolicy.defaultAction === 'block'"
            class="mt-3"
            type="warning"
            title="Ação padrão bloqueante no grupo"
          >
            Comandos sem regra correspondente serão bloqueados quando este for o grupo aplicável de maior prioridade.
          </NAlert>
        </NCard>

        <NCard v-if="selectedPolicy" :bordered="false" class="policy-card">
          <template #header>Simular comando</template>
          <NText depth="3" class="block text-xs mb-3">
            Teste o comportamento deste grupo antes de aplicar em produção. A simulação usa as regras carregadas abaixo.
          </NText>
          <NInput
            v-model:value="simulatorCommand"
            placeholder="Ex.: rm -rf /tmp/teste"
            clearable
            style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"
          />
          <div v-if="simulatorResult" class="policy-simulator-result">
            <div class="flex flex-wrap items-center gap-2">
              <NTag :type="simulatorResult.action === 'block' ? 'error' : 'success'" size="small">
                {{ simulatorResult.action === 'block' ? 'Bloqueado' : 'Permitido' }}
              </NTag>
              <NTag size="small" :type="simulatorResult.source === 'rule' ? 'info' : 'default'">
                {{ simulatorResult.source === 'rule' ? 'Regra correspondente' : 'Ação padrão' }}
              </NTag>
              <NText depth="3" class="text-xs">
                {{ simulatorResult.message }}
              </NText>
            </div>
            <div v-if="simulatorResult.matchedRule" class="mt-2">
              <code class="policy-code">{{ simulatorResult.matchedRule.pattern }}</code>
              <NText depth="3" class="ml-2 text-xs">
                {{ ruleTypeLabel(simulatorResult.matchedRule.type) }} · prioridade {{ simulatorResult.matchedRule.priority }}
              </NText>
            </div>
          </div>
          <NAlert v-else class="mt-3" type="info" title="Digite um comando para simular" />
        </NCard>

        <NCard :bordered="false" class="policy-card">
          <template #header>Simulação efetiva</template>
          <NText depth="3" class="block text-xs mb-3">
            Avalia o comando para um usuário e host usando as mesmas regras efetivas aplicadas no terminal.
          </NText>
          <NAlert class="mb-4" type="info" title="Resultado do runtime atual">
            Esta simulação considera regras e ação padrão vinculadas ao usuário, grupo, host ou todos os acessos.
          </NAlert>
          <NForm label-placement="top">
            <div class="form-grid form-grid-effective">
              <NFormItem label="Usuário">
                <NSelect
                  v-model:value="effectiveSimulatorUserId"
                  :options="effectiveUserOptions"
                  filterable
                  clearable
                  placeholder="Selecione o usuário"
                />
              </NFormItem>
              <NFormItem label="Host">
                <NSelect
                  v-model:value="effectiveSimulatorHostId"
                  :options="effectiveHostOptions"
                  filterable
                  clearable
                  placeholder="Selecione o host"
                />
              </NFormItem>
            </div>
            <NFormItem label="Comando">
              <NInput
                v-model:value="effectiveSimulatorCommand"
                placeholder="Ex.: systemctl restart nginx"
                clearable
                style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;"
                @keyup.enter="runEffectiveSimulation"
              />
            </NFormItem>
            <NSpace justify="end" class="mb-4">
              <NButton
                type="primary"
                :disabled="!canRunEffectiveSimulation"
                :loading="effectiveSimulatorLoading"
                @click="runEffectiveSimulation"
              >
                Simular efetivo
              </NButton>
            </NSpace>
          </NForm>
          <NAlert v-if="effectiveSimulatorError" class="mb-3" type="error" :title="effectiveSimulatorError" />
          <div v-if="effectiveSimulatorResult" class="policy-simulator-result">
            <div class="flex flex-wrap items-center gap-2">
              <NTag :type="effectiveSimulatorResult.action === 'block' ? 'error' : 'success'" size="small">
                {{ effectiveSimulatorResult.action === 'block' ? 'Bloqueado' : 'Permitido' }}
              </NTag>
              <NTag size="small" :type="effectiveSimulatorResult.source === 'rule' ? 'info' : 'default'">
                {{ effectiveSimulatorResult.source === 'rule' ? 'Regra correspondente' : 'Ação padrão efetiva' }}
              </NTag>
              <NTag v-if="effectiveSimulatorResult.source !== 'rule'" size="small" :type="effectiveSimulatorResult.defaultAction === 'block' ? 'error' : 'success'">
                Padrão: {{ effectiveSimulatorResult.defaultAction === 'block' ? 'Bloquear' : 'Permitir' }}
              </NTag>
              <NTag size="small">{{ effectiveSimulatorResult.rulesEvaluated }} regra(s) avaliada(s)</NTag>
              <NText v-if="effectiveSimulatorResult.message" depth="3" class="text-xs">
                {{ effectiveSimulatorResult.message }}
              </NText>
            </div>
            <div v-if="effectiveSimulatorResult.matchedRule" class="mt-2">
              <code class="policy-code">{{ effectiveSimulatorResult.matchedRule.pattern }}</code>
              <NText depth="3" class="ml-2 text-xs">
                {{ ruleTypeLabel(effectiveSimulatorResult.matchedRule.type) }} · prioridade {{ effectiveSimulatorResult.matchedRule.priority }}
              </NText>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="policy-card">
          <template #header>{{ selectedPolicy ? 'Editar grupo' : 'Novo grupo' }}</template>
          <NForm label-placement="top">
            <div class="form-grid">
              <NFormItem label="Nome">
                <NInput v-model:value="policyForm.name" placeholder="Ex.: Bloqueios de produção" />
              </NFormItem>
              <NFormItem label="Prioridade">
                <NInputNumber v-model:value="policyForm.priority" :min="0" class="w-full" />
                <template #feedback>
                  <span class="text-xs text-gray-500">Número maior tem precedência.</span>
                </template>
              </NFormItem>
            </div>
            <NFormItem label="Descrição">
              <NInput v-model:value="policyForm.description" type="textarea" placeholder="Contexto operacional deste grupo" />
            </NFormItem>
            <div class="form-grid">
              <NFormItem label="Ação padrão">
                <NSelect v-model:value="policyForm.defaultAction" :options="defaultActionOptions" />
              </NFormItem>
              <NFormItem label="Status">
                <NSpace align="center">
                  <NSwitch v-model:value="policyForm.enabled" />
                  <NText>{{ policyForm.enabled ? 'Ativo' : 'Inativo' }}</NText>
                </NSpace>
              </NFormItem>
            </div>
            <NAlert
              v-if="policyForm.defaultAction === 'block'"
              class="mb-4"
              type="warning"
              title="Bloqueio padrão exige cuidado"
            >
              Se o grupo estiver ativo e vinculado, qualquer comando sem regra correspondente será bloqueado.
            </NAlert>
            <NSpace justify="end">
              <NButton type="primary" :loading="savingPolicy" @click="savePolicy">
                {{ selectedPolicy ? 'Salvar grupo' : 'Criar grupo' }}
              </NButton>
            </NSpace>
          </NForm>
        </NCard>

        <NCard :bordered="false" class="policy-card">
          <template #header>Regras</template>
          <NAlert v-if="!selectedPolicy" type="info" class="mb-4" title="Crie ou selecione um grupo para adicionar regras." />
          <template v-else>
            <NForm label-placement="top">
              <div class="form-grid form-grid-rule">
                <NFormItem label="Tipo">
                  <NSelect v-model:value="ruleForm.type" :options="ruleTypeOptions" />
                </NFormItem>
                <NFormItem label="Ação">
                  <NSelect v-model:value="ruleForm.action" :options="ruleActionOptions" />
                </NFormItem>
                <NFormItem label="Prioridade">
                  <NInputNumber v-model:value="ruleForm.priority" :min="0" class="w-full" />
                  <template #feedback>
                    <span class="text-xs text-gray-500">Número maior é avaliado primeiro.</span>
                  </template>
                </NFormItem>
              </div>
              <NFormItem label="Padrão">
                <NInput v-model:value="ruleForm.pattern" placeholder="Ex.: rm -rf, shutdown, ^sudo\\s+su" />
              </NFormItem>
              <NFormItem label="Mensagem exibida">
                <NInput v-model:value="ruleForm.message" placeholder="Mensagem opcional para o terminal" />
              </NFormItem>
              <NSpace justify="space-between" align="center" class="mb-4">
                <NSpace align="center">
                  <NSwitch v-model:value="ruleForm.enabled" />
                  <NText>{{ ruleForm.enabled ? 'Regra ativa' : 'Regra inativa' }}</NText>
                </NSpace>
                <NButton type="primary" :loading="savingRule" @click="addRule">Adicionar regra</NButton>
              </NSpace>
            </NForm>
            <NAlert
              v-if="rules.length > 0 && activeRulesCount === 0"
              class="mb-4"
              type="warning"
              title="Nenhuma regra ativa"
            >
              O grupo está sem regras ativas. A decisão dependerá apenas da ação padrão quando este grupo for aplicável.
            </NAlert>
            <NDataTable
              :columns="ruleColumns"
              :data="rules"
              :loading="detailsLoading"
              :row-key="(row) => row.id"
              size="small"
              :pagination="{ pageSize: 5 }"
            />
          </template>
        </NCard>

        <NCard :bordered="false" class="policy-card">
          <template #header>Vínculos</template>
          <NAlert v-if="!selectedPolicy" type="info" class="mb-4" title="Crie ou selecione um grupo para adicionar vínculos." />
          <template v-else>
            <NAlert
              v-if="bindings.length === 0"
              class="mb-4"
              type="warning"
              title="Sem vínculo, sem efeito"
            >
              Este grupo só será avaliado depois de ser aplicado a todos os acessos, usuário, grupo ou host.
            </NAlert>
            <NAlert
              v-else-if="globalBindingsCount > 0"
              class="mb-4"
              type="info"
              title="Aplicação global"
            >
              Há vínculo global ativo neste grupo. As regras podem afetar todos os usuários e hosts do tenant.
            </NAlert>
            <NForm label-placement="top">
              <div class="form-grid">
                <NFormItem label="Aplicar em">
                  <NSelect v-model:value="bindingForm.targetType" :options="bindingTargetOptions" />
                </NFormItem>
                <NFormItem label="Destino">
                  <NSelect
                    v-model:value="bindingForm.targetId"
                    :options="targetOptions"
                    :disabled="!requiresTarget"
                    filterable
                    clearable
                    placeholder="Selecione o destino"
                  />
                </NFormItem>
              </div>
              <NSpace justify="end" class="mb-4">
                <NButton type="primary" :loading="savingBinding" @click="addBinding">Adicionar vínculo</NButton>
              </NSpace>
            </NForm>
            <NDataTable
              :columns="bindingColumns"
              :data="bindings"
              :loading="detailsLoading"
              :row-key="(row) => row.id"
              size="small"
              :pagination="{ pageSize: 5 }"
            />
          </template>
        </NCard>
      </div>
    </div>

    <NModal v-model:show="showHelp">
      <NCard
        style="width: min(920px, calc(100vw - 32px))"
        title="Ajuda: Bloqueio de comandos SSH"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <div class="max-h-[78vh] overflow-y-auto pr-1">
          <div class="mb-5 rounded border border-white/10 p-4">
            <NText depth="3" class="block text-sm">
              Use esta referência para configurar grupos, regras e vínculos sem bloquear acessos fora do escopo desejado.
            </NText>
            <div class="mt-4 grid gap-3 md:grid-cols-3">
              <div
                v-for="item in helpQuickItems"
                :key="item"
                class="rounded bg-white/5 p-3"
              >
                <NText strong class="block text-sm">{{ helpQuickText[item].title }}</NText>
                <NText depth="3" class="block text-xs mt-1">{{ helpQuickText[item].description }}</NText>
              </div>
            </div>
          </div>

          <div class="grid gap-5 lg:grid-cols-[1fr_1fr]">
            <section>
              <h2 class="text-sm font-semibold text-white mb-3">Como a decisão é aplicada</h2>
              <div class="overflow-hidden rounded border border-white/10">
                <div
                  v-for="item in helpDecisionItems"
                  :key="item"
                  class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[150px_1fr]"
                >
                  <NText strong class="text-sm">{{ helpDecisionText[item].title }}</NText>
                  <NText depth="3" class="text-sm">{{ helpDecisionText[item].description }}</NText>
                </div>
              </div>
            </section>

            <section>
              <h2 class="text-sm font-semibold text-white mb-3">Tipos de regra</h2>
              <div class="space-y-3">
                <div
                  v-for="type in helpRuleTypes"
                  :key="type"
                  class="rounded border border-white/10 p-3"
                >
                  <NTag size="small">{{ ruleTypeLabel(type) }}</NTag>
                  <NText depth="3" class="block text-sm mt-2">{{ ruleTypeHelpText(type) }}</NText>
                </div>
              </div>
            </section>
          </div>

          <div class="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <section>
              <h2 class="text-sm font-semibold text-white mb-3">Ações da regra</h2>
              <div class="space-y-3">
                <div
                  v-for="action in helpActions"
                  :key="action"
                  class="rounded border border-white/10 p-3"
                >
                  <NTag size="small" :type="action === 'block' ? 'error' : 'success'">
                    {{ action === 'block' ? 'Bloquear' : 'Permitir' }}
                  </NTag>
                  <NText depth="3" class="block text-sm mt-2">{{ actionHelpText(action) }}</NText>
                </div>
              </div>
            </section>

            <section>
              <h2 class="text-sm font-semibold text-white mb-3">Vínculos disponíveis</h2>
              <div class="grid gap-3 md:grid-cols-2">
                <div
                  v-for="target in helpTargets"
                  :key="target"
                  class="rounded border border-white/10 p-3"
                >
                  <NTag size="small" :type="target === 'global' ? 'info' : 'default'">
                    {{ bindingTargetLabel(target) }}
                  </NTag>
                  <NText depth="3" class="block text-xs mt-2">{{ bindingTargetHelpText(target) }}</NText>
                </div>
              </div>
            </section>
          </div>

          <NAlert
            class="mt-5"
            type="warning"
            title="Valide regras amplas antes de ativar globalmente"
          >
            Regex e ação padrão “Bloquear” podem afetar muitos acessos. Prefira começar com vínculo específico e prioridade clara.
          </NAlert>
        </div>
      </NCard>
    </NModal>
  </div>
</template>

<style scoped>
.session-command-policies :deep(.n-card) {
  background: var(--na-surface-raised);
  border-color: var(--na-border);
}

.policy-layout {
  display: grid;
  grid-template-columns: minmax(360px, 0.9fr) minmax(0, 1.4fr);
  gap: 16px;
}

.policy-card {
  min-width: 0;
}

.policy-side {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.policy-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.policy-summary-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.policy-simulator-result {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-soft);
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 12px;
}

.form-grid-rule {
  grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) 140px;
}

.form-grid-effective {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.policy-code {
  display: inline-block;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--na-text-strong);
  background: var(--na-surface-code);
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 1180px) {
  .policy-layout,
  .policy-summary,
  .form-grid,
  .form-grid-rule {
    grid-template-columns: 1fr;
  }

  .policy-summary-tags {
    justify-content: flex-start;
  }
}
</style>
