<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NEmpty, NForm,
  NFormItem, NInput, NModal, NPopconfirm, NProgress, NSelect, NSpace, NSpin, NTag, useMessage,
} from 'naive-ui'
import HaHelpTooltip from '@/components/ha/HaHelpTooltip.vue'
import HaTopologyMap from '@/components/ha/HaTopologyMap.vue'
import HaFailurePolicyGuide from '@/components/ha/HaFailurePolicyGuide.vue'
import HaIncidentGuide from '@/components/ha/HaIncidentGuide.vue'
import HaSetupWizard from '@/components/ha/HaSetupWizard.vue'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import { haService, type HaNode, type HaOperation, type HaStatus } from '@/services/ha.service'

const message = useMessage()
const loading = ref(true)
const saving = ref(false)
const entitlementSaving = ref(false)
const roleReconciliationSaving = ref(false)
const licensed = ref(true)
const error = ref<string | null>(null)
const nodes = ref<HaNode[]>([])
const operations = ref<HaOperation[]>([])
const preflightNodeId = ref<string | null>(null)
const switchoverSaving = ref(false)
const switchoverForm = ref({
  witnessEvidenceFile: '',
  witnessSignatureFile: '',
  confirmation: '',
})
const rejoinNodeId = ref<string | null>(null)
const provisioningPlanNodeId = ref<string | null>(null)
const executorNodeId = ref<string | null>(null)
const storageActionNodeId = ref<string | null>(null)
const releaseActionNodeId = ref<string | null>(null)
const releaseNode = ref<HaNode | null>(null)
const releaseForm = ref({ releaseUrl: '', sha256: '' })
const secretsNode = ref<HaNode | null>(null)
const secretsActionNodeId = ref<string | null>(null)
const guidedAction = ref<{ type: 'PROMOTE' | 'REJOIN'; node: HaNode } | null>(null)
const guidedActionOpen = ref(false)
const guidedOperationId = ref('')
const secretFields = [
  ['JWT_SECRET', 'JWT secret compartilhado'],
  ['PEM_ENCRYPTION_KEY', 'Chave de criptografia PEM'],
  ['MYSQL_ROOT_PASSWORD', 'Senha root do MySQL'],
  ['MYSQL_PASSWORD', 'Senha da aplicação no MySQL'],
  ['MYSQL_REPLICATION_PASSWORD', 'Senha de replicação do MySQL'],
  ['REDIS_PASSWORD', 'Senha do Redis'],
] as const
const sharedSecrets = ref<Record<string, string>>(
  Object.fromEntries(secretFields.map(([key]) => [key, ''])),
)
const showAttach = ref(false)
const enrollmentCommand = ref('')
const form = ref<{ name: string; endpoint: string; virtualIp: string; desiredRole: 'PRIMARY' | 'STANDBY' }>({
  name: '',
  endpoint: '',
  virtualIp: '',
  desiredRole: 'STANDBY',
})
const currentAccessEndpoint = window.location.host
const secureTransport = window.location.protocol === 'https:'
let refreshTimer: ReturnType<typeof setInterval> | null = null

const guideSteps = [
  {
    title: '1. Anexar e validar os agentes',
    description: 'Informe a mesma VIP nas duas matrículas, execute cada comando em até 15 minutos e confirme heartbeat e inventário. O agente detecta Docker e Compose, mas não instala a stack completa.',
  },
  {
    title: '2. Preparar estado e replicação',
    description: 'Prepare os diretórios, valide escrita e configure MySQL, Redis e arquivos na direção primário → standby.',
  },
  {
    title: '3. Ensaiar promoção',
    description: 'Execute o preflight. Em uma troca planejada, congele o primário; em falha, faça fencing externo e obtenha a evidência do witness.',
  },
  {
    title: '4. Promover e validar',
    description: 'Execute o script de promoção no standby, confirme banco, Redis, containers e storage, mova o tráfego e rode o pós-failover.',
  },
  {
    title: '5. Retornar o nó antigo',
    description: 'Reingresse o antigo primário como standby somente leitura. Só faça failback depois da paridade de GTID e dos gates de réplica.',
  },
]

const useCases = [
  {
    title: 'Manutenção planejada',
    description: 'Trocar o nó ativo com barreira de escrita, sincronização final e retorno controlado.',
  },
  {
    title: 'Falha do primário',
    description: 'Promover o standby sem split-brain depois de fencing externo e autorização do witness.',
  },
  {
    title: 'Atualização com menor indisponibilidade',
    description: 'Atualizar e validar um nó por vez, mantendo um caminho de retorno explícito.',
  },
  {
    title: 'Recuperação e auditoria',
    description: 'Comprovar backups restauráveis, réplica alinhada e journal das decisões operacionais.',
  },
]

const promotionCandidates = computed(() =>
  nodes.value.filter((node) => node.observedRole !== 'PRIMARY'),
)
const activeNode = computed(() =>
  nodes.value.find((node) => node.observedRole === 'PRIMARY') ?? null,
)
const unhealthyNodes = computed(() =>
  promotionCandidates.value.filter((node) => !node.promotionReady),
)
const activeOperations = computed(() =>
  operations.value.filter((operation) => operation.status === 'RUNNING'),
)
const transitionActive = computed(() =>
  activeOperations.value.length > 0
  || nodes.value.some((node) => node.components.orchestration?.status === 'degraded'),
)
const freshVipOwners = computed(() =>
  nodes.value.filter((node) => node.ownsVip && node.heartbeatState !== 'STALE'),
)
const hasConfirmedSplitBrain = computed(() => freshVipOwners.value.length > 1)
const hasRoleMismatch = computed(() =>
  nodes.value.some((node) =>
    node.observedRole != null && node.observedRole !== node.desiredRole
  ),
)
const canReconcileRoles = computed(() =>
  nodes.value.length === 2
  && nodes.value.every((node) => node.heartbeatState === 'CURRENT')
  && nodes.value.filter((node) => node.observedRole === 'PRIMARY' && node.ownsVip).length === 1
  && nodes.value.filter((node) => node.observedRole === 'STANDBY' && !node.ownsVip).length === 1
  && !transitionActive.value
  && !hasConfirmedSplitBrain.value
)
const overallHealthy = computed(() =>
  promotionCandidates.value.length > 0 && unhealthyNodes.value.length === 0,
)
const haSetupComplete = computed(() =>
  licensed.value
  && nodes.value.length === 2
  && nodes.value.every((node) => node.heartbeatState === 'CURRENT')
  && nodes.value.filter((node) => node.observedRole === 'PRIMARY' && node.ownsVip).length === 1
  && nodes.value.filter((node) => node.observedRole === 'STANDBY' && !node.ownsVip && node.inventory).length === 1
  && nodes.value.every((node) => node.desiredRole === node.observedRole)
)
const nodesWithReadyProvisioningPlan = computed(() => new Set(
  operations.value
    .filter((operation) => operation.type === 'PROVISION_PLAN' && operation.status === 'READY')
    .map((operation) => operation.nodeId),
))
const nodesWithPreparedStorage = computed(() => {
  const latestStorageOperation = new Map<string, HaOperation>()
  const ordered = [...operations.value].sort(
    (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
  )
  for (const operation of ordered) {
    if (latestStorageOperation.has(operation.nodeId)) continue
    if (operation.steps.some((step) => step.key === 'prepare-storage' || step.key === 'rollback-storage')) {
      latestStorageOperation.set(operation.nodeId, operation)
    }
  }
  return new Set(
    [...latestStorageOperation.values()]
      .filter((operation) =>
        operation.status === 'COMPLETED'
        && operation.steps.some((step) => step.key === 'prepare-storage'),
      )
      .map((operation) => operation.nodeId),
  )
})
const releaseFormValid = computed(() =>
  /^https?:\/\/\S+$/i.test(releaseForm.value.releaseUrl.trim())
  && /^[a-fA-F0-9]{64}$/.test(releaseForm.value.sha256.trim()),
)
const sharedSecretsValid = computed(() =>
  secretFields.every(([key]) => /^[A-Za-z0-9_./+=:@%-]{1,240}$/.test(sharedSecrets.value[key] ?? '')),
)
const plannedSwitchoverValid = computed(() =>
  /^[A-Za-z0-9._-]{1,160}$/.test(switchoverForm.value.witnessEvidenceFile)
  && /^[A-Za-z0-9._-]{1,160}$/.test(switchoverForm.value.witnessSignatureFile)
  && switchoverForm.value.confirmation === 'TROCAR',
)
const plannedWitnessPrefix = computed(() => guidedOperationId.value || 'switchover-planejado')
const plannedWitnessIssueCommand = computed(() => {
  if (guidedAction.value?.type !== 'PROMOTE') return ''
  return [
    'sudo nodeaccess-ha-witness-authorize planned',
    shellArg(activeNode.value?.id ?? 'ID_DO_PRIMARY'),
    shellArg(guidedAction.value.node.id),
    shellArg(`/tmp/${plannedWitnessPrefix.value}`),
  ].join(' ')
})
const plannedWitnessCopyCommand = computed(() => {
  if (guidedAction.value?.type !== 'PROMOTE') return ''
  const standbyEndpoint = guidedAction.value.node.endpoint ?? 'IP_DO_STANDBY'
  return [
    `scp /tmp/${plannedWitnessPrefix.value}.txt /tmp/${plannedWitnessPrefix.value}.sig \\`,
    `  root@${standbyEndpoint}:/opt/nodeaccess/shared/ha/witness/`,
  ].join('\n')
})
const shellArg = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const guidedCommand = computed(() => {
  const action = guidedAction.value
  if (!action) return ''
  const node = action.node
  const primary = activeNode.value
  if (action.type === 'REJOIN') {
    return [
      'MODE=apply \\',
      'CONFIRM_REJOIN=true \\',
      `ACTIVE_NODE_IP=${shellArg(primary?.endpoint ?? 'IP_DO_PRIMARY_ATIVO')} \\`,
      `NODE_IP=${shellArg(node.endpoint ?? 'IP_DESTE_NO')} \\`,
      "REPLICATION_ENV='/srv/nodeaccess-shared/mysql/replication.env' \\",
      "FILE_SOURCE_ROOT='/srv/nodeaccess-shared' \\",
      "FILE_REPLICA_ROOT='/srv/nodeaccess-shared' \\",
      'bash /opt/nodeaccess/current/scripts/deploy/prepare-ha-rejoin.sh',
    ].join('\n')
  }
  return [
    'CONFIRM_PROMOTION=true \\',
    `OPERATION_ID=${shellArg(guidedOperationId.value || 'OPERACAO_UNICA')} \\`,
    `PRIMARY_NODE_ID=${shellArg(primary?.id ?? 'ID_PRIMARIO')} \\`,
    `STANDBY_NODE_ID=${shellArg(node.id)} \\`,
    "WITNESS_EVIDENCE_FILE='/caminho/evidencia.txt' \\",
    "WITNESS_SIGNATURE_FILE='/caminho/evidencia.sig' \\",
    "WITNESS_PUBLIC_KEY='/opt/nodeaccess/shared/ha/witness-public.pem' \\",
    `FINAL_SYNC_SOURCE_IP=${shellArg(primary?.endpoint ?? 'IP_PRIMARIO_CONGELADO')} \\`,
    `NODE_IP=${shellArg(node.endpoint ?? 'IP_DESTE_STANDBY')} \\`,
    'APP_TLS_MODE=provided \\',
    'bash /opt/nodeaccess/current/scripts/deploy/promote-ha-standby.sh',
  ].join('\n')
})
const guidedQuiesceCommand = computed(() => {
  if (guidedAction.value?.type !== 'PROMOTE') return ''
  const primary = activeNode.value
  return [
    'MODE=apply \\',
    'CONFIRM_QUIESCE=true \\',
    `OPERATION_ID=${shellArg(guidedOperationId.value || 'OPERACAO_UNICA')} \\`,
    `NODE_IP=${shellArg(primary?.endpoint ?? 'IP_DO_PRIMARIO_ATIVO')} \\`,
    "MARKER_FILE='/opt/nodeaccess/shared/ha/primary-quiesced' \\",
    'bash /opt/nodeaccess/current/scripts/deploy/quiesce-ha-primary.sh',
  ].join('\n')
})

const statusType: Record<HaStatus, 'default' | 'success' | 'warning' | 'error'> = {
  PENDING: 'default',
  HEALTHY: 'success',
  DEGRADED: 'warning',
  OFFLINE: 'error',
}
const statusLabel: Record<HaStatus, string> = {
  PENDING: 'Aguardando agente',
  HEALTHY: 'Saudável',
  DEGRADED: 'Degradado',
  OFFLINE: 'Sem heartbeat',
}
const componentLabel: Record<string, string> = {
  mysql: 'MySQL', redis: 'Redis', files: 'Arquivos', api: 'API',
  frontend: 'Frontend', sshGateway: 'SSH Gateway', guacd: 'guacd',
  keepalived: 'Keepalived', orchestration: 'Orquestração',
  autoFailover: 'Failover automático',
}

onMounted(() => {
  void load()
  refreshTimer = setInterval(() => void load(false), 30_000)
})
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

async function load(showSpinner = true) {
  if (showSpinner) loading.value = true
  error.value = null
  try {
    const [nodesResponse, operationsResponse] = await Promise.all([
      haService.listNodes(),
      haService.listOperations(),
    ])
    nodes.value = nodesResponse.data
    operations.value = operationsResponse.data
    licensed.value = true
  } catch (cause: any) {
    if (cause?.response?.status === 403) licensed.value = false
    else error.value = cause?.response?.data?.message ?? 'Não foi possível consultar a topologia HA.'
  } finally {
    loading.value = false
  }
}

async function reconcileObservedRoles() {
  roleReconciliationSaving.value = true
  try {
    await haService.reconcileObservedRoles()
    await load(false)
    message.success('Papéis configurados alinhados. Aguardando o próximo heartbeat confirmar a saúde.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível reconciliar os papéis HA.')
  } finally {
    roleReconciliationSaving.value = false
  }
}

function scrollToOperations() {
  document.querySelector('#ha-operational-topology')?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

function openGuidedAction(type: 'PROMOTE' | 'REJOIN', node: HaNode) {
  guidedOperationId.value = type === 'PROMOTE'
    ? `switchover-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z')}`
    : ''
  guidedAction.value = { type, node }
  switchoverForm.value = {
    witnessEvidenceFile: `${guidedOperationId.value}.txt`,
    witnessSignatureFile: `${guidedOperationId.value}.sig`,
    confirmation: '',
  }
  guidedActionOpen.value = true
}

function closeGuidedAction() {
  guidedActionOpen.value = false
}

function clearGuidedAction() {
  guidedAction.value = null
}

async function copyGuidedCommand(command: string, successMessage: string) {
  if (!command) return
  try {
    await navigator.clipboard.writeText(command)
    message.success(successMessage)
  } catch {
    message.error('Não foi possível copiar o comando.')
  }
}

async function runPreflight(node: HaNode) {
  preflightNodeId.value = node.id
  try {
    const { data } = await haService.runPreflight(node.id)
    await load(false)
    if (data.status === 'READY') {
      message.success('Preflight aprovado. Fencing ainda será obrigatório antes da promoção.')
    } else {
      message.warning(data.errorMessage ?? 'Preflight bloqueado.')
    }
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível executar o preflight.')
  } finally {
    preflightNodeId.value = null
  }
}

async function startPlannedSwitchover() {
  const action = guidedAction.value
  if (action?.type !== 'PROMOTE' || !plannedSwitchoverValid.value) return
  switchoverSaving.value = true
  try {
    await haService.startPlannedSwitchover(action.node.id, {
      witnessEvidenceFile: switchoverForm.value.witnessEvidenceFile,
      witnessSignatureFile: switchoverForm.value.witnessSignatureFile,
    })
    closeGuidedAction()
    await load(false)
    message.success('Troca planejada iniciada. O painel acompanhará o quiesce e a promoção.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível iniciar a troca planejada.')
  } finally {
    switchoverSaving.value = false
  }
}

async function runRejoinPreflight(node: HaNode) {
  rejoinNodeId.value = node.id
  try {
    const { data } = await haService.runRejoinPreflight(node.id)
    await load(false)
    if (data.status === 'READY') {
      message.success('Nó sincronizado e pronto para o failback controlado.')
    } else {
      message.warning(data.errorMessage ?? 'Retorno bloqueado.')
    }
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível validar o retorno do nó.')
  } finally {
    rejoinNodeId.value = null
  }
}

async function createProvisioningPlan(node: HaNode) {
  provisioningPlanNodeId.value = node.id
  try {
    const { data } = await haService.createProvisioningPlan(node.id)
    await load(false)
    if (data.status === 'READY') {
      message.success('Plano criado. Revise as etapas antes de autorizar qualquer instalação.')
    } else {
      message.warning(data.errorMessage ?? 'O inventário ainda não permite preparar o provisionamento.')
    }
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível avaliar o provisionamento.')
  } finally {
    provisioningPlanNodeId.value = null
  }
}

async function validateAgentExecutor(node: HaNode) {
  executorNodeId.value = node.id
  try {
    await haService.queueInventoryRefresh(node.id)
    await load(false)
    message.success('Ação enfileirada. O agente concluirá a validação no próximo ciclo.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível validar o executor do agente.')
  } finally {
    executorNodeId.value = null
  }
}

function openReleaseProvisioning(node: HaNode) {
  releaseNode.value = node
  releaseForm.value = { releaseUrl: '', sha256: '' }
}

async function installRelease() {
  const node = releaseNode.value
  if (!node || !releaseFormValid.value) return
  releaseActionNodeId.value = node.id
  try {
    await haService.installRelease(node.id, {
      releaseUrl: releaseForm.value.releaseUrl.trim(),
      sha256: releaseForm.value.sha256.trim().toLowerCase(),
    })
    releaseNode.value = null
    await load(false)
    message.success('Instalação enfileirada. O agente validará o checksum antes de promover a release.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível enfileirar a instalação da release.')
  } finally {
    releaseActionNodeId.value = null
  }
}

function openSharedSecretsProvisioning(node: HaNode) {
  secretsNode.value = node
  sharedSecrets.value = Object.fromEntries(secretFields.map(([key]) => [key, '']))
}

async function applySharedSecrets() {
  const node = secretsNode.value
  if (!node || !sharedSecretsValid.value) return
  secretsActionNodeId.value = node.id
  try {
    await haService.applySharedSecrets(node.id, { ...sharedSecrets.value })
    secretsNode.value = null
    sharedSecrets.value = Object.fromEntries(secretFields.map(([key]) => [key, '']))
    await load(false)
    message.success('Envelope cifrado enfileirado. O agente aplicará a configuração no próximo ciclo.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível enfileirar os segredos compartilhados.')
  } finally {
    secretsActionNodeId.value = null
  }
}

async function rollbackSharedSecrets(node: HaNode) {
  secretsActionNodeId.value = node.id
  try {
    await haService.rollbackSharedSecrets(node.id)
    await load(false)
    message.success('Rollback enfileirado. O agente restaurará o último backup local sem reiniciar serviços.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível enfileirar o rollback da configuração.')
  } finally {
    secretsActionNodeId.value = null
  }
}

async function prepareStorageDirectories(node: HaNode) {
  storageActionNodeId.value = node.id
  try {
    await haService.prepareStorageDirectories(node.id)
    await load(false)
    message.success('Preparação enfileirada. O agente atuará somente nos diretórios permitidos do standby.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível preparar os diretórios de dados.')
  } finally {
    storageActionNodeId.value = null
  }
}

async function rollbackStorageDirectories(node: HaNode) {
  storageActionNodeId.value = node.id
  try {
    await haService.rollbackStorageDirectories(node.id)
    await load(false)
    message.success('Rollback enfileirado. Diretórios com arquivos serão preservados.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível reverter a preparação dos diretórios.')
  } finally {
    storageActionNodeId.value = null
  }
}

async function validateStorageWriteAccess(node: HaNode) {
  storageActionNodeId.value = node.id
  try {
    await haService.validateStorageWriteAccess(node.id)
    await load(false)
    message.success('Validação enfileirada. Os probes serão removidos no mesmo ciclo do agente.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível validar a escrita nos diretórios.')
  } finally {
    storageActionNodeId.value = null
  }
}

async function setEntitlement(enabled: boolean) {
  entitlementSaving.value = true
  try {
    await haService.setEntitlement(enabled)
    licensed.value = enabled
    if (enabled) {
      await load()
      message.success('Alta disponibilidade habilitada para este ambiente.')
    } else {
      nodes.value = []
      operations.value = []
      message.success('Alta disponibilidade desabilitada.')
    }
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível alterar a habilitação de alta disponibilidade.')
  } finally {
    entitlementSaving.value = false
  }
}

async function attachNode() {
  if (!form.value.name.trim() || !form.value.virtualIp.trim()) return
  saving.value = true
  try {
    const { data } = await haService.createEnrollment({
      name: form.value.name.trim(),
      endpoint: form.value.endpoint.trim() || undefined,
      desiredRole: form.value.desiredRole,
    })
    const apiUrl = `${window.location.origin}/api/v1`
    const allowHttp = window.location.protocol === 'http:'
      ? 'NODEACCESS_HA_ALLOW_HTTP=true '
      : ''
    enrollmentCommand.value =
      `curl -fsSL '${apiUrl}/ha/agent/install.sh' | sudo ` +
      `${allowHttp}NODEACCESS_HA_ENROLLMENT_TOKEN='${data.token}' bash -s -- ` +
      `--api-url '${apiUrl}' --node-id '${data.id}' ` +
      `--role '${form.value.desiredRole}' --virtual-ip '${form.value.virtualIp.trim()}'`
    showAttach.value = false
    form.value = { name: '', endpoint: '', virtualIp: '', desiredRole: 'STANDBY' }
    await load(false)
    message.success('Matrícula criada. Execute o comando no nó secundário em até 15 minutos.')
  } catch (cause: any) {
    message.error(cause?.response?.data?.message ?? 'Não foi possível criar a matrícula HA.')
  } finally {
    saving.value = false
  }
}

async function copyCommand() {
  await navigator.clipboard.writeText(enrollmentCommand.value)
  message.success('Comando copiado.')
}

async function removeNode(node: HaNode) {
  try {
    await haService.removeNode(node.id)
    await load(false)
    message.success('Nó HA removido.')
  } catch {
    message.error('Não foi possível remover o nó HA.')
  }
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'Nunca'
}

function heartbeatText(node: HaNode) {
  if (node.heartbeatAgeSeconds == null) return 'Nunca recebido'
  if (node.heartbeatAgeSeconds < 10) return 'Agora'
  if (node.heartbeatAgeSeconds < 60) return `Há ${node.heartbeatAgeSeconds}s`
  const minutes = Math.floor(node.heartbeatAgeSeconds / 60)
  return `Há ${minutes} min · ${formatDate(node.lastSeenAt)}`
}

function operationProgress(operation: HaOperation) {
  if (operation.status === 'COMPLETED' || operation.status === 'READY') return 100
  const total = operation.steps.length
  if (total === 0) return operation.status === 'RUNNING' ? 10 : 0
  return Math.round(operation.steps.filter((step) => step.status === 'ok').length / total * 100)
}

function componentText(key: string, component: HaNode['components'][string]) {
  const label = componentLabel[key] ?? key
  const lag = key === 'mysql' && Number.isFinite(component.lagSeconds)
    ? ` · lag ${component.lagSeconds}s`
    : ''
  return `${label}: ${component.status}${lag}`
}

function operationLabel(operation: HaOperation) {
  if (operation.type === 'FAILBACK') return 'Validação de retorno'
  if (operation.type === 'PROVISION_PLAN') return 'Plano de provisionamento'
  if (operation.steps.some((step) => step.key === 'install-release')) return 'Instalação de release'
  if (operation.steps.some((step) => step.key === 'prepare-storage')) return 'Preparação de diretórios'
  if (operation.steps.some((step) => step.key === 'rollback-storage')) return 'Rollback de diretórios'
  if (operation.steps.some((step) => step.key === 'validate-storage-write')) return 'Validação de escrita'
  if (operation.type === 'PROVISIONING') return 'Validação do executor'
  return 'Preflight'
}

function operationStatusType(operation: HaOperation) {
  if (operation.status === 'READY' || operation.status === 'COMPLETED') return 'success'
  if (operation.status === 'RUNNING') return 'info'
  return 'error'
}

function operationStatusLabel(operation: HaOperation) {
  if (operation.status === 'READY' && operation.type === 'PROVISION_PLAN') return 'Plano disponível'
  if (operation.status === 'READY') return 'Pronto'
  if (operation.status === 'RUNNING') return 'Em execução'
  if (operation.status === 'COMPLETED') return 'Concluído'
  if (operation.status === 'FAILED') return 'Falhou'
  return 'Bloqueado'
}
</script>

<template>
  <div class="ha-page">
    <header class="ha-header">
      <div>
        <h1>Alta disponibilidade</h1>
        <p>Topologia, replicação e prontidão para failover.</p>
      </div>
      <NSpace>
        <NPopconfirm v-if="licensed" @positive-click="setEntitlement(false)">
          <template #trigger>
            <NButton secondary :loading="entitlementSaving">Desabilitar HA</NButton>
          </template>
          Desabilitar alta disponibilidade? Esta ação só será aceita quando não houver nós anexados.
        </NPopconfirm>
        <NButton v-if="licensed" type="primary" @click="showAttach = true">Anexar nó</NButton>
        <NButton v-else type="primary" :loading="entitlementSaving" @click="setEntitlement(true)">
          Habilitar alta disponibilidade
        </NButton>
      </NSpace>
    </header>

    <NAlert v-if="!licensed" type="warning" title="Recurso não habilitado na licença">
      Alta disponibilidade é um módulo comercial opcional. Como SuperAdmin, você pode habilitá-lo para este ambiente.
    </NAlert>
    <NAlert v-else-if="hasConfirmedSplitBrain" type="error" title="Mais de um nó confirmou a VIP">
      Interrompa a operação e isole um dos nós. Esta condição pode causar split-brain e não é tratada como uma transferência normal.
    </NAlert>
    <NAlert v-else-if="transitionActive" type="info" title="Alteração da topologia em andamento">
      A VIP, os papéis e alguns serviços podem aparecer temporariamente em transição. O painel continuará atualizando
      os heartbeats e manterá o histórico das etapas; bloqueadores de segurança continuam ativos.
    </NAlert>
    <NAlert v-else-if="hasRoleMismatch" type="warning" title="Papéis configurados divergem da topologia observada">
      <div class="role-reconciliation-alert">
        <span>
          Confirme a topologia somente se a troca já terminou: um PRIMARY deve possuir a VIP e o outro nó deve estar
          como STANDBY sem a VIP.
        </span>
        <NPopconfirm
          :disabled="!canReconcileRoles"
          @positive-click="reconcileObservedRoles"
        >
          <template #trigger>
            <NButton
              size="small"
              type="warning"
              :disabled="!canReconcileRoles"
              :loading="roleReconciliationSaving"
            >
              Confirmar papéis observados
            </NButton>
          </template>
          Registrar os papéis observados como configuração desejada? Esta ação não move a VIP nem altera serviços.
        </NPopconfirm>
      </div>
    </NAlert>
    <NAlert v-else-if="unhealthyNodes.length" type="error" title="Há nós que não podem ser promovidos">
      Revise os bloqueadores abaixo. Uma promoção deve permanecer bloqueada enquanto existir componente crítico com falha.
    </NAlert>
    <NAlert v-else-if="overallHealthy" type="success" title="Standby pronto para failover">
      Todos os componentes reportados estão saudáveis. A promoção ainda depende de isolamento seguro do nó ativo.
      <HaHelpTooltip
        label="Fencing e witness"
        text="Fencing isola o nó antigo para impedir duas instâncias ativas. Witness é um terceiro ponto de decisão que confirma qual nó pode assumir com segurança."
      />
    </NAlert>
    <NAlert v-if="error" type="error">{{ error }}</NAlert>

    <HaIncidentGuide
      :nodes="nodes"
      :active-operations="activeOperations"
      :has-split-brain="hasConfirmedSplitBrain"
      :has-role-mismatch="hasRoleMismatch"
    />

    <HaSetupWizard
      :licensed="licensed"
      :nodes="nodes"
      @attach="showAttach = true"
      @open-operations="scrollToOperations"
    />

    <div id="ha-operational-topology" class="ha-scroll-anchor" />
    <CollapsibleSection title="Configurações e operação dos nós" :default-open="true" body-class="mt-2 ha-section-body">
    <NSpin :show="loading">
      <NEmpty v-if="licensed && !loading && nodes.length === 0" description="Nenhum nó HA anexado." />
      <HaTopologyMap
        v-else-if="licensed && nodes.length > 0"
        :nodes="nodes"
        :access-endpoint="currentAccessEndpoint"
        :transition-active="transitionActive"
      />
      <section v-if="licensed && nodes.length > 0" class="node-details" aria-labelledby="ha-node-details-title">
        <div class="node-details-heading">
          <div>
            <h2 id="ha-node-details-title">Detalhes e ações por nó</h2>
            <p>Consulte telemetria, inventário e operações disponíveis em cada servidor.</p>
          </div>
          <NTag size="small">{{ nodes.length }} nós monitorados</NTag>
        </div>
        <div class="node-grid">
        <NCard v-for="node in nodes" :key="node.id" :title="node.name" size="small">
          <template #header-extra>
            <NTag :type="statusType[node.status]">{{ statusLabel[node.status] }}</NTag>
          </template>
          <NDescriptions :column="1" label-placement="left" size="small">
            <NDescriptionsItem label="Papel observado">{{ node.observedRole ?? 'Não informado' }}</NDescriptionsItem>
            <NDescriptionsItem label="IP administrativo">{{ node.endpoint ?? 'Não informado' }}</NDescriptionsItem>
            <NDescriptionsItem label="VIP">
              {{ node.virtualIp ?? currentAccessEndpoint }}
              <NTag v-if="node.ownsVip" type="success" size="small">Neste nó</NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="Último heartbeat">
              <NTag
                size="small"
                :type="node.heartbeatState === 'CURRENT' ? 'success' : node.heartbeatState === 'DELAYED' ? 'warning' : 'error'"
              >
                {{ heartbeatText(node) }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="Pronto para promoção">
              <HaHelpTooltip
                label="Pronto para promoção"
                text="Indica que replicação, serviços e heartbeat passaram nos gates. Ainda é necessário isolar o nó ativo antes da troca."
              />
              <NTag :type="node.observedRole === 'PRIMARY' ? 'default' : node.promotionReady ? 'success' : 'error'">
                {{ node.observedRole === 'PRIMARY' ? 'Não se aplica · nó ativo' : node.promotionReady ? 'Sim' : 'Não' }}
              </NTag>
            </NDescriptionsItem>
          </NDescriptions>
          <section class="inventory" aria-label="Inventário do servidor">
            <div class="inventory-title">
              <strong>Inventário do agente</strong>
              <NTag :type="node.inventory ? 'success' : 'default'" size="small">
                {{ node.inventory ? 'Recebido' : 'Aguardando' }}
              </NTag>
            </div>
            <NDescriptions v-if="node.inventory" :column="1" label-placement="left" size="small">
              <NDescriptionsItem label="Servidor">{{ node.inventory.hostname }}</NDescriptionsItem>
              <NDescriptionsItem label="Sistema">
                {{ node.inventory.operatingSystem }} · {{ node.inventory.architecture }}
              </NDescriptionsItem>
              <NDescriptionsItem label="Capacidade">
                {{ node.inventory.cpuCores }} CPU · {{ node.inventory.memoryTotalMb }} MB RAM ·
                {{ node.inventory.diskFreeMb }} MB livres
              </NDescriptionsItem>
              <NDescriptionsItem label="Containers">
                Docker {{ node.inventory.dockerInstalled ? node.inventory.dockerVersion || 'instalado' : 'ausente' }} ·
                Compose {{ node.inventory.composeInstalled ? 'instalado' : 'ausente' }}
              </NDescriptionsItem>
            </NDescriptions>
            <p v-else class="inventory-empty">
              O agente ainda não enviou os pré-requisitos deste servidor.
            </p>
          </section>
          <div class="components" aria-label="Estado dos componentes">
            <NTag
              v-for="(component, key) in node.components"
              :key="key"
              :type="component.status === 'ok' ? 'success' : component.status === 'degraded' ? 'warning' : 'error'"
              size="small"
            >
              {{ componentText(key, component) }}
            </NTag>
          </div>
          <NAlert v-if="node.blockers.length" type="warning" title="Bloqueadores" class="blockers">
            <ul><li v-for="blocker in node.blockers" :key="blocker">{{ blocker }}</li></ul>
          </NAlert>
          <NAlert v-if="node.notices.length" type="info" title="Operação em andamento" class="blockers">
            <ul><li v-for="notice in node.notices" :key="notice">{{ notice }}</li></ul>
          </NAlert>
          <template #footer>
            <div class="node-actions">
              <div class="node-primary-action">
                <NButton
                  v-if="node.observedRole === 'STANDBY' && node.desiredRole !== 'PRIMARY'"
                  type="primary"
                  :disabled="!node.promotionReady || transitionActive"
                  @click="openGuidedAction('PROMOTE', node)"
                >
                  Promover este nó
                </NButton>
                <NButton
                  v-else-if="node.observedRole === 'STANDBY'"
                  type="primary"
                  :disabled="node.ownsVip || transitionActive"
                  @click="openGuidedAction('REJOIN', node)"
                >
                  Retornar como standby
                </NButton>
                <span v-else class="active-node-note">
                  Nó ativo com a VIP · escolha um standby para iniciar uma troca.
                </span>
                <small v-if="node.observedRole === 'STANDBY' && !node.promotionReady" class="action-disabled-reason">
                  Resolva os bloqueadores antes de iniciar a promoção.
                </small>
              </div>
              <details class="advanced-actions">
                <summary>Validações e opções avançadas</summary>
                <div class="advanced-actions-body">
            <NSpace justify="space-between" align="center">
              <NSpace>
                <span class="action-with-help">
                  <NButton
                    size="small"
                    ghost
                    :loading="provisioningPlanNodeId === node.id"
                    @click="createProvisioningPlan(node)"
                  >
                    Avaliar provisionamento
                  </NButton>
                  <HaHelpTooltip
                    label="Avaliar provisionamento"
                    text="Lê o inventário enviado pelo agente e cria um plano. Não instala pacotes, não altera serviços e não move a VIP."
                  />
                </span>
                <NPopconfirm
                  v-if="node.observedRole !== 'PRIMARY'"
                  :disabled="!nodesWithReadyProvisioningPlan.has(node.id) || node.ownsVip"
                  positive-text="Restaurar configuração"
                  negative-text="Cancelar"
                  @positive-click="rollbackSharedSecrets(node)"
                >
                  <template #trigger>
                    <NButton
                      size="small"
                      ghost
                      :disabled="!nodesWithReadyProvisioningPlan.has(node.id) || node.ownsVip"
                      :loading="secretsActionNodeId === node.id"
                    >
                      Reverter configuração
                    </NButton>
                  </template>
                  Restaurar o último .env preservado pelo agente? Os serviços não serão reiniciados automaticamente.
                </NPopconfirm>
                <span v-if="node.observedRole !== 'PRIMARY'" class="action-with-help">
                  <NButton
                    size="small"
                    :disabled="!nodesWithReadyProvisioningPlan.has(node.id) || node.ownsVip || !node.secureProvisioningReady || !secureTransport"
                    :loading="secretsActionNodeId === node.id"
                    @click="openSharedSecretsProvisioning(node)"
                  >
                    Aplicar configuração segura
                  </NButton>
                  <HaHelpTooltip
                    label="Aplicar configuração segura"
                    :text="!secureTransport
                      ? 'Configure HTTPS no painel antes de transportar segredos.'
                      : node.secureProvisioningReady
                        ? 'Cifra cada segredo para a chave exclusiva deste agente. O banco e o journal não recebem valores em texto aberto.'
                        : 'Atualize o agente e aguarde o heartbeat publicar a chave pública de provisionamento.'"
                  />
                </span>
                <NPopconfirm
                  :disabled="!nodesWithReadyProvisioningPlan.has(node.id)"
                  positive-text="Confirmar"
                  negative-text="Cancelar"
                  @positive-click="validateAgentExecutor(node)"
                >
                  <template #trigger>
                    <NButton
                      size="small"
                      ghost
                      :disabled="!nodesWithReadyProvisioningPlan.has(node.id)"
                      :loading="executorNodeId === node.id"
                    >
                      Validar executor
                    </NButton>
                  </template>
                  Enfileirar a ação segura REFRESH_INVENTORY? Ela não instala pacotes nem executa shell arbitrário.
                </NPopconfirm>
                <template v-if="node.observedRole !== 'PRIMARY'">
                <span class="action-with-help">
                  <NButton
                    size="small"
                    type="primary"
                    :disabled="!nodesWithReadyProvisioningPlan.has(node.id) || node.ownsVip"
                    :loading="releaseActionNodeId === node.id"
                    @click="openReleaseProvisioning(node)"
                  >
                    Instalar release
                  </NButton>
                  <HaHelpTooltip
                    label="Instalar release"
                    text="O agente baixa o pacote, confere SHA-256, carrega as imagens offline e promove a release. Banco, réplicas e VIP permanecem bloqueados."
                  />
                </span>
                <NPopconfirm
                  v-if="!nodesWithPreparedStorage.has(node.id)"
                  :disabled="!nodesWithReadyProvisioningPlan.has(node.id) || node.ownsVip"
                  positive-text="Preparar diretórios"
                  negative-text="Cancelar"
                  @positive-click="prepareStorageDirectories(node)"
                >
                  <template #trigger>
                    <NButton
                      size="small"
                      type="primary"
                      :disabled="!nodesWithReadyProvisioningPlan.has(node.id) || node.ownsVip"
                      :loading="storageActionNodeId === node.id"
                    >
                      Preparar diretórios
                    </NButton>
                  </template>
                  Criar somente os diretórios ausentes em /srv/nodeaccess-replica? Nenhum arquivo existente será alterado ou removido.
                </NPopconfirm>
                <NPopconfirm
                  v-else
                  positive-text="Reverter diretórios vazios"
                  negative-text="Cancelar"
                  @positive-click="rollbackStorageDirectories(node)"
                >
                  <template #trigger>
                    <NButton
                      size="small"
                      type="warning"
                      ghost
                      :disabled="node.ownsVip"
                      :loading="storageActionNodeId === node.id"
                    >
                      Reverter preparação
                    </NButton>
                  </template>
                  Remover somente diretórios vazios que o agente registrou como criados por ele? Diretórios com arquivos serão preservados e a operação indicará falha segura.
                </NPopconfirm>
                <NPopconfirm
                  v-if="nodesWithPreparedStorage.has(node.id)"
                  positive-text="Validar escrita"
                  negative-text="Cancelar"
                  @positive-click="validateStorageWriteAccess(node)"
                >
                  <template #trigger>
                    <NButton
                      size="small"
                      ghost
                      :disabled="node.ownsVip"
                      :loading="storageActionNodeId === node.id"
                    >
                      Validar escrita
                    </NButton>
                  </template>
                  Criar e remover um arquivo temporário em cada diretório de dados? Links simbólicos serão recusados e nenhum probe será mantido.
                </NPopconfirm>
                <span class="action-with-help">
                  <NButton
                    size="small"
                    type="primary"
                    ghost
                    :loading="preflightNodeId === node.id"
                    @click="runPreflight(node)"
                  >
                    Executar preflight
                  </NButton>
                  <HaHelpTooltip
                    label="Executar preflight"
                    text="Preflight é uma verificação somente leitura. Confere heartbeat, replicação e serviços; não promove o nó e não move a VIP."
                  />
                </span>
                <span class="action-with-help">
                  <NButton
                    size="small"
                    ghost
                    :loading="rejoinNodeId === node.id"
                    @click="runRejoinPreflight(node)"
                  >
                    Validar retorno
                  </NButton>
                  <HaHelpTooltip
                    label="Validar retorno"
                    text="Confere se um nó que voltou está sincronizado e seguro para atuar como réplica. Não altera a direção da replicação nem move a VIP."
                  />
                </span>
                </template>
              </NSpace>
              <NPopconfirm @positive-click="removeNode(node)">
                <template #trigger><NButton size="small" type="error" ghost>Remover nó</NButton></template>
                Remover {{ node.name }} da topologia HA?
              </NPopconfirm>
            </NSpace>
                </div>
              </details>
            </div>
          </template>
        </NCard>
        </div>
      </section>
    </NSpin>

    <CollapsibleSection
      v-if="licensed"
      title="Journal de operações"
      body-class="mt-2 journal-section-body"
    >
      <NEmpty v-if="operations.length === 0" description="Nenhuma operação executada." />
      <div v-else class="operation-list">
        <article v-for="operation in operations" :key="operation.id" class="operation-item">
          <div class="operation-heading">
            <div>
              <strong>
                {{ operation.nodeName }} · {{ operationLabel(operation) }}
              </strong>
              <div class="operation-date">{{ formatDate(operation.startedAt) }}</div>
            </div>
            <NTag :type="operationStatusType(operation)">
              {{ operationStatusLabel(operation) }}
            </NTag>
          </div>
          <NProgress
            v-if="operation.status === 'RUNNING'"
            type="line"
            :percentage="operationProgress(operation)"
            :show-indicator="true"
            processing
            aria-label="Progresso da operação HA"
          />
          <p v-if="operation.status === 'RUNNING'" class="operation-stage">
            Etapa atual: {{ operation.currentStage }}
          </p>
          <div class="components">
            <NTag
              v-for="step in operation.steps"
              :key="step.key"
              :type="step.status === 'ok' ? 'success' : step.status === 'required' ? 'warning' : 'error'"
              size="small"
              :title="step.message"
            >
              {{ step.label }}: {{ step.status === 'ok' ? 'ok' : step.status === 'required' ? 'pendente' : 'falhou' }}
            </NTag>
          </div>
          <ol v-if="operation.steps.length" class="operation-log" aria-label="Registro das etapas">
            <li v-for="step in operation.steps" :key="`${operation.id}-${step.key}`">
              <span class="operation-log-status" :data-status="step.status">
                {{ step.status === 'ok' ? 'Concluída' : step.status === 'required' ? 'Pendente' : 'Falhou' }}
              </span>
              <strong>{{ step.label }}</strong>
              <span v-if="step.message">{{ step.message }}</span>
            </li>
          </ol>
          <p v-if="operation.errorMessage" class="operation-error">
            Camada {{ operation.errorLayer }}: {{ operation.errorMessage }}
          </p>
        </article>
      </div>
    </CollapsibleSection>

    <NCard v-if="enrollmentCommand" title="Instalar agente no nó secundário" class="install-card">
      <NAlert type="info" title="O agente inicia a validação e pode instalar a release">
        Este comando instala o agente, registra a VIP e envia inventário e heartbeat. Docker, Compose,
        MySQL/Redis, replicação, Keepalived e certificados precisam existir ou ser preparados nas etapas
        seguintes. Após revisar o plano, a release offline pode ser instalada pelo próprio agente.
      </NAlert>
      <p>O token expira em 15 minutos e autoriza somente relatórios HA deste nó.</p>
      <NInput :value="enrollmentCommand" type="textarea" readonly :autosize="{ minRows: 3, maxRows: 6 }" aria-label="Comando de instalação do agente HA" />
      <NButton class="copy-button" @click="copyCommand">Copiar comando</NButton>
    </NCard>
    </CollapsibleSection>

    <CollapsibleSection title="Política de promoção e falhas" :default-open="true" body-class="mt-2 ha-section-body">
      <HaFailurePolicyGuide />
    </CollapsibleSection>

    <CollapsibleSection title="Guia de configuração" body-class="mt-2 ha-section-body">
      <div class="guide-list">
        <article v-for="item in guideSteps" :key="item.title" class="guide-item">
          <strong>{{ item.title }}</strong>
          <p>{{ item.description }}</p>
        </article>
      </div>
      <NAlert type="warning" title="O que continua manual" class="manual-alert">
        O painel não presume o isolamento físico do primário. Confirme o fencing no hypervisor/rede e emita
        a evidência pelo witness. Se o standby assumir a VIP antes da promoção, interrompa o Keepalived local
        conforme a etapa indicada; o script persistirá as novas prioridades após concluir. DNS ou balanceador
        externo continuam sob responsabilidade do operador. Sessões SSH e transferências ativas podem precisar
        ser reabertas.
      </NAlert>
    </CollapsibleSection>

    <CollapsibleSection title="Casos práticos que resolve" body-class="mt-2 ha-section-body">
      <div class="use-case-grid">
        <article v-for="item in useCases" :key="item.title" class="guide-item">
          <strong>{{ item.title }}</strong>
          <p>{{ item.description }}</p>
        </article>
      </div>
    </CollapsibleSection>

    <NModal
      :show="guidedActionOpen"
      preset="card"
      :title="guidedAction?.type === 'PROMOTE'
        ? `Promover ${guidedAction.node.name}`
        : `Retornar ${guidedAction?.node.name ?? 'nó'} como standby`"
      style="width: min(720px, calc(100vw - 32px))"
      @update:show="(show) => { if (!show) closeGuidedAction() }"
      @after-leave="clearGuidedAction"
    >
      <NAlert type="info" title="Execução assistida">
        Na troca planejada, os agentes executam somente as ações privilegiadas fechadas de quiesce e promoção.
        Em falha não planejada, o fencing externo continua obrigatório e não é executado pelo painel.
      </NAlert>

      <ol v-if="guidedAction?.type === 'PROMOTE'" class="guided-steps">
        <li>
          <strong>Validar o candidato</strong>
          <span>Execute o preflight e confirme réplica, backup, serviços e ausência da VIP neste nó.</span>
        </li>
        <li>
          <strong>Congelar ou isolar o primário</strong>
          <span>Em troca planejada, execute primeiro o comando de quiesce no nó ativo. Em falha, faça fencing externo antes de emitir a evidência witness.</span>
        </li>
        <li>
          <strong>Promover no servidor {{ guidedAction.node.endpoint ?? guidedAction.node.name }}</strong>
          <span>Revise os caminhos abaixo e execute o script como root. O journal local registrará todas as etapas.</span>
        </li>
        <li>
          <strong>Validar e reconciliar</strong>
          <span>Confirme health profundo, VIP única e depois alinhe os papéis observados no painel.</span>
        </li>
      </ol>
      <ol v-else class="guided-steps">
        <li>
          <strong>Manter o nó antigo sem VIP</strong>
          <span>Ele não pode retornar automaticamente como primário.</span>
        </li>
        <li>
          <strong>Preparar o rejoin</strong>
          <span>O script reconfigura MySQL, Redis e arquivos na direção do primário ativo.</span>
        </li>
        <li>
          <strong>Validar paridade</strong>
          <span>GTIDs divergentes ou arquivos fora do RPO bloqueiam o retorno e exigem re-seed.</span>
        </li>
        <li>
          <strong>Confirmar o papel standby</strong>
          <span>Depois do heartbeat saudável, reconcilie os papéis no painel.</span>
        </li>
      </ol>

      <NAlert
        :type="guidedAction?.node.promotionReady ? 'success' : 'warning'"
        :title="guidedAction?.type === 'PROMOTE'
          ? guidedAction.node.promotionReady ? 'Candidato pronto para o preflight final' : 'Promoção bloqueada'
          : 'Valide o retorno antes de liberar o nó'"
        class="guided-readiness"
      >
        {{
          guidedAction?.type === 'PROMOTE'
            ? guidedAction.node.promotionReady
              ? 'A telemetria atual passou nos gates. Fencing e witness continuam obrigatórios.'
              : 'Consulte os bloqueadores no cartão e repita o preflight após corrigi-los.'
            : 'O nó deve permanecer sem VIP e somente leitura durante todo o rejoin.'
        }}
      </NAlert>

      <template v-if="guidedAction?.type === 'PROMOTE'">
        <NForm label-placement="top" class="switchover-form" @submit.prevent="startPlannedSwitchover">
          <NAlert type="info" title="O que é o witness?">
            É uma terceira máquina independente dos dois nós. Ela guarda a chave privada e autoriza a troca,
            impedindo que os dois servidores se tornem PRIMARY ao mesmo tempo. Em troca planejada, a evidência
            é uma autorização curta e assinada; ela não desliga o nó ativo. Em uma falha real, o witness
            confirma o fencing antes da promoção automática.
          </NAlert>
          <dl class="witness-locations" aria-label="Origem e destino dos arquivos witness">
            <div>
              <dt>Onde o comando é executado</dt>
              <dd>Na terceira máquina que executa o serviço witness — nunca no PRIMARY ou no STANDBY.</dd>
            </div>
            <div>
              <dt>Onde os arquivos são gerados</dt>
              <dd>
                O último argumento do comando define o local. Com
                <code>/tmp/{{ plannedWitnessPrefix }}</code>, serão criados
                <code>/tmp/{{ plannedWitnessPrefix }}.txt</code> e
                <code>/tmp/{{ plannedWitnessPrefix }}.sig</code> no witness.
              </dd>
            </div>
            <div>
              <dt>Para onde devem ser copiados</dt>
              <dd>
                Para <code>/opt/nodeaccess/shared/ha/witness/</code> no standby
                {{ guidedAction.node.endpoint ?? guidedAction.node.name }}.
              </dd>
            </div>
          </dl>
          <NAlert type="default" title="Neste laboratório" class="witness-lab-note">
            O witness é o localhost Windows. A chave privada fica na área local protegida do serviço
            <code>NodeAccessHAWitness</code>. Em Linux, o caminho padrão é
            <code>/var/lib/nodeaccess-ha-witness/keys/witness-private.pem</code>.
          </NAlert>
          <ol class="witness-steps">
            <li>
              <strong>1. Gerar no servidor witness</strong>
              <span>Execute esta única linha perto do momento da troca: os arquivos expiram em 5 minutos.</span>
              <div class="guided-command-heading">
                <small>O script usa a chave padrão local; ela nunca é copiada para os nós NodeAccess.</small>
                <NButton
                  size="small"
                  @click="copyGuidedCommand(plannedWitnessIssueCommand, 'Comando de emissão witness copiado.')"
                >
                  Copiar comando
                </NButton>
              </div>
              <NInput
                :value="plannedWitnessIssueCommand"
                type="textarea"
                readonly
                :autosize="{ minRows: 2, maxRows: 4 }"
                aria-label="Comando para emitir autorização no witness"
                class="guided-command"
              />
            </li>
            <li>
              <strong>2. Copiar somente a evidência e a assinatura para o standby</strong>
              <span>Os dois arquivos devem chegar ao diretório protegido abaixo antes de iniciar.</span>
              <div class="guided-command-heading">
                <small><code>/opt/nodeaccess/shared/ha/witness</code></small>
                <NButton
                  size="small"
                  @click="copyGuidedCommand(plannedWitnessCopyCommand, 'Comando de cópia para o standby copiado.')"
                >
                  Copiar comando
                </NButton>
              </div>
              <NInput
                :value="plannedWitnessCopyCommand"
                type="textarea"
                readonly
                :autosize="{ minRows: 2, maxRows: 4 }"
                aria-label="Comando para copiar evidência e assinatura ao standby"
                class="guided-command"
              />
            </li>
            <li>
              <strong>3. Confirmar os nomes e iniciar</strong>
              <span>O painel já preencheu os nomes esperados. Informe somente os nomes, sem diretórios.</span>
            </li>
          </ol>
          <div class="switchover-fields">
            <NFormItem
              label="Nome do arquivo de evidência"
              required
              feedback="Deve existir no standby em /opt/nodeaccess/shared/ha/witness."
            >
              <NInput
                v-model:value="switchoverForm.witnessEvidenceFile"
                placeholder="switchover-...txt"
                :input-props="{ 'aria-label': 'Arquivo da evidência witness' }"
              />
            </NFormItem>
            <NFormItem
              label="Nome do arquivo de assinatura"
              required
              feedback="A assinatura .sig comprova que a evidência veio do witness autorizado."
            >
              <NInput
                v-model:value="switchoverForm.witnessSignatureFile"
                placeholder="switchover-...sig"
                :input-props="{ 'aria-label': 'Arquivo da assinatura witness' }"
              />
            </NFormItem>
          </div>
          <NFormItem
            label="Confirmação"
            required
            feedback="Digite TROCAR para autorizar o quiesce do primário e a promoção deste standby."
          >
            <NInput
              v-model:value="switchoverForm.confirmation"
              placeholder="TROCAR"
              :input-props="{ 'aria-label': 'Confirmação da troca planejada' }"
            />
          </NFormItem>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="switchoverSaving"
            :disabled="!plannedSwitchoverValid || !guidedAction.node.promotionReady || transitionActive"
          >
            Iniciar troca planejada
          </NButton>
        </NForm>
        <div class="guided-command-heading">
          <div>
            <strong>Alternativa manual: 1. Congelar o primário ativo</strong>
            <small>Execute no nó {{ activeNode?.endpoint ?? activeNode?.name ?? 'primário' }} e confirme que ele perdeu a VIP.</small>
          </div>
          <NButton
            size="small"
            @click="copyGuidedCommand(guidedQuiesceCommand, 'Comando de congelamento copiado.')"
          >
            Copiar congelamento
          </NButton>
        </div>
        <NInput
          :value="guidedQuiesceCommand"
          type="textarea"
          readonly
          :autosize="{ minRows: 5, maxRows: 8 }"
          aria-label="Comando para congelar o nó primário"
          class="guided-command"
        />
        <div class="guided-command-heading">
          <div>
            <strong>Alternativa manual: 2. Promover o standby</strong>
            <small>Use o mesmo ID de operação somente após o primário estar congelado ou isolado.</small>
          </div>
          <NButton
            size="small"
            type="primary"
            @click="copyGuidedCommand(guidedCommand, 'Comando de promoção copiado. Revise os caminhos da evidência witness.')"
          >
            Copiar promoção
          </NButton>
        </div>
      </template>
      <NInput
        :value="guidedCommand"
        type="textarea"
        readonly
        :autosize="{ minRows: 7, maxRows: 12 }"
        aria-label="Comando assistido para operação HA"
        class="guided-command"
      />
      <NSpace justify="space-between" class="guided-actions">
        <NButton
          v-if="guidedAction?.type === 'PROMOTE'"
          :loading="preflightNodeId === guidedAction.node.id"
          @click="runPreflight(guidedAction.node)"
        >
          Executar preflight
        </NButton>
        <NButton
          v-else-if="guidedAction"
          :loading="rejoinNodeId === guidedAction.node.id"
          @click="runRejoinPreflight(guidedAction.node)"
        >
          Validar retorno
        </NButton>
        <NSpace>
          <NButton @click="closeGuidedAction">Fechar</NButton>
          <NButton
            v-if="guidedAction?.type !== 'PROMOTE'"
            type="primary"
            @click="copyGuidedCommand(guidedCommand, 'Comando copiado. Revise os caminhos antes de executar.')"
          >
            Copiar comando
          </NButton>
        </NSpace>
      </NSpace>
    </NModal>

    <NModal v-model:show="showAttach" preset="card" title="Anexar nó standby" style="width: min(520px, calc(100vw - 32px))">
      <NForm label-placement="top" @submit.prevent="attachNode">
        <NFormItem label="Nome do nó" required>
          <NInput v-model:value="form.name" placeholder="Ex.: nodeaccess-b" :input-props="{ 'aria-label': 'Nome do nó' }" />
        </NFormItem>
        <NFormItem label="Endereço administrativo (opcional)">
          <NInput v-model:value="form.endpoint" placeholder="Ex.: 192.168.1.101" :input-props="{ 'aria-label': 'Endereço administrativo' }" />
        </NFormItem>
        <NFormItem
          label="Endereço virtual (VIP)"
          required
          feedback="Informe o IP livre que será compartilhado pelos dois nós, sem máscara. Use exatamente a mesma VIP nas duas matrículas."
        >
          <NInput v-model:value="form.virtualIp" placeholder="Ex.: 192.168.1.105" :input-props="{ 'aria-label': 'Endereço virtual (VIP)' }" />
        </NFormItem>
        <NFormItem label="Papel deste nó">
          <NSelect
            v-model:value="form.desiredRole"
            :options="[
              { label: 'Standby — candidato à promoção', value: 'STANDBY' },
              { label: 'Primary — nó ativo', value: 'PRIMARY' },
            ]"
          />
        </NFormItem>
        <NSpace justify="end">
          <NButton @click="showAttach = false">Cancelar</NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="saving"
            :disabled="!form.name.trim() || !form.virtualIp.trim()"
          >
            Gerar matrícula
          </NButton>
        </NSpace>
      </NForm>
    </NModal>

    <NModal
      :show="Boolean(releaseNode)"
      preset="card"
      title="Instalar release no standby"
      style="width: min(600px, calc(100vw - 32px))"
      @update:show="(show) => { if (!show) releaseNode = null }"
    >
      <NAlert type="warning" title="Instalação controlada">
        A release será baixada pelo nó, validada pelo SHA-256 e promovida sem iniciar banco, réplicas ou VIP.
        Use uma URL HTTPS acessível pelo servidor. HTTP é aceito somente em laboratório explicitamente habilitado.
      </NAlert>
      <NForm label-placement="top" class="release-form" @submit.prevent="installRelease">
        <NFormItem label="URL do pacote da release" required>
          <NInput
            v-model:value="releaseForm.releaseUrl"
            placeholder="https://releases.exemplo/nodeaccess-release-2.0.28.tar.gz"
            :input-props="{ 'aria-label': 'URL do pacote da release' }"
          />
        </NFormItem>
        <NFormItem
          label="SHA-256 esperado"
          required
          feedback="Cole os 64 caracteres publicados junto ao pacote."
        >
          <NInput
            v-model:value="releaseForm.sha256"
            placeholder="fdb3ef..."
            :input-props="{ 'aria-label': 'SHA-256 esperado', spellcheck: 'false' }"
          />
        </NFormItem>
        <NSpace justify="end">
          <NButton @click="releaseNode = null">Cancelar</NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :disabled="!releaseFormValid"
            :loading="releaseActionNodeId === releaseNode?.id"
          >
            Autorizar instalação
          </NButton>
        </NSpace>
      </NForm>
    </NModal>

    <NModal
      :show="Boolean(secretsNode)"
      preset="card"
      title="Aplicar configuração segura no standby"
      style="width: min(640px, calc(100vw - 32px))"
      @update:show="(show) => { if (!show) secretsNode = null }"
    >
      <NAlert type="warning" title="Segredos compartilhados">
        Use exatamente os mesmos valores do primário. Cada campo será cifrado para este agente antes de
        entrar na fila. A ação atualiza o arquivo .env e preserva um backup local, mas não reinicia serviços.
      </NAlert>
      <NForm label-placement="top" class="release-form" @submit.prevent="applySharedSecrets">
        <NFormItem
          v-for="[key, label] in secretFields"
          :key="key"
          :label="label"
          required
        >
          <NInput
            v-model:value="sharedSecrets[key]"
            type="password"
            show-password-on="click"
            :input-props="{ 'aria-label': label, autocomplete: 'new-password', spellcheck: 'false' }"
          />
        </NFormItem>
        <NAlert type="info">
          Depois da conclusão, valide o journal e execute os gates de estado antes de reiniciar containers
          ou alterar Keepalived/VIP.
        </NAlert>
        <NSpace justify="end">
          <NButton @click="secretsNode = null">Cancelar</NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :disabled="!sharedSecretsValid"
            :loading="secretsActionNodeId === secretsNode?.id"
          >
            Cifrar e autorizar
          </NButton>
        </NSpace>
      </NForm>
    </NModal>
  </div>
</template>

<style scoped>
.ha-page { display: grid; gap: 16px; }
.ha-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ha-header h1 { margin: 0; color: #fff; font-size: 1.25rem; }
.ha-header p, .install-card p { margin: 4px 0 0; color: #9ca3af; }
.node-details {
  width: min(100%, 1080px);
  margin: 28px auto 0;
  padding-top: 22px;
  border-top: 1px solid rgba(148, 163, 184, .18);
}
.node-details-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.node-details-heading h2 { margin: 0; color: #f8fafc; font-size: 1rem; }
.node-details-heading p { margin: 4px 0 0; color: #9ca3af; font-size: .8125rem; }
.node-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  gap: 16px;
}
.components { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.action-with-help { display: inline-flex; align-items: center; }
.active-node-note { color: #94a3b8; font-size: .75rem; }
.node-actions { display: grid; gap: 12px; }
.node-primary-action { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.action-disabled-reason { color: #fbbf24; font-size: .75rem; }
.advanced-actions {
  border-top: 1px solid rgba(148, 163, 184, .14);
  padding-top: 10px;
}
.advanced-actions summary {
  width: fit-content;
  color: #94a3b8;
  cursor: pointer;
  font-size: .75rem;
}
.advanced-actions summary:hover { color: #cbd5e1; }
.advanced-actions-body { margin-top: 12px; }
.guided-steps {
  display: grid;
  gap: 12px;
  margin: 18px 0;
  padding-left: 22px;
}
.guided-steps li { padding-left: 4px; color: #e2e8f0; }
.guided-steps strong, .guided-steps span { display: block; }
.guided-steps span { margin-top: 3px; color: #9ca3af; font-size: .8125rem; line-height: 1.45; }
.guided-readiness { margin-bottom: 14px; }
.switchover-form {
  margin: 16px 0 20px;
  padding: 14px;
  border: 1px solid rgba(245, 158, 11, .28);
  border-radius: 8px;
}
.witness-steps {
  display: grid;
  gap: 14px;
  margin: 16px 0;
  padding: 0;
  list-style: none;
}
.witness-locations {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 14px 0 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, .16);
  border-radius: 8px;
  background: rgba(148, 163, 184, .16);
}
.witness-locations > div { min-width: 0; padding: 12px; background: rgba(15, 23, 42, .82); }
.witness-locations dt {
  color: #94a3b8;
  font-size: .6875rem;
  font-weight: 650;
  letter-spacing: .04em;
  text-transform: uppercase;
}
.witness-locations dd { margin: 5px 0 0; color: #e2e8f0; font-size: .75rem; line-height: 1.5; }
.witness-locations code { color: #bae6fd; overflow-wrap: anywhere; }
.witness-lab-note { margin-top: 12px; }
.witness-steps > li {
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, .16);
  border-radius: 8px;
}
.witness-steps strong,
.witness-steps span { display: block; }
.witness-steps strong { color: #f8fafc; font-size: .875rem; }
.witness-steps span { margin-top: 4px; color: #9ca3af; font-size: .75rem; line-height: 1.45; }
.switchover-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.guided-command-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 14px 0 8px;
}
.guided-command-heading strong, .guided-command-heading small { display: block; }
.guided-command-heading small { margin-top: 3px; color: #9ca3af; line-height: 1.4; }
.guided-command :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.guided-actions { margin-top: 14px; }
.release-form { margin-top: 16px; }
.blockers { margin-top: 16px; }
.blockers ul { margin: 0; padding-left: 20px; }
.role-reconciliation-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.install-card { margin-top: 4px; }
.copy-button { margin-top: 12px; }
.operation-list { display: grid; gap: 12px; }
.operation-item { border: 1px solid rgba(148, 163, 184, .18); border-radius: 8px; padding: 12px; }
.operation-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.operation-date { color: #9ca3af; font-size: .75rem; margin-top: 2px; }
.operation-stage { color: #cbd5e1; font-size: .8125rem; margin: 8px 0 0; }
.operation-log { display: grid; gap: 7px; margin: 12px 0 0; padding: 0; list-style: none; }
.operation-log li { display: grid; grid-template-columns: 72px minmax(120px, .6fr) 1fr; gap: 8px; color: #94a3b8; font-size: .75rem; }
.operation-log strong { color: #e2e8f0; }
.operation-log-status[data-status="ok"] { color: #86efac; }
.operation-log-status[data-status="required"] { color: #fde68a; }
.operation-log-status[data-status="failed"] { color: #fca5a5; }
.operation-error { color: #fca5a5; font-size: .875rem; margin: 10px 0 0; }
.inventory { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(148, 163, 184, .14); }
.inventory-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.inventory-empty { margin: 0; color: #9ca3af; font-size: .8125rem; }
.guide-list { display: grid; gap: 10px; }
.use-case-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 10px; }
.guide-item { border: 1px solid rgba(148, 163, 184, .18); border-radius: 8px; padding: 12px; }
.guide-item strong { color: #f8fafc; font-size: .875rem; }
.guide-item p { color: #9ca3af; font-size: .8125rem; line-height: 1.5; margin: 4px 0 0; }
.manual-alert { margin-top: 12px; }
:deep(.ha-section-body) { background: transparent; }
:deep(.journal-section-body) { background: transparent; }
@media (max-width: 640px) {
  .ha-header { align-items: stretch; flex-direction: column; }
  .node-details { margin-top: 20px; padding-top: 18px; }
  .node-details-heading { align-items: stretch; flex-direction: column; }
  .guided-command-heading { align-items: stretch; flex-direction: column; }
  .switchover-fields { grid-template-columns: 1fr; gap: 0; }
  .guided-actions { align-items: stretch !important; flex-direction: column; }
  .operation-log li { grid-template-columns: 1fr; gap: 2px; }
  .witness-locations { grid-template-columns: 1fr; }
}
</style>
