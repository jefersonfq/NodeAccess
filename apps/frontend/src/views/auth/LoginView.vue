<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NForm, NFormItem, NInput, NButton, NAlert, NDivider, NSpin } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { authService, type TenantOption } from '@/services/auth.service'
import { LoginSchema } from '@nodeaccess/shared'
import { getSafeRedirectTarget } from '@/services/auth-redirect.service'

const route = useRoute()
const router = useRouter()
const auth   = useAuthStore()
const { t }  = useI18n()

// ── State ────────────────────────────────────────────────────────────────────

type Step = 'email' | 'tenant' | 'password'

const step           = ref<Step>('email')
const loading        = ref(false)
const error          = ref<string | null>(null)

const email          = ref('')
const password       = ref('')
const tenants        = ref<TenantOption[]>([])
const selectedSlug   = ref('')
const selectedName   = ref('')
const noTenantsFound = ref(false)

const hasDuplicateNames = computed(() => {
  const names = tenants.value.map(t => t.name)
  return names.length !== new Set(names).size
})

const redirectTarget          = computed(() => getSafeRedirectTarget(route.query))
const sessionExpired          = computed(() => route.query.reason === 'expired')
const sessionExpiredFromTerminal = computed(() => sessionExpired.value && route.query.context === 'terminal')
const mfaSetupExpired         = computed(() => route.query.reason === 'mfa_setup_expired')

// ── Google Sign-In ───────────────────────────────────────────────────────────

const googleEnabled  = ref(false)
const googleClientId = ref<string | null>(null)
const googleLoading  = ref(false)
const googleBtnEl    = ref<HTMLElement | null>(null)
const oidcEnabled    = ref(false)
const oidcName       = ref<string | null>(null)
const oidcLoading    = ref(false)

let googleScriptPromise: Promise<void> | null = null

async function initGoogle(tenantSlug?: string) {
  googleEnabled.value = false
  googleClientId.value = null

  googleLoading.value = true
  try {
    const { data } = await authService.googleConfig(tenantSlug)
    if (!data.enabled || !data.clientId) return
    googleEnabled.value  = true
    googleClientId.value = data.clientId
    await nextTick()
    await loadGIS(data.clientId)
  } catch {
    // silently ignore
  } finally {
    googleLoading.value = false
  }
}

async function initOidc(tenantSlug?: string) {
  oidcEnabled.value = false
  oidcName.value = null
  try {
    const { data } = await authService.oidcConfig(tenantSlug)
    oidcEnabled.value = data.enabled
    oidcName.value = data.name
  } catch {
    // Provedor opcional; login por senha continua disponível.
  }
}

async function startOidc() {
  error.value = null
  oidcLoading.value = true
  try {
    sessionStorage.setItem('na_oidc_redirect', redirectTarget.value)
    const { data } = await authService.oidcStart(selectedSlug.value || undefined)
    window.location.assign(data.authorizationUrl)
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('auth.login.oidcError')
    oidcLoading.value = false
  }
}

async function loadGIS(clientId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(window as any).google) {
    googleScriptPromise ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src   = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Google Identity Services indisponível'))
      document.head.appendChild(script)
    })
    await googleScriptPromise
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = (window as any).google
  if (!g || !googleBtnEl.value) return
  g.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredential,
    auto_select: false,
  })
  googleBtnEl.value.replaceChildren()
  g.accounts.id.renderButton(googleBtnEl.value, {
    theme: 'filled_black',
    size: 'large',
    width: 340,
    text: 'signin_with',
    logo_alignment: 'left',
  })
}

async function handleGoogleCredential(response: { credential: string }) {
  error.value         = null
  googleLoading.value = true
  try {
    const { data } = await authService.googleLogin(response.credential, selectedSlug.value)
    auth.completeLogin(data.accessToken, data.refreshToken)
    router.push(redirectTarget.value)
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('auth.login.googleError')
  } finally {
    googleLoading.value = false
  }
}

// ── Step 1: e-mail ───────────────────────────────────────────────────────────

async function continueFromEmail() {
  error.value = null
  const trimmed = email.value.trim()
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    error.value = t('auth.login.invalidData')
    return
  }

  loading.value = true
  try {
    const { data } = await authService.lookupTenant(trimmed)
    tenants.value = data.tenants
    noTenantsFound.value = data.tenants.length === 0

    if (data.tenants.length === 1) {
      selectTenant(data.tenants[0])
      step.value = 'password'
      await Promise.all([initGoogle(selectedSlug.value), initOidc(selectedSlug.value)])
    } else if (data.tenants.length > 1) {
      // pre-select first
      selectTenant(data.tenants[0])
      step.value = 'tenant'
    } else {
      // Sem vínculo existente: o backend ainda pode resolver o tenant pelo
      // hostname/proxy para permitir JIT provisioning via SSO.
      step.value = 'password'
      await Promise.all([initGoogle(), initOidc()])
    }
  } catch {
    step.value = 'password'
    await Promise.all([initGoogle(), initOidc()])
  } finally {
    loading.value = false
  }
}

// ── Step 2: tenant picker ────────────────────────────────────────────────────

function selectTenant(t: TenantOption) {
  selectedSlug.value = t.slug
  selectedName.value = t.name
}

function continueFromTenant() {
  if (!selectedSlug.value) return
  error.value = null
  step.value = 'password'
  nextTick(async () => {
    const pwInput = document.querySelector<HTMLInputElement>('input[type="password"]')
    pwInput?.focus()
    await Promise.all([initGoogle(selectedSlug.value), initOidc(selectedSlug.value)])
  })
}

// ── Step 3: password + login ─────────────────────────────────────────────────

async function submit() {
  error.value = null
  const parsed = LoginSchema.safeParse({
    email:      email.value.trim(),
    password:   password.value,
    tenantSlug: selectedSlug.value || undefined,
  })
  if (!parsed.success) {
    error.value = parsed.error.errors[0]?.message ?? t('auth.login.invalidData')
    return
  }
  loading.value = true
  try {
    const { data } = await authService.login(parsed.data)
    auth.setPendingMfa(data.tempToken, data.emailOtpAvailable ?? false)
    if (data.requiresMfaSetup) {
      router.push({ name: 'setup-totp', query: { redirect: redirectTarget.value } })
    } else {
      router.push({ name: 'verify-totp', query: { redirect: redirectTarget.value } })
    }
  } catch (err: unknown) {
    const axiosError = err as { response?: { data?: { message?: string } } }
    error.value = axiosError.response?.data?.message ?? t('auth.login.invalidCredentials')
  } finally {
    loading.value = false
  }
}

function resetToEmail() {
  step.value     = 'email'
  error.value    = null
  password.value = ''
  tenants.value  = []
  selectedSlug.value = ''
  selectedName.value = ''
  noTenantsFound.value = false
  googleEnabled.value = false
  googleClientId.value = null
  oidcEnabled.value = false
  oidcName.value = null
}
</script>

<template>
  <div class="login-card rounded-2xl p-8">
    <NAlert
      v-if="sessionExpired"
      type="warning"
      class="mb-4"
      :title="sessionExpiredFromTerminal ? $t('auth.sessionExpiredTerminal') : $t('auth.sessionExpired')"
    />
    <NAlert
      v-if="mfaSetupExpired"
      type="warning"
      class="mb-4"
      :title="$t('auth.login.mfaSetupExpired')"
    />
    <NAlert v-if="error" type="error" class="mb-5" :title="error" />

    <!-- ── Step 1: e-mail ── -->
    <NForm v-if="step === 'email'" @submit.prevent="continueFromEmail">
      <NFormItem :label="$t('auth.login.emailLabel')" :show-feedback="false" class="mb-5">
        <NInput
          v-model:value="email"
          :input-props="{ inputmode: 'email', autocomplete: 'email' }"
          :placeholder="$t('auth.login.emailPlaceholder')"
          size="large"
          :disabled="loading"
        />
      </NFormItem>
      <NButton
        type="primary"
        attr-type="submit"
        block
        size="large"
        :loading="loading"
        style="font-weight: 600;"
      >
        {{ $t('auth.login.emailContinue') }}
      </NButton>
    </NForm>

    <!-- ── Step 2: picker de tenant ── -->
    <template v-else-if="step === 'tenant'">
      <button class="back-btn mb-4" @click="resetToEmail">
        ← {{ $t('auth.login.changeEmail') }}
      </button>
      <p class="step-email mb-4">{{ email }}</p>

      <p class="picker-hint mb-3">
        {{ $t('auth.login.tenantPickerHint', { count: tenants.length }) }}
      </p>

      <div v-if="noTenantsFound" class="mb-4">
        <NAlert type="warning" :title="$t('auth.login.noTenantsFound')" />
      </div>

      <div class="tenant-list mb-5">
        <button
          v-for="opt in tenants"
          :key="opt.slug"
          class="tenant-option"
          :class="{ 'tenant-option--selected': selectedSlug === opt.slug }"
          @click="selectTenant(opt)"
        >
          <span class="tenant-radio">
            <span v-if="selectedSlug === opt.slug" class="tenant-radio-dot" />
          </span>
          <span class="tenant-info">
            <span class="tenant-name">{{ opt.name }}</span>
            <span
              v-if="hasDuplicateNames || tenants.length > 1"
              class="tenant-slug"
            >{{ opt.slug }}</span>
          </span>
        </button>
      </div>

      <NButton
        type="primary"
        block
        size="large"
        :disabled="!selectedSlug"
        style="font-weight: 600;"
        @click="continueFromTenant"
      >
        {{ $t('auth.login.tenantPickerContinue') }}
      </NButton>
    </template>

    <!-- ── Step 3: senha ── -->
    <NForm v-else @submit.prevent="submit">
      <button type="button" class="back-btn mb-3" @click="resetToEmail">
        ← {{ $t('auth.login.changeEmail') }}
      </button>

      <div class="identity-summary mb-4">
        <span class="identity-email">{{ email }}</span>
        <span v-if="selectedName" class="identity-tenant">{{ selectedName }}</span>
      </div>

      <NButton
        v-if="oidcEnabled"
        attr-type="button"
        block
        size="large"
        secondary
        :loading="oidcLoading"
        class="mb-3"
        @click="startOidc"
      >
        {{ $t('auth.login.oidcSubmit', { provider: oidcName || 'SSO' }) }}
      </NButton>

      <NSpin v-if="googleLoading" :show="true" class="mb-4 flex justify-center" />
      <div v-if="googleEnabled && !googleLoading" class="mb-2 flex justify-center">
        <div ref="googleBtnEl" />
      </div>
      <NDivider v-if="googleEnabled" style="margin: 16px 0;">
        <span class="text-xs" style="color:#4b4b58;">{{ $t('auth.login.orContinueWith') }}</span>
      </NDivider>

      <NFormItem :label="$t('auth.login.passwordLabel')" :show-feedback="false" class="mb-5">
        <NInput
          v-model:value="password"
          type="password"
          :placeholder="$t('auth.login.passwordPlaceholder')"
          size="large"
          show-password-on="click"
          :disabled="loading"
          :input-props="{ autocomplete: 'current-password' }"
        />
      </NFormItem>

      <NButton
        type="primary"
        attr-type="submit"
        block
        size="large"
        :loading="loading"
        style="font-weight: 600;"
      >
        {{ $t('auth.login.submit') }}
      </NButton>
    </NForm>
  </div>
</template>

<style scoped>
.login-card {
  background: rgba(22, 22, 26, 0.85);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.07);
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.4),
    0 32px 64px rgba(0,0,0,0.5),
    0 0 80px rgba(99,102,241,0.06);
}

/* ── back button ── */
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: #555;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}
.back-btn:hover { color: #999; }

/* ── step email display ── */
.step-email {
  font-size: 13px;
  color: #ccc;
  font-weight: 500;
}

/* ── picker ── */
.picker-hint {
  font-size: 12px;
  color: #555;
  margin: 0;
}

.tenant-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tenant-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
  width: 100%;
}
.tenant-option:hover {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.12);
}
.tenant-option--selected {
  border-color: #6366f1;
  background: rgba(99,102,241,0.08);
}

.tenant-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: border-color 0.15s;
}
.tenant-option--selected .tenant-radio {
  border-color: #6366f1;
}
.tenant-radio-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6366f1;
}

.tenant-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tenant-name {
  font-size: 14px;
  color: #ddd;
  font-weight: 500;
}

.tenant-slug {
  font-size: 11px;
  color: #555;
  font-family: ui-monospace, 'Cascadia Code', 'Fira Mono', monospace;
}
.tenant-option--selected .tenant-slug {
  color: #7c7ff0;
}

/* ── identity summary (step password) ── */
.identity-summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px;
}

.identity-email {
  font-size: 13px;
  color: #ccc;
}

.identity-tenant {
  font-size: 11px;
  color: #6366f1;
  font-weight: 500;
}
</style>
