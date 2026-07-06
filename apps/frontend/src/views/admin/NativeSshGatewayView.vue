<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { useAuthStore } from '@/stores/auth'
import {
  nativeSshGatewayService,
  type NativeSshGatewayConfig,
  type UpdateNativeSshGatewayConfigPayload,
} from '@/services/native-ssh-gateway.service'

const auth = useAuthStore()
const message = useMessage()

const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const config = ref<NativeSshGatewayConfig | null>(null)
const sampleTarget = ref('172.16.1.2')
const sampleTargetUser = ref('root')
const form = ref<UpdateNativeSshGatewayConfigPayload>({
  enabled: false,
  bindHost: '0.0.0.0',
  port: 2222,
  publicEndpoint: '',
  hostKeyPath: '',
  passwordAuth: true,
  mfaRequired: true,
  publicKeyAuth: false,
})

const nodeAccessLogin = computed(() => auth.user?.email || auth.user?.name || 'usuario@empresa.com')
const gatewayPort = computed(() => form.value.port || config.value?.port || 2222)
const endpointValue = computed(() =>
  form.value.publicEndpoint?.trim() || config.value?.suggestedEndpoint || 'nodeaccess.example.com',
)

const interactiveCommand = computed(() =>
  `ssh -p ${gatewayPort.value} -l '${nodeAccessLogin.value}' ${endpointValue.value}`,
)

const directDefaultUserCommand = computed(() =>
  `ssh -p ${gatewayPort.value} -l '${nodeAccessLogin.value}@${sampleTarget.value || '172.16.1.2'}' ${endpointValue.value}`,
)

const directOverrideUserCommand = computed(() =>
  `ssh -p ${gatewayPort.value} -l '${nodeAccessLogin.value}@${sampleTargetUser.value || 'usuario'}@${sampleTarget.value || '172.16.1.2'}' ${endpointValue.value}`,
)

const inlineDirectDefaultUserCommand = computed(
  () =>
    `ssh -p ${gatewayPort.value} -o IdentitiesOnly=yes '${nodeAccessLogin.value}@${sampleTarget.value || '172.16.1.2'}'@${endpointValue.value}`,
)

const inlineDirectOverrideUserCommand = computed(
  () =>
    `ssh -p ${gatewayPort.value} -o IdentitiesOnly=yes '${nodeAccessLogin.value}@${sampleTargetUser.value || 'usuario'}@${sampleTarget.value || '172.16.1.2'}'@${endpointValue.value}`,
)

const safeTestOptions = '-o PreferredAuthentications=password -o PubkeyAuthentication=no'
const interactivePasswordOnlyCommand = computed(
  () => `ssh -p ${gatewayPort.value} ${safeTestOptions} -l '${nodeAccessLogin.value}' ${endpointValue.value}`,
)

onMounted(load)

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await nativeSshGatewayService.getConfig()
    applyConfig(data)
  } catch {
    error.value = 'Não foi possível carregar a configuração do SSH Gateway.'
  } finally {
    loading.value = false
  }
}

function applyConfig(data: NativeSshGatewayConfig) {
  config.value = data
  form.value = {
    enabled: data.enabled,
    bindHost: data.bindHost,
    port: data.port,
    publicEndpoint: data.publicEndpoint || data.suggestedEndpoint,
    hostKeyPath: data.hostKeyPath,
    passwordAuth: data.passwordAuth,
    mfaRequired: data.mfaRequired,
    publicKeyAuth: data.publicKeyAuth,
  }
}

async function save() {
  saving.value = true
  error.value = null
  try {
    const { data } = await nativeSshGatewayService.updateConfig({
      ...form.value,
      publicEndpoint: form.value.publicEndpoint?.trim() || null,
      hostKeyPath: form.value.hostKeyPath?.trim() || null,
      bindHost: form.value.bindHost.trim(),
    })
    applyConfig(data)
    message.success('Configuração do SSH Gateway salva.')
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? 'Não foi possível salvar a configuração.')
  } finally {
    saving.value = false
  }
}

async function copy(command: string) {
  await navigator.clipboard.writeText(command)
  message.success('Comando copiado.')
}

function runtimeStateLabel(state: NativeSshGatewayConfig['operational']['processState']) {
  const labels = {
    online: 'Online',
    disabled: 'Desabilitado',
    error: 'Erro',
    stopped: 'Parado',
    unknown: 'Sem heartbeat',
  }
  return labels[state]
}

function runtimeStateTagType(state: NativeSshGatewayConfig['operational']['processState']) {
  if (state === 'online') return 'success'
  if (state === 'error') return 'error'
  if (state === 'disabled') return 'warning'
  return 'default'
}

function formatRuntimeDate(value: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}
</script>

<template>
  <div class="p-6 native-ssh-gateway">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-white">SSH Gateway</h1>
        <NText depth="3" class="text-sm">
          Configuração efetiva e comandos de primeiro acesso para usuários.
        </NText>
      </div>
      <NButton :loading="loading" @click="load">Atualizar</NButton>
    </div>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />
    <NSpin v-if="loading" />

    <template v-else-if="config">
      <div class="gateway-grid">
        <NCard :bordered="false">
          <template #header>Status</template>
          <NDescriptions :column="1" bordered size="small">
            <NDescriptionsItem label="Gateway efetivo">
              <NTag :type="config.effective.enabled ? 'success' : 'default'" size="small">
                {{ config.effective.enabled ? 'Habilitado' : 'Desabilitado' }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="Bind efetivo">
              {{ config.effective.bindHost }}:{{ config.effective.port }}
            </NDescriptionsItem>
            <NDescriptionsItem label="Host key efetiva">
              <NTag :type="config.effective.hostKeyConfigured ? 'success' : 'error'" size="small">
                {{ config.effective.hostKeyConfigured ? 'Configurada' : 'Pendente' }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="Sessões Native SSH ativas">
              <NTag :type="config.operational.activeNativeSshSessions > 0 ? 'success' : 'default'" size="small">
                {{ config.operational.activeNativeSshSessions }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="Status do processo">
              <NTag :type="runtimeStateTagType(config.operational.processState)" size="small">
                {{ runtimeStateLabel(config.operational.processState) }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="Listener reportado">
              {{
                config.operational.runtimeHost && config.operational.runtimePort
                  ? `${config.operational.runtimeHost}:${config.operational.runtimePort}`
                  : '—'
              }}
            </NDescriptionsItem>
            <NDescriptionsItem label="Último heartbeat">
              {{ formatRuntimeDate(config.operational.runtimeLastSeenAt) }}
            </NDescriptionsItem>
            <NDescriptionsItem label="Última falha">
              <div>
                <NText>{{ formatRuntimeDate(config.operational.runtimeLastFailureAt) }}</NText>
                <NText v-if="config.operational.runtimeLastFailureMessage" depth="3" class="block text-xs mt-1">
                  {{ config.operational.runtimeLastFailureMessage }}
                </NText>
              </div>
            </NDescriptionsItem>
            <NDescriptionsItem label="Origem da configuração">
              <NTag :type="config.configSource === 'database' ? 'info' : 'default'" size="small">
                {{ config.configSource === 'database' ? 'Banco' : '.env' }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem label="APP_URL">
              {{ config.appUrl }}
            </NDescriptionsItem>
          </NDescriptions>

          <NAlert
            v-if="!config.effective.enabled || !config.effective.hostKeyConfigured"
            type="warning"
            class="mt-4"
            title="Gateway ainda não está pronto para uso"
          >
            Verifique FEATURE_NATIVE_SSH_GATEWAY e NATIVE_SSH_GATEWAY_HOST_KEY_PATH no backend.
          </NAlert>

          <NAlert
            v-if="config.requiresGatewayRestart"
            type="info"
            class="mt-4"
            title="Configuração salva requer restart do gateway"
          >
            O processo Native SSH Gateway carrega a configuração salva no banco durante o startup. Reinicie o processo gateway para aplicar porta, bind ou host key.
          </NAlert>

          <NAlert
            v-if="!config.operational.processStatusObservable"
            type="default"
            class="mt-4"
            title="Heartbeat do gateway não encontrado"
          >
            O processo gateway pode estar parado, sem Redis, ou ainda não publicou status operacional.
          </NAlert>
        </NCard>

        <NCard :bordered="false">
          <template #header>Configuração administrativa</template>
          <NForm label-placement="top">
            <div class="form-grid">
              <NFormItem label="Gateway habilitado">
                <NSpace align="center">
                  <NSwitch v-model:value="form.enabled" />
                  <NText>{{ form.enabled ? 'Habilitado' : 'Desabilitado' }}</NText>
                </NSpace>
              </NFormItem>
              <NFormItem label="Porta">
                <NInputNumber v-model:value="form.port" :min="1" :max="65535" class="w-full" />
              </NFormItem>
            </div>
            <NFormItem label="Bind host">
              <NInput v-model:value="form.bindHost" placeholder="0.0.0.0" />
            </NFormItem>
            <NFormItem label="Endpoint público">
              <NInput v-model:value="form.publicEndpoint" placeholder="186.250.124.90 ou ssh.nodeaccess.local" />
            </NFormItem>
            <NFormItem label="Caminho da host key">
              <NInput v-model:value="form.hostKeyPath" placeholder="/opt/nodeaccess/ssh_host_ed25519_key" />
            </NFormItem>
            <div class="form-grid">
              <NFormItem label="Senha">
                <NSwitch v-model:value="form.passwordAuth" />
              </NFormItem>
              <NFormItem label="MFA">
                <NSwitch v-model:value="form.mfaRequired" />
              </NFormItem>
              <NFormItem label="Chave pública">
                <NSpace align="center">
                  <NSwitch v-model:value="form.publicKeyAuth" />
                  <NTag size="small">futuro</NTag>
                </NSpace>
              </NFormItem>
            </div>
            <NSpace justify="end">
              <NButton type="primary" :loading="saving" @click="save">Salvar configuração</NButton>
            </NSpace>
          </NForm>
        </NCard>
      </div>

      <NCard :bordered="false" class="mt-4">
        <template #header>Parâmetros dos exemplos</template>
        <div class="form-grid examples-grid">
          <label class="field-label">
            Host destino para exemplo
            <NInput v-model:value="sampleTarget" placeholder="172.16.1.2" />
          </label>
          <label class="field-label">
            Usuário SSH opcional do destino
            <NInput v-model:value="sampleTargetUser" placeholder="root" />
          </label>
        </div>
      </NCard>

      <NCard :bordered="false" class="mt-4">
        <template #header>Comandos para Linux/macOS</template>
        <div class="command-list">
          <div class="command-row">
            <div>
              <NText strong>Abrir shell do NodeAccess</NText>
              <NText depth="3" class="block text-xs">Use para entrar no ambiente e rodar sshs, hosts ou connect.</NText>
            </div>
            <code>{{ interactiveCommand }}</code>
            <NButton size="small" @click="copy(interactiveCommand)">Copiar</NButton>
          </div>

          <div class="command-row">
            <div>
              <NText strong>Conectar direto usando usuário padrão do host</NText>
              <NText depth="3" class="block text-xs">Usa o usuário SSH cadastrado no host do NodeAccess.</NText>
            </div>
            <code>{{ directDefaultUserCommand }}</code>
            <NButton size="small" @click="copy(directDefaultUserCommand)">Copiar</NButton>
          </div>

          <div class="command-row">
            <div>
              <NText strong>Conectar direto forçando usuário do destino</NText>
              <NText depth="3" class="block text-xs">Só funciona se a credencial cadastrada for válida para esse usuário.</NText>
            </div>
            <code>{{ directOverrideUserCommand }}</code>
            <NButton size="small" @click="copy(directOverrideUserCommand)">Copiar</NButton>
          </div>

          <div class="command-row">
            <div>
              <NText strong>Formato usuário@gateway com usuário padrão</NText>
              <NText depth="3" class="block text-xs">Mantém a parte antes do gateway entre aspas para preservar os @.</NText>
            </div>
            <code>{{ inlineDirectDefaultUserCommand }}</code>
            <NButton size="small" @click="copy(inlineDirectDefaultUserCommand)">Copiar</NButton>
          </div>

          <div class="command-row">
            <div>
              <NText strong>Formato usuário@gateway forçando usuário do destino</NText>
              <NText depth="3" class="block text-xs">Equivalente ao formato usado por clientes que preferem usuario@host.</NText>
            </div>
            <code>{{ inlineDirectOverrideUserCommand }}</code>
            <NButton size="small" @click="copy(inlineDirectOverrideUserCommand)">Copiar</NButton>
          </div>

          <div class="command-row">
            <div>
              <NText strong>Teste forçando senha no NodeAccess</NText>
              <NText depth="3" class="block text-xs">Útil para evitar que o cliente tente chave pública local.</NText>
            </div>
            <code>{{ interactivePasswordOnlyCommand }}</code>
            <NButton size="small" @click="copy(interactivePasswordOnlyCommand)">Copiar</NButton>
          </div>
        </div>
      </NCard>

      <NCard :bordered="false" class="mt-4">
        <template #header>Fluxo recomendado para primeiro acesso</template>
        <ol class="steps">
          <li>Conectar no shell do NodeAccess.</li>
          <li>Validar senha e MFA.</li>
          <li>Rodar <code>sshs</code> para localizar hosts acessíveis.</li>
          <li>Conectar pelo seletor ou usar <code>connect [usuario@]host</code>.</li>
          <li>Depois validar o comando direto com <code>-l 'usuario@host'</code> ou <code>'usuario@host'@gateway</code>.</li>
        </ol>
      </NCard>
    </template>
  </div>
</template>

<style scoped>
.native-ssh-gateway :deep(.n-card) {
  background: var(--na-surface-raised);
  border-color: var(--na-border);
}

.gateway-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 0.8fr);
  gap: 16px;
}

.field-label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--na-text);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.examples-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.command-list {
  display: grid;
  gap: 12px;
}

.command-row {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.command-row code {
  display: block;
  padding: 8px 10px;
  border-radius: 4px;
  background: var(--na-surface-code);
  color: var(--na-text-strong);
  white-space: pre-wrap;
  word-break: break-word;
}

.steps {
  margin: 0;
  padding-left: 20px;
  color: var(--na-text);
}

.steps li + li {
  margin-top: 8px;
}

@media (max-width: 980px) {
  .gateway-grid,
  .command-row,
  .form-grid,
  .examples-grid {
    grid-template-columns: 1fr;
  }
}
</style>
