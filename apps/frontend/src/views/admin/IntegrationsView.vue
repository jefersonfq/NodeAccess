<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NInput, NSwitch, NTag, NAlert, NSpin, NText,
  NDivider, NTooltip, NInputNumber, NCheckbox, useMessage,
} from 'naive-ui'
import type { IntegrationPublic, GoogleConfigPublic, JiraConfigPublic, OpenAiConfigPublic } from '@nodeaccess/shared'
import { integrationService } from '@/services/integration.service'
import { featuresService } from '@/services/features.service'

const { t } = useI18n()

const msg     = useMessage()
const loading = ref(true)

// Estado das integrações
const integrations = ref<IntegrationPublic[]>([])

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

// ── OpenAI / Session Audit AI ────────────────────────────────────────────────

const aiSaved         = ref<OpenAiConfigPublic | null>(null)
const aiEnabled       = ref(false)
const aiApiKey        = ref('')
const aiBaseUrl       = ref('')
const aiDefaultModel  = ref('gpt-5-mini')
const aiSaving        = ref(false)
const aiTesting       = ref(false)
const aiLicensed      = ref(false)
const integrationsLicensed = ref(false)
const integrationProviders = ref<Record<string, boolean>>({})

// ── JIRA ────────────────────────────────────────────────────────────────────

const jiraSaved               = ref<JiraConfigPublic | null>(null)
const jiraEnabled             = ref(false)
const jiraBaseUrl             = ref('')
const jiraServiceAccountEmail = ref('')
const jiraApiToken            = ref('')
const jiraProjectKeys         = ref('')
const jiraSaving              = ref(false)
const jiraTesting             = ref(false)

async function load() {
  loading.value = true
  try {
    const [listRes, googleRes, features] = await Promise.all([
      integrationService.list(),
      integrationService.getGoogle(),
      featuresService.get(),
    ])

    integrations.value = listRes.data
    aiLicensed.value = features.sessionAuditAiLicensed
    integrationsLicensed.value = features.integrationsLicensed
    integrationProviders.value = features.integrationProviders

    const op = listRes.data.find((i) => i.provider === 'onepassword')
    if (op) { opEnabled.value = op.enabled; opSaved.value = op }

    const g = googleRes.data
    gSaved.value        = g
    gEnabled.value      = g.enabled
    gClientId.value     = g.clientId      ?? ''
    gAdminEmail.value   = g.adminEmail    ?? ''
    gDomain.value       = g.domain        ?? ''
    gSyncInterval.value = g.syncIntervalMinutes
    gAutoProvision.value = g.autoProvision

    const openAiRes = await integrationService.getOpenAi()
    const ai = openAiRes.data
    aiSaved.value        = ai
    aiEnabled.value      = ai.enabled
    aiBaseUrl.value      = ai.baseUrl ?? ''
    aiDefaultModel.value = ai.defaultModel ?? 'gpt-5-mini'

    const jiraRes = await integrationService.getJira()
    const jira = jiraRes.data
    jiraSaved.value = jira
    jiraEnabled.value = jira.enabled
    jiraBaseUrl.value = jira.baseUrl ?? ''
    jiraServiceAccountEmail.value = jira.serviceAccountEmail ?? ''
    jiraProjectKeys.value = jira.projectKeys.join(', ')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const onePasswordLicensed = computed(() => integrationsLicensed.value && integrationProviders.value.onepassword === true)
const googleLicensed = computed(() => integrationsLicensed.value && integrationProviders.value.google === true)
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
    })
    aiSaved.value = data
    aiApiKey.value = ''
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

async function saveJira() {
  if (!jiraBaseUrl.value.trim()) {
    msg.warning(t('admin.integrations.jira.messages.baseUrlRequired'))
    return
  }
  if (!jiraServiceAccountEmail.value.trim()) {
    msg.warning(t('admin.integrations.jira.messages.serviceAccountEmailRequired'))
    return
  }
  if (!jiraSaved.value?.hasApiToken && !jiraApiToken.value.trim()) {
    msg.warning(t('admin.integrations.jira.messages.apiTokenRequired'))
    return
  }
  jiraSaving.value = true
  try {
    const { data } = await integrationService.upsertJira({
      enabled: jiraEnabled.value,
      baseUrl: jiraBaseUrl.value.trim(),
      serviceAccountEmail: jiraServiceAccountEmail.value.trim(),
      apiToken: jiraApiToken.value.trim() || undefined,
      projectKeys: jiraProjectKeys.value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
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

const jiraStatusType = computed(() => {
  if (jiraSaved.value?.healthStatus === 'healthy') return 'success'
  if (jiraSaved.value?.healthStatus === 'unhealthy') return 'error'
  return 'warning'
})
</script>

<template>
  <div class="p-8 max-w-3xl">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold text-white">{{ $t('admin.integrations.title') }}</h1>
      <NText depth="3" class="text-sm">
        {{ $t('admin.integrations.subtitle') }}
      </NText>
    </div>

    <NSpin :show="loading">

      <!-- ── 1Password ────────────────────────────────────────────────────── -->
      <NCard :bordered="false" style="background:#1e1e22;" class="mb-4">
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

        <!-- Guia completo -->
        <NDivider style="margin: 16px 0;" />
        <details class="cursor-pointer">
          <summary class="text-sm text-gray-300 hover:text-white transition-colors select-none font-medium">
            {{ $t('admin.integrations.onepassword.guideLink') }}
          </summary>

          <!-- O que é e como funciona -->
          <div class="mt-4 space-y-4 text-xs text-gray-400">
            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
              <div class="text-gray-200 font-semibold mb-2">O que essa integração faz?</div>
              <p class="leading-relaxed">
                Permite que o NodeAccess busque senhas e chaves SSH diretamente do seu cofre do 1Password no momento da conexão.
                As credenciais <strong class="text-gray-300">nunca ficam armazenadas</strong> no NodeAccess — elas são resolvidas em memória a cada conexão e descartadas em seguida.
              </p>
              <div class="mt-3 p-2 rounded" style="background:#0d0d10; border: 1px solid #1a2a3a;">
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
            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
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
            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
              <div class="text-gray-200 font-semibold mb-2">Como usar nos hosts</div>
              <p class="leading-relaxed mb-3">
                Ao cadastrar ou editar um host, preencha o campo <strong class="text-gray-300">Referência 1Password</strong>
                com o caminho do item no formato <span class="font-mono text-blue-400">op://vault/item/field</span>.
                As credenciais locais (senha ou PEM) são ignoradas quando esse campo está preenchido.
              </p>
              <div class="p-2 rounded" style="background:#0d0d10;">
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
            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
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
            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
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
      <NCard :bordered="false" style="background:#1e1e22;" class="mb-4">
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
                <NTag v-else-if="jiraSaved?.enabled && jiraSaved?.hasApiToken && jiraSaved?.healthStatus === 'healthy'" type="success" size="small">{{ $t('admin.integrations.status.active') }}</NTag>
                <NTag v-else-if="jiraSaved?.hasApiToken && jiraSaved?.enabled" :type="jiraStatusType" size="small">{{ $t('admin.integrations.status.checking') }}</NTag>
                <NTag v-else-if="jiraSaved?.hasApiToken && !jiraSaved?.enabled" type="warning" size="small">{{ $t('admin.integrations.status.disabled') }}</NTag>
                <NTag v-else size="small">{{ $t('admin.integrations.status.notConfigured') }}</NTag>
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
                :disabled="!jiraLicensed || !jiraSaved?.hasApiToken"
                @update:value="(v: boolean) => { jiraEnabled = v }"
              />
            </template>
            {{ !jiraLicensed ? $t('admin.integrations.tooltips.licenseRequiredProvider') : jiraSaved?.hasApiToken ? (jiraEnabled ? $t('admin.integrations.tooltips.disable') : $t('admin.integrations.tooltips.enable')) : $t('admin.integrations.tooltips.configFirstJira') }}
          </NTooltip>
        </div>

        <NDivider style="margin: 16px 0;" />

        <div class="space-y-4">
          <NAlert v-if="!jiraLicensed" type="warning" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.messages.providerNotLicensed', { provider: 'JIRA' }) }}
          </NAlert>
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
            v-if="jiraSaved?.healthMessage"
            :type="jiraSaved?.healthStatus === 'healthy' ? 'success' : jiraSaved?.healthStatus === 'unhealthy' ? 'error' : 'warning'"
            :show-icon="false"
            style="font-size:12px;"
          >
            {{ jiraSaved.healthMessage }}
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
                :disabled="!jiraLicensed || !jiraSaved?.hasApiToken"
                :loading="jiraTesting"
                @click="testJira"
              >
                {{ $t('admin.integrations.jira.testButton') }}
              </NButton>
              <NButton
                type="primary"
                :disabled="!jiraLicensed"
                :loading="jiraSaving"
                @click="saveJira"
              >
                {{ $t('admin.integrations.save') }}
              </NButton>
            </div>
          </div>
        </div>
      </NCard>

      <!-- ── Google Workspace ───────────────────────────────────────────────── -->
      <NCard :bordered="false" style="background:#1e1e22;" class="mb-4">
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
                <NTag v-else-if="gSaved?.enabled && gSaved?.clientId" type="success" size="small">{{ $t('admin.integrations.status.active') }}</NTag>
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

        <NDivider style="margin: 16px 0;" />
        <details class="cursor-pointer">
          <summary class="text-sm text-gray-300 hover:text-white transition-colors select-none font-medium">
            {{ $t('admin.integrations.google.guideLink') }}
          </summary>
          <div class="mt-4 space-y-4 text-xs text-gray-400">

            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
              <div class="text-gray-200 font-semibold mb-2">O que essa integração faz?</div>
              <ul class="space-y-1 leading-relaxed">
                <li><strong class="text-gray-300">OAuth 2.0 (login):</strong> Usuários entram com "Entrar com Google" na tela de login. Não precisam de senha no NodeAccess.</li>
                <li><strong class="text-gray-300">Usuários locais continuam funcionando:</strong> Contas criadas manualmente no NodeAccess sem googleId usam e-mail + senha normalmente.</li>
                <li><strong class="text-gray-300">Directory Sync:</strong> Detecta automaticamente usuários desativados ou removidos do Workspace e desativa a conta no NodeAccess.</li>
              </ul>
            </div>

            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
              <div class="text-gray-200 font-semibold mb-3">Passo 1 — Criar credencial OAuth</div>
              <ol class="space-y-1.5 list-none">
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">1</span>
                  <span>Acesse <span class="font-mono text-blue-400">console.cloud.google.com</span> → APIs & Services → Credentials</span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">2</span>
                  <span>Clique em <strong class="text-gray-300">+ Create Credentials → OAuth client ID</strong> · Tipo: <span class="font-mono">Web application</span></span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">3</span>
                  <span>Adicione o domínio do NodeAccess em <strong class="text-gray-300">Authorized JavaScript origins</strong></span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">4</span>
                  <span>Copie o <strong class="text-gray-300">Client ID</strong> e cole no campo acima</span>
                </li>
              </ol>
            </div>

            <div class="p-3 rounded-lg" style="background:#111113; border: 1px solid #2a2a30;">
              <div class="text-gray-200 font-semibold mb-3">Passo 2 — Service Account para Directory Sync (opcional)</div>
              <ol class="space-y-1.5 list-none">
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">1</span>
                  <span>Habilite a API: <span class="font-mono text-blue-400">Admin SDK API</span> no Google Cloud Console</span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">2</span>
                  <span>Crie uma service account e baixe o JSON da chave</span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">3</span>
                  <span>Em <span class="font-mono text-blue-400">admin.google.com → Security → API Controls → Domain-wide Delegation</span>, adicione o Client ID da service account com o scope: <span class="font-mono text-green-400">https://www.googleapis.com/auth/admin.directory.user.readonly</span></span>
                </li>
                <li class="flex gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-blue-900 text-blue-300 text-center font-bold" style="line-height:20px;">4</span>
                  <span>Cole o conteúdo do JSON da chave no campo "Service Account JSON" acima</span>
                </li>
              </ol>
            </div>

          </div>
        </details>
      </NCard>

      <!-- ── OpenAI / Session Audit AI ───────────────────────────────────── -->
      <NCard :bordered="false" style="background:#1e1e22;" class="mb-4">
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
                <NTag v-else-if="aiSaved?.enabled && aiSaved?.hasApiKey && aiSaved?.healthStatus === 'healthy'" type="success" size="small">{{ $t('admin.integrations.status.active') }}</NTag>
                <NTag v-else-if="aiSaved?.hasApiKey && aiSaved?.enabled" :type="aiStatusType" size="small">{{ $t('admin.integrations.status.checking') }}</NTag>
                <NTag v-else-if="aiSaved?.hasApiKey && !aiSaved?.enabled" type="warning" size="small">{{ $t('admin.integrations.status.disabled') }}</NTag>
                <NTag v-else size="small">{{ $t('admin.integrations.status.notConfigured') }}</NTag>
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

          <NAlert v-if="aiSaved?.hasApiKey" type="info" :show-icon="false" style="font-size:12px;">
            {{ $t('admin.integrations.openai.apiKeyAlert') }}
          </NAlert>

          <NAlert
            v-if="aiSaved?.healthMessage"
            :type="aiSaved?.healthStatus === 'healthy' ? 'success' : aiSaved?.healthStatus === 'unhealthy' ? 'error' : 'warning'"
            :show-icon="false"
            style="font-size:12px;"
          >
            {{ aiSaved.healthMessage }}
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
      </NCard>

      <!-- ── Futuros providers (placeholder) ──────────────────────────────── -->
      <NCard :bordered="false" style="background:#1a1a1e; opacity: 0.5;" class="mb-4">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0" style="background:#1f2937;">🏛</div>
          <div>
            <div class="font-semibold text-gray-400">{{ $t('admin.integrations.vault.name') }} <NTag size="small">{{ $t('common.soon') }}</NTag></div>
            <NText depth="3" class="text-xs">{{ $t('admin.integrations.vault.description') }}</NText>
          </div>
        </div>
      </NCard>

      <NCard :bordered="false" style="background:#1a1a1e; opacity: 0.5;">
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
