<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NProgress, NSelect,
  NSpace, NSpin, NTag, NText, NTransfer, NCheckbox, NInputNumber, useMessage,
  NInput, NTooltip,
} from 'naive-ui'
import type { SessionAuditPolicyMode, SessionAuditPolicyPublic, UserPublic, GroupPublic } from '@nodeaccess/shared'
import { settingsService, type SettingsData } from '@/services/settings.service'
import { sessionAuditPolicyService } from '@/services/sessionAuditPolicy.service'
import { userService } from '@/services/user.service'
import { groupService } from '@/services/group.service'
import { featuresService } from '@/services/features.service'
import { aiSshActionCommandPolicyService } from '@/services/ai-ssh-action-command-policy.service'
import { clearAllRegisteredCaches, clearRegisteredCache, listCacheRegistry, refreshAllRegisteredCaches, refreshRegisteredCache, type CacheRegistrySnapshot } from '@/services/service-cache'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const loading = ref(false)
const error   = ref<string | null>(null)
const data    = ref<SettingsData | null>(null)
const policySaving = ref(false)
const licenseSaving = ref(false)
const commandPolicySaving = ref(false)
const sessionLimitsSaving = ref(false)
const passwordPolicySaving = ref(false)
const tenantSettingsSaving = ref(false)
const jitAccessSaving = ref(false)
const sharedSessionSaving = ref(false)
const sftpPolicySaving = ref(false)
const policy = ref<SessionAuditPolicyPublic | null>(null)
const users = ref<UserPublic[]>([])
const groups = ref<GroupPublic[]>([])
const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'

const policyForm = ref<{
  enabled: boolean
  mode: SessionAuditPolicyMode
  userIds: number[]
  groupIds: number[]
}>({
  enabled: false,
  mode: 'DISABLED',
  userIds: [],
  groupIds: [],
})

const licenseForm = ref({
  limitHostsEnabled: false,
  maxHosts: 50 as number | null,
  multiConnect: false,
  sessionAudit: false,
  sessionAuditAi: false,
  sessionAuditAiProvider: 'automatic' as 'automatic' | 'openai' | 'local_ai',
  sessionAuditAiAutoSummary: false,
  agents: false,
  secrets: false,
  snippets: false,
  portForwarding: false,
  integrations: false,
  feedback: false,
  localAi: false,
  mcp: false,
  aiSshActions: false,
  jira: false,
  google: false,
  ldap: false,
  onepassword: false,
})

const commandPolicyForm = ref({
  safePatterns: '',
  approvalPatterns: '',
  blockedPatterns: '',
})
const sessionLimitsForm = ref({ maxPerUser: null as number | null, maxPerTenant: null as number | null })
const passwordPolicyForm = ref({ minLength: 8, regex: '', description: '' })
const tenantSettingsForm = ref({ totpIssuer: '', hostsDefaultView: 'home' as 'home' | 'list' })
const jitAccessForm = ref({ enabled: true, expiryMinutes: [5, 10, 30] as number[], maxExpiryMinutes: 30, pinRequired: false })
const sharedSessionForm = ref({ expiryMinutes: [5, 10, 30] as number[], maxExpiryMinutes: 30 })
const sftpPolicyForm = ref({
  blockOnModePreservationFailure: false,
  blockOnOwnershipPreservationFailure: false,
  blockOnTimestampPreservationFailure: false,
  diffMaxBytes: 1_048_576,
  diffMaxLines: 400,
})

const commandPolicyTest = ref({
  command: '',
  loading: false,
  result: null as null | { command: string; risk: 'safe' | 'approval_required' | 'blocked' },
})
const cacheRows = ref<CacheRegistrySnapshot[]>([])
const cacheSearch = ref('')
const cacheDomainFilter = ref<'all' | 'hosts' | 'settings' | 'features' | 'integrations' | 'folders' | 'groups' | 'bastions' | 'pem-keys' | 'tags' | 'other'>('all')
const cacheSectionExpanded = ref(false)
const jitAccessExpiryOptions = computed(() => {
  const base = [5, 10, 15, 30, 60, 120, 240, 480, 720, 1440, ...jitAccessForm.value.expiryMinutes]
  return Array.from(new Set(base))
    .filter((minutes) => minutes > 0 && minutes <= jitAccessForm.value.maxExpiryMinutes)
    .sort((a, b) => a - b)
    .map((minutes) => ({ label: t('admin.settings.jitAccess.expiryOption', { minutes }), value: minutes }))
})
const sharedSessionExpiryOptions = computed(() => {
  const base = [5, 10, 15, 30, 60, 120, 240, 480, 720, 1440, ...sharedSessionForm.value.expiryMinutes]
  return Array.from(new Set(base))
    .filter((minutes) => minutes > 0 && minutes <= sharedSessionForm.value.maxExpiryMinutes)
    .sort((a, b) => a - b)
    .map((minutes) => ({ label: t('admin.settings.sharedSessions.expiryOption', { minutes }), value: minutes }))
})

async function load() {
  loading.value = true
  error.value   = null
  try {
    const [settingsRes, policyRes, usersRes, groupsRes] = await Promise.all([
      settingsService.get(),
      sessionAuditPolicyService.get().catch(() => ({ data: null })),
      userService.list({ limit: 200 }),
      groupService.list(),
    ])
    data.value = settingsRes.data
    syncLicenseForm(settingsRes.data)
    syncSessionLimitsForm(settingsRes.data)
    syncPasswordPolicyForm(settingsRes.data)
    syncTenantSettingsForm(settingsRes.data)
    syncJitAccessForm(settingsRes.data)
    syncSharedSessionForm(settingsRes.data)
    syncSftpPolicyForm(settingsRes.data)
    await loadCommandPolicy(settingsRes.data)
    policy.value = policyRes.data
    users.value = usersRes.data.data
    groups.value = groupsRes.data

    if (policy.value) {
      policyForm.value = {
        enabled: policy.value.enabled,
        mode: policy.value.mode,
        userIds: [...policy.value.userIds],
        groupIds: [...policy.value.groupIds],
      }
    }
    refreshCacheRows()
  } catch {
    error.value = 'Erro ao carregar configurações'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function refreshCacheRows() {
  cacheRows.value = listCacheRegistry()
}

function cacheMissHint(row: CacheRegistrySnapshot) {
  if (row.kind !== 'keyed') return 'Baixo reaproveitamento nas leituras observadas.'
  if (row.keyInsights.length <= 1) return 'Poucas repetições da mesma chave até agora.'
  if (row.name === 'hosts:list') {
    return 'Leituras variando entre paginação, busca ou filtros diferentes.'
  }
  return 'Várias chaves diferentes foram lidas no mesmo cache.'
}

function cacheKeyInsightLabel(row: CacheRegistrySnapshot) {
  if (row.kind !== 'keyed' || row.keyInsights.length === 0) return 'Sem detalhe por chave ainda.'
  return row.keyInsights
    .map((entry) => `${entry.label} (${entry.reads} leituras, ${formatHitRate(entry.hitRate)})`)
    .join(' · ')
}

function cacheMutationLabel(row: CacheRegistrySnapshot) {
  if (!row.meta.lastMutationAction) return 'Sem mutação registrada ainda.'
  const action =
    row.meta.lastMutationAction === 'clear' ? 'clear'
      : row.meta.lastMutationAction === 'set' ? 'set'
        : row.meta.lastMutationAction === 'update' ? 'update'
          : 'refresh'
  const reason = row.meta.lastMutationReason ? ` por ${row.meta.lastMutationReason}` : ''
  return `${action}${reason}`
}

function syncSessionLimitsForm(settings: SettingsData) {
  sessionLimitsForm.value = {
    maxPerUser:   settings.sessionLimits.maxPerUser   ?? null,
    maxPerTenant: settings.sessionLimits.maxPerTenant ?? null,
  }
}

function syncPasswordPolicyForm(settings: SettingsData) {
  passwordPolicyForm.value = {
    minLength:   settings.passwordPolicy.minLength,
    regex:       settings.passwordPolicy.regex,
    description: settings.passwordPolicy.description,
  }
}

function syncTenantSettingsForm(settings: SettingsData) {
  tenantSettingsForm.value = {
    totpIssuer: settings.tenantSettings?.totpIssuer ?? '',
    hostsDefaultView: settings.tenantSettings?.hostsDefaultView ?? 'home',
  }
}

function syncJitAccessForm(settings: SettingsData) {
  jitAccessForm.value = {
    enabled: settings.jitAccess?.enabled !== false,
    expiryMinutes: settings.jitAccess?.expiryMinutes?.length ? settings.jitAccess.expiryMinutes : [5, 10, 30],
    maxExpiryMinutes: settings.jitAccess?.maxExpiryMinutes ?? 30,
    pinRequired: settings.jitAccess?.pinRequired === true,
  }
}

function syncSharedSessionForm(settings: SettingsData) {
  sharedSessionForm.value = {
    expiryMinutes: settings.sharedSessions?.expiryMinutes?.length ? settings.sharedSessions.expiryMinutes : [5, 10, 30],
    maxExpiryMinutes: settings.sharedSessions?.maxExpiryMinutes ?? 30,
  }
}

function syncSftpPolicyForm(settings: SettingsData) {
  sftpPolicyForm.value = {
    blockOnModePreservationFailure: settings.sftpPolicy?.blockOnModePreservationFailure === true,
    blockOnOwnershipPreservationFailure: settings.sftpPolicy?.blockOnOwnershipPreservationFailure === true,
    blockOnTimestampPreservationFailure: settings.sftpPolicy?.blockOnTimestampPreservationFailure === true,
    diffMaxBytes: settings.sftpPolicy?.diffMaxBytes ?? 1_048_576,
    diffMaxLines: settings.sftpPolicy?.diffMaxLines ?? 400,
  }
}

function syncLicenseForm(settings: SettingsData) {
  licenseForm.value = {
    limitHostsEnabled: settings.license.maxHosts !== null,
    maxHosts: settings.license.maxHosts ?? 50,
    multiConnect: settings.license.multiConnect === true,
    sessionAudit: settings.license.sessionAuditEnabled === true,
    sessionAuditAi: settings.license.sessionAuditAiEnabled === true,
    sessionAuditAiProvider: settings.license.sessionAuditAiProvider ?? 'automatic',
    sessionAuditAiAutoSummary: settings.license.sessionAuditAiAutoSummaryEnabled === true,
    agents: settings.license.featureEntitlements.agents === true,
    secrets: settings.license.featureEntitlements.secrets === true,
    snippets: settings.license.featureEntitlements.snippets === true,
    portForwarding: settings.license.featureEntitlements.portForwarding === true,
    integrations: settings.license.featureEntitlements.integrations === true,
    feedback: settings.license.featureEntitlements.feedback === true,
    localAi: settings.license.featureEntitlements.localAi === true,
    mcp: settings.license.featureEntitlements.mcp === true,
    aiSshActions: settings.license.featureEntitlements.aiSshActions === true,
    jira: settings.license.integrationEntitlements.jira === true,
    google: settings.license.integrationEntitlements.google === true,
    ldap: settings.license.integrationEntitlements.ldap === true,
    onepassword: settings.license.integrationEntitlements.onepassword === true,
  }
}

const licensePercent = computed(() => {
  if (!data.value) return 0
  const { activeUsers, maxUsers } = data.value.license
  return Math.round((activeUsers / maxUsers) * 100)
})

const licenseStatus = computed(() => {
  if (licensePercent.value >= 90) return 'error'
  if (licensePercent.value >= 70) return 'warning'
  return 'success'
})

const policyModeOptions = computed(() => [
  { label: t('admin.settings.sessionAudit.policy.modes.DISABLED'), value: 'DISABLED' },
  { label: t('admin.settings.sessionAudit.policy.modes.ALL'), value: 'ALL' },
  { label: t('admin.settings.sessionAudit.policy.modes.USERS'), value: 'USERS' },
  { label: t('admin.settings.sessionAudit.policy.modes.GROUPS'), value: 'GROUPS' },
  { label: t('admin.settings.sessionAudit.policy.modes.MIXED'), value: 'MIXED' },
])

const userTransferOptions = computed(() =>
  users.value.map((user) => ({
    label: `${user.name} (${user.email})`,
    value: user.id,
  })),
)

const groupTransferOptions = computed(() =>
  groups.value.map((group) => ({
    label: group.name,
    value: group.id,
  })),
)

const showUserScope = computed(() =>
  policyForm.value.mode === 'USERS' || policyForm.value.mode === 'MIXED',
)

const showGroupScope = computed(() =>
  policyForm.value.mode === 'GROUPS' || policyForm.value.mode === 'MIXED',
)

const licensedIntegrationProviders = computed(() =>
  Object.entries(data.value?.license.integrationEntitlements ?? {})
    .filter(([, enabled]) => enabled)
    .map(([provider]) => provider),
)

const canEditIntegrationProviders = computed(() => licenseForm.value.integrations)
const licenseHelp = computed(() => ({
  maxHosts: t('admin.settings.license.editor.maxHostsHelp'),
  multiConnect: t('admin.settings.license.editor.multiConnectHelp'),
  sessionAudit: t('admin.settings.license.editor.sessionAuditHelp'),
  sessionAuditAi: t('admin.settings.license.editor.sessionAuditAiHelp'),
  sessionAuditAiAutoSummary: t('admin.settings.license.editor.auditAiAutoSummaryHelp'),
  agents: t('admin.settings.license.editor.agentsHelp'),
  secrets: t('admin.settings.license.editor.secretsHelp'),
  snippets: t('admin.settings.license.editor.snippetsHelp'),
  portForwarding: t('admin.settings.license.editor.portForwardingHelp'),
  integrations: t('admin.settings.license.editor.integrationsHelp'),
  feedback: t('admin.settings.license.editor.feedbackHelp'),
  localAi: t('admin.settings.license.editor.localAiHelp'),
  mcp: t('admin.settings.license.editor.mcpHelp'),
  aiSshActions: t('admin.settings.license.editor.aiSshActionsHelp'),
  providers: t('admin.settings.license.editor.providersHelp'),
}))
const environmentFeatureRows = computed(() => {
  const features = data.value?.environment.features
  return [
    {
      key: 'FEATURE_SESSION_AUDIT',
      label: t('admin.settings.environment.features.sessionAudit'),
      enabled: features?.sessionAudit === true,
    },
    {
      key: 'FEATURE_SESSION_AUDIT_AI_SUMMARY',
      label: t('admin.settings.environment.features.sessionAuditAiSummary'),
      enabled: features?.sessionAuditAiSummary === true,
    },
    {
      key: 'FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY',
      label: t('admin.settings.environment.features.sessionAuditAiAutoSummary'),
      enabled: features?.sessionAuditAiAutoSummary === true,
    },
    {
      key: 'FEATURE_LOCAL_AI',
      label: t('admin.settings.environment.features.localAi'),
      enabled: features?.localAi === true,
    },
    {
      key: 'FEATURE_NATIVE_SSH_GATEWAY',
      label: t('admin.settings.environment.features.nativeSshGateway'),
      enabled: features?.nativeSshGateway === true,
    },
  ]
})
const policyCache = computed(() => policy.value?.cache ?? null)
const sessionAuditAiProviderOptions = computed(() => [
  { label: t('admin.settings.license.auditAiProviders.automatic'), value: 'automatic' },
  { label: t('admin.settings.license.auditAiProviders.openai'), value: 'openai' },
  { label: t('admin.settings.license.auditAiProviders.local_ai'), value: 'local_ai' },
])
const cacheDomainOptions = computed(() => [
  { label: 'Todos', value: 'all' },
  { label: 'Hosts', value: 'hosts' },
  { label: 'Settings', value: 'settings' },
  { label: 'Features', value: 'features' },
  { label: 'Integrations', value: 'integrations' },
  { label: 'Folders', value: 'folders' },
  { label: 'Groups', value: 'groups' },
  { label: 'Bastions', value: 'bastions' },
  { label: 'Pem keys', value: 'pem-keys' },
  { label: 'Tags', value: 'tags' },
  { label: 'Outros', value: 'other' },
])
const filteredCacheRows = computed(() => {
  const search = cacheSearch.value.trim().toLowerCase()
  return cacheRows.value.filter((row) => {
    const domain = cacheDomain(row.name)
    const matchesDomain = cacheDomainFilter.value === 'all' || domain === cacheDomainFilter.value
    const matchesSearch = !search || row.name.toLowerCase().includes(search)
    return matchesDomain && matchesSearch
  })
})
const groupedCacheRows = computed(() => {
  const groups = new Map<string, CacheRegistrySnapshot[]>()
  for (const row of filteredCacheRows.value) {
    const domain = cacheDomain(row.name)
    const label = cacheDomainLabel(domain)
    const current = groups.get(label) ?? []
    current.push(row)
    groups.set(label, current)
  }
  return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }))
})
const cacheSummary = computed(() => {
  const totalCaches = cacheRows.value.length
  const totalEntries = cacheRows.value.reduce((total, row) => total + row.entryCount, 0)
  const totalHits = cacheRows.value.reduce((total, row) => total + row.stats.hits, 0)
  const totalMisses = cacheRows.value.reduce((total, row) => total + row.stats.misses, 0)
  const totalReads = totalHits + totalMisses
  const hitRate = totalReads > 0 ? totalHits / totalReads : null
  const attentionCount = cacheRows.value.filter((row) => {
    const reads = row.stats.hits + row.stats.misses
    return reads >= 5 && row.hitRate < 0.4
  }).length

  return {
    totalCaches,
    totalEntries,
    hitRate,
    attentionCount,
  }
})
const cacheAttentionRows = computed(() =>
  cacheRows.value
    .filter((row) => row.health === 'attention')
    .sort((a, b) => b.totalReads - a.totalReads)
    .slice(0, 5),
)

async function saveSessionLimits() {
  sessionLimitsSaving.value = true
  try {
    const res = await settingsService.updateSessionLimits({
      maxPerUser:   sessionLimitsForm.value.maxPerUser   ?? null,
      maxPerTenant: sessionLimitsForm.value.maxPerTenant ?? null,
    })
    data.value = res.data
    syncSessionLimitsForm(res.data)
    settingsService.clear()
    message.success(t('admin.settings.sessionLimits.messages.saved'))
  } catch {
    message.error(t('admin.settings.sessionLimits.messages.saveError'))
  } finally {
    sessionLimitsSaving.value = false
  }
}

async function savePasswordPolicy() {
  passwordPolicySaving.value = true
  try {
    const res = await settingsService.updatePasswordPolicy({
      minLength:   passwordPolicyForm.value.minLength,
      regex:       passwordPolicyForm.value.regex,
      description: passwordPolicyForm.value.description,
    })
    data.value = res.data
    syncPasswordPolicyForm(res.data)
    settingsService.clear()
    message.success(t('admin.settings.passwordPolicy.messages.saved'))
  } catch {
    message.error(t('admin.settings.passwordPolicy.messages.saveError'))
  } finally {
    passwordPolicySaving.value = false
  }
}

async function saveTenantSettings() {
  tenantSettingsSaving.value = true
  try {
    const res = await settingsService.updateTenantSettings({
      totpIssuer: tenantSettingsForm.value.totpIssuer,
      hostsDefaultView: tenantSettingsForm.value.hostsDefaultView,
    })
    data.value = res.data
    syncTenantSettingsForm(res.data)
    settingsService.clear()
    message.success(t('admin.settings.tenantSettings.messages.saved'))
  } catch {
    message.error(t('admin.settings.tenantSettings.messages.saveError'))
  } finally {
    tenantSettingsSaving.value = false
  }
}

async function saveJitAccessSettings() {
  jitAccessSaving.value = true
  try {
    const maxExpiryMinutes = Math.min(1440, Math.max(1, Math.floor(jitAccessForm.value.maxExpiryMinutes)))
    const expiryMinutes = Array.from(new Set(jitAccessForm.value.expiryMinutes
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= maxExpiryMinutes)))
      .sort((a, b) => a - b)
    const res = await settingsService.updateJitAccess({
      enabled: jitAccessForm.value.enabled,
      maxExpiryMinutes,
      expiryMinutes: expiryMinutes.length > 0 ? expiryMinutes : [Math.min(10, maxExpiryMinutes)],
      pinRequired: jitAccessForm.value.pinRequired,
    })
    data.value = res.data
    syncJitAccessForm(res.data)
    settingsService.clear()
    message.success(t('admin.settings.jitAccess.messages.saved'))
  } catch {
    message.error(t('admin.settings.jitAccess.messages.saveError'))
  } finally {
    jitAccessSaving.value = false
  }
}

async function saveSharedSessionSettings() {
  sharedSessionSaving.value = true
  try {
    const maxExpiryMinutes = Math.min(1440, Math.max(1, Math.floor(sharedSessionForm.value.maxExpiryMinutes)))
    const expiryMinutes = Array.from(new Set(sharedSessionForm.value.expiryMinutes
      .map((value) => Math.floor(Number(value)))
      .filter((value) => Number.isInteger(value) && value > 0 && value <= maxExpiryMinutes)))
      .sort((a, b) => a - b)
    const res = await settingsService.updateSharedSessions({
      maxExpiryMinutes,
      expiryMinutes: expiryMinutes.length > 0 ? expiryMinutes : [Math.min(10, maxExpiryMinutes)],
    })
    data.value = res.data
    syncSharedSessionForm(res.data)
    settingsService.clear()
    message.success(t('admin.settings.sharedSessions.messages.saved'))
  } catch {
    message.error(t('admin.settings.sharedSessions.messages.saveError'))
  } finally {
    sharedSessionSaving.value = false
  }
}

async function saveSftpPolicySettings() {
  sftpPolicySaving.value = true
  try {
    const res = await settingsService.updateSftpPolicy({
      blockOnModePreservationFailure: sftpPolicyForm.value.blockOnModePreservationFailure,
      blockOnOwnershipPreservationFailure: sftpPolicyForm.value.blockOnOwnershipPreservationFailure,
      blockOnTimestampPreservationFailure: sftpPolicyForm.value.blockOnTimestampPreservationFailure,
      diffMaxBytes: Math.min(10_485_760, Math.max(4_096, Math.floor(Number(sftpPolicyForm.value.diffMaxBytes)))),
      diffMaxLines: Math.min(2_000, Math.max(20, Math.floor(Number(sftpPolicyForm.value.diffMaxLines)))),
    })
    data.value = res.data
    syncSftpPolicyForm(res.data)
    settingsService.clear()
    message.success(t('admin.settings.sftpPolicy.messages.saved'))
  } catch {
    message.error(t('admin.settings.sftpPolicy.messages.saveError'))
  } finally {
    sftpPolicySaving.value = false
  }
}

async function savePolicy() {
  policySaving.value = true
  try {
    const payload = buildPolicyPayload()
    const { data: saved } = await sessionAuditPolicyService.update({
      enabled: payload.enabled,
      mode: payload.mode,
      userIds: payload.userIds,
      groupIds: payload.groupIds,
    })
    policy.value = saved
    policyForm.value = {
      enabled: saved.enabled,
      mode: saved.mode,
      userIds: [...saved.userIds],
      groupIds: [...saved.groupIds],
    }
    message.success(t('admin.settings.sessionAudit.policy.messages.saved'))
  } catch {
    message.error(t('admin.settings.sessionAudit.policy.messages.saveError'))
  } finally {
    policySaving.value = false
  }
}

async function saveLicense() {
  licenseSaving.value = true
  try {
    const payload = {
      maxHosts: licenseForm.value.limitHostsEnabled ? licenseForm.value.maxHosts : null,
      multiConnect: licenseForm.value.multiConnect,
      sessionAuditEnabled: licenseForm.value.sessionAudit,
      sessionAuditAiEnabled: licenseForm.value.sessionAudit && licenseForm.value.sessionAuditAi,
      sessionAuditAiProvider: licenseForm.value.sessionAudit && licenseForm.value.sessionAuditAi
        ? licenseForm.value.sessionAuditAiProvider
        : 'automatic',
      sessionAuditAiAutoSummaryEnabled: licenseForm.value.sessionAudit && licenseForm.value.sessionAuditAi && licenseForm.value.sessionAuditAiAutoSummary,
      featureEntitlements: {
        agents: licenseForm.value.agents,
        secrets: licenseForm.value.secrets,
        snippets: licenseForm.value.snippets,
        portForwarding: licenseForm.value.portForwarding,
        integrations: licenseForm.value.integrations,
        feedback: licenseForm.value.feedback,
        localAi: licenseForm.value.localAi,
        mcp: licenseForm.value.mcp,
        aiSshActions: licenseForm.value.aiSshActions,
        sessionAuditAiAutoSummary: licenseForm.value.sessionAudit && licenseForm.value.sessionAuditAi && licenseForm.value.sessionAuditAiAutoSummary,
      },
      integrationEntitlements: {
        jira: licenseForm.value.integrations && licenseForm.value.jira,
        google: licenseForm.value.integrations && licenseForm.value.google,
        ldap: licenseForm.value.integrations && licenseForm.value.ldap,
        onepassword: licenseForm.value.integrations && licenseForm.value.onepassword,
      },
    }

    const response = await settingsService.updateLicense(payload)
    settingsService.clear()
    featuresService.clear()
    refreshCacheRows()
    data.value = response.data
    syncLicenseForm(response.data)
    await loadCommandPolicy(response.data)
    window.dispatchEvent(new Event(FEATURES_UPDATED_EVENT))
    message.success(t('admin.settings.license.editor.messages.saved'))
  } catch {
    message.error(t('admin.settings.license.editor.messages.saveError'))
  } finally {
    licenseSaving.value = false
  }
}

async function loadCommandPolicy(settings: SettingsData) {
  if (settings.license.featureEntitlements.aiSshActions !== true) {
    commandPolicyForm.value = { safePatterns: '', approvalPatterns: '', blockedPatterns: '' }
    return
  }

  try {
    const { data: saved } = await aiSshActionCommandPolicyService.get()
    commandPolicyForm.value = {
      safePatterns: saved.safePatterns.join('\n'),
      approvalPatterns: saved.approvalPatterns.join('\n'),
      blockedPatterns: saved.blockedPatterns.join('\n'),
    }
  } catch {
    commandPolicyForm.value = { safePatterns: '', approvalPatterns: '', blockedPatterns: '' }
  }
}

function splitPatternLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function saveCommandPolicy() {
  commandPolicySaving.value = true
  try {
    const { data: saved } = await aiSshActionCommandPolicyService.update({
      safePatterns: splitPatternLines(commandPolicyForm.value.safePatterns),
      approvalPatterns: splitPatternLines(commandPolicyForm.value.approvalPatterns),
      blockedPatterns: splitPatternLines(commandPolicyForm.value.blockedPatterns),
    })
    commandPolicyForm.value = {
      safePatterns: saved.safePatterns.join('\n'),
      approvalPatterns: saved.approvalPatterns.join('\n'),
      blockedPatterns: saved.blockedPatterns.join('\n'),
    }
    message.success('Policy de comandos SSH por IA salva.')
  } catch {
    message.error('Não foi possível salvar a policy de comandos SSH por IA.')
  } finally {
    commandPolicySaving.value = false
  }
}

function commandRiskTagType(risk: 'safe' | 'approval_required' | 'blocked') {
  if (risk === 'safe') return 'success'
  if (risk === 'approval_required') return 'warning'
  return 'error'
}

async function evaluateCommandPolicy() {
  if (!commandPolicyTest.value.command.trim()) return
  commandPolicyTest.value.loading = true
  commandPolicyTest.value.result = null
  try {
    const { data: result } = await aiSshActionCommandPolicyService.evaluate(commandPolicyTest.value.command)
    commandPolicyTest.value.result = result
  } catch {
    message.error('Não foi possível avaliar o comando contra a policy.')
  } finally {
    commandPolicyTest.value.loading = false
  }
}

function buildPolicyPayload() {
  if (!policyForm.value.enabled || policyForm.value.mode === 'DISABLED' || policyForm.value.mode === 'ALL') {
    return {
      enabled: policyForm.value.enabled,
      mode: policyForm.value.enabled ? policyForm.value.mode : 'DISABLED' as SessionAuditPolicyMode,
      userIds: [],
      groupIds: [],
    }
  }

  if (policyForm.value.mode === 'USERS') {
    return {
      enabled: true,
      mode: 'USERS' as SessionAuditPolicyMode,
      userIds: policyForm.value.userIds,
      groupIds: [],
    }
  }

  if (policyForm.value.mode === 'GROUPS') {
    return {
      enabled: true,
      mode: 'GROUPS' as SessionAuditPolicyMode,
      userIds: [],
      groupIds: policyForm.value.groupIds,
    }
  }

  return {
    enabled: true,
    mode: 'MIXED' as SessionAuditPolicyMode,
    userIds: policyForm.value.userIds,
    groupIds: policyForm.value.groupIds,
  }
}

function formatCacheTimestamp(value: number | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatHitRate(value: number) {
  return `${Math.round(value * 100)}%`
}

function cacheHealthTagType(health: CacheRegistrySnapshot['health']): 'default' | 'success' | 'warning' {
  if (health === 'healthy') return 'success'
  if (health === 'warming' || health === 'attention') return 'warning'
  return 'default'
}

function cacheHealthLabel(health: CacheRegistrySnapshot['health']) {
  if (health === 'healthy') return 'saudavel'
  if (health === 'warming') return 'aquecendo'
  if (health === 'attention') return 'atencao'
  return 'frio'
}

function cacheDomain(name: string) {
  if (name.startsWith('hosts:')) return 'hosts'
  if (name === 'settings') return 'settings'
  if (name === 'features') return 'features'
  if (name.startsWith('integrations:')) return 'integrations'
  if (name.startsWith('folders:')) return 'folders'
  if (name.startsWith('groups:')) return 'groups'
  if (name.startsWith('bastions:')) return 'bastions'
  if (name.startsWith('pem-keys:')) return 'pem-keys'
  if (name.startsWith('tags:')) return 'tags'
  return 'other'
}

function cacheDomainLabel(domain: string) {
  if (domain === 'hosts') return 'Hosts'
  if (domain === 'settings') return 'Settings'
  if (domain === 'features') return 'Features'
  if (domain === 'integrations') return 'Integrations'
  if (domain === 'folders') return 'Folders'
  if (domain === 'groups') return 'Groups'
  if (domain === 'bastions') return 'Bastions'
  if (domain === 'pem-keys') return 'Pem keys'
  if (domain === 'tags') return 'Tags'
  return 'Outros'
}

function clearCache(name: string) {
  clearRegisteredCache(name)
  refreshCacheRows()
  message.success(`Cache "${name}" limpo.`)
}

function clearAllCaches() {
  clearAllRegisteredCaches()
  refreshCacheRows()
  message.success('Todos os caches registrados foram limpos.')
}

async function refreshCache(name: string) {
  await refreshRegisteredCache(name)
  refreshCacheRows()
  message.success(`Cache "${name}" renovado.`)
}

async function refreshAllCaches() {
  await refreshAllRegisteredCaches()
  refreshCacheRows()
  message.success('Todos os caches com refresh disponível foram renovados.')
}
</script>

<template>
  <div class="p-6">
    <h1 class="text-xl font-semibold text-white mb-6">{{ $t('admin.settings.title') }}</h1>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NSpin :show="loading">
      <div v-if="data" class="flex flex-col gap-6">
        <NCard :bordered="false" class="na-card">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('admin.emailConfig.title') }}</div>
              <div class="mt-1 text-sm text-zinc-400">{{ $t('admin.emailConfig.description') }}</div>
            </div>
            <NButton secondary @click="router.push({ name: 'admin-email-config' })">
              {{ $t('common.open') }}
            </NButton>
          </div>
        </NCard>

        <NCard :title="$t('admin.settings.environment.title')" :bordered="false" class="na-card">
          <div class="mb-4 text-sm text-zinc-400">
            {{ $t('admin.settings.environment.subtitle') }}
          </div>
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="feature in environmentFeatureRows"
              :key="feature.key"
              class="na-item rounded-lg border p-3"
            >
              <div class="mb-2 flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-sm font-semibold text-white">{{ feature.label }}</div>
                  <div class="mt-1 font-mono text-[11px] text-zinc-500">{{ feature.key }}</div>
                </div>
                <NTag :type="feature.enabled ? 'success' : 'default'" size="small">
                  {{ feature.enabled ? $t('common.enabled') : $t('common.disabled') }}
                </NTag>
              </div>
            </div>
          </div>
        </NCard>

        <!-- Tenant -->
        <NCard :title="$t('admin.settings.tenant.title')" :bordered="false" class="na-card">
          <NDescriptions :column="2" label-placement="left" class="mb-4">
            <NDescriptionsItem :label="$t('admin.settings.tenant.name')">
              {{ data.tenant.name }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.tenant.slug')">
              <NText class="font-mono">{{ data.tenant.slug }}</NText>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.tenant.id')">
              {{ data.tenant.id }}
            </NDescriptionsItem>
          </NDescriptions>

          <div class="na-panel rounded-xl border p-4">
            <div class="mb-3 text-sm font-semibold text-white">{{ $t('admin.settings.tenantSettings.title') }}</div>
            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.tenantSettings.totpIssuer') }}</div>
                <NInput
                  v-model:value="tenantSettingsForm.totpIssuer"
                  :placeholder="$t('admin.settings.tenantSettings.totpIssuerPlaceholder')"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.tenantSettings.totpIssuerHelp') }}</div>
              </div>
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.tenantSettings.hostsDefaultView') }}</div>
                <NSelect
                  v-model:value="tenantSettingsForm.hostsDefaultView"
                  :options="[
                    { label: $t('admin.settings.tenantSettings.hostsDefaultViews.home'), value: 'home' },
                    { label: $t('admin.settings.tenantSettings.hostsDefaultViews.list'), value: 'list' },
                  ]"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.tenantSettings.hostsDefaultViewHelp') }}</div>
              </div>
            </div>
            <NSpace justify="end" class="mt-4">
              <NButton type="primary" :loading="tenantSettingsSaving" @click="saveTenantSettings">
                {{ $t('admin.settings.tenantSettings.save') }}
              </NButton>
            </NSpace>
          </div>

          <div class="na-panel mt-4 rounded-xl border p-4">
            <div class="mb-3">
              <div class="text-sm font-semibold text-white">{{ $t('admin.settings.jitAccess.title') }}</div>
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.jitAccess.subtitle') }}</div>
            </div>
            <div class="na-item mb-3 rounded-lg border p-3">
              <NCheckbox v-model:checked="jitAccessForm.enabled">
                {{ $t('admin.settings.jitAccess.enabled') }}
              </NCheckbox>
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.jitAccess.enabledHelp') }}</div>
            </div>
            <div class="grid gap-3 md:grid-cols-[1fr_220px]">
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.jitAccess.expiryMinutes') }}</div>
                <NSelect
                  v-model:value="jitAccessForm.expiryMinutes"
                  multiple
                  tag
                  :options="jitAccessExpiryOptions"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.jitAccess.expiryMinutesHelp') }}</div>
              </div>
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.jitAccess.maxExpiryMinutes') }}</div>
                <NInputNumber
                  v-model:value="jitAccessForm.maxExpiryMinutes"
                  class="w-full"
                  :min="1"
                  :max="1440"
                  :step="5"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.jitAccess.maxExpiryMinutesHelp') }}</div>
              </div>
            </div>
            <div class="na-item mt-3 rounded-lg border p-3">
              <NCheckbox v-model:checked="jitAccessForm.pinRequired">
                {{ $t('admin.settings.jitAccess.pinRequired') }}
              </NCheckbox>
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.jitAccess.pinRequiredHelp') }}</div>
            </div>
            <NSpace justify="end" class="mt-4">
              <NButton type="primary" :loading="jitAccessSaving" @click="saveJitAccessSettings">
                {{ $t('admin.settings.jitAccess.save') }}
              </NButton>
            </NSpace>
          </div>

          <div class="na-panel mt-4 rounded-xl border p-4">
            <div class="mb-3">
              <div class="text-sm font-semibold text-white">{{ $t('admin.settings.sharedSessions.title') }}</div>
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sharedSessions.subtitle') }}</div>
            </div>
            <div class="grid gap-3 md:grid-cols-[1fr_220px]">
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.sharedSessions.expiryMinutes') }}</div>
                <NSelect
                  v-model:value="sharedSessionForm.expiryMinutes"
                  multiple
                  tag
                  :options="sharedSessionExpiryOptions"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sharedSessions.expiryMinutesHelp') }}</div>
              </div>
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.sharedSessions.maxExpiryMinutes') }}</div>
                <NInputNumber
                  v-model:value="sharedSessionForm.maxExpiryMinutes"
                  class="w-full"
                  :min="1"
                  :max="1440"
                  :step="5"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sharedSessions.maxExpiryMinutesHelp') }}</div>
              </div>
            </div>
            <NSpace justify="end" class="mt-4">
              <NButton type="primary" :loading="sharedSessionSaving" @click="saveSharedSessionSettings">
                {{ $t('admin.settings.sharedSessions.save') }}
              </NButton>
            </NSpace>
          </div>

          <div class="na-panel mt-4 rounded-xl border p-4">
            <div class="mb-3">
              <div class="text-sm font-semibold text-white">{{ $t('admin.settings.sftpPolicy.title') }}</div>
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sftpPolicy.subtitle') }}</div>
            </div>
            <div class="grid gap-3 md:grid-cols-3">
              <div class="na-item rounded-lg border p-3">
                <NCheckbox v-model:checked="sftpPolicyForm.blockOnModePreservationFailure">
                  {{ $t('admin.settings.sftpPolicy.blockMode') }}
                </NCheckbox>
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sftpPolicy.blockModeHelp') }}</div>
              </div>
              <div class="na-item rounded-lg border p-3">
                <NCheckbox v-model:checked="sftpPolicyForm.blockOnOwnershipPreservationFailure">
                  {{ $t('admin.settings.sftpPolicy.blockOwnership') }}
                </NCheckbox>
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sftpPolicy.blockOwnershipHelp') }}</div>
              </div>
              <div class="na-item rounded-lg border p-3">
                <NCheckbox v-model:checked="sftpPolicyForm.blockOnTimestampPreservationFailure">
                  {{ $t('admin.settings.sftpPolicy.blockTimestamp') }}
                </NCheckbox>
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sftpPolicy.blockTimestampHelp') }}</div>
              </div>
            </div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.sftpPolicy.diffMaxBytes') }}</div>
                <NInputNumber
                  v-model:value="sftpPolicyForm.diffMaxBytes"
                  class="w-full"
                  :min="4096"
                  :max="10485760"
                  :step="65536"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sftpPolicy.diffMaxBytesHelp') }}</div>
              </div>
              <div>
                <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.sftpPolicy.diffMaxLines') }}</div>
                <NInputNumber
                  v-model:value="sftpPolicyForm.diffMaxLines"
                  class="w-full"
                  :min="20"
                  :max="2000"
                  :step="20"
                />
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sftpPolicy.diffMaxLinesHelp') }}</div>
              </div>
            </div>
            <NSpace justify="end" class="mt-4">
              <NButton type="primary" :loading="sftpPolicySaving" @click="saveSftpPolicySettings">
                {{ $t('admin.settings.sftpPolicy.save') }}
              </NButton>
            </NSpace>
          </div>
        </NCard>

        <NCard :title="$t('admin.settings.hostKey.title')" :bordered="false" class="na-card">
          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <NText depth="3" class="text-sm leading-6">
                {{ $t('admin.settings.hostKey.description') }}
              </NText>

              <div class="mt-4 grid gap-3 md:grid-cols-3">
                <div class="na-item rounded-lg border p-3">
                  <div class="text-sm font-semibold text-white">{{ $t('admin.settings.hostKey.firstConnectionTitle') }}</div>
                  <div class="mt-1 text-xs leading-5 text-zinc-500">{{ $t('admin.settings.hostKey.firstConnectionDescription') }}</div>
                </div>
                <div class="na-item rounded-lg border p-3">
                  <div class="text-sm font-semibold text-white">{{ $t('admin.settings.hostKey.changedTitle') }}</div>
                  <div class="mt-1 text-xs leading-5 text-zinc-500">{{ $t('admin.settings.hostKey.changedDescription') }}</div>
                </div>
                <div class="na-item rounded-lg border p-3">
                  <div class="text-sm font-semibold text-white">{{ $t('admin.settings.hostKey.auditTitle') }}</div>
                  <div class="mt-1 text-xs leading-5 text-zinc-500">{{ $t('admin.settings.hostKey.auditDescription') }}</div>
                </div>
              </div>
            </div>

            <div class="na-panel rounded-xl border p-4">
              <div class="text-sm font-semibold text-white">{{ $t('admin.settings.hostKey.reportTitle') }}</div>
              <div class="mt-1 text-xs leading-5 text-zinc-500">{{ $t('admin.settings.hostKey.reportDescription') }}</div>
              <NButton
                class="mt-4"
                secondary
                size="small"
                @click="router.push({ name: 'admin-reports-host-keys' })"
              >
                {{ $t('admin.settings.hostKey.openReport') }}
              </NButton>
            </div>
          </div>
        </NCard>

        <NCard title="Cache do frontend" :bordered="false" class="na-card">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-white">Observabilidade de cache</div>
              <div class="mt-1 text-xs text-zinc-400">
                Mostra caches registrados no cliente, hit rate, quantidade de entradas e permite limpeza manual.
              </div>
              <div class="mt-2 flex flex-wrap gap-2">
                <NTag size="small" type="default">{{ cacheSummary.totalCaches }} caches</NTag>
                <NTag size="small" type="info">{{ cacheSummary.totalEntries }} entradas</NTag>
                <NTag size="small" :type="cacheSummary.hitRate !== null && cacheSummary.hitRate >= 0.7 ? 'success' : cacheSummary.hitRate !== null && cacheSummary.hitRate >= 0.4 ? 'warning' : 'default'">
                  Hit rate {{ cacheSummary.hitRate === null ? '—' : formatHitRate(cacheSummary.hitRate) }}
                </NTag>
                <NTag size="small" :type="cacheSummary.attentionCount > 0 ? 'warning' : 'success'">
                  {{ cacheSummary.attentionCount > 0 ? `${cacheSummary.attentionCount} alertas` : 'Sem alertas' }}
                </NTag>
              </div>
            </div>
            <NSpace>
              <NButton secondary @click="refreshCacheRows">Atualizar</NButton>
              <NButton secondary @click="cacheSectionExpanded = !cacheSectionExpanded">
                {{ cacheSectionExpanded ? 'Recolher' : 'Expandir' }}
              </NButton>
            </NSpace>
          </div>

          <div v-if="cacheSectionExpanded" class="mt-4">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div class="text-xs text-zinc-500">
                Ajustes operacionais. Abra apenas quando precisar investigar ou renovar cache manualmente.
              </div>
              <NSpace>
                <NButton secondary @click="refreshAllCaches">Renovar suportados</NButton>
                <NButton type="warning" secondary @click="clearAllCaches">Limpar todos</NButton>
              </NSpace>
            </div>

            <div class="mb-4 flex flex-wrap gap-3">
              <NInput
                v-model:value="cacheSearch"
                clearable
                placeholder="Buscar cache por nome"
                style="width: 280px;"
              />
              <NSelect
                v-model:value="cacheDomainFilter"
                :options="cacheDomainOptions"
                style="width: 220px;"
              />
            </div>

            <div v-if="cacheRows.length === 0" class="text-sm text-zinc-400">
              Nenhum cache registrado no frontend.
            </div>

            <div v-else-if="filteredCacheRows.length === 0" class="text-sm text-zinc-400">
              Nenhum cache encontrado para o filtro atual.
            </div>

            <div v-else class="grid gap-4">
              <div
                v-if="cacheAttentionRows.length > 0"
                class="na-panel rounded-lg border border-amber-700/40 p-4"
              >
                <div class="mb-2 text-sm font-semibold text-gray-200">Caches quentes com baixo hit rate</div>
                <div class="flex flex-wrap gap-2">
                  <NTag
                    v-for="row in cacheAttentionRows"
                    :key="`attention-${row.name}`"
                    size="small"
                    type="warning"
                  >
                    {{ row.name }} · {{ row.totalReads }} leituras · {{ formatHitRate(row.hitRate) }}
                  </NTag>
                </div>
                <div class="mt-3 grid gap-2">
                  <div
                    v-for="row in cacheAttentionRows"
                    :key="`attention-detail-${row.name}`"
                    class="na-item rounded border border-amber-800/40 px-3 py-2 text-xs text-gray-300"
                  >
                    <div class="font-medium">{{ row.name }}</div>
                    <div class="mt-1 text-gray-400">{{ cacheMissHint(row) }}</div>
                    <div class="mt-1 text-gray-400">{{ cacheKeyInsightLabel(row) }}</div>
                  </div>
                </div>
              </div>

              <div
                v-for="group in groupedCacheRows"
                :key="group.label"
                class="na-panel rounded-lg border p-4"
              >
                <div class="mb-3 text-sm font-semibold text-white">{{ group.label }}</div>
                <div class="grid gap-3">
                  <div
                    v-for="row in group.rows"
                    :key="row.name"
                    class="na-item rounded-lg border p-4"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-white">{{ row.name }}</div>
                        <div class="mt-1 text-xs text-zinc-400">
                          {{ row.kind }} · TTL {{ Math.round(row.ttlMs / 1000) }}s · {{ row.entryCount }} entrada(s)
                        </div>
                      </div>
                      <NSpace>
                        <NTag size="small" :type="cacheHealthTagType(row.health)">
                          {{ cacheHealthLabel(row.health) }}
                        </NTag>
                        <NTag size="small" :type="row.hitRate >= 0.7 ? 'success' : row.hitRate >= 0.4 ? 'warning' : 'default'">
                          Hit rate {{ formatHitRate(row.hitRate) }}
                        </NTag>
                        <NButton v-if="row.canRefresh" size="small" secondary @click="refreshCache(row.name)">Renovar</NButton>
                        <NButton size="small" secondary @click="clearCache(row.name)">Limpar</NButton>
                      </NSpace>
                    </div>

                    <NDescriptions :column="3" label-placement="top" class="mt-4">
                    <NDescriptionsItem label="Hits">{{ row.stats.hits }}</NDescriptionsItem>
                    <NDescriptionsItem label="Misses">{{ row.stats.misses }}</NDescriptionsItem>
                    <NDescriptionsItem label="Leituras / hit rate">{{ row.totalReads }} / {{ formatHitRate(row.hitRate) }}</NDescriptionsItem>
                    <NDescriptionsItem label="Sets / updates">{{ row.stats.sets }} / {{ row.stats.updates }}</NDescriptionsItem>
                    <NDescriptionsItem label="Clears">{{ row.stats.clears }}</NDescriptionsItem>
                    <NDescriptionsItem label="Último hit">{{ formatCacheTimestamp(row.stats.lastHitAt) }}</NDescriptionsItem>
                    <NDescriptionsItem label="Último miss">{{ formatCacheTimestamp(row.stats.lastMissAt) }}</NDescriptionsItem>
                    <NDescriptionsItem label="Última atividade">{{ formatCacheTimestamp(row.lastActivityAt) }}</NDescriptionsItem>
                    <NDescriptionsItem label="Última mutação">{{ cacheMutationLabel(row) }}</NDescriptionsItem>
                    <NDescriptionsItem label="Mutação em">{{ formatCacheTimestamp(row.meta.lastMutationAt) }}</NDescriptionsItem>
                    </NDescriptions>

                    <div v-if="row.keyInsights.length > 0" class="mt-4">
                      <div class="text-xs font-medium text-zinc-300">Chaves mais lidas</div>
                      <div class="mt-2 flex flex-wrap gap-2">
                        <NTag
                          v-for="entry in row.keyInsights"
                          :key="`${row.name}-${entry.key}`"
                          size="small"
                          :type="entry.hitRate >= 0.7 ? 'success' : entry.hitRate >= 0.4 ? 'warning' : 'default'"
                        >
                          {{ entry.label }} · {{ entry.reads }} leituras · {{ formatHitRate(entry.hitRate) }}
                        </NTag>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </NCard>

        <!-- Licença -->
        <NCard :title="$t('admin.settings.license.title')" :bordered="false" class="na-card">
          <NDescriptions :column="2" label-placement="left" class="mb-4">
            <NDescriptionsItem :label="$t('admin.settings.license.activeUsers')">
              {{ data.license.activeUsers }} / {{ data.license.maxUsers }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.registeredHosts')">
              {{ data.license.registeredHosts }} / {{ data.license.maxHosts ?? $t('common.unlimited') }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.key')">
              <NTag :type="data.license.hasKey ? 'success' : 'warning'" size="small">
                {{ data.license.hasKey ? $t('admin.settings.license.registered') : $t('admin.settings.license.notConfigured') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.multiConnect')">
              <NTag :type="data.license.multiConnect ? 'success' : 'default'" size="small">
                {{ data.license.multiConnect ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.sessionAudit')">
              <NTag :type="data.license.sessionAuditEnabled ? 'success' : 'default'" size="small">
                {{ data.license.sessionAuditEnabled ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.auditAiProvider')">
              {{ $t(`admin.settings.license.auditAiProviders.${data.license.sessionAuditAiProvider}`) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.sessionAuditAiAutoSummary')">
              <NTag :type="data.license.sessionAuditAiAutoSummaryEnabled ? 'success' : 'default'" size="small">
                {{ data.license.sessionAuditAiAutoSummaryEnabled ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.agents')">
              <NTag :type="data.license.featureEntitlements.agents ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.agents ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.secrets')">
              <NTag :type="data.license.featureEntitlements.secrets ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.secrets ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.snippets')">
              <NTag :type="data.license.featureEntitlements.snippets ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.snippets ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.sshTunnels')">
              <NTag :type="data.license.featureEntitlements.portForwarding ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.portForwarding ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.integrations')">
              <NTag :type="data.license.featureEntitlements.integrations ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.integrations ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.feedback')">
              <NTag :type="data.license.featureEntitlements.feedback ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.feedback ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.localAi')">
              <NTag :type="data.license.featureEntitlements.localAi ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.localAi ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.mcp')">
              <NTag :type="data.license.featureEntitlements.mcp ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.mcp ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.aiSshActions')">
              <NTag :type="data.license.featureEntitlements.aiSshActions ? 'success' : 'default'" size="small">
                {{ data.license.featureEntitlements.aiSshActions ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="Alta disponibilidade">
              <NSpace align="center" size="small">
                <NTag :type="data.license.featureEntitlements.ha ? 'success' : 'default'" size="small">
                  {{ data.license.featureEntitlements.ha ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
                </NTag>
                <NButton
                  v-if="auth.isPlatformAdmin"
                  size="tiny"
                  text
                  type="primary"
                  @click="router.push({ name: 'platform-high-availability' })"
                >
                  Gerenciar
                </NButton>
              </NSpace>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.settings.license.integrationProviders')">
              <span v-if="licensedIntegrationProviders.length > 0">
                {{ licensedIntegrationProviders.join(', ') }}
              </span>
              <span v-else>{{ $t('common.none') }}</span>
            </NDescriptionsItem>
          </NDescriptions>
          <NProgress
            type="line"
            :percentage="licensePercent"
            :status="licenseStatus"
            :show-indicator="true"
          />

          <div class="na-panel mt-6 rounded-xl border p-4">
            <div class="mb-4">
              <div class="text-sm font-semibold text-white">{{ $t('admin.settings.license.editor.title') }}</div>
              <div class="mt-1 text-xs text-zinc-400">{{ $t('admin.settings.license.editor.subtitle') }}</div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <div class="na-item rounded-lg border p-3">
                <label class="flex items-center gap-2 text-sm text-zinc-200">
                  <NCheckbox v-model:checked="licenseForm.limitHostsEnabled" />
                  <span>{{ $t('admin.settings.license.editor.limitHostsEnabled') }}</span>
                  <NTooltip trigger="hover">
                    <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                    {{ licenseHelp.maxHosts }}
                  </NTooltip>
                </label>
                <div class="mt-3">
                  <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.license.editor.maxHostsLabel') }}</div>
                  <NInputNumber
                    v-model:value="licenseForm.maxHosts"
                    :min="1"
                    :disabled="!licenseForm.limitHostsEnabled"
                    style="width: 100%;"
                  />
                  <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.license.editor.maxHostsHelp') }}</div>
                </div>
                <label class="mt-4 flex items-center gap-2 text-sm text-zinc-200">
                  <NCheckbox v-model:checked="licenseForm.multiConnect" />
                  <span>{{ $t('admin.settings.license.multiConnect') }}</span>
                  <NTooltip trigger="hover">
                    <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                    {{ licenseHelp.multiConnect }}
                  </NTooltip>
                </label>
                <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.license.editor.multiConnectHelp') }}</div>
              </div>

              <div class="na-item rounded-lg border p-3">
                <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {{ $t('admin.settings.license.editor.featuresTitle') }}
                </div>
                <div class="flex flex-col gap-2 text-sm text-zinc-200">
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.sessionAudit" />
                    <span>{{ $t('admin.settings.license.sessionAudit') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.sessionAudit }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.sessionAuditAi" :disabled="!licenseForm.sessionAudit" />
                    <span>{{ $t('admin.settings.license.sessionAuditAi') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.sessionAuditAi }}
                    </NTooltip>
                  </label>
                  <div class="pl-6">
                    <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.license.auditAiProvider') }}</div>
                    <NSelect
                      v-model:value="licenseForm.sessionAuditAiProvider"
                      :options="sessionAuditAiProviderOptions"
                      :disabled="!licenseForm.sessionAudit || !licenseForm.sessionAuditAi"
                    />
                    <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.license.editor.auditAiProviderHelp') }}</div>
                  </div>
                  <label class="flex items-center gap-2 pl-6">
                    <NCheckbox
                      v-model:checked="licenseForm.sessionAuditAiAutoSummary"
                      :disabled="!licenseForm.sessionAudit || !licenseForm.sessionAuditAi"
                    />
                    <span>{{ $t('admin.settings.license.sessionAuditAiAutoSummary') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.sessionAuditAiAutoSummary }}
                    </NTooltip>
                  </label>
                  <div class="pl-12 -mt-1 text-xs text-zinc-500">
                    {{ $t('admin.settings.license.editor.auditAiAutoSummaryHelp') }}
                  </div>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.agents" />
                    <span>{{ $t('admin.settings.license.agents') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.agents }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.secrets" />
                    <span>{{ $t('admin.settings.license.secrets') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.secrets }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.snippets" />
                    <span>{{ $t('admin.settings.license.snippets') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.snippets }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.portForwarding" />
                    <span>{{ $t('admin.settings.license.sshTunnels') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.portForwarding }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.integrations" />
                    <span>{{ $t('admin.settings.license.integrations') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.integrations }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.feedback" />
                    <span>{{ $t('admin.settings.license.feedback') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.feedback }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.localAi" />
                    <span>{{ $t('admin.settings.license.localAi') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.localAi }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.mcp" />
                    <span>{{ $t('admin.settings.license.mcp') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.mcp }}
                    </NTooltip>
                  </label>
                  <label class="flex items-center gap-2">
                    <NCheckbox v-model:checked="licenseForm.aiSshActions" />
                    <span>{{ $t('admin.settings.license.aiSshActions') }}</span>
                    <NTooltip trigger="hover">
                      <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                      {{ licenseHelp.aiSshActions }}
                    </NTooltip>
                  </label>
                </div>
              </div>
            </div>

            <div class="na-item mt-4 rounded-lg border p-3">
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {{ $t('admin.settings.license.editor.providersTitle') }}
              </div>
              <div class="mb-2 text-xs text-zinc-500">{{ $t('admin.settings.license.editor.providersHelp') }}</div>
              <div class="flex flex-wrap gap-4 text-sm text-zinc-200">
                <label class="flex items-center gap-2">
                  <NCheckbox v-model:checked="licenseForm.jira" :disabled="!canEditIntegrationProviders" />
                  <span>JIRA</span>
                  <NTooltip trigger="hover">
                    <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                    {{ licenseHelp.providers }}
                  </NTooltip>
                </label>
                <label class="flex items-center gap-2">
                  <NCheckbox v-model:checked="licenseForm.google" :disabled="!canEditIntegrationProviders" />
                  <span>Google</span>
                  <NTooltip trigger="hover">
                    <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                    {{ licenseHelp.providers }}
                  </NTooltip>
                </label>
                <label class="flex items-center gap-2">
                  <NCheckbox v-model:checked="licenseForm.ldap" :disabled="!canEditIntegrationProviders" />
                  <span>LDAP</span>
                  <NTooltip trigger="hover">
                    <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                    {{ licenseHelp.providers }}
                  </NTooltip>
                </label>
                <label class="flex items-center gap-2">
                  <NCheckbox v-model:checked="licenseForm.onepassword" :disabled="!canEditIntegrationProviders" />
                  <span>1Password</span>
                  <NTooltip trigger="hover">
                    <template #trigger><span class="cursor-help text-xs text-zinc-500">?</span></template>
                    {{ licenseHelp.providers }}
                  </NTooltip>
                </label>
              </div>
            </div>

            <NSpace justify="end" class="mt-4">
              <NButton type="primary" :loading="licenseSaving" @click="saveLicense">
                {{ $t('admin.settings.license.editor.save') }}
              </NButton>
            </NSpace>
          </div>
        </NCard>

        <NCard title="Policy de comandos SSH por IA" :bordered="false" class="na-card">
          <NAlert
            v-if="!data.license.featureEntitlements.aiSshActions"
            type="warning"
            class="mb-4"
          >
            Ações SSH por IA não estão licenciadas para este tenant.
          </NAlert>

          <template v-else>
            <NAlert type="info" class="mb-4">
              Configure regex por linha. A precedência é: bloqueado, seguro customizado, aprovação obrigatória.
            </NAlert>

            <div class="grid gap-4 lg:grid-cols-3">
              <div>
                <NText depth="3" class="text-sm">Safe patterns</NText>
                <NInput
                  v-model:value="commandPolicyForm.safePatterns"
                  type="textarea"
                  class="mt-2"
                  placeholder="^systemctl status nginx$"
                  :autosize="{ minRows: 6, maxRows: 12 }"
                />
                <div class="mt-1 text-xs text-zinc-500">Comandos permitidos quando não baterem em bloqueio.</div>
              </div>

              <div>
                <NText depth="3" class="text-sm">Approval required patterns</NText>
                <NInput
                  v-model:value="commandPolicyForm.approvalPatterns"
                  type="textarea"
                  class="mt-2"
                  placeholder="^docker restart "
                  :autosize="{ minRows: 6, maxRows: 12 }"
                />
                <div class="mt-1 text-xs text-zinc-500">Comandos que exigem aprovação administrativa antes da execução.</div>
              </div>

              <div>
                <NText depth="3" class="text-sm">Blocked patterns</NText>
                <NInput
                  v-model:value="commandPolicyForm.blockedPatterns"
                  type="textarea"
                  class="mt-2"
                  placeholder="^mysql .*DROP"
                  :autosize="{ minRows: 6, maxRows: 12 }"
                />
                <div class="mt-1 text-xs text-zinc-500">Comandos bloqueados mesmo com aprovação.</div>
              </div>
            </div>

            <NSpace justify="end" class="mt-4">
              <NButton type="primary" :loading="commandPolicySaving" @click="saveCommandPolicy">
                Salvar policy
              </NButton>
            </NSpace>

            <div class="na-panel mt-4 rounded-lg border p-3">
              <div class="mb-2 text-sm font-semibold text-white">Testar comando</div>
              <div class="grid gap-3 md:grid-cols-[1fr_auto]">
                <NInput
                  v-model:value="commandPolicyTest.command"
                  placeholder="Ex.: systemctl restart nginx"
                  clearable
                  @keyup.enter="evaluateCommandPolicy"
                />
                <NButton
                  secondary
                  :loading="commandPolicyTest.loading"
                  :disabled="!commandPolicyTest.command.trim()"
                  @click="evaluateCommandPolicy"
                >
                  Avaliar
                </NButton>
              </div>
              <div v-if="commandPolicyTest.result" class="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <NText depth="3">Resultado:</NText>
                <NTag :type="commandRiskTagType(commandPolicyTest.result.risk)" size="small">
                  {{ commandPolicyTest.result.risk }}
                </NTag>
                <NText depth="3" class="font-mono text-xs">{{ commandPolicyTest.result.command }}</NText>
              </div>
              <div class="mt-2 text-xs text-zinc-500">
                O teste usa a policy persistida no banco. Salve antes de testar alterações feitas acima.
              </div>
            </div>
          </template>
        </NCard>

        <NCard :title="$t('admin.settings.sessionAudit.title')" :bordered="false" class="na-card">
          <NAlert
            v-if="!data.license.sessionAuditEnabled"
            type="warning"
            class="mb-4"
          >
            {{ $t('admin.settings.sessionAudit.notLicensed') }}
          </NAlert>

          <template v-else>
            <NDescriptions :column="2" label-placement="left" class="mb-4">
              <NDescriptionsItem :label="$t('admin.settings.sessionAudit.currentStatus')">
                <NTag :type="policyForm.enabled ? 'success' : 'default'" size="small">
                  {{ policyForm.enabled ? $t('admin.settings.license.enabled') : $t('admin.settings.license.disabled') }}
                </NTag>
              </NDescriptionsItem>
              <NDescriptionsItem :label="$t('admin.settings.sessionAudit.mode')">
                <NText>{{ $t(`admin.settings.sessionAudit.policy.modes.${policyForm.mode}`) }}</NText>
              </NDescriptionsItem>
            </NDescriptions>

            <NAlert
              v-if="policyCache"
              type="info"
              class="mb-4"
              :title="$t('admin.settings.sessionAudit.cache.title')"
            >
              <div class="flex flex-col gap-2 text-sm">
                <div>
                  {{ $t('admin.settings.sessionAudit.cache.description', { ttl: policyCache.ttlSeconds }) }}
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <NTag :type="policyCache.enabled ? 'success' : 'default'" size="small">
                    {{ policyCache.enabled ? $t('admin.settings.sessionAudit.cache.enabled') : $t('admin.settings.sessionAudit.cache.disabled') }}
                  </NTag>
                  <NText depth="3" class="text-xs">
                    {{ $t('admin.settings.sessionAudit.cache.future') }}
                  </NText>
                </div>
              </div>
            </NAlert>

            <div class="flex flex-col gap-4">
              <label class="flex items-center gap-2 text-sm text-zinc-200">
                <input v-model="policyForm.enabled" type="checkbox">
                <span>{{ $t('admin.settings.sessionAudit.enabledLabel') }}</span>
              </label>

              <div>
                <NText depth="3" class="text-sm">{{ $t('admin.settings.sessionAudit.mode') }}</NText>
                <NSelect
                  v-model:value="policyForm.mode"
                  :options="policyModeOptions"
                  class="mt-2"
                />
              </div>

              <div v-if="showUserScope">
                <NText depth="3" class="text-sm">{{ $t('admin.settings.sessionAudit.policy.usersTitle') }}</NText>
                <NTransfer
                  v-model:value="policyForm.userIds"
                  class="mt-2"
                  :options="userTransferOptions"
                  source-filterable
                  target-filterable
                />
              </div>

              <div v-if="showGroupScope">
                <NText depth="3" class="text-sm">{{ $t('admin.settings.sessionAudit.policy.groupsTitle') }}</NText>
                <NTransfer
                  v-model:value="policyForm.groupIds"
                  class="mt-2"
                  :options="groupTransferOptions"
                  source-filterable
                  target-filterable
                />
              </div>

              <NSpace justify="end">
                <NButton type="primary" :loading="policySaving" @click="savePolicy">
                  {{ $t('admin.settings.sessionAudit.policy.save') }}
                </NButton>
              </NSpace>
            </div>
          </template>
        </NCard>

        <NCard :title="$t('admin.settings.sessionLimits.title')" :bordered="false" class="na-card">
          <NDescriptions :column="1" label-placement="left" class="mb-4">
            <NDescriptionsItem :label="$t('admin.settings.sessionLimits.activeSessions')">
              <NTag size="small" :type="data.sessionLimits.activeSessions > 0 ? 'success' : 'default'">
                {{ data.sessionLimits.activeSessions }}
              </NTag>
            </NDescriptionsItem>
          </NDescriptions>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.sessionLimits.maxPerUser') }}</div>
              <NInputNumber
                v-model:value="sessionLimitsForm.maxPerUser"
                :min="1"
                :placeholder="$t('common.unlimited')"
                clearable
                style="width: 100%;"
              />
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sessionLimits.maxPerUserHelp') }}</div>
            </div>
            <div>
              <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.sessionLimits.maxPerTenant') }}</div>
              <NInputNumber
                v-model:value="sessionLimitsForm.maxPerTenant"
                :min="1"
                :placeholder="$t('common.unlimited')"
                clearable
                style="width: 100%;"
              />
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.sessionLimits.maxPerTenantHelp') }}</div>
            </div>
          </div>
          <NSpace justify="end" class="mt-4">
            <NButton type="primary" :loading="sessionLimitsSaving" @click="saveSessionLimits">
              {{ $t('admin.settings.sessionLimits.save') }}
            </NButton>
          </NSpace>
        </NCard>

        <!-- Política de senhas -->
        <NCard :title="$t('admin.settings.passwordPolicy.title')" :bordered="false" class="na-card">
          <NAlert type="info" class="mb-4" style="font-size: 12px;">
            {{ $t('admin.settings.passwordPolicy.info') }}
          </NAlert>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.passwordPolicy.description') }}</div>
              <NInput
                v-model:value="passwordPolicyForm.description"
                :placeholder="$t('admin.settings.passwordPolicy.descriptionPlaceholder')"
              />
            </div>
            <div>
              <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.passwordPolicy.minLength') }}</div>
              <NInputNumber
                v-model:value="passwordPolicyForm.minLength"
                :min="1"
                :max="128"
                style="width: 100%;"
              />
            </div>
            <div class="md:col-span-2">
              <div class="mb-1 text-xs text-zinc-400">{{ $t('admin.settings.passwordPolicy.regex') }}</div>
              <NInput
                v-model:value="passwordPolicyForm.regex"
                class="font-mono"
                placeholder="^(?=.*[A-Z])(?=.*\d).{8,}$"
              />
              <div class="mt-1 text-xs text-zinc-500">{{ $t('admin.settings.passwordPolicy.regexHelp') }}</div>
            </div>
          </div>
          <NSpace justify="end" class="mt-4">
            <NButton type="primary" :loading="passwordPolicySaving" @click="savePasswordPolicy">
              {{ $t('admin.settings.passwordPolicy.save') }}
            </NButton>
          </NSpace>
        </NCard>

      </div>
    </NSpin>
  </div>
</template>
