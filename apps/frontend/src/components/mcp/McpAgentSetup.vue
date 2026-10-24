<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NAlert, NButton, NFormItem, NInput, NModal, NSelect, NTag, useMessage } from 'naive-ui'
import { buildMcpAgentSetup, type McpAgent, type McpShell } from '@/services/mcp-agent-setup'
import { runMcpReadOnlyProbe, type McpProbeStep } from '@/services/mcp.service'

const props = defineProps<{ show: boolean; baseUrl: string; token?: string | null; tenantKey?: string | number; capabilities?: string[] }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; 'create-token': []; 'clear-token': [] }>()
const message = useMessage()
const agent = ref<McpAgent>('codex')
const shell = ref<McpShell>('bash')
const endpoint = ref('')
const secret = ref('')
const loading = ref(false)
const steps = ref<McpProbeStep[]>([])
const testOpen = ref(false)
let probeGeneration = 0
let probeController: AbortController | undefined
const agentOptions = [{ label: 'Codex CLI', value: 'codex' }, { label: 'Claude Code', value: 'claude' }, { label: 'Gemini CLI', value: 'gemini' }]
const shellOptions = [{ label: 'Bash (Linux, macOS, WSL)', value: 'bash' }, { label: 'PowerShell 5.1+', value: 'powershell' }]
const agentLabel = computed(() => agentOptions.find(option => option.value === agent.value)?.label ?? 'agente')
const setup = computed(() => { try { return buildMcpAgentSetup(endpoint.value, agent.value, shell.value) } catch { return null } })
const defaultEndpoint = computed(() => `${props.baseUrl.replace(/\/$/, '')}/mcp/jsonrpc`)
const differentEndpoint = computed(() => setup.value && setup.value.endpoint !== defaultEndpoint.value)
const failedStep = computed(() => steps.value.find(step => step.status === 'failed'))
const skippedQuery = computed(() => steps.value.find(step => step.key === 'read_only_tool' && step.status === 'skipped'))
function clearSecret(): void {
  probeController?.abort()
  secret.value = ''
  steps.value = []
  loading.value = false
  probeGeneration++
}
watch(() => props.show, (show) => {
  clearSecret()
  if (show) {
    // Keep non-secret choices when returning from token creation or reopening this tenant's guide.
    if (!endpoint.value) endpoint.value = defaultEndpoint.value
    secret.value = props.token ?? ''
    testOpen.value = !!props.token
  }
}, { immediate: true })
watch([(): string | number | undefined => props.tenantKey, (): string => props.baseUrl], () => {
  clearSecret()
  endpoint.value = defaultEndpoint.value
  testOpen.value = false
  emit('update:show', false)
})
onBeforeUnmount(clearSecret)
function updateSecret(value: string): void {
  secret.value = value
  steps.value = []
}
async function copy(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); message.success('Copiado. Cole no destino indicado.') }
  catch { message.error('Clipboard indisponível. Selecione o texto do bloco e copie manualmente.') }
}
async function probe(): Promise<void> {
  if (!secret.value.trim() || loading.value) return
  const generation = ++probeGeneration
  probeController = new AbortController()
  loading.value = true
  steps.value = []
  try {
    const result = await runMcpReadOnlyProbe(secret.value.trim(), props.baseUrl, props.capabilities ?? [], globalThis.fetch.bind(globalThis), probeController.signal)
    if (generation === probeGeneration) steps.value = result
  } finally {
    if (generation === probeGeneration) { loading.value = false; secret.value = ''; emit('clear-token') }
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :style="{ width: '820px', maxWidth: 'calc(100vw - 24px)' }"
    title="Conectar seu agente ao NodeAccess"
    aria-label="Conectar seu agente ao NodeAccess"
    @update:show="emit('update:show', $event)"
  >
    <div
      class="mcp-setup"
      data-testid="mcp-agent-setup"
    >
      <section aria-labelledby="mcp-register-heading">
        <h3 id="mcp-register-heading">
          1. Cadastre o servidor
        </h3>
        <div class="setup-options">
          <NFormItem label="Agente">
            <NSelect
              v-model:value="agent"
              :options="agentOptions"
              :consistent-menu-width="false"
              aria-label="Agente"
              data-testid="mcp-agent-select"
            />
          </NFormItem>
          <NFormItem label="Terminal">
            <NSelect
              v-model:value="shell"
              :options="shellOptions"
              :consistent-menu-width="false"
              aria-label="Terminal"
              data-testid="mcp-shell-select"
            />
          </NFormItem>
        </div>
        <NFormItem label="Endereço acessível pelo agente">
          <NInput
            v-model:value="endpoint"
            :input-props="{ 'aria-label': 'Endereço acessível pelo agente' }"
            :status="setup ? undefined : 'error'"
          />
        </NFormItem>
        <NAlert
          v-if="!setup"
          type="error"
        >
          Informe uma URL HTTP(S) válida, sem credenciais, parâmetros ou fragmentos.
        </NAlert>
        <NAlert
          v-else-if="setup.local || setup.insecure"
          type="warning"
        >
          <span v-if="setup.local">Um endereço local aponta para a máquina do agente. Em WSL, container ou acesso remoto, confira o destino.</span>
          <span v-if="setup.insecure"> HTTP não cifra o token. Use HTTPS fora de um ambiente local controlado.</span>
        </NAlert>
        <template v-if="setup">
          <template v-if="setup.register">
            <p>Execute uma vez no terminal escolhido. O comando cadastra o servidor no Codex do usuário atual; revise se já existir uma entrada chamada <code>nodeaccess</code>.</p>
            <pre
              tabindex="0"
              aria-label="Comando de cadastro Codex"
              data-testid="mcp-register"
            >{{ setup.register }}</pre>
            <NButton
              type="primary"
              @click="copy(setup.register)"
            >
              Copiar comando de cadastro
            </NButton>
            <details
              class="setup-details"
              data-testid="mcp-config-alternative"
            >
              <summary>Alternativa: configurar pelo arquivo</summary>
              <p>Destino: <strong data-testid="mcp-config-destination">{{ setup.destination }}</strong>. Mescle esta entrada e preserve os outros servidores.</p>
              <pre
                tabindex="0"
                aria-label="Configuração MCP"
                data-testid="mcp-config"
              >{{ setup.config }}</pre>
              <NButton
                secondary
                @click="copy(setup.config)"
              >
                Copiar configuração
              </NButton>
            </details>
          </template>
          <template v-else>
            <p>Destino: <strong data-testid="mcp-config-destination">{{ setup.destination }}</strong>.</p>
            <p>Mescle a entrada <code>nodeaccess</code> no arquivo. Preserve outros servidores e revise antes de substituir uma entrada com esse nome.</p>
            <pre
              tabindex="0"
              aria-label="Configuração MCP"
              data-testid="mcp-config"
            >{{ setup.config }}</pre>
            <NButton
              type="primary"
              @click="copy(setup.config)"
            >
              Copiar configuração
            </NButton>
          </template>
        </template>
      </section>
      <section aria-labelledby="mcp-start-heading">
        <h3 id="mcp-start-heading">
          2. Inicie o agente com seu token
        </h3>
        <div class="credential-row">
          <p>Já tem um token válido? Use-o na entrada oculta do terminal. Para um novo token, comece com Consulta e revise hosts e expiração.</p>
          <NButton
            secondary
            @click="emit('create-token')"
          >
            Criar token de consulta
          </NButton>
        </div>
        <template v-if="setup">
          <p>Cole no terminal escolhido, na pasta em que usará o agente. O comando pede o token sem exibi-lo e abre o {{ agentLabel }}.</p>
          <pre
            tabindex="0"
            aria-label="Comando de inicialização"
            data-testid="mcp-start"
          >{{ setup.start }}</pre>
          <NButton
            secondary
            @click="copy(setup.start)"
          >
            Copiar inicialização
          </NButton>
          <p class="setup-hint">
            O token fica na sessão do processo; a variável criada pelo comando é removida quando o agente encerra.
          </p>
        </template>
      </section>
      <section aria-labelledby="mcp-confirm-heading">
        <h3 id="mcp-confirm-heading">
          3. Confirme a conexão no agente
        </h3>
        <p data-testid="mcp-client-confirmation">
          {{ setup?.verify }} Confirme que <code>nodeaccess</code> está conectado e peça: “Liste os hosts que posso consultar”.
        </p>
        <details
          :open="testOpen"
          class="setup-details"
          data-testid="mcp-server-test"
          @toggle="testOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>Teste opcional: servidor e token nesta instância</summary>
          <p>Endereço testado pelo navegador:</p>
          <code
            class="tested-endpoint"
            data-testid="mcp-tested-endpoint"
          >{{ defaultEndpoint }}</code>
          <p
            v-if="differentEndpoint"
            data-testid="mcp-test-different-endpoint"
          >
            Este endereço é diferente do configurado para o agente. O teste não valida o endereço externo.
          </p>
          <p>Verifica o protocolo e uma consulta permitida, sem abrir SSH. A conexão do {{ agentLabel }} deve ser confirmada no próprio cliente.</p>
          <NFormItem label="Token para teste (temporário)">
            <NInput
              :value="secret"
              type="password"
              autocomplete="off"
              :input-props="{ spellcheck: false, 'aria-label': 'Token para teste (temporário)' }"
              placeholder="Cole o token MCP"
              :disabled="loading"
              @update:value="updateSecret"
            />
          </NFormItem>
          <NButton
            secondary
            :loading="loading"
            :disabled="!secret.trim() || loading"
            @click="probe"
          >
            Executar teste somente leitura
          </NButton>
          <p class="setup-hint">
            O campo é limpo após o teste, ao fechar ou trocar de tenant. O token não é gravado em armazenamento do navegador.
          </p>
          <div
            class="probe-results"
            aria-live="polite"
            aria-atomic="true"
            :aria-busy="loading"
          >
            <p v-if="loading">
              Validando servidor e token nesta instância…
            </p>
            <template v-else-if="steps.length">
              <NAlert
                :type="failedStep ? 'error' : 'success'"
                :title="failedStep ? `Teste interrompido: ${failedStep.label}` : 'Servidor e token validados nesta instância'"
                data-testid="mcp-probe-summary"
              >
                <p v-if="failedStep">
                  {{ failedStep.detail }}
                </p>
                <p v-else-if="skippedQuery">
                  Consulta de hosts não executada: {{ skippedQuery.detail }}
                </p>
                <p v-else>
                  Consulta de hosts concluída.
                </p>
                <p>{{ failedStep ? 'Revise a orientação acima e teste novamente.' : `Próximo passo: confirme a conexão no ${agentLabel}. Este teste não comprova a conexão do agente.` }}</p>
              </NAlert>
              <details
                :open="!!failedStep"
                class="setup-details"
                data-testid="mcp-probe-details"
              >
                <summary>Detalhes do teste</summary>
                <div
                  v-for="step in steps"
                  :key="step.key"
                  class="probe-step"
                >
                  <div><strong>{{ step.label }}</strong><p>{{ step.detail }}</p></div>
                  <NTag :type="step.status === 'passed' ? 'success' : step.status === 'failed' ? 'error' : 'default'">
                    {{ step.status === 'passed' ? 'Aprovado' : step.status === 'failed' ? 'Falhou' : 'Não executado' }}
                  </NTag>
                </div>
              </details>
            </template>
          </div>
        </details>
      </section>
      <NButton @click="emit('update:show', false)">
        Fechar guia
      </NButton>
    </div>
  </NModal>
</template>

<style scoped>
.mcp-setup { display: grid; gap: 24px; min-width: 0; }
.mcp-setup section { min-width: 0; }
.mcp-setup h3 { margin: 0 0 12px; font-size: 16px; font-weight: 600; }
.mcp-setup p { line-height: 1.5; overflow-wrap: anywhere; margin: 10px 0; }
.mcp-setup pre { padding: 12px; background: var(--na-bg); border: 1px solid var(--na-border); border-radius: 6px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.setup-options { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.setup-details { margin-top: 14px; }
.setup-details summary { cursor: pointer; padding: 8px 0; font-weight: 500; }
.setup-details summary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; border-radius: 3px; }
.setup-hint { font-size: 12px; color: var(--na-text-muted); }
.tested-endpoint { display: block; overflow-wrap: anywhere; padding: 8px; background: var(--na-bg); }
.credential-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.credential-row p { flex: 1 1 300px; }
.probe-results { margin-top: 14px; }
.probe-step { display: flex; justify-content: space-between; align-items: start; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--na-border); }
.probe-step p { margin: 4px 0 0; }
@media (max-width: 600px) { .setup-options { grid-template-columns: 1fr; gap: 0; } .probe-step { flex-wrap: wrap; } }
</style>
