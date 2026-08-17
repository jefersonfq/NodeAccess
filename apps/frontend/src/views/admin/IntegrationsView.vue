<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NCard, NButton, NInput, NSwitch, NTag, NAlert, NSpin, NText,
  NDivider, NTooltip, NInputNumber, NCheckbox, NSelect, useMessage,
} from 'naive-ui'
import type { IntegrationPublic, GoogleConfigPublic, LdapConfigPublic, LdapTestResult, UpsertLdapDto, JiraConfigPublic, OpenAiConfigPublic, LocalAiConfigPublic, LocalAiKnowledgeDocument } from '@nodeaccess/shared'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import OidcIntegrationCard from '@/components/integrations/OidcIntegrationCard.vue'
import ScimIntegrationCard from '@/components/integrations/ScimIntegrationCard.vue'
import { integrationService } from '@/services/integration.service'
import { featuresService } from '@/services/features.service'
import { localAiService } from '@/services/local-ai.service'
import { userService } from '@/services/user.service'
import { groupService } from '@/services/group.service'
import { inventoryService } from '@/services/inventory.service'
import type { UserPublic, GroupPublic, InventoryNodePublic } from '@nodeaccess/shared'
import { integrationReadinessPresentation } from '@/services/integration-readiness.service'

const { t } = useI18n()
const router = useRouter()

const msg     = useMessage()
const loading = ref(true)

// Estado das integrações
const integrations = ref<IntegrationPublic[]>([])

function readinessLabel(config: OpenAiConfigPublic | LocalAiConfigPublic | JiraConfigPublic | LdapConfigPublic) {
  return t(integrationReadinessPresentation(config.readinessStatus).translationKey)
}

function readinessTagType(config: OpenAiConfigPublic | LocalAiConfigPublic | JiraConfigPublic | LdapConfigPublic) {
  return integrationReadinessPresentation(config.readinessStatus).tagType
}

// ── 1Password ────────────────────────────────────────────────────────────────

const opEnabled = ref(false)
const opToken   = ref('')
const opSaving  = ref(false)
const opSaved   = ref<IntegrationPublic | null>(null)

// ── Google Workspace ─────────────────────────────────────────────────────────

const gSaved              = ref<GoogleConfigPublic | null>(null)
const gEnabled            = ref(false)
const gClientId           = ref('')
const gAdminEmail         = ref('')
const gDomain             = ref('')
const gSyncInterval       = ref(60)
const gAutoProvision      = ref(false)
const gServiceAccountJson = ref('')
const gSaving             = ref(false)
const gSyncing            = ref(false)

// ── LDAP / Active Directory ─────────────────────────────────────────────────

const ldapSaved = ref<LdapConfigPublic | null>(null)
const ldapEnabled = ref(false)
const ldapUrl = ref('')
const ldapBindDn = ref('')
const ldapBindPassword = ref('')
const ldapBaseDn = ref('')
const ldapUserSearchFilter = ref('(mail={{email}})')
const ldapStartTls = ref(false)
const ldapTlsRejectUnauthorized = ref(true)
const ldapAutoProvision = ref(false)
const ldapSaving = ref(false)
const ldapTesting = ref(false)
const ldapTestResult = ref<LdapTestResult | null>(null)

// ── OpenAI / Session Audit AI ────────────────────────────────────────────────

const aiSaved         = ref<OpenAiConfigPublic | null>(null)
const aiEnabled       = ref(false)
const aiApiKey        = ref('')
const aiBaseUrl       = ref('')
const aiDefaultModel  = ref('gpt-5-mini')
const aiAuditInstructions = ref('')
const aiSaving        = ref(false)
const aiTesting       = ref(false)
const aiLicensed      = ref(false)
const localAiLicensed = ref(false)
const integrationsLicensed = ref(false)
const integrationProviders = ref<Record<string, boolean>>({})

// ── Local AI / Assistente local ────────────────────────────────────────────

const localAiSaved = ref<LocalAiConfigPublic | null>(null)
const localAiEnabled = ref(false)
const localAiMode = ref<'read_only' | 'low_impact' | 'full_control'>('read_only')
const localAiRoutingPolicy = ref<'local_only' | 'network_only' | 'prefer_local' | 'prefer_network'>('local_only')
const localAiLocalProvider = ref('ollama')
const localAiLocalBaseUrl = ref('http://localhost:11434')
const localAiLocalModel = ref('qwen2.5-coder:3b')
const localAiNetworkProvider = ref('openai_compatible')
const localAiNetworkBaseUrl = ref('')
const localAiNetworkModel = ref('')
const localAiNetworkApiKey = ref('')
const localAiAuditInstructions = ref('')
const localAiAssistantInstructions = ref('')
const localAiMonthlyRequestLimit = ref<number | null>(null)
const localAiInteractionRetentionDays = ref(30)
const localAiSaving = ref(false)
const localAiTesting = ref(false)
const localAiDocuments = ref<LocalAiKnowledgeDocument[]>([])
const localAiTextTitle = ref('')
const localAiTextDescription = ref('')
const localAiTextContent = ref('')
const localAiLinkTitle = ref('')
const localAiLinkDescription = ref('')
const localAiLinkUrl = ref('')
const localAiLinkContent = ref('')
const localAiDocumentSaving = ref(false)
const localAiDocumentDeletingId = ref<number | null>(null)
const localAiUploadRef = ref<HTMLInputElement | null>(null)
const localAiActivity = ref<Array<{
  id: number
  action: 'TEST_LOCAL_AI' | 'OPEN_LOCAL_AI_DIAGNOSTIC'
  adminName: string
  timestamp: string
  details?: string | null
}>>([])

// ── JIRA ────────────────────────────────────────────────────────────────────

const jiraSaved               = ref<JiraConfigPublic | null>(null)
const jiraEnabled             = ref(false)
const jiraBaseUrl             = ref('')
const jiraServiceAccountEmail = ref('')
const jiraApiToken            = ref('')
const jiraProjectKeys         = ref('')
const jiraSaving              = ref(false)
const jiraTesting             = ref(false)
const jiraOAuthStarting       = ref(false)
const jiraTicketRequirement   = ref<'optional' | 'required'>('optional')
const jiraTicketEnforcementMode = ref<'off' | 'tenant' | 'selected'>('off')
const jiraTicketUserIds = ref<number[]>([])
const jiraTicketGroupIds = ref<number[]>([])
const jiraTicketInventoryFolderIds = ref<number[]>([])
const jiraPolicyUsers = ref<UserPublic[]>([])
const jiraPolicyGroups = ref<GroupPublic[]>([])
const jiraPolicyInventory = ref<InventoryNodePublic[]>([])
const jiraUserOptions = computed(() => jiraPolicyUsers.value.map((item) => ({ label: `${item.name} (${item.email})`, value: item.id })))
const jiraGroupOptions = computed(() => jiraPolicyGroups.value.map((item) => ({ label: item.name, value: item.id })))
const jiraFolderOptions = computed(() => jiraPolicyInventory.value.filter((item) => item.type === 'FOLDER').map((item) => ({ label: `${'— '.repeat(Math.max(0, item.depth - 1))}${item.name}`, value: item.id })))
const jiraAllowedIssueTypes = ref('')
const jiraAllowedStatuses = ref('')
const jiraRequiredLabels = ref('')
const jiraRequireAssignee = ref(false)
const jiraMaxTicketAgeHours = ref<number | null>(null)
const jiraPublishStartComment = ref(false)
const jiraPublishEndComment = ref(false)
const jiraAttachAuditOnClose = ref(false)
const jiraTransitionOnClose = ref(false)
const jiraCloseTransitionId = ref('')
const jiraBreakGlassEnabled = ref(false)
const jiraOAuthRequestWrite = ref(false)

async function load() {
  loading.value = true
  try {
    const [listRes, features] = await Promise.all([
      integrationService.list(),
      featuresService.get(),
    ])

    integrations.value = listRes.data
    aiLicensed.value = features.sessionAuditAiLicensed
    localAiLicensed.value = features.localAiLicensed
    integrationsLicensed.value = features.integrationsLicensed
    integrationProviders.value = features.integrationProviders

    const op = listRes.data.find((i) => i.provider === 'onepassword')
    if (op) { opEnabled.value = op.enabled; opSaved.value = op }

    if (features.integrationsLicensed && features.integrationProviders.google === true) {
      const googleRes = await integrationService.getGoogle()
      const g = googleRes.data
      gSaved.value        = g
      gEnabled.value      = g.enabled
      gClientId.value     = g.clientId      ?? ''
      gAdminEmail.value   = g.adminEmail    ?? ''
      gDomain.value       = g.domain        ?? ''
      gSyncInterval.value = g.syncIntervalMinutes
      gAutoProvision.value = g.autoProvision
    }

    if (features.integrationsLicensed && features.integrationProviders.ldap === true) {
      const ldapRes = await integrationService.getLdap()
      const ldap = ldapRes.data
      ldapSaved.value = ldap
      ldapEnabled.value = ldap.enabled
      ldapUrl.value = ldap.url ?? ''
      ldapBindDn.value = ldap.bindDn ?? ''
      ldapBaseDn.value = ldap.baseDn ?? ''
      ldapUserSearchFilter.value = ldap.userSearchFilter ?? '(mail={{email}})'
      ldapStartTls.value = ldap.startTls
      ldapTlsRejectUnauthorized.value = ldap.tlsRejectUnauthorized
      ldapAutoProvision.value = ldap.autoProvision
    }

    const openAiRes = await integrationService.getOpenAi()
    const ai = openAiRes.data
    aiSaved.value        = ai
    aiEnabled.value      = ai.enabled
    aiBaseUrl.value      = ai.baseUrl ?? ''
    aiDefaultModel.value = ai.defaultModel ?? 'gpt-5-mini'
    aiAuditInstructions.value = ai.auditInstructions ?? ''

    if (features.localAiLicensed) {
      const [localAiRes, docsRes, activityRes] = await Promise.all([
        integrationService.getLocalAi(),
        localAiService.listAdminDocuments(),
        integrationService.getLocalAiActivity(),
      ])
      const localAi = localAiRes.data
      localAiSaved.value = localAi
      localAiEnabled.value = localAi.enabled
      localAiMode.value = localAi.mode
      localAiRoutingPolicy.value = localAi.routingPolicy
      localAiLocalProvider.value = localAi.localProvider ?? 'ollama'
      localAiLocalBaseUrl.value = localAi.localBaseUrl ?? 'http://localhost:11434'
      localAiLocalModel.value = localAi.localModel ?? 'qwen2.5-coder:3b'
      localAiNetworkProvider.value = localAi.networkProvider ?? 'openai_compatible'
      localAiNetworkBaseUrl.value = localAi.networkBaseUrl ?? ''
      localAiNetworkModel.value = localAi.networkModel ?? ''
      localAiAuditInstructions.value = localAi.auditInstructions ?? ''
      localAiAssistantInstructions.value = localAi.assistantInstructions ?? ''
      localAiMonthlyRequestLimit.value = localAi.monthlyRequestLimit
      localAiInteractionRetentionDays.value = localAi.interactionRetentionDays
      localAiDocuments.value = docsRes.data
      localAiActivity.value = activityRes.data
    }

    if (features.integrationsLicensed && features.integrationProviders.jira === true) {
      const [jiraRes, usersRes, groupsRes, inventoryRes] = await Promise.all([
        integrationService.getJira(),
        userService.list({ limit: 1000, active: true }),
        groupService.list(),
        inventoryService.list(),
      ])
      const jira = jiraRes.data
      jiraSaved.value = jira
      jiraEnabled.value = jira.enabled
      jiraBaseUrl.value = jira.baseUrl ?? ''
      jiraServiceAccountEmail.value = jira.serviceAccountEmail ?? ''
      jiraProjectKeys.value = jira.projectKeys.join(', ')
      jiraTicketRequirement.value = jira.ticketRequirement
      jiraTicketEnforcementMode.value = jira.ticketEnforcementMode
      jiraTicketUserIds.value = [...jira.ticketUserIds]
      jiraTicketGroupIds.value = [...jira.ticketGroupIds]
      jiraTicketInventoryFolderIds.value = [...jira.ticketInventoryFolderIds]
      jiraPolicyUsers.value = usersRes.data.data
      jiraPolicyGroups.value = groupsRes.data
      jiraPolicyInventory.value = inventoryRes.data
      jiraAllowedIssueTypes.value = jira.allowedIssueTypes.join(', ')
      jiraAllowedStatuses.value = jira.allowedStatuses.join(', ')
      jiraRequiredLabels.value = jira.requiredLabels.join(', ')
      jiraRequireAssignee.value = jira.requireAssignee
      jiraMaxTicketAgeHours.value = jira.maxTicketAgeHours
      jiraPublishStartComment.value = jira.publishStartComment
      jiraPublishEndComment.value = jira.publishEndComment
      jiraAttachAuditOnClose.value = jira.attachAuditOnClose
      jiraTransitionOnClose.value = jira.transitionOnClose
      jiraCloseTransitionId.value = jira.closeTransitionId ?? ''
      jiraBreakGlassEnabled.value = jira.breakGlassEnabled
    }
  } finally {
    loading.value = false
  }
}

onMounted(load)

const onePasswordLicensed = computed(() => integrationsLicensed.value && integrationProviders.value.onepassword === true)
const googleLicensed = computed(() => integrationsLicensed.value && integrationProviders.value.google === true)
const ldapLicensed = computed(() => integrationsLicensed.value && integrationProviders.value.ldap === true)
const jiraLicensed = computed(() => integrationsLicensed.value && integrationProviders.value.jira === true)

// ── 1Password handlers ───────────────────────────────────────────────────────

async function saveOnePassword() {
  if (!opSaved.value?.hasToken && !opToken.value.trim()) {
    msg.warning(t('admin.integrations.onepassword.messages.tokenRequired'))
    return
  }
  opSaving.value = true
  try {
    const { data } = await integrationService.upsertOnePassword({
      enabled:             opEnabled.value,
      serviceAccountToken: opToken.value.trim() || undefined,
    })
    opSaved.value  = data
    opToken.value  = ''
    msg.success(t('admin.integrations.onepassword.messages.saved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.onepassword.messages.saveError'))
  } finally {
    opSaving.value = false
  }
}

// ── Google handlers ───────────────────────────────────────────────────────────

async function saveGoogle() {
  if (!gClientId.value.trim()) {
    msg.warning(t('admin.integrations.google.messages.clientIdRequired'))
    return
  }
  gSaving.value = true
  try {
    const { data } = await integrationService.upsertGoogle({
      enabled:              gEnabled.value,
      clientId:             gClientId.value.trim(),
      adminEmail:           gAdminEmail.value.trim() || undefined,
      domain:               gDomain.value.trim()     || undefined,
      syncIntervalMinutes:  gSyncInterval.value,
      autoProvision:        gAutoProvision.value,
      serviceAccountJson:   gServiceAccountJson.value.trim() || undefined,
    })
    gSaved.value             = data
    gServiceAccountJson.value = ''
    msg.success(t('admin.integrations.google.messages.saved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.google.messages.saveError'))
  } finally {
    gSaving.value = false
  }
}

const gServiceAccountPlaceholder = computed(() =>
  gSaved.value?.hasServiceAccount
    ? t('admin.integrations.google.saPlaceholderSaved')
    : '{ "type": "service_account", "client_email": "...", "private_key": "..." }'
)

async function runSync() {
  gSyncing.value = true
  try {
    const { data } = await integrationService.syncGoogle()
    msg.success(t('admin.integrations.google.messages.syncSuccess', { synced: data.synced, deactivated: data.deactivated }))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.google.messages.syncError'))
  } finally {
    gSyncing.value = false
  }
}

async function saveLdap() {
  if (!ldapLicensed.value) {
    msg.warning(t('admin.integrations.messages.providerNotLicensed', { provider: 'LDAP' }))
    return
  }
  const payload = buildLdapPayload()
  if (!payload) return

  ldapSaving.value = true
  try {
    const { data } = await integrationService.upsertLdap(payload)
    ldapSaved.value = data
    ldapBindPassword.value = ''
    msg.success(t('admin.integrations.ldap.messages.saved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.ldap.messages.saveError'))
  } finally {
    ldapSaving.value = false
  }
}

function buildLdapPayload(): UpsertLdapDto | null {
  if (!ldapUrl.value.trim()) {
    msg.warning(t('admin.integrations.ldap.messages.urlRequired'))
    return null
  }
  if (!ldapBaseDn.value.trim()) {
    msg.warning(t('admin.integrations.ldap.messages.baseDnRequired'))
    return null
  }
  if (!ldapUserSearchFilter.value.trim()) {
    msg.warning(t('admin.integrations.ldap.messages.filterRequired'))
    return null
  }
  if (ldapBindDn.value.trim() && !ldapSaved.value?.hasBindPassword && !ldapBindPassword.value.trim()) {
    msg.warning(t('admin.integrations.ldap.messages.bindPasswordRequired'))
    return null
  }

  return {
    enabled: ldapEnabled.value,
    url: ldapUrl.value.trim(),
    bindDn: ldapBindDn.value.trim() || undefined,
    bindPassword: ldapBindPassword.value.trim() || undefined,
    baseDn: ldapBaseDn.value.trim(),
    userSearchFilter: ldapUserSearchFilter.value.trim(),
    startTls: ldapStartTls.value,
    tlsRejectUnauthorized: ldapTlsRejectUnauthorized.value,
    autoProvision: ldapAutoProvision.value,
  }
}

async function testLdap() {
  if (!ldapLicensed.value) {
    msg.warning(t('admin.integrations.messages.providerNotLicensed', { provider: 'LDAP' }))
    return
  }
  const payload = buildLdapPayload()
  if (!payload) return

  ldapTesting.value = true
  try {
    const { data } = await integrationService.testLdap(payload)
    ldapTestResult.value = data
    ldapSaved.value = (await integrationService.getLdap()).data
    if (data.ok) {
      msg.success(t('admin.integrations.ldap.messages.testSuccess'))
    } else {
      msg.warning(data.healthMessage ?? t('admin.integrations.ldap.messages.testError'))
    }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.ldap.messages.testError'))
  } finally {
    ldapTesting.value = false
  }
}

async function saveOpenAi() {
  if (!aiLicensed.value) {
    msg.warning(t('admin.integrations.openai.messages.licenseRequired'))
    return
  }
  if (!aiSaved.value?.hasApiKey && !aiApiKey.value.trim()) {
    msg.warning(t('admin.integrations.openai.messages.apiKeyRequired'))
    return
  }
  if (!aiDefaultModel.value.trim()) {
    msg.warning(t('admin.integrations.openai.messages.modelRequired'))
    return
  }
  aiSaving.value = true
  try {
    const { data } = await integrationService.upsertOpenAi({
      enabled: aiEnabled.value,
      apiKey: aiApiKey.value.trim() || undefined,
      baseUrl: aiBaseUrl.value.trim() || undefined,
      defaultModel: aiDefaultModel.value.trim(),
      auditInstructions: aiAuditInstructions.value.trim() || undefined,
    })
    aiSaved.value = data
    aiApiKey.value = ''
    aiAuditInstructions.value = data.auditInstructions ?? ''
    msg.success(t('admin.integrations.openai.messages.saved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.openai.messages.saveError'))
  } finally {
    aiSaving.value = false
  }
}

async function testOpenAi() {
  if (!aiLicensed.value) {
    msg.warning(t('admin.integrations.openai.messages.licenseRequired'))
    return
  }
  aiTesting.value = true
  try {
    const { data } = await integrationService.testOpenAi()
    if (data.ok) {
      msg.success(t('admin.integrations.openai.messages.testSuccess'))
    } else {
      msg.warning(data.healthMessage ?? t('admin.integrations.openai.messages.testError'))
    }
    const { data: refreshed } = await integrationService.getOpenAi()
    aiSaved.value = refreshed
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.openai.messages.testError'))
  } finally {
    aiTesting.value = false
  }
}

const aiStatusType = computed(() => {
  if (aiSaved.value?.healthStatus === 'healthy') return 'success'
  if (aiSaved.value?.healthStatus === 'unhealthy') return 'error'
  return 'warning'
})

const aiCanInteract = computed(() => aiLicensed.value)
const localAiCanInteract = computed(() => localAiLicensed.value)
const localAiModeOptions = computed(() => [
  { label: t('admin.integrations.localAi.modeOptions.read_only'), value: 'read_only' },
  { label: t('admin.integrations.localAi.modeOptions.low_impact'), value: 'low_impact' },
  { label: t('admin.integrations.localAi.modeOptions.full_control'), value: 'full_control' },
])
const localAiRoutingPolicyOptions = computed(() => [
  { label: t('admin.integrations.localAi.routingPolicies.local_only'), value: 'local_only' },
  { label: t('admin.integrations.localAi.routingPolicies.network_only'), value: 'network_only' },
  { label: t('admin.integrations.localAi.routingPolicies.prefer_local'), value: 'prefer_local' },
  { label: t('admin.integrations.localAi.routingPolicies.prefer_network'), value: 'prefer_network' },
])

async function saveLocalAi() {
  if (!localAiLicensed.value) {
    msg.warning(t('admin.integrations.localAi.messages.licenseRequired'))
    return
  }

  localAiSaving.value = true
  try {
    const { data } = await integrationService.upsertLocalAi({
      enabled: localAiEnabled.value,
      mode: localAiMode.value,
      routingPolicy: localAiRoutingPolicy.value,
      localProvider: localAiLocalProvider.value.trim() || undefined,
      localBaseUrl: localAiLocalBaseUrl.value.trim() || undefined,
      localModel: localAiLocalModel.value.trim() || undefined,
      networkProvider: localAiNetworkProvider.value.trim() || undefined,
      networkBaseUrl: localAiNetworkBaseUrl.value.trim() || undefined,
      networkModel: localAiNetworkModel.value.trim() || undefined,
      networkApiKey: localAiNetworkApiKey.value.trim() || undefined,
      auditInstructions: localAiAuditInstructions.value.trim() || undefined,
      assistantInstructions: localAiAssistantInstructions.value.trim() || undefined,
      monthlyRequestLimit: localAiMonthlyRequestLimit.value,
      interactionRetentionDays: localAiInteractionRetentionDays.value,
    })
    localAiSaved.value = data
    localAiEnabled.value = data.enabled
    localAiMode.value = data.mode
    localAiRoutingPolicy.value = data.routingPolicy
    localAiNetworkApiKey.value = ''
    localAiAuditInstructions.value = data.auditInstructions ?? ''
    localAiAssistantInstructions.value = data.assistantInstructions ?? ''
    localAiMonthlyRequestLimit.value = data.monthlyRequestLimit
    localAiInteractionRetentionDays.value = data.interactionRetentionDays
    msg.success(t('admin.integrations.localAi.messages.saved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.localAi.messages.saveError'))
  } finally {
    localAiSaving.value = false
  }
}

async function testLocalAi() {
  if (!localAiLicensed.value) {
    msg.warning(t('admin.integrations.localAi.messages.licenseRequired'))
    return
  }
  localAiTesting.value = true
  try {
    const { data } = await integrationService.testLocalAi()
    if (data.ok) {
      msg.success(t('admin.integrations.localAi.messages.testSuccess'))
    } else {
      msg.warning(data.healthMessage ?? t('admin.integrations.localAi.messages.testError'))
    }
    const { data: refreshed } = await integrationService.getLocalAi()
    localAiSaved.value = refreshed
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.localAi.messages.testError'))
  } finally {
    localAiTesting.value = false
  }
}

async function openLocalAiProxy() {
  if (!localAiLicensed.value) {
    msg.warning(t('admin.integrations.localAi.messages.licenseRequired'))
    return
  }
  try {
    const { data } = await integrationService.openLocalAiLink()
    window.open(data.url, '_blank', 'noopener,noreferrer')
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.localAi.messages.openLinkError'))
  }
}

async function createLocalAiTextDocument() {
  if (!localAiLicensed.value) {
    msg.warning(t('admin.integrations.localAi.messages.licenseRequired'))
    return
  }
  localAiDocumentSaving.value = true
  try {
    const { data } = await localAiService.createTextDocument({
      title: localAiTextTitle.value.trim(),
      description: localAiTextDescription.value.trim() || undefined,
      contentText: localAiTextContent.value.trim(),
    })
    localAiDocuments.value = [data, ...localAiDocuments.value]
    localAiTextTitle.value = ''
    localAiTextDescription.value = ''
    localAiTextContent.value = ''
    msg.success(t('admin.integrations.localAi.messages.documentSaved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.localAi.messages.documentSaveError'))
  } finally {
    localAiDocumentSaving.value = false
  }
}

async function createLocalAiLinkDocument() {
  if (!localAiLicensed.value) {
    msg.warning(t('admin.integrations.localAi.messages.licenseRequired'))
    return
  }
  localAiDocumentSaving.value = true
  try {
    const { data } = await localAiService.createLinkDocument({
      title: localAiLinkTitle.value.trim(),
      description: localAiLinkDescription.value.trim() || undefined,
      referenceUrl: localAiLinkUrl.value.trim(),
      contentText: localAiLinkContent.value.trim() || undefined,
    })
    localAiDocuments.value = [data, ...localAiDocuments.value]
    localAiLinkTitle.value = ''
    localAiLinkDescription.value = ''
    localAiLinkUrl.value = ''
    localAiLinkContent.value = ''
    msg.success(t('admin.integrations.localAi.messages.documentSaved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.localAi.messages.documentSaveError'))
  } finally {
    localAiDocumentSaving.value = false
  }
}

async function onLocalAiFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  localAiDocumentSaving.value = true
  try {
    const { data } = await localAiService.uploadDocument(file)
    localAiDocuments.value = [data, ...localAiDocuments.value]
    msg.success(t('admin.integrations.localAi.messages.documentSaved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.localAi.messages.documentSaveError'))
  } finally {
    input.value = ''
    localAiDocumentSaving.value = false
  }
}

async function deleteLocalAiDocument(id: number) {
  localAiDocumentDeletingId.value = id
  try {
    await localAiService.deleteDocument(id)
    localAiDocuments.value = localAiDocuments.value.filter((document) => document.id !== id)
    msg.success(t('admin.integrations.localAi.messages.documentDeleted'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.localAi.messages.documentDeleteError'))
  } finally {
    localAiDocumentDeletingId.value = null
  }
}

async function saveJira() {
  if (jiraTicketEnforcementMode.value === 'selected' && jiraTicketUserIds.value.length + jiraTicketGroupIds.value.length + jiraTicketInventoryFolderIds.value.length === 0) {
    msg.warning('Selecione pelo menos um usuário, grupo ou pasta corporativa para exigir ticket.')
    return
  }
  if (!jiraBaseUrl.value.trim()) {
    msg.warning(t('admin.integrations.jira.messages.baseUrlRequired'))
    return
  }
  if (!jiraSaved.value?.oauthConnected && !jiraServiceAccountEmail.value.trim()) {
    msg.warning(t('admin.integrations.jira.messages.serviceAccountEmailRequired'))
    return
  }
  if (!jiraSaved.value?.oauthConnected && !jiraSaved.value?.hasApiToken && !jiraApiToken.value.trim()) {
    msg.warning(t('admin.integrations.jira.messages.apiTokenRequired'))
    return
  }
  jiraSaving.value = true
  try {
    const serviceAccountEmail = jiraServiceAccountEmail.value.trim()
    const { data } = await integrationService.upsertJira({
      enabled: jiraEnabled.value,
      baseUrl: jiraBaseUrl.value.trim(),
      ...(serviceAccountEmail ? { serviceAccountEmail } : {}),
      apiToken: jiraApiToken.value.trim() || undefined,
      projectKeys: jiraProjectKeys.value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      ticketRequirement: jiraTicketRequirement.value,
      ticketEnforcementMode: jiraTicketEnforcementMode.value,
      ticketUserIds: jiraTicketUserIds.value,
      ticketGroupIds: jiraTicketGroupIds.value,
      ticketInventoryFolderIds: jiraTicketInventoryFolderIds.value,
      allowedIssueTypes: jiraAllowedIssueTypes.value.split(',').map((v) => v.trim()).filter(Boolean),
      allowedStatuses: jiraAllowedStatuses.value.split(',').map((v) => v.trim()).filter(Boolean),
      requiredLabels: jiraRequiredLabels.value.split(',').map((v) => v.trim()).filter(Boolean),
      requireAssignee: jiraRequireAssignee.value,
      maxTicketAgeHours: jiraMaxTicketAgeHours.value,
      publishStartComment: jiraPublishStartComment.value,
      publishEndComment: jiraPublishEndComment.value,
      attachAuditOnClose: jiraAttachAuditOnClose.value,
      transitionOnClose: jiraTransitionOnClose.value,
      ...(jiraCloseTransitionId.value.trim() ? { closeTransitionId: jiraCloseTransitionId.value.trim() } : {}),
      breakGlassEnabled: jiraBreakGlassEnabled.value,
    })
    jiraSaved.value = data
    jiraApiToken.value = ''
    msg.success(t('admin.integrations.jira.messages.saved'))
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.jira.messages.saveError'))
  } finally {
    jiraSaving.value = false
  }
}

async function testJira() {
  jiraTesting.value = true
  try {
    const { data } = await integrationService.testJira()
    if (data.ok) {
      msg.success(t('admin.integrations.jira.messages.testSuccess'))
    } else {
      msg.warning(data.healthMessage ?? t('admin.integrations.jira.messages.testError'))
    }
    const { data: refreshed } = await integrationService.getJira()
    jiraSaved.value = refreshed
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.integrations.jira.messages.testError'))
  } finally {
    jiraTesting.value = false
  }
}

async function connectJiraOAuth() {
  jiraOAuthStarting.value = true
  try {
    const { data } = await integrationService.beginJiraOAuth(jiraOAuthRequestWrite.value)
    window.location.assign(data.authorizationUrl)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? 'Não foi possível iniciar a autorização do Jira')
    jiraOAuthStarting.value = false
  }
}

async function disconnectJiraOAuth() {
  jiraOAuthStarting.value = true
  try { const { data } = await integrationService.disconnectJiraOAuth(); jiraSaved.value = data; jiraEnabled.value = false; msg.success('Autorização OAuth removida.') }
  catch { msg.error('Não foi possível remover a autorização OAuth.') }
  finally { jiraOAuthStarting.value = false }
}

const jiraHasCredential = computed(() => jiraSaved.value?.oauthConnected === true || jiraSaved.value?.hasApiToken === true)

const jiraStatusType = computed(() => {
  if (jiraSaved.value?.healthStatus === 'healthy') return 'success'
  if (jiraSaved.value?.healthStatus === 'unhealthy') return 'error'
  return 'warning'
})

const localAiStatusType = computed(() => {
  if (localAiSaved.value?.healthStatus === 'healthy') return 'success'
  if (localAiSaved.value?.healthStatus === 'unhealthy') return 'error'
  return 'warning'
})

const localAiOperationalSummary = computed(() => ({
  effectiveProvider: localAiRoutingPolicy.value === 'network_only'
    ? (localAiNetworkProvider.value || 'openai_compatible')
    : localAiRoutingPolicy.value === 'prefer_network'
      ? (localAiNetworkProvider.value || 'openai_compatible')
      : (localAiLocalProvider.value || 'ollama'),
  effectiveBaseUrl: localAiRoutingPolicy.value === 'network_only'
    ? (localAiNetworkBaseUrl.value || '—')
    : localAiRoutingPolicy.value === 'prefer_network'
      ? (localAiNetworkBaseUrl.value || localAiLocalBaseUrl.value || '—')
      : (localAiLocalBaseUrl.value || localAiNetworkBaseUrl.value || '—'),
  effectiveModel: localAiRoutingPolicy.value === 'network_only'
    ? (localAiNetworkModel.value || '—')
    : localAiRoutingPolicy.value === 'prefer_network'
      ? (localAiNetworkModel.value || localAiLocalModel.value || '—')
      : (localAiLocalModel.value || localAiNetworkModel.value || '—'),
}))

const localAiModeGuardrailMessage = computed(() => {
  if (localAiMode.value === 'read_only') return null
  return t('admin.integrations.localAi.modeGuardrail', { mode: localAiMode.value })
})

type IntegrationGuideItem = {
  title: string
  description: string
}

const onePasswordUseCases: IntegrationGuideItem[] = [
  {
    title: 'Credenciais SSH fora do NodeAccess',
    description: 'Senhas e chaves privadas ficam no cofre corporativo e são resolvidas apenas no momento da conexão.',
  },
  {
    title: 'Rotação sem editar hosts',
    description: 'Ao trocar a senha ou chave no 1Password, os hosts continuam usando a mesma referência op://.',
  },
  {
    title: 'Menos exposição operacional',
    description: 'Administradores não precisam copiar segredos para tickets, planilhas ou campos locais do host.',
  },
]

const jiraUseCases: IntegrationGuideItem[] = [
  {
    title: 'Auditoria vinculada a mudança',
    description: 'Exigir ou sugerir uma issue antes de acessos sensíveis ajuda a conectar sessão SSH, usuário e motivo operacional.',
  },
  {
    title: 'Validação de projetos permitidos',
    description: 'Limitar project keys reduz ruído e evita associação de acessos a chamados fora do escopo da operação.',
  },
  {
    title: 'Investigação pós-incidente',
    description: 'Logs e relatórios conseguem apontar qual chamado justificou uma sessão ou alteração feita no ambiente.',
  },
]

const googleGuideSteps: IntegrationGuideItem[] = [
  {
    title: 'Criar credencial OAuth',
    description: 'No Google Cloud Console, crie um OAuth Client do tipo Web Application e informe a origem autorizada do NodeAccess.',
  },
  {
    title: 'Informar domínio e Client ID',
    description: 'Cole o Client ID nesta tela e, se necessário, restrinja login ao domínio corporativo.',
  },
  {
    title: 'Configurar Directory Sync',
    description: 'Para sincronização, habilite Admin SDK API, crie uma service account e delegue o scope readonly de usuários.',
  },
  {
    title: 'Salvar e sincronizar',
    description: 'Salve a configuração e use Sincronizar agora para validar usuários ativos, desativados e removidos.',
  },
]

const googleUseCases: IntegrationGuideItem[] = [
  {
    title: 'Login corporativo centralizado',
    description: 'Usuários acessam com Google Workspace, reduzindo senhas locais e melhorando o offboarding.',
  },
  {
    title: 'Desativação automática',
    description: 'Usuários removidos ou suspensos no Workspace podem ser desativados no NodeAccess na próxima sincronização.',
  },
  {
    title: 'Provisionamento controlado',
    description: 'Com auto-provisionamento, novos usuários do domínio podem entrar sem cadastro manual prévio.',
  },
]

const ldapUseCases: IntegrationGuideItem[] = [
  {
    title: 'Login corporativo sem SSO moderno',
    description: 'Ambientes com Active Directory local podem autenticar no portal sem implantar OIDC ou SAML nesta fase.',
  },
  {
    title: 'Menos manutenção de contas locais',
    description: 'Com auto-provisionamento, o NodeAccess cria o espelho local depois que o diretório valida a identidade.',
  },
  {
    title: 'Fallback administrativo preservado',
    description: 'Contas locais continuam funcionando para break-glass, enquanto usuários operacionais usam a senha corporativa.',
  },
]

const ldapGuideSteps: IntegrationGuideItem[] = [
  {
    title: 'URL LDAP',
    description: 'Informe o endpoint do diretório. Use ldaps:// para TLS direto ou ldap:// com StartTLS habilitado.',
  },
  {
    title: 'DN de bind e senha',
    description: 'Use uma conta técnica com permissão mínima de busca. A senha é cifrada no backend e não volta para o navegador.',
  },
  {
    title: 'Base DN',
    description: 'Defina o ramo onde os usuários serão pesquisados, por exemplo OU=Users,DC=empresa,DC=com.',
  },
  {
    title: 'Filtro de busca',
    description: 'Controle como o usuário é localizado. Use {{email}} para login por e-mail ou {{username}} para sAMAccountName/uid.',
  },
  {
    title: 'StartTLS e validação TLS',
    description: 'StartTLS atualiza ldap:// para canal criptografado. Em produção, mantenha validação de certificado habilitada.',
  },
  {
    title: 'Auto-provisionamento',
    description: 'Quando habilitado, usuários autenticados no LDAP ganham uma conta local USER sem senha local; permissões e MFA continuam no NodeAccess.',
  },
]

const openAiGuideSteps: IntegrationGuideItem[] = [
  {
    title: 'Gerar API key',
    description: 'Crie uma chave no provider compatível com OpenAI e cole no campo API key. A chave fica cifrada no backend.',
  },
  {
    title: 'Definir modelo padrão',
    description: 'Informe o modelo usado para resumos e análises. Use Base URL apenas quando houver proxy ou gateway compatível.',
  },
  {
    title: 'Ajustar instruções de auditoria',
    description: 'Descreva o tom e os pontos de atenção esperados nos resumos, como comandos críticos, alterações de serviço e falhas.',
  },
  {
    title: 'Testar conexão',
    description: 'Depois de salvar, execute o teste para validar autenticação, modelo e disponibilidade do provider.',
  },
]

const openAiUseCases: IntegrationGuideItem[] = [
  {
    title: 'Resumo de sessões SSH',
    description: 'Transforma histórico de terminal em resumo legível para auditoria, revisão de mudança e troubleshooting.',
  },
  {
    title: 'Sinalização de risco',
    description: 'Ajuda a destacar comandos destrutivos, mudanças em serviços e tentativas incomuns durante a sessão.',
  },
  {
    title: 'Padronização de evidências',
    description: 'Gera narrativa consistente para anexar em incidentes, mudanças ou revisões internas.',
  },
]

const localAiGuideSteps: IntegrationGuideItem[] = [
  {
    title: 'Preparar runtime local',
    description: 'Instale Ollama ou outro provider compatível no host responsável pela IA local.',
  },
  {
    title: 'Baixar e escolher modelo',
    description: 'Configure um modelo adequado ao uso operacional, como qwen2.5-coder para comandos e análise técnica.',
  },
  {
    title: 'Definir política de roteamento',
    description: 'Escolha local_only, prefer_local ou rede conforme privacidade, latência e disponibilidade esperada.',
  },
  {
    title: 'Adicionar conhecimento interno',
    description: 'Inclua runbooks, padrões de comandos, links e políticas para orientar respostas no contexto da organização.',
  },
]

const localAiUseCases: IntegrationGuideItem[] = [
  {
    title: 'Assistência sem enviar dados para fora',
    description: 'Mantém análises e sugestões dentro do ambiente quando a política exige execução local.',
  },
  {
    title: 'Runbooks no contexto do terminal',
    description: 'Permite consultar procedimentos internos e padrões de operação durante diagnóstico e suporte.',
  },
  {
    title: 'Fallback operacional',
    description: 'Pode servir como alternativa quando o provider de rede estiver indisponível ou bloqueado.',
  },
]
</script>

<template>
  <div class="p-6 max-w-3xl">
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.integrations.title') }}</h1>
      <NText depth="3" class="text-sm">
        {{ $t('admin.integrations.subtitle') }}
      </NText>
    </div>

    <NSpin :show="loading">

      <!-- ── 1Password ────────────────────────────────────────────────────── -->
      <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mb-4">
        <div class="flex items-start justify-between gap-4">
          <!-- Logo + Info -->
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-2xl"
              style="background:#1a3a5c;"
            >🔐</div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-white">1Password</span>
                <NTag v-if="!onePasswordLicensed" type="error" size="small">{{ $t('admin.integrations.status.unlicensed') }}</NTag>
                <NTag v-else-if="opSaved?.hasToken && opSaved?.enabled" type="success" size="small">{{ $t('admin.integrations.status.active') }}</NTag>
                <NTag v-else-if="opSaved?.hasToken && !opSaved?.enabled" type="warning" size="small">{{ $t('admin.integrations.status.disabled') }}</NTag>
                <NTag v-else size="small">{{ $t('admin.integrations.status.notConfigured') }}</NTag>
              </div>
              <NText depth="3" class="text-xs">
                {{ $t('admin.integrations.onepassword.description') }}
              </NText>
            </div>
          </div>

          <!-- Toggle habilitado/desabilitado -->
          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NSwitch
                :value="opEnabled"
                :disabled="!onePasswordLicensed || !opSaved?.hasToken"
                @update:value="(v) => { opEnabled = v }"
              />
            </template>
            {{ !onePasswordLicensed ? $t('admin.integrations.tooltips.licenseRequiredProvider') : opSaved?.hasToken ? (opEnabled ? $t('admin.integrations.tooltips.disable') : $t('admin.integrations.tooltips.enable')) : $t('admin.integrations.tooltips.configFirst1p') }}
          </NTooltip>
        </div>

        <NDivider style="margin: 16px 0;" />

        <!-- Configuração do token -->
        <CollapsibleSection title="Configuração" body-class="mt-2 !bg-transparent">
          <div class="space-y-4">
          <NAlert v-if="!onePasswordLicensed" type="warning" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.messages.providerNotLicensed', { provider: '1Password' }) }}
          </NAlert>
          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.onepassword.tokenLabel') }}</div>
            <NText depth="3" class="text-xs block mb-2">
              {{ $t('admin.integrations.onepassword.tokenInfoText') }}
            </NText>
            <NInput
              v-model:value="opToken"
              :disabled="!onePasswordLicensed"
              type="password"
              show-password-on="click"
              :placeholder="opSaved?.hasToken ? $t('admin.integrations.onepassword.tokenPlaceholderSaved') : $t('admin.integrations.onepassword.tokenPlaceholder')"
              style="font-family: monospace;"
            />
          </div>

          <NAlert v-if="opSaved?.hasToken" type="info" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.onepassword.tokenAlert') }}
          </NAlert>

          <div class="flex items-center justify-between">
            <NText depth="3" class="text-xs">
              {{ $t('admin.integrations.onepassword.helperText') }}
            </NText>
            <NButton type="primary" :loading="opSaving" @click="saveOnePassword">
              <template v-if="onePasswordLicensed">{{ $t('admin.integrations.save') }}</template>
              <template v-else>{{ $t('admin.integrations.status.unlicensed') }}</template>
            </NButton>
          </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Casos práticos que resolve" body-class="mt-2 !bg-transparent">
          <div class="integration-guide-grid">
            <div v-for="item in onePasswordUseCases" :key="item.title" class="integration-guide-card">
              <div class="integration-guide-card__title">{{ item.title }}</div>
              <div class="integration-guide-card__text">{{ item.description }}</div>
            </div>
          </div>
        </CollapsibleSection>

        <!-- Guia completo -->
        <NDivider style="margin: 16px 0;" />
        <details class="integration-detail cursor-pointer">
          <summary class="integration-detail__summary text-sm transition-colors select-none font-medium">
            {{ $t('admin.integrations.onepassword.guideLink') }}
          </summary>

          <!-- O que é e como funciona -->
          <div class="mt-4 space-y-4 text-xs text-gray-400">
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">O que essa integração faz?</div>
              <p class="leading-relaxed">
                Permite que o NodeAccess busque senhas e chaves SSH diretamente do seu cofre do 1Password no momento da conexão.
                As credenciais <strong class="text-gray-300">nunca ficam armazenadas</strong> no NodeAccess — elas são resolvidas em memória a cada conexão e descartadas em seguida.
              </p>
              <div class="mt-3 p-2 rounded" style="background: var(--na-surface); border: 1px solid var(--na-border);">
                <div class="text-blue-400 font-medium mb-1">Fluxo ao conectar a um host</div>
                <div class="font-mono text-gray-400 space-y-0.5">
                  <div>Usuário clica "Conectar"</div>
                  <div class="pl-2 text-gray-600">↓</div>
                  <div>NodeAccess lê a referência <span class="text-green-400">op://vault/item/field</span></div>
                  <div class="pl-2 text-gray-600">↓</div>
                  <div>Token do Service Account é descriptografado (AES-256-GCM)</div>
                  <div class="pl-2 text-gray-600">↓</div>
                  <div>1Password SDK resolve o secret em memória</div>
                  <div class="pl-2 text-gray-600">↓</div>
                  <div>Conexão SSH estabelecida · secret descartado</div>
                </div>
              </div>
            </div>

            <!-- Passo a passo -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-3">Passo a passo: criar o Service Account</div>
              <ol class="space-y-2 list-none">
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">1</span>
                  <span>Acesse <span class="font-mono text-blue-400">my.1password.com</span> (ou seu servidor self-hosted)</span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">2</span>
                  <span>Vá em <strong class="text-gray-300">Integrações → Service Accounts</strong> → <strong class="text-gray-300">New Service Account</strong></span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">3</span>
                  <span>Dê um nome descritivo (ex: <span class="font-mono">nodeaccess-prod</span>)</span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">4</span>
                  <span>Selecione apenas os vaults que contêm as credenciais SSH · permissão mínima: <span class="font-mono">View items</span></span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">5</span>
                  <span>Copie o token gerado — começa com <span class="font-mono text-green-400">ops_</span> · você só verá ele uma vez</span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">6</span>
                  <span>Cole no campo "Service Account Token" acima e clique em <strong class="text-gray-300">Salvar</strong></span>
                </li>
              </ol>
            </div>

            <!-- Como usar nos hosts -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">Como usar nos hosts</div>
              <p class="leading-relaxed mb-3">
                Ao cadastrar ou editar um host, preencha o campo <strong class="text-gray-300">Referência 1Password</strong>
                com o caminho do item no formato <span class="font-mono text-blue-400">op://vault/item/field</span>.
                As credenciais locais (senha ou PEM) são ignoradas quando esse campo está preenchido.
              </p>
              <div class="p-2 rounded" style="background: var(--na-surface);">
                <div class="text-gray-500 mb-1.5">Exemplos de referência:</div>
                <div class="space-y-1 font-mono">
                  <div><span class="text-green-400">op://Infra/web-prod-01/password</span> <span class="text-gray-600">← senha do host</span></div>
                  <div><span class="text-green-400">op://Infra/db-server/private key</span> <span class="text-gray-600">← chave SSH privada</span></div>
                  <div><span class="text-green-400">op://DevOps/bastion-aws/credential</span> <span class="text-gray-600">← bastion com PEM</span></div>
                </div>
              </div>
              <div class="mt-2 text-gray-500">
                Para encontrar o caminho exato: abra o item no app do 1Password → clique com botão direito no campo → "Copiar referência secreta".
              </div>
            </div>

            <!-- Segurança -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">Modelo de segurança</div>
              <ul class="space-y-1.5 leading-relaxed">
                <li>🔒 Service account token cifrado com <strong class="text-gray-300">AES-256-GCM</strong> antes de persistir no banco</li>
                <li>🚫 Token nunca retorna à API — o frontend recebe apenas <span class="font-mono">hasToken: true/false</span></li>
                <li>⚡ Secrets resolvidos em memória no momento da conexão e descartados após uso</li>
                <li>🔑 O NodeAccess nunca armazena senhas ou chaves SSH se a referência 1Password estiver configurada</li>
                <li>🔄 Rotacionar o token: cole o novo valor no campo e salve — o token antigo é substituído imediatamente</li>
              </ul>
            </div>

            <!-- Troubleshooting -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">Resolução de problemas</div>
              <div class="space-y-2">
                <div>
                  <div class="text-orange-400 font-medium">Erro ao salvar o token</div>
                  <div class="text-gray-500">O NodeAccess valida o token contra a API do 1Password antes de salvar. Verifique se o token começa com <span class="font-mono">ops_</span>, se foi copiado completo e se a service account ainda está ativa.</div>
                </div>
                <div>
                  <div class="text-orange-400 font-medium">Erro de "item não encontrado" ao conectar</div>
                  <div class="text-gray-500">Verifique se o vault e o nome do item no caminho <span class="font-mono">op://</span> estão corretos e se a service account tem acesso ao vault especificado.</div>
                </div>
                <div>
                  <div class="text-orange-400 font-medium">Integração ativa mas conexão SSH falha</div>
                  <div class="text-gray-500">Use "Testar conexão" ao salvar o host para validar se o secret retornado é aceito pelo servidor SSH (senha incorreta, chave no formato errado, etc.).</div>
                </div>
              </div>
            </div>
          </div>
        </details>
      </NCard>

      <!-- ── JIRA ───────────────────────────────────────────────────────── -->
      <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mb-4" data-testid="jira-integration-card">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-2xl"
              style="background:#1c2847;"
            >J</div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-white">JIRA</span>
                <NTag v-if="!jiraLicensed" type="error" size="small">{{ $t('admin.integrations.status.unlicensed') }}</NTag>
                <NTag v-else-if="jiraSaved" :type="readinessTagType(jiraSaved)" size="small" data-testid="jira-readiness">{{ readinessLabel(jiraSaved) }}</NTag>
              </div>
              <NText depth="3" class="text-xs">
                {{ $t('admin.integrations.jira.description') }}
              </NText>
            </div>
          </div>

          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NSwitch
                :value="jiraEnabled"
                :disabled="!jiraLicensed || !jiraHasCredential"
                @update:value="(v: boolean) => { jiraEnabled = v }"
              />
            </template>
            {{ !jiraLicensed ? $t('admin.integrations.tooltips.licenseRequiredProvider') : jiraHasCredential ? (jiraEnabled ? $t('admin.integrations.tooltips.disable') : $t('admin.integrations.tooltips.enable')) : $t('admin.integrations.tooltips.configFirstJira') }}
          </NTooltip>
        </div>

        <NDivider style="margin: 16px 0;" />

        <CollapsibleSection title="Configuração" body-class="mt-2 !bg-transparent">
          <div class="space-y-4">
          <NAlert v-if="!jiraLicensed" type="warning" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.messages.providerNotLicensed', { provider: 'JIRA' }) }}
          </NAlert>
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-700 p-3">
            <div>
              <div class="text-sm font-medium text-gray-200">OAuth 2.0 do Jira Cloud</div>
              <NText depth="3" class="text-xs">
                {{ jiraSaved?.oauthConnected ? `Conectado a ${jiraSaved.oauthSiteName ?? 'Jira Cloud'} com acesso read-only.` : 'Autorize a leitura de tickets sem armazenar senha ou API token de usuário.' }}
              </NText>
            </div>
            <NButton
              secondary
              type="primary"
              :disabled="!jiraLicensed"
              :loading="jiraOAuthStarting"
              @click="connectJiraOAuth"
            >
              {{ jiraSaved?.oauthConnected ? 'Reconectar OAuth' : 'Conectar com Jira Cloud' }}
            </NButton>
            <NCheckbox v-model:checked="jiraOAuthRequestWrite">
              Solicitar permissões de escrita (requer liberação da instalação)
            </NCheckbox>
            <NButton v-if="jiraSaved?.oauthConnected" tertiary type="error" :loading="jiraOAuthStarting" @click="disconnectJiraOAuth">Revogar no NodeAccess</NButton>
          </div>
          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">Quem deve informar ticket</div>
            <NText depth="3" class="text-xs block mb-2">
              O gateway aplica a regra antes da conexão. Usuários, grupos e pastas selecionados são combinados por correspondência inclusiva.
            </NText>
            <NSelect
              v-model:value="jiraTicketEnforcementMode"
              data-testid="jira-policy-mode"
              :disabled="!jiraLicensed"
              :options="[
                { label: 'Ninguém — ticket opcional', value: 'off' },
                { label: 'Todo o tenant', value: 'tenant' },
                { label: 'Usuários, grupos ou pastas selecionados', value: 'selected' },
              ]"
            />
            <div v-if="jiraTicketEnforcementMode === 'selected'" class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div>
                <label class="text-xs text-gray-400">Usuários</label>
                <NSelect v-model:value="jiraTicketUserIds" multiple filterable :options="jiraUserOptions" placeholder="Selecionar usuários" />
              </div>
              <div>
                <label class="text-xs text-gray-400">Grupos</label>
                <NSelect v-model:value="jiraTicketGroupIds" multiple filterable :options="jiraGroupOptions" placeholder="Selecionar grupos" data-testid="jira-policy-groups" />
              </div>
              <div>
                <label class="text-xs text-gray-400">Pastas corporativas</label>
                <NSelect v-model:value="jiraTicketInventoryFolderIds" multiple filterable :options="jiraFolderOptions" placeholder="Selecionar pastas" />
              </div>
            </div>
            <NAlert v-if="jiraTicketEnforcementMode === 'selected'" type="info" :show-icon="false" class="mt-3">
              Atinge {{ jiraTicketUserIds.length }} usuário(s), {{ jiraTicketGroupIds.length }} grupo(s) e {{ jiraTicketInventoryFolderIds.length }} pasta(s), incluindo suas subpastas.
            </NAlert>
          </div>
          <div class="rounded-lg border border-gray-700 p-3 space-y-3">
            <div class="text-sm font-medium text-gray-200">Validade e encerramento do atendimento</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <NInput v-model:value="jiraAllowedIssueTypes" placeholder="Tipos permitidos: Task, Incident" />
              <NInput v-model:value="jiraAllowedStatuses" placeholder="Status permitidos: Open, In Progress" />
              <NInput v-model:value="jiraRequiredLabels" placeholder="Labels obrigatórias" />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <NCheckbox v-model:checked="jiraRequireAssignee">Exigir ticket com responsável definido</NCheckbox>
              <NInputNumber
                v-model:value="jiraMaxTicketAgeHours"
                :min="1"
                :max="8760"
                clearable
                placeholder="Idade máxima desde a atualização (horas)"
                style="width: 100%"
              />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm text-gray-300">
              <NCheckbox v-model:checked="jiraPublishStartComment" :disabled="!jiraSaved?.capabilities.comment">Comentar ao iniciar</NCheckbox>
              <NCheckbox v-model:checked="jiraPublishEndComment" :disabled="!jiraSaved?.capabilities.comment">Comentar ao encerrar</NCheckbox>
              <NCheckbox v-model:checked="jiraAttachAuditOnClose" :disabled="!jiraSaved?.capabilities.attachment">Anexar link da auditoria</NCheckbox>
              <NCheckbox v-model:checked="jiraTransitionOnClose" :disabled="!jiraSaved?.capabilities.transition">Transicionar ao encerrar</NCheckbox>
              <NCheckbox v-model:checked="jiraBreakGlassEnabled">Permitir break-glass para administradores</NCheckbox>
            </div>
            <NInput v-if="jiraTransitionOnClose" v-model:value="jiraCloseTransitionId" placeholder="ID exato da transição Jira" />
            <NAlert type="info" :show-icon="false">Capacidades: leitura {{ jiraSaved?.capabilities.read ? '✓' : '—' }}, comentário {{ jiraSaved?.capabilities.comment ? '✓' : '—' }}, anexo {{ jiraSaved?.capabilities.attachment ? '✓' : '—' }}, transição {{ jiraSaved?.capabilities.transition ? '✓' : '—' }}.</NAlert>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.jira.baseUrlLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.jira.baseUrlInfo') }}
              </NText>
              <NInput
                v-model:value="jiraBaseUrl"
                :disabled="!jiraLicensed"
                :placeholder="$t('admin.integrations.jira.baseUrlPlaceholder')"
                style="font-family: monospace;"
              />
            </div>
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.jira.serviceAccountEmailLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.jira.serviceAccountEmailInfo') }}
              </NText>
              <NInput
                v-model:value="jiraServiceAccountEmail"
                :disabled="!jiraLicensed"
                :placeholder="$t('admin.integrations.jira.serviceAccountEmailPlaceholder')"
              />
            </div>
          </div>

          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.jira.apiTokenLabel') }}</div>
            <NText depth="3" class="text-xs block mb-2">
              {{ $t('admin.integrations.jira.apiTokenInfo') }}
            </NText>
            <NInput
              v-model:value="jiraApiToken"
              :disabled="!jiraLicensed"
              type="password"
              show-password-on="click"
              :placeholder="jiraSaved?.hasApiToken ? $t('admin.integrations.jira.apiTokenPlaceholderSaved') : $t('admin.integrations.jira.apiTokenPlaceholder')"
              style="font-family: monospace;"
            />
          </div>

          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.jira.projectKeysLabel') }}</div>
            <NText depth="3" class="text-xs block mb-2">
              {{ $t('admin.integrations.jira.projectKeysInfo') }}
            </NText>
            <NInput
              v-model:value="jiraProjectKeys"
              :disabled="!jiraLicensed"
              :placeholder="$t('admin.integrations.jira.projectKeysPlaceholder')"
            />
          </div>

          <NAlert v-if="jiraSaved?.hasApiToken" type="info" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.jira.apiTokenAlert') }}
          </NAlert>

          <NAlert
            v-if="jiraSaved?.readinessMessage || jiraSaved?.healthMessage"
            :type="jiraSaved?.operational ? 'success' : jiraSaved?.readinessStatus === 'unhealthy' ? 'error' : 'warning'"
            :show-icon="false"
            style="font-size:12px;"
          >
            {{ jiraSaved.readinessMessage ?? jiraSaved.healthMessage }}
          </NAlert>

          <div class="flex items-center justify-between gap-3">
            <NText depth="3" class="text-xs">
              {{
                jiraSaved?.lastCheckedAt
                  ? $t('admin.integrations.jira.lastCheckedAt', { at: new Date(jiraSaved.lastCheckedAt).toLocaleString() })
                  : $t('admin.integrations.jira.notCheckedYet')
              }}
            </NText>
            <div class="flex items-center gap-3">
              <NButton
                ghost
                :disabled="!jiraLicensed || !jiraHasCredential"
                :loading="jiraTesting"
                @click="testJira"
              >
                {{ $t('admin.integrations.jira.testButton') }}
              </NButton>
              <NButton
                type="primary"
                data-testid="jira-save"
                :disabled="!jiraLicensed"
                :loading="jiraSaving"
                @click="saveJira"
              >
                {{ $t('admin.integrations.save') }}
              </NButton>
            </div>
          </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Casos práticos que resolve" body-class="mt-2 !bg-transparent">
          <div class="integration-guide-grid">
            <div v-for="item in jiraUseCases" :key="item.title" class="integration-guide-card">
              <div class="integration-guide-card__title">{{ item.title }}</div>
              <div class="integration-guide-card__text">{{ item.description }}</div>
            </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <details class="integration-detail cursor-pointer">
          <summary class="integration-detail__summary text-sm transition-colors select-none font-medium">
            {{ $t('admin.integrations.jira.guideLink') }}
          </summary>
          <div class="mt-4 space-y-4 text-sm text-gray-400">

            <!-- Jira Cloud -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-3">{{ $t('admin.integrations.jira.guide.cloudTitle') }}</div>
              <ol class="space-y-2 list-none">
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">1</span>
                  <span v-html="$t('admin.integrations.jira.guide.cloudStep1')" />
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">2</span>
                  <span v-html="$t('admin.integrations.jira.guide.cloudStep2')" />
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">3</span>
                  <span v-html="$t('admin.integrations.jira.guide.cloudStep3')" />
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">4</span>
                  <span v-html="$t('admin.integrations.jira.guide.cloudStep4')" />
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">5</span>
                  <span v-html="$t('admin.integrations.jira.guide.cloudStep5')" />
                </li>
              </ol>
              <div class="mt-3 p-2 rounded" style="background: var(--na-surface);">
                <div class="text-gray-500 mb-1">{{ $t('admin.integrations.jira.guide.exampleLabel') }}</div>
                <div class="font-mono space-y-1">
                  <div><span class="text-green-400">https://suaempresa.atlassian.net</span> <span class="text-gray-600">← Base URL</span></div>
                  <div><span class="text-green-400">automacao@suaempresa.com</span> <span class="text-gray-600">← E-mail da conta</span></div>
                  <div><span class="text-green-400">ATATT3xFfGF0c...</span> <span class="text-gray-600">← API Token</span></div>
                </div>
              </div>
            </div>

            <!-- Jira Server / Data Center -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-3">{{ $t('admin.integrations.jira.guide.serverTitle') }}</div>
              <ol class="space-y-2 list-none">
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-indigo-900 text-indigo-300 text-center font-bold" style="line-height:20px;">1</span>
                  <span v-html="$t('admin.integrations.jira.guide.serverStep1')" />
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-indigo-900 text-indigo-300 text-center font-bold" style="line-height:20px;">2</span>
                  <span v-html="$t('admin.integrations.jira.guide.serverStep2')" />
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-indigo-900 text-indigo-300 text-center font-bold" style="line-height:20px;">3</span>
                  <span v-html="$t('admin.integrations.jira.guide.serverStep3')" />
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-indigo-900 text-indigo-300 text-center font-bold" style="line-height:20px;">4</span>
                  <span v-html="$t('admin.integrations.jira.guide.serverStep4')" />
                </li>
              </ol>
              <div class="mt-3 p-2 rounded" style="background: var(--na-surface);">
                <div class="text-gray-500 mb-1">{{ $t('admin.integrations.jira.guide.exampleLabel') }}</div>
                <div class="font-mono space-y-1">
                  <div><span class="text-green-400">https://jira.suaempresa.com</span> <span class="text-gray-600">← Base URL (sem barra final)</span></div>
                  <div><span class="text-green-400">automacao@suaempresa.com</span> <span class="text-gray-600">← E-mail da conta técnica</span></div>
                  <div><span class="text-green-400">NjA3NTk4O...</span> <span class="text-gray-600">← Personal Access Token (PAT)</span></div>
                </div>
              </div>
            </div>

            <!-- Project Keys -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">{{ $t('admin.integrations.jira.guide.projectKeysTitle') }}</div>
              <p class="leading-relaxed mb-3">{{ $t('admin.integrations.jira.guide.projectKeysBody') }}</p>
              <div class="p-2 rounded" style="background: var(--na-surface);">
                <div class="font-mono space-y-1">
                  <div><span class="text-green-400">https://suaempresa.atlassian.net/jira/software/projects/<strong>OPS</strong>/boards</span></div>
                  <div class="text-gray-600 text-xs mt-1">{{ $t('admin.integrations.jira.guide.projectKeysUrlHint') }}</div>
                </div>
              </div>
            </div>

            <!-- Permissões -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">{{ $t('admin.integrations.jira.guide.permissionsTitle') }}</div>
              <ul class="space-y-1.5 leading-relaxed">
                <li>✅ <strong class="text-gray-300">Browse Projects</strong> — {{ $t('admin.integrations.jira.guide.permBrowse') }}</li>
                <li>✅ <strong class="text-gray-300">View Development Tools</strong> — {{ $t('admin.integrations.jira.guide.permViewDev') }}</li>
                <li>🚫 {{ $t('admin.integrations.jira.guide.permNoWrite') }}</li>
              </ul>
            </div>

            <!-- Troubleshooting -->
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">{{ $t('admin.integrations.jira.guide.troubleshootingTitle') }}</div>
              <div class="space-y-2">
                <div>
                  <div class="text-orange-400 font-medium">{{ $t('admin.integrations.jira.guide.ts1Title') }}</div>
                  <div class="text-gray-500">{{ $t('admin.integrations.jira.guide.ts1Body') }}</div>
                </div>
                <div>
                  <div class="text-orange-400 font-medium">{{ $t('admin.integrations.jira.guide.ts2Title') }}</div>
                  <div class="text-gray-500">{{ $t('admin.integrations.jira.guide.ts2Body') }}</div>
                </div>
                <div>
                  <div class="text-orange-400 font-medium">{{ $t('admin.integrations.jira.guide.ts3Title') }}</div>
                  <div class="text-gray-500">{{ $t('admin.integrations.jira.guide.ts3Body') }}</div>
                </div>
              </div>
            </div>

          </div>
        </details>
      </NCard>

      <OidcIntegrationCard />
      <ScimIntegrationCard v-if="integrationProviders.scim === true" />
      <NAlert
        type="info"
        :title="$t('admin.integrations.authPolicy.name')"
        class="mb-4"
      >
        <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{{ $t('admin.integrations.authPolicy.integrationContext') }}</span>
          <NButton size="small" secondary type="info" @click="router.push({ name: 'admin-settings', query: { section: 'authentication' } })">
            {{ $t('admin.integrations.authPolicy.manageInTenantSettings') }}
          </NButton>
        </div>
      </NAlert>

      <!-- ── Google Workspace ───────────────────────────────────────────────── -->
      <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mb-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
              style="background:#1a2a1a;"
            >
              <svg viewBox="0 0 24 24" class="w-7 h-7" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-white">Google Workspace</span>
                <NTag v-if="!googleLicensed" type="error" size="small">{{ $t('admin.integrations.status.unlicensed') }}</NTag>
                <NTag v-else-if="gSaved?.enabled && gSaved?.clientId" type="warning" size="small">{{ $t('admin.integrations.status.checking') }}</NTag>
                <NTag v-else-if="gSaved?.clientId && !gSaved?.enabled" type="warning" size="small">{{ $t('admin.integrations.status.disabled') }}</NTag>
                <NTag v-else size="small">{{ $t('admin.integrations.status.notConfigured') }}</NTag>
              </div>
              <NText depth="3" class="text-xs">
                {{ $t('admin.integrations.google.description') }}
              </NText>
            </div>
          </div>

          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NSwitch
                :value="gEnabled"
                :disabled="!googleLicensed || !gSaved?.clientId"
                @update:value="(v: boolean) => { gEnabled = v }"
              />
            </template>
            {{ !googleLicensed ? $t('admin.integrations.tooltips.licenseRequiredProvider') : gSaved?.clientId ? (gEnabled ? $t('admin.integrations.tooltips.disable') : $t('admin.integrations.tooltips.enable')) : $t('admin.integrations.tooltips.configFirstGoogle') }}
          </NTooltip>
        </div>

        <NDivider style="margin: 16px 0;" />

        <CollapsibleSection title="Configuração" body-class="mt-2 !bg-transparent">
          <div class="space-y-4">
          <NAlert v-if="!googleLicensed" type="warning" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.messages.providerNotLicensed', { provider: 'Google' }) }}
          </NAlert>

          <!-- Client ID -->
          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.google.clientIdLabel') }}</div>
            <NText depth="3" class="text-xs block mb-2">
              {{ $t('admin.integrations.google.clientIdInfo') }}
            </NText>
            <NInput
              v-model:value="gClientId"
              :disabled="!googleLicensed"
              :placeholder="$t('admin.integrations.google.clientIdPlaceholder')"
              style="font-family: monospace; font-size: 13px;"
            />
          </div>

          <!-- Domain + Admin email -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.google.domainLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">{{ $t('admin.integrations.google.domainInfo') }}</NText>
              <NInput v-model:value="gDomain" :disabled="!googleLicensed" :placeholder="$t('admin.integrations.google.domainPlaceholder')" />
            </div>
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.google.adminEmailLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">{{ $t('admin.integrations.google.adminEmailInfo') }}</NText>
              <NInput v-model:value="gAdminEmail" :disabled="!googleLicensed" :placeholder="$t('admin.integrations.google.adminEmailPlaceholder')" />
            </div>
          </div>

          <!-- Auto-provision + Sync interval -->
          <div class="flex items-center gap-6">
            <NCheckbox v-model:checked="gAutoProvision" :disabled="!googleLicensed">
              <span class="text-sm text-gray-300">{{ $t('admin.integrations.google.autoProvisionLabel') }}</span>
            </NCheckbox>
            <div class="flex items-center gap-2 ml-auto">
              <span class="text-sm text-gray-300">{{ $t('admin.integrations.google.syncIntervalLabel') }}</span>
              <NInputNumber
                v-model:value="gSyncInterval"
                :disabled="!googleLicensed"
                :min="5"
                :max="1440"
                style="width: 90px;"
              />
              <span class="text-sm text-gray-300">{{ $t('admin.integrations.google.syncIntervalSuffix') }}</span>
            </div>
          </div>

          <!-- Service Account JSON -->
          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.google.serviceAccountLabel') }}</div>
            <NText depth="3" class="text-xs block mb-2">
              {{ $t('admin.integrations.google.serviceAccountInfo') }}
              <span v-if="gSaved?.hasServiceAccount" class="text-green-400 ml-1">{{ $t('admin.integrations.google.serviceAccountConfigured') }}</span>
            </NText>
            <NInput
              v-model:value="gServiceAccountJson"
              :disabled="!googleLicensed"
              type="textarea"
              :rows="4"
              :placeholder="gServiceAccountPlaceholder"
              style="font-family: monospace; font-size: 12px;"
            />
          </div>

          <NAlert v-if="gSaved?.hasServiceAccount" type="info" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.google.saAlert') }}
          </NAlert>

          <div class="flex items-center gap-3 justify-end">
            <NButton
              v-if="gSaved?.hasServiceAccount && gSaved?.enabled"
              :disabled="!googleLicensed"
              :loading="gSyncing"
              ghost
              @click="runSync"
            >
              {{ $t('admin.integrations.google.syncNow') }}
            </NButton>
            <NButton type="primary" :disabled="!googleLicensed" :loading="gSaving" @click="saveGoogle">
              {{ $t('admin.integrations.save') }}
            </NButton>
          </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Guia de configuração" body-class="mt-2 !bg-transparent">
          <div class="integration-guide-list">
            <div v-for="(item, index) in googleGuideSteps" :key="item.title" class="integration-guide-step">
              <span class="integration-guide-step__number">{{ index + 1 }}</span>
              <div>
                <div class="integration-guide-card__title">{{ item.title }}</div>
                <div class="integration-guide-card__text">{{ item.description }}</div>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Casos práticos que resolve" body-class="mt-2 !bg-transparent">
          <div class="integration-guide-grid">
            <div v-for="item in googleUseCases" :key="item.title" class="integration-guide-card">
              <div class="integration-guide-card__title">{{ item.title }}</div>
              <div class="integration-guide-card__text">{{ item.description }}</div>
            </div>
          </div>
        </CollapsibleSection>
      </NCard>

      <!-- ── LDAP / Active Directory ───────────────────────────────────────── -->
      <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mb-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-sm font-semibold"
              style="background:#27303f;color:#dbeafe;"
            >LDAP</div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-white">LDAP / Active Directory</span>
                <NTag v-if="!ldapLicensed" type="error" size="small">{{ $t('admin.integrations.status.unlicensed') }}</NTag>
                <NTag v-else-if="ldapSaved" :type="readinessTagType(ldapSaved)" size="small" data-testid="ldap-readiness">{{ readinessLabel(ldapSaved) }}</NTag>
              </div>
              <NText depth="3" class="text-xs">
                {{ $t('admin.integrations.ldap.description') }}
              </NText>
            </div>
          </div>

          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NSwitch
                :value="ldapEnabled"
                :disabled="!ldapLicensed || !ldapSaved?.url || !ldapSaved?.baseDn"
                @update:value="(v: boolean) => { ldapEnabled = v }"
              />
            </template>
            {{ !ldapLicensed ? $t('admin.integrations.tooltips.licenseRequiredProvider') : ldapSaved?.url && ldapSaved?.baseDn ? (ldapEnabled ? $t('admin.integrations.tooltips.disable') : $t('admin.integrations.tooltips.enable')) : $t('admin.integrations.tooltips.configFirstLdap') }}
          </NTooltip>
        </div>

        <NDivider style="margin: 16px 0;" />

        <CollapsibleSection title="Configuração" body-class="mt-2 !bg-transparent">
          <div class="space-y-4">
            <NAlert v-if="!ldapLicensed" type="warning" :show-icon="false" style="font-size:12px;">
              {{ $t('admin.integrations.messages.providerNotLicensed', { provider: 'LDAP' }) }}
            </NAlert>

            <NAlert type="info" :show-icon="false" style="font-size:12px;">
              {{ $t('admin.integrations.ldap.securityAlert') }}
            </NAlert>

            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.ldap.urlLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.ldap.urlInfo') }}
              </NText>
              <NInput
                v-model:value="ldapUrl"
                :disabled="!ldapLicensed"
                :placeholder="$t('admin.integrations.ldap.urlPlaceholder')"
                style="font-family: monospace;"
              />
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.ldap.bindDnLabel') }}</div>
                <NText depth="3" class="text-xs block mb-2">
                  {{ $t('admin.integrations.ldap.bindDnInfo') }}
                </NText>
                <NInput
                  v-model:value="ldapBindDn"
                  :disabled="!ldapLicensed"
                  :placeholder="$t('admin.integrations.ldap.bindDnPlaceholder')"
                  style="font-family: monospace;"
                />
              </div>

              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.ldap.bindPasswordLabel') }}</div>
                <NText depth="3" class="text-xs block mb-2">
                  {{ ldapSaved?.hasBindPassword ? $t('admin.integrations.ldap.bindPasswordInfoSaved') : $t('admin.integrations.ldap.bindPasswordInfo') }}
                </NText>
                <NInput
                  v-model:value="ldapBindPassword"
                  :disabled="!ldapLicensed"
                  type="password"
                  show-password-on="click"
                  :placeholder="ldapSaved?.hasBindPassword ? $t('admin.integrations.ldap.bindPasswordPlaceholderSaved') : $t('admin.integrations.ldap.bindPasswordPlaceholder')"
                  style="font-family: monospace;"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.ldap.baseDnLabel') }}</div>
                <NText depth="3" class="text-xs block mb-2">
                  {{ $t('admin.integrations.ldap.baseDnInfo') }}
                </NText>
                <NInput
                  v-model:value="ldapBaseDn"
                  :disabled="!ldapLicensed"
                  :placeholder="$t('admin.integrations.ldap.baseDnPlaceholder')"
                  style="font-family: monospace;"
                />
              </div>

              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.ldap.userSearchFilterLabel') }}</div>
                <NText depth="3" class="text-xs block mb-2">
                  {{ $t('admin.integrations.ldap.userSearchFilterInfo') }}
                </NText>
                <NInput
                  v-model:value="ldapUserSearchFilter"
                  :disabled="!ldapLicensed"
                  :placeholder="$t('admin.integrations.ldap.userSearchFilterPlaceholder')"
                  style="font-family: monospace;"
                />
              </div>
            </div>

            <div class="flex flex-wrap gap-5">
              <NCheckbox v-model:checked="ldapStartTls" :disabled="!ldapLicensed || ldapUrl.startsWith('ldaps://')">
                <span class="text-sm text-gray-300">{{ $t('admin.integrations.ldap.startTlsLabel') }}</span>
              </NCheckbox>
              <NCheckbox v-model:checked="ldapTlsRejectUnauthorized" :disabled="!ldapLicensed">
                <span class="text-sm text-gray-300">{{ $t('admin.integrations.ldap.tlsRejectUnauthorizedLabel') }}</span>
              </NCheckbox>
              <NCheckbox v-model:checked="ldapAutoProvision" :disabled="!ldapLicensed">
                <span class="text-sm text-gray-300">{{ $t('admin.integrations.ldap.autoProvisionLabel') }}</span>
              </NCheckbox>
            </div>

            <NAlert v-if="ldapSaved?.hasBindPassword" type="info" :show-icon="false" style="font-size:12px;">
              {{ $t('admin.integrations.ldap.bindPasswordAlert') }}
            </NAlert>

            <NAlert
              v-if="ldapSaved?.readinessMessage || ldapTestResult?.healthMessage"
              :type="ldapSaved?.operational ? 'success' : ldapSaved?.readinessStatus === 'unhealthy' ? 'error' : 'warning'"
              :show-icon="false"
              style="font-size:12px;"
            >
              {{ ldapSaved?.readinessMessage ?? ldapTestResult?.healthMessage }}
            </NAlert>

            <div class="flex items-center justify-between gap-3">
              <NText depth="3" class="text-xs">
                <template v-if="ldapTestResult?.checkedAt">
                  {{ $t('admin.integrations.ldap.lastCheckedAt', { at: new Date(ldapTestResult.checkedAt).toLocaleString() }) }}
                </template>
                <template v-else>
                  {{
                    ldapSaved?.updatedAt
                      ? $t('admin.integrations.ldap.updatedAt', { at: new Date(ldapSaved.updatedAt).toLocaleString() })
                      : $t('admin.integrations.ldap.notConfiguredYet')
                  }}
                </template>
              </NText>
              <div class="flex items-center gap-3">
                <NButton
                  ghost
                  :disabled="!ldapLicensed"
                  :loading="ldapTesting"
                  @click="testLdap"
                >
                  {{ $t('admin.integrations.ldap.testButton') }}
                </NButton>
                <NButton
                  type="primary"
                  :disabled="!ldapLicensed"
                  :loading="ldapSaving"
                  @click="saveLdap"
                >
                  {{ $t('admin.integrations.save') }}
                </NButton>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Casos práticos que resolve" body-class="mt-2 !bg-transparent">
          <div class="integration-guide-grid">
            <div v-for="item in ldapUseCases" :key="item.title" class="integration-guide-card">
              <div class="integration-guide-card__title">{{ item.title }}</div>
              <div class="integration-guide-card__text">{{ item.description }}</div>
            </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Guia de configuração" body-class="mt-2 !bg-transparent">
          <div class="space-y-3 text-xs text-gray-400">
            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">Fluxo de autenticação LDAP</div>
              <div class="font-mono text-gray-400 space-y-0.5">
                <div>Usuário informa e-mail e senha</div>
                <div class="pl-2 text-gray-600">↓</div>
                <div>NodeAccess tenta autenticação local como fallback</div>
                <div class="pl-2 text-gray-600">↓</div>
                <div>LDAP habilitado: service bind opcional e busca pelo filtro configurado</div>
                <div class="pl-2 text-gray-600">↓</div>
                <div>User bind valida a senha corporativa</div>
                <div class="pl-2 text-gray-600">↓</div>
                <div>MFA, permissões, auditoria e sessão continuam governados pelo NodeAccess</div>
              </div>
            </div>

            <div class="integration-guide-grid">
              <div v-for="item in ldapGuideSteps" :key="item.title" class="integration-guide-card">
                <div class="integration-guide-card__title">{{ item.title }}</div>
                <div class="integration-guide-card__text">{{ item.description }}</div>
              </div>
            </div>

            <div class="p-3 rounded-lg" style="background: var(--na-surface-soft); border: 1px solid var(--na-border);">
              <div class="text-gray-200 font-semibold mb-2">Exemplos comuns</div>
              <div class="font-mono space-y-1">
                <div><span class="text-green-400">ldaps://ad.empresa.com:636</span> <span class="text-gray-600">← URL recomendada</span></div>
                <div><span class="text-green-400">OU=Users,DC=empresa,DC=com</span> <span class="text-gray-600">← Base DN</span></div>
                <div><span class="text-green-400" v-text="'(mail={{email}})'" /> <span class="text-gray-600">← Login por e-mail</span></div>
                <div><span class="text-green-400" v-text="'(sAMAccountName={{username}})'" /> <span class="text-gray-600">← Login AD por usuário</span></div>
              </div>
            </div>

            <NAlert type="warning" :show-icon="false" style="font-size:12px;">
              LDAP não define permissões operacionais no NodeAccess. Após autenticar, o usuário continua sujeito a role, grupos, ACLs, MFA e auditoria internos.
            </NAlert>
          </div>
        </CollapsibleSection>
      </NCard>

      <!-- ── OpenAI / Session Audit AI ───────────────────────────────────── -->
      <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mb-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-2xl"
              style="background:#17312b;"
            >AI</div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-white">OpenAI</span>
                <NTag v-if="!aiLicensed" size="small">{{ $t('admin.integrations.status.unlicensed') }}</NTag>
                <NTag v-else-if="aiSaved" :type="readinessTagType(aiSaved)" size="small" data-testid="openai-readiness">{{ readinessLabel(aiSaved) }}</NTag>
              </div>
              <NText depth="3" class="text-xs">
                {{ $t('admin.integrations.openai.description') }}
              </NText>
            </div>
          </div>

          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NSwitch
                :value="aiEnabled"
                :disabled="!aiCanInteract || !aiSaved?.hasApiKey"
                @update:value="(v: boolean) => { aiEnabled = v }"
              />
            </template>
            {{
              !aiLicensed
                ? $t('admin.integrations.tooltips.licenseRequiredOpenAi')
                : aiSaved?.hasApiKey
                  ? (aiEnabled ? $t('admin.integrations.tooltips.disable') : $t('admin.integrations.tooltips.enable'))
                  : $t('admin.integrations.tooltips.configFirstOpenAi')
            }}
          </NTooltip>
        </div>

        <NDivider style="margin: 16px 0;" />

        <CollapsibleSection title="Configuração principal" :default-open="true" body-class="mt-2 !bg-transparent">
          <div class="space-y-4">
          <NAlert
            v-if="!aiLicensed"
            type="warning"
            :show-icon="false"
            style="font-size:12px;"
          >
            {{ $t('admin.integrations.openai.licenseAlert') }}
          </NAlert>

          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.openai.apiKeyLabel') }}</div>
            <NText depth="3" class="text-xs block mb-2">
              {{ $t('admin.integrations.openai.apiKeyInfo') }}
            </NText>
            <NInput
              v-model:value="aiApiKey"
              type="password"
              show-password-on="click"
              :disabled="!aiCanInteract"
              :placeholder="aiSaved?.hasApiKey ? $t('admin.integrations.openai.apiKeyPlaceholderSaved') : $t('admin.integrations.openai.apiKeyPlaceholder')"
              style="font-family: monospace;"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.openai.baseUrlLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.openai.baseUrlInfo') }}
              </NText>
              <NInput
                v-model:value="aiBaseUrl"
                :disabled="!aiCanInteract"
                :placeholder="$t('admin.integrations.openai.baseUrlPlaceholder')"
                style="font-family: monospace;"
              />
            </div>
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.openai.defaultModelLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.openai.defaultModelInfo') }}
              </NText>
              <NInput
                v-model:value="aiDefaultModel"
                :disabled="!aiCanInteract"
                :placeholder="$t('admin.integrations.openai.defaultModelPlaceholder')"
                style="font-family: monospace;"
              />
            </div>
          </div>

          <div>
            <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.openai.auditInstructionsLabel') }}</div>
            <NText depth="3" class="text-xs block mb-2">
              {{ $t('admin.integrations.openai.auditInstructionsInfo') }}
            </NText>
            <NInput
              v-model:value="aiAuditInstructions"
              type="textarea"
              :disabled="!aiCanInteract"
              :rows="5"
              :maxlength="4000"
              :placeholder="$t('admin.integrations.openai.auditInstructionsPlaceholder')"
            />
          </div>

          <NAlert v-if="aiSaved?.hasApiKey" type="info" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.openai.apiKeyAlert') }}
          </NAlert>

          <NAlert
            v-if="aiSaved?.readinessMessage || aiSaved?.healthMessage"
            :type="aiSaved?.operational ? 'success' : aiSaved?.readinessStatus === 'unhealthy' ? 'error' : 'warning'"
            :show-icon="false"
            style="font-size:12px;"
          >
            {{ aiSaved.readinessMessage ?? aiSaved.healthMessage }}
          </NAlert>

          <div class="flex items-center justify-between gap-3">
            <NText depth="3" class="text-xs">
              {{
                aiSaved?.lastCheckedAt
                  ? $t('admin.integrations.openai.lastCheckedAt', { at: new Date(aiSaved.lastCheckedAt).toLocaleString() })
                  : $t('admin.integrations.openai.notCheckedYet')
              }}
            </NText>
            <div class="flex items-center gap-3">
              <NButton
                ghost
                :disabled="!aiCanInteract || !aiSaved?.hasApiKey"
                :loading="aiTesting"
                @click="testOpenAi"
              >
                {{ $t('admin.integrations.openai.testButton') }}
              </NButton>
              <NButton
                type="primary"
                :disabled="!aiCanInteract"
                :loading="aiSaving"
                @click="saveOpenAi"
              >
                {{ $t('admin.integrations.save') }}
              </NButton>
            </div>
          </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Guia de configuração" body-class="mt-2 !bg-transparent">
          <div class="integration-guide-list">
            <div v-for="(item, index) in openAiGuideSteps" :key="item.title" class="integration-guide-step">
              <span class="integration-guide-step__number">{{ index + 1 }}</span>
              <div>
                <div class="integration-guide-card__title">{{ item.title }}</div>
                <div class="integration-guide-card__text">{{ item.description }}</div>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <NDivider style="margin: 16px 0;" />
        <CollapsibleSection title="Casos práticos que resolve" body-class="mt-2 !bg-transparent">
          <div class="integration-guide-grid">
            <div v-for="item in openAiUseCases" :key="item.title" class="integration-guide-card">
              <div class="integration-guide-card__title">{{ item.title }}</div>
              <div class="integration-guide-card__text">{{ item.description }}</div>
            </div>
          </div>
        </CollapsibleSection>
      </NCard>

      <!-- ── Assistente local / Local AI ────────────────────────────────── -->
      <NCard :bordered="false" style="background: var(--na-surface-raised);" class="mb-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-2xl"
              style="background:#1f2d1f;"
            >🧠</div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-white">{{ $t('admin.integrations.localAi.name') }}</span>
                <NTag v-if="!localAiLicensed" type="error" size="small">{{ $t('admin.integrations.status.unlicensed') }}</NTag>
                <NTag v-else-if="localAiSaved" :type="readinessTagType(localAiSaved)" size="small" data-testid="local-ai-readiness">{{ readinessLabel(localAiSaved) }}</NTag>
                <NTag v-else-if="localAiSaved" type="warning" size="small">{{ $t('admin.integrations.status.disabled') }}</NTag>
                <NTag v-else size="small">{{ $t('admin.integrations.status.notConfigured') }}</NTag>
              </div>
              <NText depth="3" class="text-xs">
                {{ $t('admin.integrations.localAi.description') }}
              </NText>
            </div>
          </div>

          <NTooltip trigger="hover" placement="left">
            <template #trigger>
              <NSwitch
                :value="localAiEnabled"
                :disabled="!localAiCanInteract"
                @update:value="(v: boolean) => { localAiEnabled = v }"
              />
            </template>
            {{ !localAiLicensed ? $t('admin.integrations.localAi.tooltips.licenseRequired') : (localAiEnabled ? $t('admin.integrations.tooltips.disable') : $t('admin.integrations.tooltips.enable')) }}
          </NTooltip>
        </div>

        <NDivider style="margin: 16px 0;" />

        <div class="space-y-4">
          <NAlert v-if="!localAiLicensed" type="warning" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.localAi.licenseAlert') }}
          </NAlert>

          <NAlert v-else type="info" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.localAi.policyHelp') }}
          </NAlert>

          <NAlert v-if="localAiModeGuardrailMessage" type="warning" :show-icon="false" style="font-size:12px;">
            {{ localAiModeGuardrailMessage }}
          </NAlert>

          <CollapsibleSection :title="$t('admin.integrations.localAi.quickStartTitle')" body-class="mt-2 !bg-transparent">
            <div class="na-panel rounded-lg border p-3">
              <div class="space-y-1 text-xs text-gray-300">
                <div>{{ $t('admin.integrations.localAi.quickStartStep1') }}</div>
                <div>{{ $t('admin.integrations.localAi.quickStartStep2') }}</div>
                <div>{{ $t('admin.integrations.localAi.quickStartStep3') }}</div>
                <div>{{ $t('admin.integrations.localAi.quickStartStep4') }}</div>
              </div>
              <NText depth="3" class="text-xs block mt-3">
                {{ $t('admin.integrations.localAi.proxyHint') }}
              </NText>
              <div class="mt-3">
                <NButton ghost :disabled="!localAiCanInteract" @click="openLocalAiProxy">
                  {{ $t('admin.integrations.localAi.openProxyButton') }}
                </NButton>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Guia de configuração" body-class="mt-2 !bg-transparent">
            <div class="integration-guide-list">
              <div v-for="(item, index) in localAiGuideSteps" :key="item.title" class="integration-guide-step">
                <span class="integration-guide-step__number">{{ index + 1 }}</span>
                <div>
                  <div class="integration-guide-card__title">{{ item.title }}</div>
                  <div class="integration-guide-card__text">{{ item.description }}</div>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Casos práticos que resolve" body-class="mt-2 !bg-transparent">
            <div class="integration-guide-grid">
              <div v-for="item in localAiUseCases" :key="item.title" class="integration-guide-card">
                <div class="integration-guide-card__title">{{ item.title }}</div>
                <div class="integration-guide-card__text">{{ item.description }}</div>
              </div>
            </div>
          </CollapsibleSection>

          <NAlert
            v-if="localAiSaved?.readinessMessage || localAiSaved?.healthMessage"
            :type="localAiSaved?.operational ? 'success' : localAiSaved?.readinessStatus === 'unhealthy' ? 'error' : 'warning'"
            :show-icon="false"
            style="font-size:12px;"
          >
            {{ localAiSaved.readinessMessage ?? localAiSaved.healthMessage }}
          </NAlert>

          <div class="na-panel rounded-lg border p-3">
            <div class="mb-2 text-sm font-medium text-white">{{ $t('admin.integrations.localAi.summaryTitle') }}</div>
            <div class="grid grid-cols-3 gap-3 text-xs">
              <div>
                <div class="text-gray-500 mb-1">{{ $t('admin.integrations.localAi.summaryProvider') }}</div>
                <div class="text-gray-200 break-all">{{ localAiOperationalSummary.effectiveProvider }}</div>
              </div>
              <div>
                <div class="text-gray-500 mb-1">{{ $t('admin.integrations.localAi.summaryBaseUrl') }}</div>
                <div class="text-gray-200 break-all">{{ localAiOperationalSummary.effectiveBaseUrl }}</div>
              </div>
              <div>
                <div class="text-gray-500 mb-1">{{ $t('admin.integrations.localAi.summaryModel') }}</div>
                <div class="text-gray-200 break-all">{{ localAiOperationalSummary.effectiveModel }}</div>
              </div>
            </div>
          </div>

          <CollapsibleSection :title="$t('admin.integrations.localAi.activityTitle')" body-class="mt-2 !bg-transparent">
            <div class="na-panel rounded-lg border p-3">
              <NAlert v-if="localAiActivity.length === 0" type="info" :show-icon="false" style="font-size:12px;">
                {{ $t('admin.integrations.localAi.activityEmpty') }}
              </NAlert>
              <div v-else class="space-y-2">
                <div
                  v-for="item in localAiActivity"
                  :key="item.id"
                  class="na-item rounded border p-2"
                >
                  <div class="flex items-center justify-between gap-3 text-xs">
                    <div class="text-gray-200">
                      {{ item.action === 'TEST_LOCAL_AI' ? $t('admin.integrations.localAi.activityTest') : $t('admin.integrations.localAi.activityOpenDiagnostic') }}
                    </div>
                    <div class="text-gray-500">
                      {{ new Date(item.timestamp).toLocaleString() }}
                    </div>
                  </div>
                  <div class="mt-1 text-xs text-gray-400">
                    {{ $t('admin.integrations.localAi.activityBy', { name: item.adminName }) }}
                  </div>
                  <div v-if="item.details" class="mt-1 text-xs text-gray-500 break-all">
                    {{ item.details }}
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.modeLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.localAi.modeInfo') }}
              </NText>
              <NSelect
                v-model:value="localAiMode"
                :disabled="!localAiCanInteract"
                :options="localAiModeOptions"
              />
            </div>
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.routingPolicyLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.localAi.routingPolicyInfo') }}
              </NText>
              <NSelect
                v-model:value="localAiRoutingPolicy"
                :disabled="!localAiCanInteract"
                :options="localAiRoutingPolicyOptions"
              />
            </div>
          </div>

          <CollapsibleSection :title="$t('admin.integrations.localAi.budgetTitle')" body-class="mt-2 !bg-transparent">
            <div class="na-panel grid gap-4 rounded-lg border p-3 md:grid-cols-2">
              <div>
                <label for="local-ai-monthly-request-limit" class="text-sm text-gray-300 mb-1 font-medium block">
                  {{ $t('admin.integrations.localAi.monthlyRequestLimitLabel') }}
                </label>
                <NText depth="3" class="text-xs block mb-2">{{ $t('admin.integrations.localAi.monthlyRequestLimitInfo') }}</NText>
                <NInputNumber id="local-ai-monthly-request-limit" v-model:value="localAiMonthlyRequestLimit" :disabled="!localAiCanInteract" :min="1" :max="10000000" :step="100" clearable :placeholder="$t('admin.integrations.localAi.monthlyRequestLimitPlaceholder')" />
              </div>
              <div>
                <label for="local-ai-interaction-retention" class="text-sm text-gray-300 mb-1 font-medium block">
                  {{ $t('admin.integrations.localAi.interactionRetentionLabel') }}
                </label>
                <NText depth="3" class="text-xs block mb-2">{{ $t('admin.integrations.localAi.interactionRetentionInfo') }}</NText>
                <NInputNumber id="local-ai-interaction-retention" v-model:value="localAiInteractionRetentionDays" :disabled="!localAiCanInteract" :min="1" :max="365" :step="1" />
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection :title="$t('admin.integrations.localAi.localTitle')" body-class="mt-2 !bg-transparent">
            <div class="na-panel rounded-lg border p-3">
              <div class="grid grid-cols-3 gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.localProviderLabel') }}</div>
                <NInput v-model:value="localAiLocalProvider" :disabled="!localAiCanInteract" placeholder="ollama" />
              </div>
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.localBaseUrlLabel') }}</div>
                <NInput v-model:value="localAiLocalBaseUrl" :disabled="!localAiCanInteract" placeholder="http://localhost:11434" style="font-family: monospace;" />
              </div>
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.localModelLabel') }}</div>
                <NInput v-model:value="localAiLocalModel" :disabled="!localAiCanInteract" placeholder="qwen2.5-coder" style="font-family: monospace;" />
              </div>
            </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection :title="$t('admin.integrations.localAi.networkTitle')" body-class="mt-2 !bg-transparent">
            <div class="na-panel rounded-lg border p-3">
              <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.networkProviderLabel') }}</div>
                <NSelect
                  v-model:value="localAiNetworkProvider"
                  :disabled="!localAiCanInteract"
                  :options="[
                    { label: 'OpenAI (Responses API)', value: 'openai' },
                    { label: 'Anthropic (Messages API)', value: 'anthropic' },
                    { label: 'OpenAI-compatible', value: 'openai_compatible' },
                  ]"
                />
              </div>
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.networkModelLabel') }}</div>
                <NInput v-model:value="localAiNetworkModel" :disabled="!localAiCanInteract" :placeholder="$t('admin.integrations.localAi.networkModelPlaceholder')" style="font-family: monospace;" />
              </div>
            </div>
            <div class="mt-3">
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.networkBaseUrlLabel') }}</div>
              <NInput v-model:value="localAiNetworkBaseUrl" :disabled="!localAiCanInteract" :placeholder="$t('admin.integrations.localAi.networkBaseUrlPlaceholder')" style="font-family: monospace;" />
            </div>
            <div class="mt-3">
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.networkApiKeyLabel') }}</div>
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.localAi.networkApiKeyInfo') }}
              </NText>
              <NInput
                v-model:value="localAiNetworkApiKey"
                :disabled="!localAiCanInteract"
                type="password"
                show-password-on="click"
                :placeholder="localAiSaved?.hasNetworkApiKey ? $t('admin.integrations.localAi.networkApiKeyPlaceholderSaved') : $t('admin.integrations.localAi.networkApiKeyPlaceholder')"
                style="font-family: monospace;"
              />
            </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection :title="$t('admin.integrations.localAi.auditInstructionsLabel')" body-class="mt-2 !bg-transparent">
            <div class="na-panel rounded-lg border p-3">
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.localAi.auditInstructionsInfo') }}
              </NText>
              <NInput
                v-model:value="localAiAuditInstructions"
                type="textarea"
                :disabled="!localAiCanInteract"
                :rows="5"
                :maxlength="4000"
                :placeholder="$t('admin.integrations.localAi.auditInstructionsPlaceholder')"
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection :title="$t('admin.integrations.localAi.assistantInstructionsLabel')" body-class="mt-2 !bg-transparent">
            <div class="na-panel rounded-lg border p-3">
              <NText depth="3" class="text-xs block mb-2">
                {{ $t('admin.integrations.localAi.assistantInstructionsInfo') }}
              </NText>
              <NInput
                v-model:value="localAiAssistantInstructions"
                type="textarea"
                :disabled="!localAiCanInteract"
                :rows="5"
                :maxlength="4000"
                :placeholder="$t('admin.integrations.localAi.assistantInstructionsPlaceholder')"
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection :title="$t('admin.integrations.localAi.knowledgeTitle')" body-class="mt-2 !bg-transparent">
            <div class="na-panel rounded-lg border p-3 space-y-4">
              <div>
                <NText depth="3" class="text-xs block">
                  {{ $t('admin.integrations.localAi.knowledgeInfo') }}
                </NText>
              </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.textTitleLabel') }}</div>
                <NInput v-model:value="localAiTextTitle" :disabled="!localAiCanInteract || localAiDocumentSaving" :placeholder="$t('admin.integrations.localAi.textTitlePlaceholder')" />
              </div>
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.textDescriptionLabel') }}</div>
                <NInput v-model:value="localAiTextDescription" :disabled="!localAiCanInteract || localAiDocumentSaving" :placeholder="$t('admin.integrations.localAi.textDescriptionPlaceholder')" />
              </div>
            </div>
            <div>
              <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.textContentLabel') }}</div>
              <NInput
                v-model:value="localAiTextContent"
                :disabled="!localAiCanInteract || localAiDocumentSaving"
                type="textarea"
                :rows="4"
                :placeholder="$t('admin.integrations.localAi.textContentPlaceholder')"
              />
            </div>
            <div class="flex justify-end">
              <NButton
                ghost
                :disabled="!localAiCanInteract || localAiDocumentSaving"
                :loading="localAiDocumentSaving"
                @click="createLocalAiTextDocument"
              >
                {{ $t('admin.integrations.localAi.addTextButton') }}
              </NButton>
            </div>

            <NDivider style="margin: 0;" />

            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.linkTitleLabel') }}</div>
                <NInput v-model:value="localAiLinkTitle" :disabled="!localAiCanInteract || localAiDocumentSaving" :placeholder="$t('admin.integrations.localAi.linkTitlePlaceholder')" />
              </div>
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.linkUrlLabel') }}</div>
                <NInput v-model:value="localAiLinkUrl" :disabled="!localAiCanInteract || localAiDocumentSaving" :placeholder="$t('admin.integrations.localAi.linkUrlPlaceholder')" style="font-family: monospace;" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.linkDescriptionLabel') }}</div>
                <NInput v-model:value="localAiLinkDescription" :disabled="!localAiCanInteract || localAiDocumentSaving" :placeholder="$t('admin.integrations.localAi.linkDescriptionPlaceholder')" />
              </div>
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.linkContentLabel') }}</div>
                <NInput v-model:value="localAiLinkContent" :disabled="!localAiCanInteract || localAiDocumentSaving" :placeholder="$t('admin.integrations.localAi.linkContentPlaceholder')" />
              </div>
            </div>
            <div class="flex justify-end">
              <NButton
                ghost
                :disabled="!localAiCanInteract || localAiDocumentSaving"
                :loading="localAiDocumentSaving"
                @click="createLocalAiLinkDocument"
              >
                {{ $t('admin.integrations.localAi.addLinkButton') }}
              </NButton>
            </div>

            <NDivider style="margin: 0;" />

            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm text-gray-300 mb-1 font-medium">{{ $t('admin.integrations.localAi.uploadLabel') }}</div>
                <NText depth="3" class="text-xs block">
                  {{ $t('admin.integrations.localAi.uploadInfo') }}
                </NText>
              </div>
              <div class="flex items-center gap-3">
                <input ref="localAiUploadRef" type="file" class="hidden" @change="onLocalAiFileSelected" />
                <NButton
                  ghost
                  :disabled="!localAiCanInteract || localAiDocumentSaving"
                  :loading="localAiDocumentSaving"
                  @click="localAiUploadRef?.click()"
                >
                  {{ $t('admin.integrations.localAi.uploadButton') }}
                </NButton>
              </div>
            </div>

            <NDivider style="margin: 0;" />

            <div class="space-y-2">
              <div class="flex items-center justify-between gap-3">
                <div class="text-sm font-medium text-white">{{ $t('admin.integrations.localAi.documentsListTitle') }}</div>
                <NTag size="small">{{ localAiDocuments.length }}</NTag>
              </div>
              <NAlert v-if="localAiDocuments.length === 0" type="info" :show-icon="false" style="font-size:12px;">
                {{ $t('admin.integrations.localAi.documentsEmpty') }}
              </NAlert>
              <div
                v-for="document in localAiDocuments"
                :key="document.id"
                class="na-item rounded-lg border p-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium text-white">{{ document.title }}</span>
                      <NTag size="small">{{ document.sourceType }}</NTag>
                      <NTag size="small" :type="document.status === 'ready' ? 'success' : 'error'">{{ document.status }}</NTag>
                    </div>
                    <NText depth="3" class="text-xs block mt-1">
                      {{ $t('admin.integrations.localAi.documentMeta', { by: document.createdBy.name, at: new Date(document.createdAt).toLocaleString() }) }}
                    </NText>
                    <NText v-if="document.referenceUrl" depth="3" class="text-xs block mt-1 break-all">
                      {{ document.referenceUrl }}
                    </NText>
                    <NText v-if="document.description" depth="3" class="text-xs block mt-1">
                      {{ document.description }}
                    </NText>
                    <NText v-if="document.fileName || document.byteSize" depth="3" class="text-xs block mt-1">
                      {{ [document.fileName, document.byteSize ? `${document.byteSize} B` : null].filter(Boolean).join(' · ') }}
                    </NText>
                  </div>
                  <NButton
                    quaternary
                    type="error"
                    size="small"
                    :loading="localAiDocumentDeletingId === document.id"
                    @click="deleteLocalAiDocument(document.id)"
                  >
                    {{ $t('common.delete') }}
                  </NButton>
                </div>
              </div>
            </div>
            </div>
          </CollapsibleSection>

          <div class="flex items-center justify-between gap-3">
            <NText depth="3" class="text-xs">
              {{
                localAiSaved?.lastCheckedAt
                  ? $t('admin.integrations.localAi.lastCheckedAt', { at: new Date(localAiSaved.lastCheckedAt).toLocaleString() })
                  : localAiSaved?.updatedAt
                    ? $t('admin.integrations.localAi.updatedAt', { at: new Date(localAiSaved.updatedAt).toLocaleString() })
                    : $t('admin.integrations.localAi.notConfiguredYet')
              }}
            </NText>
            <div class="flex items-center gap-3">
              <NButton
                ghost
                :disabled="!localAiCanInteract"
                :loading="localAiTesting"
                @click="testLocalAi"
              >
                {{ $t('admin.integrations.localAi.testButton') }}
              </NButton>
              <NButton
                type="primary"
                :disabled="!localAiCanInteract"
                :loading="localAiSaving"
                @click="saveLocalAi"
              >
                {{ $t('admin.integrations.save') }}
              </NButton>
            </div>
          </div>
        </div>
      </NCard>

      <!-- ── Futuros providers (placeholder) ──────────────────────────────── -->
      <NCard :bordered="false" class="na-card mb-4 opacity-50">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0" style="background:#1f2937;">🏛</div>
          <div>
            <div class="font-semibold text-gray-400">{{ $t('admin.integrations.vault.name') }} <NTag size="small">{{ $t('common.soon') }}</NTag></div>
            <NText depth="3" class="text-xs">{{ $t('admin.integrations.vault.description') }}</NText>
          </div>
        </div>
      </NCard>

      <NCard :bordered="false" class="na-card opacity-50">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0" style="background:#1f2937;">☁️</div>
          <div>
            <div class="font-semibold text-gray-400">{{ $t('admin.integrations.aws.name') }} <NTag size="small">{{ $t('common.soon') }}</NTag></div>
            <NText depth="3" class="text-xs">{{ $t('admin.integrations.aws.description') }}</NText>
          </div>
        </div>
      </NCard>

    </NSpin>
  </div>
</template>

<style scoped>
.integration-detail {
  border-radius: 8px;
}

.integration-detail__summary {
  color: var(--na-text-muted);
}

.integration-detail__summary:hover,
.integration-detail[open] .integration-detail__summary {
  color: var(--na-text-strong);
}

.integration-guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.integration-guide-list {
  display: grid;
  gap: 10px;
}

.integration-guide-card,
.integration-guide-step {
  border: 1px solid var(--na-border);
  border-radius: 8px;
  background: var(--na-surface-soft);
  padding: 12px;
}

.integration-guide-step {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.integration-guide-step__number {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.22);
  color: #93c5fd;
  font-size: 11px;
  font-weight: 700;
}

.integration-guide-card__title {
  color: var(--na-text-strong);
  font-size: 12px;
  font-weight: 600;
}

.integration-guide-card__text {
  margin-top: 4px;
  color: var(--na-text-muted);
  font-size: 12px;
  line-height: 1.45;
}
</style>
