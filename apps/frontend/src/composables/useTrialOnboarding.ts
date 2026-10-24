import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { TRIAL_ACCESS_KEY, takeTrialVerificationToken, trialError, trialService, type TrialPublicConfig, type TrialStatus } from '@/services/trial.service'

interface TrialOnboarding {
  config: Ref<TrialPublicConfig | null>
  status: Ref<TrialStatus | null>
  loading: Ref<boolean>
  busy: Ref<boolean>
  error: Ref<string>
  notice: Ref<string>
  registered: Ref<boolean>
  form: Ref<{ name: string; email: string; termsAccepted: boolean; marketingConsent: boolean; researchConsent: boolean }>
  invitation: Ref<{ name: string; email: string }>
  password: Ref<string>
  passwordConfirmation: Ref<string>
  active: ComputedRef<boolean>
  waiting: ComputedRef<boolean>
  ended: ComputedRef<boolean>
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
  const form = ref({ name: '', email: '', termsAccepted: false, marketingConsent: false, researchConsent: false })
  const invitation = ref({ name: '', email: '' })
  const password = ref('')
  const passwordConfirmation = ref('')
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
    form.value.marketingConsent = next.marketingConsent
    form.value.researchConsent = next.researchConsent
    schedule()
  }
  function schedule(): void {
    clearTimeout(poll)
    if (!stopped && waiting.value) poll = setTimeout(() => {
      if (document.hidden) { schedule(); return }
      void refresh().catch(err => { error.value = trialError(err, 'Não foi possível atualizar o andamento.'); })
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
        remember('')
        remember((await trialService.verify(verificationToken)).accessToken)
      }
      if (accessToken.value) await refresh()
      config.value = await trialService.config()
    } catch (err) { error.value = trialError(err, 'Não foi possível carregar a degustação.') }
    finally { loading.value = false }
  }
  async function register(): Promise<void> {
    if (!config.value?.enabled || !form.value.termsAccepted) return
    await perform(async () => {
      const response = await trialService.register({ ...form.value, name: form.value.name.trim(), email: form.value.email.trim(), termsAccepted: true, privacyVersion: config.value!.privacyVersion })
      registered.value = true
      notice.value = response.message || 'Confira seu e-mail para continuar. Se não encontrar, verifique a pasta de spam.'
    })
  }
  async function activate(): Promise<void> {
    if (password.value !== passwordConfirmation.value) { error.value = 'As senhas precisam ser iguais.'; return }
    await perform(async () => {
      const consent = status.value?.consentRequired ? { termsAccepted: true as const, privacyVersion: status.value.privacyVersion ?? '', marketingConsent: form.value.marketingConsent, researchConsent: form.value.researchConsent } : undefined
      if (consent && !form.value.termsAccepted) { error.value = 'Aceite os termos da degustação para ativar sua participação.'; return }
      await trialService.activate(accessToken.value, password.value, consent)
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
    password.value = ''; passwordConfirmation.value = ''
    void initialize()
  }
  onMounted(() => { void initialize() })
  watch(() => route.hash, hash => { if (new URLSearchParams(hash.replace(/^#/, '')).has('token')) void initialize() })
  onBeforeUnmount(() => { stopped = true; clearTimeout(poll); password.value = ''; passwordConfirmation.value = '' })
  return { config, status, loading, busy, error, notice, registered, form, invitation, invite, password, passwordConfirmation, active, waiting, ended, initialize, register, activate, savePreferences, cancel, restart, retry: (): Promise<void> => perform(refresh) }
}
