<script setup lang="ts">
import { computed, ref } from 'vue'
import { NAlert, NButton, NCard, NModal, NSpin } from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import { useTrialOnboarding } from '@/composables/useTrialOnboarding'
import { safeTrialDocumentUrl, trialStateLabel } from '@/services/trial.service'
const auth = useAuthStore()
const trial = useTrialOnboarding()
const { config, status, loading, busy, error, notice, registered, form, invitation, password, passwordConfirmation, active, waiting, ended } = trial
const showCancel = ref(false)
const privacyUrl = computed(() => safeTrialDocumentUrl(status.value?.privacyUrl ?? config.value?.privacyUrl))
const termsUrl = computed(() => safeTrialDocumentUrl(status.value?.termsUrl ?? config.value?.termsUrl))
const expiry = computed(() => status.value?.expiresAt ? new Date(status.value.expiresAt).toLocaleString('pt-BR') : '')
const loginTarget = computed(() => ({ name: 'login', query: { redirect: '/hosts?view=all', ...(status.value?.tenantSlug ? { tenantSlug: status.value.tenantSlug } : {}) } }))
async function cancel(): Promise<boolean> { await trial.cancel(); if (error.value) return false; showCancel.value = false; return true }
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
          NodeAccess
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
      <NCard class="trial-card">
        <h1>Experimente o NodeAccess</h1>
        <p class="trial-muted">
          Conheça o acesso SSH pelo navegador em um laboratório de teste.
        </p>
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
          @submit.prevent="trial.register"
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
          <fieldset>
            <legend>Contato opcional</legend>
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
.trial-page { --trial-link: #7cb4ff; min-height: 100vh; padding: 24px 16px 48px; background: var(--na-bg, #101217); color: var(--na-text, #e5e7eb); }
:global(body[data-theme='light']) .trial-page { --trial-link: #1d4ed8; }
.trial-shell { width: min(100%, 660px); margin: 0 auto; }
.trial-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.trial-brand { font-size: 22px; font-weight: 700; }
a { color: var(--trial-link); text-decoration: underline; text-underline-offset: 3px; }
h1 { font-size: 26px; line-height: 1.3; font-weight: 700; margin: 0 0 8px; }
h2 { font-size: 21px; font-weight: 600; margin: 20px 0 10px; }
h3 { font-size: 17px; font-weight: 600; margin: 10px 0; }
p { margin: 10px 0; line-height: 1.6; }
.trial-muted, small { opacity: .8; line-height: 1.6; }
.trial-form { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
.trial-form input:not([type=checkbox]) { width: 100%; min-height: 42px; box-sizing: border-box; padding: 9px 12px; border: 1px solid #6b7280; border-radius: 6px; background: transparent; color: inherit; font: inherit; }
.trial-form input:focus-visible, a:focus-visible { outline: 2px solid #60a5fa; outline-offset: 3px; }
.trial-checkbox { display: flex; gap: 10px; align-items: flex-start; line-height: 1.6; cursor: pointer; }
.trial-checkbox input { flex: 0 0 auto; width: 18px; height: 18px; margin-top: 4px; accent-color: #60a5fa; }
fieldset { border: 1px solid #6b7280; padding: 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 12px; }
legend { padding: 0 5px; font-weight: 600; }
.trial-alert { margin-top: 16px; }
.trial-loading, .trial-actions { display: flex; gap: 12px; align-items: center; padding-top: 16px; flex-wrap: wrap; }
.trial-start ol { padding-left: 22px; list-style: decimal; line-height: 1.8; }
.trial-primary-link { display: inline-block; margin: 16px 0; padding: 12px 16px; background: #2563eb; color: white; border-radius: 6px; }
.trial-preferences { border-top: 1px solid #6b7280; margin-top: 28px; padding-top: 16px; }
.trial-cancel { margin-top: 24px; }
footer { text-align: center; margin-top: 24px; font-size: 12px; opacity: .7; }
code { overflow-wrap: anywhere; }
@media (max-width: 480px) { .trial-page { padding: 16px 10px; } h1 { font-size: 23px; } .trial-header { gap: 8px; } }
</style>
