<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NCard, NModal, NTag } from 'naive-ui'
import { trialError, trialService, trialStateLabel, type TrialAdminRow, type TrialProfile } from '@/services/trial.service'
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const profile = ref<TrialProfile | null>(null)
const rows = ref<TrialAdminRow[]>([])
const provisionerReady = ref(false)
const cancelling = ref<TrialAdminRow | null>(null)
const showCancel = ref(false)
const numericFields: { key: 'durationDays' | 'maxUsers' | 'maxHosts' | 'machineCount' | 'maxActiveTrials' | 'retentionDays' | 'maxSessions' | 'expiryNoticeHours' | 'maxMachines' | 'maxCustomHosts'; label: string; max: number; min?: number }[] = [
  { key: 'durationDays', label: 'Duração do teste (dias)', max: 30 },
  { key: 'maxUsers', label: 'Participantes por teste', max: 10 },
  { key: 'maxHosts', label: 'Hosts por teste', max: 10 },
  { key: 'machineCount', label: 'Máquinas de demonstração iniciais', max: 10 },
  { key: 'maxMachines', label: 'Limite de máquinas de demonstração', max: 10 },
  { key: 'maxCustomHosts', label: 'Limite de hosts próprios', max: 10, min: 0 },
  { key: 'maxSessions', label: 'Sessões simultâneas por teste', max: 10 },
  { key: 'maxActiveTrials', label: 'Testes ativos simultâneos', max: 100 },
  { key: 'expiryNoticeHours', label: 'Avisar antes da expiração (horas)', max: 23 },
  { key: 'retentionDays', label: 'Retenção configurada (dias)', max: 365 },
]
function date(value: string | null | undefined): string { return value ? new Date(value).toLocaleString('pt-BR') : '—' }
async function load(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    const result = await trialService.list()
    profile.value = result.profile ? { ...result.profile, maxMachines: result.profile.maxMachines ?? result.profile.machineCount, allowCustomHosts: result.profile.allowCustomHosts ?? false, maxCustomHosts: result.profile.maxCustomHosts ?? 0, expiryNoticeHours: result.profile.expiryNoticeHours ?? 6, resources: result.profile.resources ?? ['ssh', 'sftp'] } : { name: 'Degustação NodeAccess', durationDays: 7, maxUsers: 2, maxHosts: 2, machineCount: 2, maxMachines: 2, allowCustomHosts: false, maxCustomHosts: 0, maxSessions: 2, templateId: '', networkCidr: '', maxActiveTrials: 10, retentionDays: 30, expiryNoticeHours: 6, privacyUrl: '', termsUrl: '', privacyVersion: '', resources: ['ssh', 'sftp'] }
    rows.value = result.trials
    provisionerReady.value = result.provisionerReady === true
  } catch (err) { error.value = trialError(err, 'Não foi possível carregar as degustações.') }
  finally { loading.value = false }
}
async function save(): Promise<void> {
  if (!profile.value || saving.value) return
  if ((profile.value.maxMachines ?? profile.value.machineCount) < profile.value.machineCount || (profile.value.maxMachines ?? profile.value.machineCount) > profile.value.maxHosts || (profile.value.maxCustomHosts ?? 0) > profile.value.maxHosts) { error.value = 'Confira as quotas: máquinas iniciais ≤ limite de máquinas ≤ total de hosts, e hosts próprios ≤ total de hosts.'; return }
  saving.value = true; error.value = ''; notice.value = ''
  try { await trialService.saveProfile(profile.value); notice.value = 'Perfil salvo. A alteração será aplicada a novos testes; os testes existentes mantêm sua configuração.' }
  catch (err) { error.value = trialError(err, 'Não foi possível salvar o perfil.') }
  finally { saving.value = false }
}
function askCancel(row: TrialAdminRow): void { cancelling.value = row; showCancel.value = true }
async function cancel(): Promise<boolean> {
  if (!cancelling.value || saving.value) return false
  saving.value = true; error.value = ''; notice.value = ''
  try { await trialService.cancelAdmin(cancelling.value.id); showCancel.value = false; await load(); notice.value = 'Encerramento solicitado.'; return true }
  catch (err) { error.value = trialError(err, 'Não foi possível encerrar o teste.'); return false }
  finally { saving.value = false }
}
function canCancel(row: TrialAdminRow): boolean { return !['expired', 'cancelled', 'removing', 'removed', 'deleted', 'deleting', 'cancel_requested'].includes(row.status.toLowerCase()) }
onMounted(() => { void load() })
</script>

<template>
  <main class="trial-admin">
    <header>
      <div><h1>Degustações</h1><p>Configure a oferta pública e acompanhe os ambientes de teste.</p></div><NButton
        :loading="loading"
        @click="load"
      >
        Atualizar
      </NButton>
    </header>
    <NAlert
      v-if="error"
      type="error"
      role="alert"
    >
      {{ error }}
    </NAlert>
    <NAlert
      v-if="notice"
      type="success"
      role="status"
    >
      {{ notice }}
    </NAlert>
    <NAlert type="info">
      Contas e ambientes criados pela administração normal mantêm suas regras atuais. Este perfil se aplica somente ao onboarding de degustação.
    </NAlert>
    <NAlert
      v-if="profile && !provisionerReady"
      type="warning"
    >
      O provisionamento ainda não está pronto. Configure e valide a infraestrutura de laboratório antes de abrir inscrições.
    </NAlert>
    <NCard
      v-if="profile"
      title="Perfil para novos testes"
    >
      <form
        class="trial-profile"
        @submit.prevent="save"
      >
        <label>Nome da oferta<input
          v-model="profile.name"
          required
          maxlength="80"
          :disabled="saving"
        ></label>
        <label
          v-for="field in numericFields"
          :key="field.key"
        >{{ field.label }}<input
          v-model.number="profile[field.key]"
          type="number"
          :min="field.min ?? 1"
          :max="field.max"
          step="1"
          required
          :disabled="saving"
        ></label>
        <label><input
          v-model="profile.allowCustomHosts"
          type="checkbox"
          :disabled="saving"
        >Permitir cadastro de hosts próprios pelos participantes</label>
        <p>Máquinas de demonstração e hosts próprios compartilham o limite total de hosts. O cadastro próprio exige permissão habilitada e quota disponível.</p>
        <label>Template do laboratório<input
          v-model="profile.templateId"
          required
          maxlength="80"
          :disabled="saving"
        ><small>Identificador de uma imagem e exercícios aprovados no provisionador.</small></label>
        <label>Rede permitida dos laboratórios (IPv4/CIDR)<input
          v-model="profile.networkCidr"
          required
          placeholder="10.64.0.0/24"
          maxlength="32"
          :disabled="saving"
        ><small>Use uma rede exclusiva, sem acesso lateral aos serviços de produção.</small></label>
        <label>URL dos termos<input
          v-model="profile.termsUrl"
          type="url"
          pattern="https://.*"
          required
          :disabled="saving"
        ></label>
        <label>URL do aviso de privacidade<input
          v-model="profile.privacyUrl"
          type="url"
          pattern="https://.*"
          required
          :disabled="saving"
        ></label>
        <label>Versão dos termos e do aviso<input
          v-model="profile.privacyVersion"
          required
          maxlength="64"
          :disabled="saving"
        ></label>
        <fieldset class="profile-resources">
          <legend>Recursos disponíveis</legend>
          <label><input
            type="checkbox"
            checked
            disabled
          > Terminal SSH (obrigatório)</label>
          <label><input
            v-model="profile.resources"
            type="checkbox"
            value="sftp"
            :disabled="saving"
          > Transferência de arquivos SFTP</label>
          <label><input
            v-model="profile.resources"
            type="checkbox"
            value="sharing"
            :disabled="saving"
          > Compartilhamento de sessão</label>
          <label><input
            v-model="profile.resources"
            type="checkbox"
            value="audit"
            :disabled="saving"
          > Auditoria de sessão</label>
        </fieldset>
        <p class="profile-note">
          Revise a finalidade e o prazo de retenção antes de publicar. Salvar este perfil não abre inscrições nem altera testes em andamento.
        </p>
        <div class="profile-actions">
          <NButton
            type="primary"
            attr-type="submit"
            :loading="saving"
          >
            Salvar perfil
          </NButton>
        </div>
      </form>
    </NCard>
    <NCard
      title="Acompanhamento dos testes"
      :aria-busy="loading"
    >
      <p
        v-if="loading"
        role="status"
      >
        Carregando degustações…
      </p>
      <p v-else-if="!rows.length">
        Nenhuma degustação cadastrada.
      </p>
      <ul
        v-else
        class="trial-list"
      >
        <li
          v-for="row in rows"
          :key="row.id"
          class="trial-row"
        >
          <div><strong>{{ row.name }}</strong><p>{{ row.email }}</p><p>Telefone: {{ row.phone || '—' }}</p><small>E-mail confirmado: {{ date(row.verifiedAt) }}</small></div>
          <div><NTag>{{ trialStateLabel(row.status) }}</NTag><p>Vencimento: {{ date(row.expiresAt) }}</p></div>
          <NButton
            v-if="canCancel(row)"
            type="error"
            secondary
            :disabled="saving"
            :aria-label="`Encerrar degustação de ${row.name}`"
            @click="askCancel(row)"
          >
            Encerrar
          </NButton>
        </li>
      </ul>
    </NCard>
    <NModal
      v-model:show="showCancel"
      preset="dialog"
      title="Encerrar esta degustação?"
      positive-text="Encerrar degustação"
      negative-text="Voltar"
      :loading="saving"
      @positive-click="cancel"
    >
      O acesso de {{ cancelling?.name }} será revogado e o laboratório será removido. Esta ação não altera ambientes normais nem pode ser desfeita.
    </NModal>
  </main>
</template>

<style scoped>
.trial-admin { padding: 24px; display: flex; flex-direction: column; gap: 20px; max-width: 1280px; margin: 0 auto; }
header { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
h1 { font-size: 24px; font-weight: 700; } p { margin: 6px 0; line-height: 1.5; }
.trial-profile { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.trial-profile label { display: flex; flex-direction: column; gap: 6px; font-weight: 500; }
input { min-width: 0; width: 100%; box-sizing: border-box; border: 1px solid #6b7280; border-radius: 5px; background: transparent; color: inherit; padding: 9px 12px; font: inherit; }
.profile-resources { grid-column: 1 / -1; border: 1px solid #6b7280; border-radius: 6px; padding: 12px; display: flex; flex-wrap: wrap; gap: 16px; }
.profile-resources label { flex-direction: row; align-items: center; }
.profile-resources input { width: 18px; height: 18px; }
input:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
small { font-weight: 400; opacity: .8; } .profile-note, .profile-actions { grid-column: 1 / -1; }
.trial-list { padding: 0; margin: 0; list-style: none; }
.trial-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid #6b728055; }
.trial-row p { overflow-wrap: anywhere; }
@media (max-width: 700px) { .trial-admin { padding: 16px; } .trial-profile { grid-template-columns: 1fr; } .trial-row { align-items: flex-start; flex-direction: column; } header { align-items: flex-start; } }
</style>
