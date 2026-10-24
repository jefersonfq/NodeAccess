<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NCard, NModal, NSpin } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { useTrialOnboarding } from '@/composables/useTrialOnboarding'
import { safeTrialDocumentUrl, trialStateLabel } from '@/services/trial.service'
const auth = useAuthStore()
const trial = useTrialOnboarding()
const { config, status, loading, busy, error, notice, registered, form, phoneError, invitation, password, passwordConfirmation, active, waiting, ended } = trial
const showCancel = ref(false)
const phoneInput = ref<HTMLInputElement | null>(null)
const primaryButtonTheme = {
  colorPrimary: '#4f46e5', colorHoverPrimary: '#4338ca', colorPressedPrimary: '#3730a3', colorFocusPrimary: '#4338ca',
  textColorPrimary: '#ffffff', textColorHoverPrimary: '#ffffff', textColorPressedPrimary: '#ffffff', textColorFocusPrimary: '#ffffff',
  borderPrimary: '1px solid #4f46e5', borderHoverPrimary: '1px solid #4338ca', borderPressedPrimary: '1px solid #3730a3', borderFocusPrimary: '1px solid #4338ca',
}
const privacyUrl = computed(() => safeTrialDocumentUrl(status.value?.privacyUrl ?? config.value?.privacyUrl))
const termsUrl = computed(() => safeTrialDocumentUrl(status.value?.termsUrl ?? config.value?.termsUrl))
const expiry = computed(() => status.value?.expiresAt ? new Date(status.value.expiresAt).toLocaleString('pt-BR') : '')
const loginTarget = computed(() => ({ name: 'login', query: { redirect: '/hosts?view=all', ...(status.value?.tenantSlug ? { tenantSlug: status.value.tenantSlug } : {}) } }))
async function cancel(): Promise<boolean> { await trial.cancel(); if (error.value) return false; showCancel.value = false; return true }
async function register(): Promise<void> {
  await trial.register()
  if (phoneError.value) phoneInput.value?.focus()
}
</script>

<template>
  <main class="trial-page">
    <div class="trial-shell">
      <header class="trial-header">
        <RouterLink
          to="/auth/login"
          class="trial-brand"
          aria-label="NodeAccess — entrar"
        >
          <img
            src="/favicon.svg"
            alt=""
            width="40"
            height="40"
          >
          <span>NodeAccess</span>
        </RouterLink>
        <RouterLink
          v-if="auth.isAuthenticated"
          to="/hosts"
        >
          Voltar ao meu ambiente
        </RouterLink>
        <RouterLink
          v-else
          to="/auth/login"
        >
          Já tenho uma conta
        </RouterLink>
      </header>
      <NCard
        class="trial-card"
        :bordered="false"
      >
        <p class="trial-eyebrow">
          Degustação
        </p>
        <h1>Experimente o NodeAccess</h1>
        <p class="trial-intro trial-muted">
          Conheça o acesso SSH pelo navegador em um laboratório de teste.
        </p>
        <ol
          v-if="!status && !registered && config?.enabled"
          class="trial-steps"
          aria-label="Como começar"
        >
          <li><span aria-hidden="true">1</span> Cadastre-se</li>
          <li><span aria-hidden="true">2</span> Confirme seu e-mail</li>
          <li><span aria-hidden="true">3</span> Acesse o laboratório</li>
        </ol>
        <NAlert
          v-if="error"
          type="error"
          title="Não foi possível concluir"
          role="alert"
          class="trial-alert"
        >
          {{ error }}
          <div class="trial-actions">
            <NButton
              v-if="status"
              :disabled="busy"
              @click="trial.retry"
            >
              Atualizar andamento
            </NButton>
            <NButton
              v-else
              :disabled="loading"
              @click="trial.initialize"
            >
              Tentar novamente
            </NButton>
            <NButton
              v-if="!status"
              :disabled="loading"
              @click="trial.restart"
            >
              Solicitar novo link
            </NButton>
          </div>
        </NAlert>
        <NAlert
          v-if="notice"
          type="success"
          class="trial-alert"
          role="status"
        >
          {{ notice }}
        </NAlert>
        <div
          v-if="loading"
          class="trial-loading"
          role="status"
        >
          <NSpin size="small" /> Carregando sua degustação…
        </div>

        <section
          v-else-if="status"
          aria-labelledby="trial-status-title"
        >
          <h2
            id="trial-status-title"
            aria-live="polite"
          >
            {{ trialStateLabel(status.status) }}
          </h2>
          <p v-if="status.message">
            {{ status.message }}
          </p>
          <p v-if="waiting">
            Você pode manter esta página aberta. O prazo começa quando o ambiente estiver pronto.
          </p>
          <p v-if="expiry">
            <strong>Disponível até:</strong> {{ expiry }} (horário deste dispositivo).
          </p>
          <p v-if="status.tenantSlug">
            <strong>Seu ambiente:</strong> <code>{{ status.tenantSlug }}</code>
          </p>
          <p v-if="ended">
            O acesso ao laboratório foi encerrado. Suas preferências de contato continuam disponíveis abaixo.
          </p>
          <NButton
            v-if="waiting || status.status.toLowerCase() === 'failed'"
            :loading="busy"
            @click="trial.retry"
          >
            Atualizar andamento
          </NButton>
          <form
            v-if="active && !status.activated"
            class="trial-form"
            @submit.prevent="trial.activate"
          >
            <h3>Defina sua senha para começar</h3>
            <p class="trial-muted">
              Na primeira entrada, você configurará a autenticação em duas etapas.
            </p>
            <label for="trial-password">Senha</label>
            <input
              id="trial-password"
              v-model="password"
              required
              type="password"
              autocomplete="new-password"
              minlength="12"
              maxlength="72"
              :disabled="busy"
              aria-describedby="trial-password-help"
            >
            <small id="trial-password-help">Use de 12 a 72 caracteres, com maiúsculas, minúsculas e números. Não reutilize senhas de outros serviços.</small>
            <label for="trial-password-confirm">Confirme a senha</label>
            <input
              id="trial-password-confirm"
              v-model="passwordConfirmation"
              required
              type="password"
              autocomplete="new-password"
              minlength="12"
              maxlength="72"
              :disabled="busy"
            >
            <fieldset v-if="status.consentRequired">
              <legend>Termos e contato</legend>
              <label class="trial-checkbox"><input
                v-model="form.termsAccepted"
                type="checkbox"
                required
                :disabled="busy"
              > <span>Aceito os <a
                v-if="termsUrl"
                :href="termsUrl"
                target="_blank"
                rel="noopener noreferrer"
              >termos da degustação</a>.</span></label>
              <p>
                Consulte o <a
                  v-if="privacyUrl"
                  :href="privacyUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >aviso de privacidade</a>.
              </p>
              <label class="trial-checkbox"><input
                v-model="form.marketingConsent"
                type="checkbox"
                :disabled="busy"
              > Quero receber novidades e ofertas por e-mail (opcional).</label>
              <label class="trial-checkbox"><input
                v-model="form.researchConsent"
                type="checkbox"
                :disabled="busy"
              > Quero receber convites para pesquisas por e-mail (opcional).</label>
            </fieldset>
            <NButton
              type="primary"
              :theme-overrides="primaryButtonTheme"
              attr-type="submit"
              :loading="busy"
              :disabled="status.consentRequired && (!termsUrl || !privacyUrl)"
            >
              Ativar minha conta
            </NButton>
          </form>
          <section
            v-if="active && status.activated"
            class="trial-start"
          >
            <h3>Comece com três passos</h3>
            <ol><li>Entre com seu e-mail e senha e configure a autenticação em duas etapas.</li><li>Abra um dos hosts de demonstração e conecte o terminal.</li><li>Experimente transferir um arquivo fictício pelo SFTP.</li></ol>
            <p>Use apenas os dados de exemplo. Não insira chaves, senhas ou informações reais no laboratório.</p>
            <NAlert
              v-if="auth.isAuthenticated"
              type="info"
            >
              Você já está conectado a outra conta. Para abrir a conta de teste sem interromper sua sessão, use uma janela privada e acesse o login com o ambiente indicado acima.
            </NAlert>
            <RouterLink
              v-else
              :to="loginTarget"
              class="trial-primary-link"
            >
              Entrar no meu ambiente de teste
            </RouterLink>
          </section>
          <form
            v-if="active && status.activated && status.owner && status.maxUsers > 1"
            class="trial-form trial-preferences"
            @submit.prevent="trial.invite"
          >
            <h3>Experimente com um colega</h3>
            <p>{{ status.users }} de {{ status.maxUsers }} vagas ocupadas. Cada pessoa confirma seu próprio e-mail e suas preferências.</p>
            <template v-if="status.users < status.maxUsers">
              <label for="trial-invite-name">Nome do convidado</label>
              <input
                id="trial-invite-name"
                v-model="invitation.name"
                required
                maxlength="100"
                :disabled="busy"
                autocomplete="off"
              >
              <label for="trial-invite-email">E-mail do convidado</label>
              <input
                id="trial-invite-email"
                v-model="invitation.email"
                required
                type="email"
                maxlength="254"
                :disabled="busy"
                autocomplete="off"
              >
              <NButton
                attr-type="submit"
                :loading="busy"
              >
                Enviar convite
              </NButton>
            </template>
            <p v-else>
              O limite de participantes deste teste foi atingido.
            </p>
          </form>
          <form
            v-if="!status.consentRequired"
            class="trial-form trial-preferences"
            @submit.prevent="trial.savePreferences"
          >
            <h3>Suas preferências de contato</h3>
            <label class="trial-checkbox"><input
              v-model="form.marketingConsent"
              type="checkbox"
              :disabled="busy"
            > Quero receber novidades e ofertas do NodeAccess por e-mail.</label>
            <label class="trial-checkbox"><input
              v-model="form.researchConsent"
              type="checkbox"
              :disabled="busy"
            > Quero receber convites por e-mail para pesquisas de feedback.</label>
            <small>Essas escolhas são opcionais e podem ser alteradas a qualquer momento.</small>
            <NButton
              attr-type="submit"
              :loading="busy"
            >
              Salvar preferências
            </NButton>
          </form>
          <NButton
            v-if="!ended"
            class="trial-cancel"
            type="error"
            text
            :disabled="busy"
            @click="showCancel = true"
          >
            {{ status.owner ? 'Encerrar minha degustação' : 'Encerrar minha participação' }}
          </NButton>
        </section>

        <section
          v-else-if="registered"
          aria-labelledby="trial-email-title"
        >
          <h2 id="trial-email-title">
            Confira seu e-mail
          </h2>
          <p>Abra o link recebido para confirmar o cadastro e acompanhar a preparação do ambiente. Verifique também a pasta de spam.</p>
          <NButton
            :loading="busy"
            @click="trial.register"
          >
            Reenviar solicitação
          </NButton>
          <NButton
            text
            :disabled="busy"
            @click="registered = false"
          >
            Corrigir meu e-mail
          </NButton>
        </section>

        <section v-else-if="config && !config.enabled">
          <h2>Novas degustações estão temporariamente indisponíveis</h2>
          <p>As contas existentes continuam funcionando. Se você já recebeu um link de acompanhamento, abra-o para consultar seu teste.</p>
          <NButton @click="trial.initialize">
            Verificar disponibilidade
          </NButton>
        </section>

        <form
          v-else-if="config?.enabled"
          class="trial-form"
          @submit.prevent="register"
        >
          <p class="trial-offer">
            <strong>{{ config.profile.durationDays }} dias</strong> a partir da liberação · até {{ config.profile.maxUsers }} participantes · {{ config.profile.maxHosts }} hosts.
          </p>
          <ul
            class="trial-offer"
            aria-label="Limites da degustação"
          >
            <li v-if="config.profile.machineCount !== undefined">
              {{ config.profile.machineCount }} máquina(s) de demonstração inicial(is), até {{ config.profile.maxMachines ?? config.profile.machineCount }} no laboratório.
            </li>
            <li v-if="config.profile.maxSessions !== undefined">
              Até {{ config.profile.maxSessions }} sessões simultâneas no laboratório.
            </li>
            <li v-if="config.profile.allowCustomHosts">
              Até {{ config.profile.maxCustomHosts ?? 0 }} hosts próprios, dentro do limite total de hosts. As quotas são compartilhadas pelos participantes.
            </li>
            <li v-else>
              Cadastro de hosts próprios indisponível neste perfil.
            </li>
            <li v-if="config.profile.resources?.length">
              Recursos: {{ config.profile.resources.map(resource => ({ ssh: 'SSH', sftp: 'SFTP', sharing: 'compartilhamento', audit: 'auditoria' })[resource]).join(', ') }}.
            </li>
          </ul>
          <p class="trial-muted">
            Use dados de teste no laboratório. O laboratório e seu acesso serão encerrados ao final do prazo.
            <template v-if="config.profile.retentionDays !== undefined">
              Os dados pessoais vinculados à degustação seguem o prazo de retenção de {{ config.profile.retentionDays }} dias após o encerramento, conforme a política de privacidade.
            </template>
          </p>
          <label for="trial-name">Nome</label>
          <input
            id="trial-name"
            v-model="form.name"
            required
            autocomplete="name"
            maxlength="100"
            :disabled="busy"
          >
          <label for="trial-email">E-mail</label>
          <input
            id="trial-email"
            v-model="form.email"
            required
            type="email"
            autocomplete="email"
            maxlength="254"
            :disabled="busy"
          >
          <label for="trial-phone">Telefone <span class="trial-optional">(opcional)</span></label>
          <input
            id="trial-phone"
            ref="phoneInput"
            v-model="form.phone"
            type="tel"
            autocomplete="tel"
            maxlength="40"
            :disabled="busy"
            :aria-invalid="phoneError ? 'true' : undefined"
            :aria-describedby="phoneError ? 'trial-phone-help trial-phone-error' : 'trial-phone-help'"
          >
          <small id="trial-phone-help">
            DDD e número; inclua +DDI para outro país.<br>
            Ao informar, você solicita contato sobre sua degustação. Não autoriza marketing.
          </small>
          <p
            v-if="phoneError"
            id="trial-phone-error"
            class="trial-field-error"
            role="alert"
          >
            {{ phoneError }}
          </p>
          <fieldset>
            <legend>Preferências opcionais por e-mail</legend>
            <label class="trial-checkbox"><input
              v-model="form.marketingConsent"
              type="checkbox"
              :disabled="busy"
            > Quero receber novidades e ofertas do NodeAccess por e-mail.</label>
            <label class="trial-checkbox"><input
              v-model="form.researchConsent"
              type="checkbox"
              :disabled="busy"
            > Quero receber convites por e-mail para pesquisas de feedback.</label>
            <small>Você pode experimentar sem marcar nenhuma dessas opções.</small>
          </fieldset>
          <label class="trial-checkbox"><input
            v-model="form.termsAccepted"
            required
            type="checkbox"
            :disabled="busy"
          > <span>Aceito os <a
            v-if="termsUrl"
            :href="termsUrl"
            target="_blank"
            rel="noopener noreferrer"
          >termos da degustação</a><span v-else>termos da degustação</span>.</span></label>
          <p class="trial-muted">
            Veja como seus dados são tratados no <a
              v-if="privacyUrl"
              :href="privacyUrl"
              target="_blank"
              rel="noopener noreferrer"
            >aviso de privacidade</a><span v-else>aviso de privacidade</span>.
          </p>
          <NButton
            type="primary"
            :theme-overrides="primaryButtonTheme"
            attr-type="submit"
            :loading="busy"
            :disabled="!termsUrl || !privacyUrl"
          >
            Solicitar meu ambiente de teste
          </NButton>
        </form>
      </NCard>
      <footer>NodeAccess · Degustação com acesso limitado ao laboratório</footer>
    </div>
    <NModal
      v-model:show="showCancel"
      preset="dialog"
      :title="status?.owner ? 'Encerrar degustação?' : 'Encerrar minha participação?'"
      :positive-text="status?.owner ? 'Encerrar degustação' : 'Encerrar participação'"
      negative-text="Continuar usando"
      :loading="busy"
      @positive-click="cancel"
    >
      <template v-if="status?.owner">
        O acesso será revogado e as máquinas e arquivos do laboratório serão removidos. Esta ação não pode ser desfeita. Suas preferências de contato não serão alteradas.
      </template>
      <template v-else>
        Somente sua participação será encerrada. O laboratório e o acesso das outras pessoas serão preservados. Suas preferências de contato não serão alteradas.
      </template>
    </NModal>
  </main>
</template>

<style scoped>
.trial-page {
  --trial-link: #a5b4fc;
  --trial-background: #0c0c10;
  --trial-card: #15151d;
  --trial-text: #f1f3fa;
  --trial-muted: #b2b7ca;
  --trial-line: #393d51;
  --trial-soft: #1c2033;
  --trial-error: #fca5a5;
  min-height: 100vh;
  padding: 32px 20px 48px;
  background: radial-gradient(ellipse at top, #6366f119, transparent 65%), var(--trial-background);
  color: var(--trial-text);
}
:global(body[data-theme='light'] .trial-page) {
  --trial-link: #4338ca;
  --trial-background: #f4f6fc;
  --trial-card: #fff;
  --trial-text: #192136;
  --trial-muted: #526078;
  --trial-line: #c9d0e0;
  --trial-soft: #f0f3ff;
  --trial-error: #b91c1c;
}
.trial-shell { width: min(100%, 760px); margin: 0 auto; }
.trial-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
.trial-brand { display: inline-flex; align-items: center; gap: 12px; font-size: 23px; font-weight: 700; letter-spacing: -.6px; color: var(--trial-text); text-decoration: none; }
.trial-brand img { flex: 0 0 auto; filter: drop-shadow(0 4px 10px #6366f133); }
.trial-header > a:last-child { font-size: 13px; text-align: right; }
.trial-card { background: var(--trial-card); color: var(--trial-text); border: 1px solid var(--trial-line); border-radius: 18px; box-shadow: 0 16px 48px #00000014; overflow: hidden; }
.trial-card::before { content: ''; display: block; height: 3px; background: linear-gradient(90deg, #3b82f6, #6366f1); }
.trial-card :deep(.n-card__content) { padding: 32px 36px; }
a { color: var(--trial-link); text-decoration: underline; text-underline-offset: 3px; }
h1 { font-size: clamp(25px, 4vw, 32px); line-height: 1.2; font-weight: 700; letter-spacing: -.7px; margin: 0 0 12px; }
h2 { font-size: 22px; line-height: 1.35; font-weight: 600; margin: 24px 0 12px; }
h3 { font-size: 17px; font-weight: 600; margin: 12px 0; }
p { margin: 10px 0; line-height: 1.65; }
.trial-eyebrow { color: var(--trial-link); margin: 0 0 12px; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
.trial-muted, small { color: var(--trial-muted); line-height: 1.65; }
.trial-intro { font-size: 15px; max-width: 50ch; }
.trial-steps { display: flex; flex-wrap: wrap; gap: 12px 18px; padding: 20px 0; margin: 16px 0 0; list-style: none; border-block: 1px solid var(--trial-line); }
.trial-steps li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.trial-steps span { display: grid; place-items: center; width: 23px; height: 23px; border: 1px solid var(--trial-line); border-radius: 50%; color: var(--trial-link); background: var(--trial-soft); font-weight: 600; }
.trial-form { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
.trial-form > label:not(.trial-checkbox) { margin-top: 6px; font-weight: 600; }
.trial-optional { color: var(--trial-muted); font-weight: 400; }
.trial-form input:not([type=checkbox]) { width: 100%; min-height: 46px; box-sizing: border-box; padding: 11px 13px; border: 1px solid var(--trial-line); border-radius: 8px; background: var(--trial-background); color: inherit; font: inherit; font-size: 16px; }
.trial-form input:disabled { opacity: .6; cursor: wait; }
.trial-form input[aria-invalid=true] { border-color: var(--trial-error); }
.trial-form input:focus-visible, a:focus-visible { outline: 2px solid #818cf8; outline-offset: 3px; }
.trial-field-error { color: var(--trial-error); font-size: 13px; margin: 0; }
.trial-checkbox { display: flex; gap: 10px; align-items: flex-start; line-height: 1.65; cursor: pointer; }
.trial-checkbox input { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 4px; accent-color: #6366f1; }
fieldset { min-width: 0; border: 1px solid var(--trial-line); background: var(--trial-soft); padding: 16px; margin: 14px 0 8px; border-radius: 10px; display: flex; flex-direction: column; gap: 12px; }
legend { padding: 0 6px; font-weight: 600; font-size: 13px; }
.trial-alert { margin-top: 20px; }
.trial-loading, .trial-actions { display: flex; gap: 12px; align-items: center; padding-top: 16px; flex-wrap: wrap; }
.trial-offer { margin: 0; }
ul.trial-offer { padding-left: 20px; list-style: disc; color: var(--trial-muted); line-height: 1.75; }
.trial-start ol { padding-left: 22px; list-style: decimal; line-height: 1.8; }
.trial-primary-link { display: inline-block; margin: 16px 0; padding: 12px 16px; background: #4f46e5; color: white; border-radius: 8px; text-decoration: none; font-weight: 600; }
.trial-preferences { border-top: 1px solid var(--trial-line); margin-top: 28px; padding-top: 20px; }
.trial-cancel { margin-top: 24px; }
footer { text-align: center; margin-top: 24px; font-size: 12px; color: var(--trial-muted); }
code { overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .trial-page { padding: 20px 14px 32px; }
  .trial-header { gap: 12px; margin-bottom: 20px; }
  .trial-brand { font-size: 19px; gap: 8px; }
  .trial-brand img { width: 34px; height: 34px; }
  .trial-header > a:last-child { max-width: 125px; }
  .trial-card :deep(.n-card__content) { padding: 24px 20px; }
  .trial-steps { gap: 12px; }
}
</style>
