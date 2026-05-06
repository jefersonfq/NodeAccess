<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NCard, NButton, NInput, NInputNumber, NSelect, NSwitch,
  NFormItem, NForm, NAlert, NSpin, NTag, NSpace, NText,
  NDivider, NCollapse, NCollapseItem, useMessage, useDialog,
} from 'naive-ui'
import { emailConfigService, type EmailConfigInput, type EmailConfigPublic } from '@/services/email-config.service'

const { t }  = useI18n()
const msg    = useMessage()
const dialog = useDialog()

const loading  = ref(true)
const saving   = ref(false)
const testing  = ref(false)
const removing = ref(false)
const error    = ref<string | null>(null)
const testOk   = ref(false)

const saved = ref<EmailConfigPublic | null>(null)

const form = ref<EmailConfigInput>({
  provider: 'gmail',
  host:     null,
  port:     587,
  secure:   false,
  user:     '',
  password: '',
  fromName: 'NodeAccess',
})

const providerOptions = [
  { label: 'Gmail',          value: 'gmail' },
  { label: 'Outlook / M365', value: 'outlook' },
  { label: 'SMTP genérico',  value: 'smtp' },
]

const PROVIDER_DEFAULTS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail:   { host: 'smtp.gmail.com',     port: 587, secure: false },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false },
  smtp:    { host: '',                   port: 587, secure: false },
}

const isSmtp       = computed(() => form.value.provider === 'smtp')
const isConfigured = computed(() => saved.value !== null)
const senderPreview = computed(() => {
  const name  = form.value.fromName?.trim() || 'NodeAccess'
  const email = form.value.user?.trim()     || 'email@exemplo.com'
  return `${name} <${email}>`
})
const canTest = computed(() =>
  !!form.value.user && !!form.value.password &&
  (form.value.provider !== 'smtp' || !!form.value.host),
)

// Preenche host/port/secure automaticamente ao trocar de provedor
watch(() => form.value.provider, (p) => {
  const d = PROVIDER_DEFAULTS[p]
  if (!d) return
  if (p !== 'smtp') {
    form.value.host   = d.host
    form.value.port   = d.port
    form.value.secure = d.secure
  } else if (!form.value.host) {
    form.value.port   = d.port
    form.value.secure = d.secure
  }
  testOk.value = false
})

watch(() => [form.value.user, form.value.password, form.value.host, form.value.port], () => {
  testOk.value = false
})

onMounted(async () => {
  try {
    const { data } = await emailConfigService.get()
    if (data) {
      saved.value          = data
      form.value.provider  = data.provider as EmailConfigInput['provider']
      form.value.host      = data.host
      form.value.port      = data.port ?? 587
      form.value.secure    = data.secure
      form.value.user      = data.user
      form.value.fromName  = data.fromName
    }
  } catch {
    error.value = t('admin.emailConfig.loadError')
  } finally {
    loading.value = false
  }
})

function setPort(port: number, secure: boolean) {
  form.value.port   = port
  form.value.secure = secure
}

async function runTest() {
  if (!canTest.value) { msg.warning(t('admin.emailConfig.fillRequired')); return }
  testing.value = true
  error.value   = null
  testOk.value  = false
  try {
    await emailConfigService.testCredentials({ ...form.value })
    testOk.value = true
    msg.success(t('admin.emailConfig.testSuccess'))
  } catch (err: any) {
    error.value = err?.response?.data?.message ?? t('admin.emailConfig.testError')
  } finally {
    testing.value = false
  }
}

async function save() {
  if (!form.value.user || !form.value.password || !form.value.fromName) {
    msg.warning(t('admin.emailConfig.fillRequired'))
    return
  }
  if (form.value.provider === 'smtp' && !form.value.host) {
    msg.warning(t('admin.emailConfig.smtpHostRequired'))
    return
  }
  saving.value = true
  error.value  = null
  try {
    const { data } = await emailConfigService.upsert(form.value)
    saved.value         = data
    form.value.password = ''
    testOk.value        = false
    msg.success(t('admin.emailConfig.saved'))
  } catch {
    error.value = t('admin.emailConfig.saveError')
  } finally {
    saving.value = false
  }
}

function confirmRemove() {
  dialog.warning({
    title:        t('admin.emailConfig.removeConfirmTitle'),
    content:      t('admin.emailConfig.removeConfirmContent'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: remove,
  })
}

async function remove() {
  removing.value = true
  try {
    await emailConfigService.remove()
    saved.value = null
    form.value  = { provider: 'gmail', host: PROVIDER_DEFAULTS.gmail.host, port: 587, secure: false, user: '', password: '', fromName: 'NodeAccess' }
    testOk.value = false
    msg.success(t('admin.emailConfig.removed'))
  } catch {
    msg.error(t('admin.emailConfig.removeError'))
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <div class="p-6 max-w-2xl">
    <NSpace vertical :size="4" class="mb-6">
      <NText class="text-xl font-semibold">{{ $t('admin.emailConfig.title') }}</NText>
      <NText depth="3" class="text-sm">{{ $t('admin.emailConfig.description') }}</NText>
    </NSpace>

    <NSpin :show="loading">
      <NAlert v-if="error" type="error" class="mb-4" :title="error" />
      <NAlert v-if="testOk" type="success" class="mb-4" :title="$t('admin.emailConfig.testSuccess')" />

      <NCard>
        <!-- Status -->
        <NSpace align="center" class="mb-4">
          <NText class="font-medium">{{ $t('admin.emailConfig.status') }}</NText>
          <NTag :type="isConfigured ? 'success' : 'default'" size="small">
            {{ isConfigured ? $t('admin.emailConfig.configured') : $t('admin.emailConfig.notConfigured') }}
          </NTag>
        </NSpace>

        <NForm label-placement="top" :show-feedback="false">

          <!-- Provedor -->
          <NFormItem :label="$t('admin.emailConfig.provider')">
            <NSelect v-model:value="form.provider" :options="providerOptions" style="width: 220px" />
          </NFormItem>

          <!-- Guia inline por provedor -->
          <NCollapse class="mb-4" arrow-placement="right">
            <NCollapseItem :title="$t('admin.emailConfig.guideTitle')" name="guide">
              <!-- Gmail -->
              <template v-if="form.provider === 'gmail'">
                <NText depth="3" class="text-sm">
                  <ol style="padding-left: 1.2em; margin: 0; line-height: 2">
                    <li>{{ $t('admin.emailConfig.gmail.step1') }}</li>
                    <li>{{ $t('admin.emailConfig.gmail.step2') }}</li>
                    <li>{{ $t('admin.emailConfig.gmail.step3') }}</li>
                    <li>{{ $t('admin.emailConfig.gmail.step4') }}</li>
                  </ol>
                  <NButton text tag="a" href="https://myaccount.google.com/apppasswords" target="_blank" class="mt-2">
                    {{ $t('admin.emailConfig.gmail.link') }} ↗
                  </NButton>
                </NText>
              </template>
              <!-- Outlook -->
              <template v-else-if="form.provider === 'outlook'">
                <NText depth="3" class="text-sm">
                  <ol style="padding-left: 1.2em; margin: 0; line-height: 2">
                    <li>{{ $t('admin.emailConfig.outlook.step1') }}</li>
                    <li>{{ $t('admin.emailConfig.outlook.step2') }}</li>
                    <li>{{ $t('admin.emailConfig.outlook.step3') }}</li>
                  </ol>
                  <NButton text tag="a" href="https://account.microsoft.com/security" target="_blank" class="mt-2">
                    {{ $t('admin.emailConfig.outlook.link') }} ↗
                  </NButton>
                </NText>
              </template>
              <!-- SMTP -->
              <template v-else>
                <NText depth="3" class="text-sm">{{ $t('admin.emailConfig.smtp.guide') }}</NText>
              </template>
            </NCollapseItem>
          </NCollapse>

          <!-- Campos SMTP genérico -->
          <template v-if="isSmtp">
            <NFormItem :label="$t('admin.emailConfig.host')">
              <NInput v-model:value="(form.host as string)" :placeholder="$t('admin.emailConfig.hostPlaceholder')" />
            </NFormItem>

            <NFormItem :label="$t('admin.emailConfig.port')">
              <NSpace align="center">
                <NInputNumber
                  v-model:value="(form.port as number)"
                  :min="1" :max="65535"
                  style="width: 120px"
                />
                <NButton size="small" :type="form.port === 587 ? 'primary' : 'default'" ghost @click="setPort(587, false)">
                  587 STARTTLS
                </NButton>
                <NButton size="small" :type="form.port === 465 ? 'primary' : 'default'" ghost @click="setPort(465, true)">
                  465 SSL
                </NButton>
                <NButton size="small" :type="form.port === 25 ? 'primary' : 'default'" ghost @click="setPort(25, false)">
                  25
                </NButton>
              </NSpace>
            </NFormItem>

            <NFormItem :label="$t('admin.emailConfig.secure')">
              <NSpace align="center">
                <NSwitch v-model:value="form.secure" />
                <NText depth="3" class="text-xs">{{ form.secure ? 'SSL/TLS (porta 465)' : 'STARTTLS (porta 587)' }}</NText>
              </NSpace>
            </NFormItem>

            <NDivider />
          </template>

          <!-- Remetente -->
          <NFormItem :label="$t('admin.emailConfig.user')">
            <NInput v-model:value="form.user" :placeholder="$t('admin.emailConfig.userPlaceholder')" />
          </NFormItem>

          <NFormItem :label="isConfigured ? $t('admin.emailConfig.newPassword') : $t('admin.emailConfig.password')">
            <NInput
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              :placeholder="isConfigured ? $t('admin.emailConfig.passwordKeep') : $t('admin.emailConfig.passwordPlaceholder')"
            />
          </NFormItem>

          <NFormItem :label="$t('admin.emailConfig.fromName')">
            <NSpace vertical :size="4" style="width: 100%">
              <NInput v-model:value="form.fromName" placeholder="NodeAccess" />
              <NText depth="3" class="text-xs">
                {{ $t('admin.emailConfig.previewLabel') }}: <span style="font-family: monospace">{{ senderPreview }}</span>
              </NText>
            </NSpace>
          </NFormItem>

        </NForm>

        <NDivider />

        <!-- Ações -->
        <NSpace wrap>
          <NButton
            :disabled="!canTest"
            :loading="testing"
            @click="runTest"
          >
            {{ $t('admin.emailConfig.test') }}
          </NButton>

          <NButton type="primary" :loading="saving" @click="save">
            {{ isConfigured ? $t('admin.emailConfig.update') : $t('admin.emailConfig.save') }}
          </NButton>

          <NButton
            v-if="isConfigured"
            type="error"
            ghost
            :loading="removing"
            @click="confirmRemove"
          >
            {{ $t('admin.emailConfig.remove') }}
          </NButton>
        </NSpace>

        <NText v-if="!isConfigured" depth="3" class="text-xs mt-3" style="display: block">
          {{ $t('admin.emailConfig.testHint') }}
        </NText>
      </NCard>
    </NSpin>
  </div>
</template>
