import axios from 'axios'
import { trialNameError, trialEmailError } from '@/services/trial-registration'
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { TRIAL_ACCESS_KEY, takeTrialVerificationToken, trialError, trialPhoneError, trialService, type TrialLifecycleAcknowledgement, type TrialPublicConfig, type TrialStatus } from '@/services/trial.service'

interface TrialOnboarding {
  config: Ref<TrialPublicConfig | null>
  status: Ref<TrialStatus | null>
  loading: Ref<boolean>
  busy: Ref<boolean>
  error: Ref<string>
  notice: Ref<string>
  registered: Ref<boolean>
  form: Ref<{ name: string; email: string; phone: string; termsAccepted: boolean; marketingConsent: boolean; researchConsent: boolean }>
  nameError: ComputedRef<string>
  emailError: ComputedRef<string>
  phoneError: ComputedRef<string>
  invitation: Ref<{ name: string; email: string }>
  password: Ref<string>
  passwordConfirmation: Ref<string>
  lifecycleAcknowledged: Ref<boolean>
  active: ComputedRef<boolean>
  waiting: ComputedRef<boolean>
  ended: ComputedRef<boolean>
  touchField: (field: 'name' | 'email' | 'phone') => void
  initialize: () => Promise<void>
  register: () => Promise<void>
  activate: () => Promise<void>
  invite: () => Promise<void>
  savePreferences: () => Promise<void>
  cancel: () => Promise<void>
  restart: () => void
  retry: () => Promise<void>
}
export function useTrialOnboarding(): TrialOnboarding {
  const route = useRoute()
  const config = ref<TrialPublicConfig | null>(null)
  const status = ref<TrialStatus | null>(null)
  const accessToken = ref('')
  const loading = ref(true)
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  const registered = ref(false)
  const form = ref({ name: '', email: '', phone: '', termsAccepted: false, marketingConsent: false, researchConsent: false })
  const registrationValidationAttempted = ref(false)
  const touchedFields = ref({ name: false, email: false, phone: false })
  const touchField = (field: 'name' | 'email' | 'phone'): void => { touchedFields.value[field] = true }
  const serverFields = ref<Record<string, string>>({})
  const nameError = computed(() => serverFields.value.name || ((registrationValidationAttempted.value || touchedFields.value.name) ? trialNameError(form.value.name) : ''))
  const emailError = computed(() => serverFields.value.email || ((registrationValidationAttempted.value || touchedFields.value.email) ? trialEmailError(form.value.email) : ''))
  for (const field of ['name', 'email', 'phone'] as const) watch(() => form.value[field], () => { delete serverFields.value[field] })
  const phoneError = computed(() => serverFields.value.phone || ((registrationValidationAttempted.value || touchedFields.value.phone) ? trialPhoneError(form.value.phone) : ''))
  const invitation = ref({ name: '', email: '' })
  const password = ref('')
  const passwordConfirmation = ref('')
  const lifecycleAcknowledged = ref(false)
  watch([(): string | null | undefined => status.value?.expiresAt, (): number | undefined => status.value?.retentionDays, (): string | null | undefined => status.value?.lifecycleNoticeVersion], () => { lifecycleAcknowledged.value = false })
  let poll: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const active = computed(() => ['active', 'ready'].includes(status.value?.status.toLowerCase() ?? ''))
  const waiting = computed(() => ['queued', 'verified', 'provisioning'].includes(status.value?.status.toLowerCase() ?? ''))
  const ended = computed(() => ['expired', 'cancelled', 'cancel_requested', 'deleting', 'removing', 'removed', 'deleted', 'cleanup_failed'].includes(status.value?.status.toLowerCase() ?? ''))

  function remember(token: string): void {
    accessToken.value = token
    try { if (token) sessionStorage.setItem(TRIAL_ACCESS_KEY, token); else sessionStorage.removeItem(TRIAL_ACCESS_KEY) } catch { /* Current tab remains usable if storage is unavailable. */ }
  }
  async function refresh(): Promise<void> {
    if (!accessToken.value || stopped) return
    const next = await trialService.status(accessToken.value)
    if (stopped) return
    status.value = next
    error.value = ''
    form.value.marketingConsent = next.marketingConsent
    form.value.researchConsent = next.researchConsent
    schedule()
  }
  function schedule(): void {
    clearTimeout(poll)
    if (!stopped && waiting.value) poll = setTimeout(() => {
      if (document.hidden) { schedule(); return }
      void refresh().catch(err => { error.value = trialError(err, 'Não foi possível atualizar o andamento.'); schedule(); })
    }, 5000)
  }
  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = ''
    notice.value = ''
    try { await action() } catch (err) { error.value = trialError(err, 'Não foi possível concluir. Tente novamente.') }
    finally { busy.value = false }
  }
  async function initialize(): Promise<void> {
    loading.value = true
    error.value = ''
    // Scrub the capability before the first network request, even if config fails.
    const verificationToken = takeTrialVerificationToken(window.location, window.history)
    try {
      try { accessToken.value = sessionStorage.getItem(TRIAL_ACCESS_KEY) ?? '' } catch { /* Storage can be blocked. */ }
      if (verificationToken !== null) {
        status.value = null
        form.value.termsAccepted = false
        lifecycleAcknowledged.value = false
        remember('')
        remember((await trialService.verify(verificationToken)).accessToken)
      }
      if (accessToken.value) await refresh()
      config.value = await trialService.config()
    } catch (err) { error.value = trialError(err, 'Não foi possível carregar o teste.') }
    finally { loading.value = false }
  }
  async function register(): Promise<void> {
    if (!config.value?.enabled || !form.value.termsAccepted) return
    registrationValidationAttempted.value = true
    if (nameError.value || emailError.value || phoneError.value) return
    serverFields.value = {}
    await perform(async () => {
      const { phone, ...registration } = form.value
      const response = await trialService.register({ ...registration, ...(phone.trim() ? { phone: phone.trim() } : {}), name: form.value.name.trim().normalize('NFC').replace(/\s+/g, ' '), email: form.value.email.trim(), termsAccepted: true, privacyVersion: config.value!.privacyVersion }).catch((err: unknown) => {
        if (axios.isAxiosError<{ fields?: Record<string, unknown> }>(err) && err.response?.status === 422) {
          for (const field of ['name', 'email', 'phone'] as const) if (typeof err.response.data.fields?.[field] === 'string') serverFields.value[field] = 'Revise este campo antes de continuar.'
          if (Object.keys(serverFields.value).length) return null
        }
        throw err
      })
      if (!response) return
      registered.value = true
      notice.value = response.message || 'Se o endereço puder ser usado, enviaremos um link. Verifique também a pasta de spam.'
    })
  }
  async function activate(): Promise<void> {
    if (password.value !== passwordConfirmation.value) { error.value = 'As senhas precisam ser iguais.'; return }
    await perform(async () => {
      const consent = status.value?.consentRequired ? { termsAccepted: true as const, privacyVersion: status.value.privacyVersion ?? '', marketingConsent: form.value.marketingConsent, researchConsent: form.value.researchConsent } : undefined
      if (consent && !form.value.termsAccepted) { error.value = 'Aceite os termos do teste para ativar sua participação.'; return }
      let acknowledgement: TrialLifecycleAcknowledgement | undefined
      if (status.value?.lifecycleAcknowledgementRequired) {
        if (!lifecycleAcknowledged.value || status.value.lifecycleNoticeVersion !== 'trial-lifecycle-v1'
          || !status.value.expiresAt || !status.value.retentionDays) {
          error.value = 'Leia e confirme o prazo e o encerramento do teste antes de ativar.'
          return
        }
        acknowledgement = { accepted: true, version: 'trial-lifecycle-v1', expiresAt: status.value.expiresAt, retentionDays: status.value.retentionDays }
      }
      await trialService.activate(accessToken.value, password.value, consent, acknowledgement).catch(async (err: unknown) => {
        if (acknowledgement && axios.isAxiosError(err) && err.response?.status === 422) {
          lifecycleAcknowledged.value = false
          await refresh().catch(() => undefined)
        }
        throw err
      })
      password.value = ''; passwordConfirmation.value = ''
      await refresh()
      notice.value = 'Conta ativada. Entre no NodeAccess para configurar a autenticação em duas etapas.'
    })
  }
  const invite = (): Promise<void> => perform(async () => {
    const response = await trialService.invite(accessToken.value, { name: invitation.value.name.trim(), email: invitation.value.email.trim() })
    invitation.value = { name: '', email: '' }
    await refresh()
    notice.value = response.message || 'Solicitação de convite recebida. O destinatário precisará confirmar o e-mail e definir suas próprias preferências.'
  })
  const savePreferences = (): Promise<void> => perform(async () => {
    await trialService.preferences(accessToken.value, { marketingConsent: form.value.marketingConsent, researchConsent: form.value.researchConsent })
    notice.value = 'Preferências atualizadas.'
  })
  const cancel = (): Promise<void> => perform(async () => {
    await trialService.cancel(accessToken.value)
    await refresh()
    notice.value = status.value?.owner ? 'Solicitação de encerramento recebida. A remoção do laboratório será acompanhada pelo sistema.' : 'Sua participação foi encerrada. Os demais participantes continuam com acesso.'
  })
  function restart(): void {
    clearTimeout(poll); remember(''); status.value = null; registered.value = false; notice.value = ''; error.value = ''
    password.value = ''; passwordConfirmation.value = ''; lifecycleAcknowledged.value = false
    void initialize()
  }
  onMounted(() => { void initialize() })
  watch(() => route.hash, hash => { if (new URLSearchParams(hash.replace(/^#/, '')).has('token')) void initialize() })
  onBeforeUnmount(() => { stopped = true; clearTimeout(poll); password.value = ''; passwordConfirmation.value = '' })
  return { config, status, loading, busy, error, notice, registered, form, nameError, emailError, phoneError, invitation, invite, password, passwordConfirmation, lifecycleAcknowledged, active, waiting, ended, touchField, initialize, register, activate, savePreferences, cancel, restart, retry: (): Promise<void> => perform(refresh) }
}
