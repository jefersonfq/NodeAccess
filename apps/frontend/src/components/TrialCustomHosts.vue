<script setup lang="ts">
import axios from 'axios'
import { computed, ref } from 'vue'
import { NAlert, NButton, NModal } from 'naive-ui'
import { trialService, type TrialCustomHost, type TrialCustomHostInput, type TrialResources } from '@/services/trial.service'
const props = defineProps<{ resources: TrialResources }>()
const emit = defineEmits<{ changed: [] }>()
const show = ref(false)
const busy = ref(false)
const editing = ref<TrialCustomHost | null>(null)
const removing = ref<TrialCustomHost | null>(null)
const confirmRemove = ref(false)
const error = ref('')
const notice = ref('')
const empty = (): TrialCustomHostInput => ({ name: '', ip: '', port: 22, sshUser: '', authType: 'password', password: '', privateKey: '', passphrase: '' })
const form = ref(empty())
const canCreate = computed(() => props.resources.customHostCount < props.resources.maxCustomHosts && Math.max(props.resources.machineCount, props.resources.requestedMachines) + props.resources.customHostCount < props.resources.maxHosts)
const credentialRequired = computed(() => !editing.value || editing.value.authType !== form.value.authType)
function explain(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.response?.status === 409) return 'Este host está em uso. Encerre suas sessões SSH antes de alterar ou remover.'
    if (err.response?.status === 403) return 'O destino, a quota ou a permissão não permite esta ação. Use um IPv4 público autorizado e confira o limite do teste.'
    if (err.response?.status === 401) return 'Sua sessão expirou. Entre novamente para continuar.'
    if (err.response?.status === 422) return 'Revise o endereço IPv4 público e os dados de acesso informados.'
  }
  return 'Não foi possível concluir agora. Seus dados continuam no formulário; tente novamente.'
}
function open(host?: TrialCustomHost): void {
  editing.value = host ?? null
  form.value = host ? { ...empty(), name: host.name, ip: host.ip, port: host.port, sshUser: host.sshUser, authType: host.authType } : empty()
  error.value = ''; notice.value = ''; show.value = true
}
function close(): void { if (!busy.value) { show.value = false; form.value = empty(); editing.value = null } }
async function save(): Promise<void> {
  if (busy.value) return
  const body: TrialCustomHostInput = { name: form.value.name.trim(), ip: form.value.ip.trim(), port: form.value.port, sshUser: form.value.sshUser.trim(), authType: form.value.authType }
  if (body.authType === 'password' && form.value.password) body.password = form.value.password
  if (body.authType === 'pem' && form.value.privateKey) { body.privateKey = form.value.privateKey; if (form.value.passphrase) body.passphrase = form.value.passphrase }
  busy.value = true; error.value = ''
  try {
    if (editing.value) await trialService.updateHost(editing.value.id, body)
    else await trialService.createHost(body)
    notice.value = 'Host salvo. Ele já pode ser localizado na lista de hosts.'
    show.value = false; form.value = empty(); editing.value = null
    emit('changed')
  } catch (err) { error.value = explain(err) }
  finally { busy.value = false }
}
function askRemove(host: TrialCustomHost): void { removing.value = host; error.value = ''; confirmRemove.value = true }
async function remove(): Promise<void> {
  if (!removing.value || busy.value) return
  busy.value = true; error.value = ''
  try { await trialService.deleteHost(removing.value.id); confirmRemove.value = false; removing.value = null; notice.value = 'Cadastro removido. O equipamento externo não foi alterado.'; emit('changed') }
  catch (err) { error.value = explain(err) }
  finally { busy.value = false }
}
defineExpose({ open, askRemove })
</script>

<template>
  <div class="trial-custom-hosts">
    <h3>Seus hosts próprios</h3>
    <p>Cadastre equipamentos seus acessíveis por IPv4 público e SSH. Redes privadas, DNS, agentes e bastions não estão disponíveis neste teste. As máquinas de demonstração permanecem separadas.</p>
    <NAlert
      v-if="notice"
      type="success"
      role="status"
    >
      {{ notice }}
    </NAlert>
    <NButton
      :disabled="!canCreate"
      @click="open()"
    >
      Cadastrar meu host
    </NButton>
    <p v-if="!canCreate">
      Não há quota disponível para outro host próprio.
    </p>
    <ul v-if="resources.customHosts?.length">
      <li
        v-for="host in resources.customHosts"
        :key="host.id"
      >
        <span>{{ host.name }} · {{ host.ip }}:{{ host.port }}</span>
        <NButton
          size="small"
          :aria-label="`Editar host ${host.name}`"
          @click="open(host)"
        >
          Editar
        </NButton>
        <NButton
          size="small"
          :aria-label="`Remover host ${host.name}`"
          @click="askRemove(host)"
        >
          Remover
        </NButton>
      </li>
    </ul>
    <NModal
      :show="show"
      preset="card"
      :title="editing ? 'Editar meu host' : 'Cadastrar meu host'"
      style="width: min(36rem, calc(100vw - 2rem))"
      :closable="!busy"
      :mask-closable="!busy"
      :close-on-esc="!busy"
      @update:show="close"
    >
      <form
        class="trial-host-form"
        @submit.prevent="save"
      >
        <NAlert
          v-if="error"
          type="error"
          role="alert"
        >
          {{ error }}
        </NAlert>
        <label>Nome do host<input
          v-model="form.name"
          required
          maxlength="120"
          :disabled="busy"
        ></label>
        <label>IPv4 público do host<input
          v-model="form.ip"
          required
          maxlength="15"
          placeholder="IPv4 público autorizado"
          :disabled="busy"
        ></label>
        <label>Porta SSH<input
          v-model.number="form.port"
          type="number"
          min="1"
          max="65535"
          required
          :disabled="busy"
        ></label>
        <label>Usuário SSH<input
          v-model="form.sshUser"
          required
          maxlength="64"
          pattern="[a-zA-Z0-9_.@-]+"
          :disabled="busy"
        ></label>
        <label>Autenticação<select
          v-model="form.authType"
          :disabled="busy"
        ><option value="password">Senha</option><option value="pem">Chave privada PEM</option></select></label>
        <label v-if="form.authType === 'password'">Senha SSH<input
          v-model="form.password"
          type="password"
          autocomplete="new-password"
          :required="credentialRequired"
          maxlength="4096"
          :disabled="busy"
        ></label>
        <template v-else>
          <label>Chave privada PEM<textarea
            v-model="form.privateKey"
            :required="credentialRequired"
            maxlength="65536"
            rows="5"
            :disabled="busy"
          /></label>
          <label>Frase de acesso da chave (opcional)<input
            v-model="form.passphrase"
            type="password"
            autocomplete="new-password"
            maxlength="4096"
            :disabled="busy || !form.privateKey"
          ></label>
        </template>
        <p v-if="editing && !credentialRequired">
          Deixe a credencial vazia para manter a atual. Credenciais salvas nunca são exibidas.
        </p>
        <div class="actions">
          <NButton
            :disabled="busy"
            @click="close"
          >
            Cancelar
          </NButton><NButton
            type="primary"
            attr-type="submit"
            :loading="busy"
          >
            Salvar meu host
          </NButton>
        </div>
      </form>
    </NModal>
    <NModal
      v-model:show="confirmRemove"
      preset="card"
      title="Remover cadastro do host?"
      style="width: min(30rem, calc(100vw - 2rem))"
      :closable="!busy"
      :mask-closable="!busy"
      :close-on-esc="!busy"
    >
      <p>O cadastro de {{ removing?.name }} será removido deste teste. Seu equipamento externo não será excluído ou alterado.</p>
      <NAlert
        v-if="error"
        type="error"
        role="alert"
      >
        {{ error }}
      </NAlert>
      <div class="actions">
        <NButton
          :disabled="busy"
          @click="confirmRemove = false"
        >
          Manter host
        </NButton><NButton
          type="error"
          :loading="busy"
          @click="remove"
        >
          Remover cadastro
        </NButton>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.trial-custom-hosts, .trial-host-form { display: grid; gap: .8rem; }
h3 { font-weight: 600; }
p { font-size: .875rem; }
label { display: grid; gap: .3rem; }
input, select, textarea { width: 100%; border: 1px solid #64748b; border-radius: .35rem; padding: .5rem; background: transparent; color: inherit; }
input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
.actions, li { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
li { margin-top: .5rem; } li span { flex: 1; overflow-wrap: anywhere; }
</style>
