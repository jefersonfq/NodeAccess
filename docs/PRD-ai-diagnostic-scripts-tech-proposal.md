# Proposta Tecnica - Diagnostic Playbooks no NodeAccess

## Resposta curta
Nao. MCP nao e necessario para a primeira implementacao.

Para essa funcionalidade funcionar com seguranca, o caminho recomendado e:
- criar primeiro um modulo interno de `Diagnostic Playbooks`
- executar playbooks com governanca propria no NodeAccess
- armazenar resultado, auditoria e analise por IA
- expor via MCP apenas depois, se fizer sentido

MCP entra como interface padronizada externa. A base real deve ser interna.

## Objetivo tecnico
Introduzir um modulo desacoplado para executar diagnosticos operacionais aprovados em hosts autorizados, coletar resultados, opcionalmente analisar a saida por IA e apresentar conclusoes auditaveis ao usuario.

## Principios
- sem comando arbitrario gerado livremente pela IA
- execucao sempre governada por playbook aprovado
- primeiro corte com confirmacao humana obrigatoria
- sem segredo em claro nas respostas
- sem impacto no caminho critico do terminal
- desacoplado de snippets
- desacoplado de MCP
- desacoplado do provider de IA
- falha do modulo nao quebra SSH normal, host dashboard ou auditoria existente

## Visao arquitetural

```txt
Frontend
  Hosts / Host Dashboard / Diagnostics UI
        |
        v
Backend API
  diagnostic-playbooks module
    - catalog
    - authorization
    - execution orchestration
    - result storage
    - AI analysis scheduling
        |
        +--> existing SSH execution path or isolated session runner
        |
        +--> existing audit/admin log services
        |
        +--> existing local AI / network AI provider abstraction
```

## MCP e opcional
MCP so passa a fazer sentido em uma fase posterior para:
- listar playbooks
- consultar resultados
- solicitar execucao com politica explicita
- operar como canal para agentes externos consumirem as mesmas tools internas

Sem o modulo interno, MCP seria apenas uma casca sem governanca suficiente.

## Modulos sugeridos

```txt
apps/backend/src/modules/diagnostic-playbooks
```

Arquivos sugeridos:

```txt
diagnostic-playbook.routes.ts
diagnostic-playbook.controller.ts
diagnostic-playbook.service.ts
diagnostic-playbook.repository.ts
diagnostic-playbook.schemas.ts
diagnostic-playbook.authorization.ts
diagnostic-playbook.execution.ts
diagnostic-playbook.redaction.ts
diagnostic-playbook.ai.ts
diagnostic-playbook.audit.ts
```

No frontend:

```txt
apps/frontend/src/services/diagnostic-playbook.service.ts
apps/frontend/src/components/host-diagnostics/
apps/frontend/src/views/HostDiagnosticsDetailView.vue
```

## Entidades

### DiagnosticPlaybook
Representa a definicao versionada do diagnostico.

Campos sugeridos:
- `id`
- `tenantId` nullable para playbooks globais
- `slug`
- `name`
- `description`
- `category`
- `targetOs`
- `riskLevel`
- `requiresApproval`
- `enabled`
- `version`
- `definitionJson`
- `createdById`
- `createdAt`
- `updatedAt`

### DiagnosticRun
Representa uma execucao solicitada para um host.

Campos sugeridos:
- `id`
- `tenantId`
- `hostId`
- `playbookId`
- `requestedById`
- `approvedById` nullable
- `status`
- `startedAt`
- `finishedAt`
- `errorMessage`
- `aiSummaryStatus`
- `aiSummaryText`
- `aiFindingsJson`
- `triggerSource` (`manual`, `ai_suggested`, `mcp_future`)

### DiagnosticRunCommand
Representa cada comando executado dentro da execucao.

Campos sugeridos:
- `id`
- `runId`
- `commandId`
- `command`
- `status`
- `startedAt`
- `finishedAt`
- `exitCode`
- `outputPreview`
- `outputBody` truncado/cifrado conforme politica
- `redactionApplied`

### DiagnosticRunStep
Evolucao recomendada do modelo atual. Representa um step executado dentro do run.

Campos sugeridos:
- `id`
- `runId`
- `stepId`
- `stepType` (`command`, `script`)
- `sourceRef` nullable
- `sourceVersion` nullable
- `sourceHash` nullable
- `command`
- `status`
- `startedAt`
- `finishedAt`
- `exitCode`
- `outputPreview`
- `outputBody`
- `redactionApplied`

## Definicao de playbook
Formato sugerido em JSON/YAML persistido em `definitionJson`.

Exemplo:

```yaml
id: mysql-baseline-linux
name: Diagnostico basico de MySQL
category: mysql
target:
  os: linux
risk: low
requiresApproval: true
timeoutSeconds: 45
maxTotalOutputBytes: 262144
commands:
  - id: service-status
    command: systemctl status mysql --no-pager || systemctl status mysqld --no-pager
    timeoutSeconds: 10
  - id: mysql-version
    command: mysql --version
    timeoutSeconds: 10
  - id: processlist
    command: mysql -e "show processlist;"
    timeoutSeconds: 15
  - id: global-status
    command: mysql -e "show global status like 'Threads_connected';"
    timeoutSeconds: 15
redaction:
  maskPatterns:
    - "(password|token|secret)=\\S+"
analysisPrompt: |
  Analise saude inicial do MySQL.
  Responda com resumo, evidencias, hipoteses e proximos passos seguros.
```

## Evolucao de formato
Para suportar comandos e scripts sem acoplamento, o playbook deve evoluir de `commands[]` para `steps[]`.

Exemplo:

```yaml
steps:
  - id: collect-version
    type: command
    command: mysql --version
    timeoutSeconds: 10
  - id: collect-health-json
    type: script
    scriptRef: linux/mysql/health-json/v1
    timeoutSeconds: 20
```

Tipos recomendados:
- `command`
- `script_asset`
- `inline_script` apenas em fase posterior e com fortes restricoes

### Observacao de implementacao
A UI administrativa ja foi preparada para trabalhar com o conceito de `step`, mas ainda serializa para `commands` para manter compatibilidade com o backend atual.

Backlog tecnico recomendado:
- introduzir contrato interno `steps`
- mapear `command` para execucao atual sem regressao
- manter `script` bloqueado ate feature flag e policy especificas
- evoluir persistencia de `DiagnosticRunCommand` para `DiagnosticRunStep` quando a base estiver pronta

## Fluxo do MVP

### 1. Catalogo
O frontend lista playbooks permitidos para o usuario e para o host.

### 2. Confirmacao
Antes de executar:
- mostrar nome
- categoria
- nivel de risco
- comandos
- timeout
- limite de output

### 3. Execucao
Backend cria `DiagnosticRun` e executa os comandos sequencialmente.

### 4. Redacao
Cada output passa por mascaramento e truncamento.

### 5. Persistencia
Resultado fica salvo e vinculado ao host.

### 6. Analise por IA
Se habilitado, um job assincrono analisa o resultado sanitizado.

### 7. Exibicao
Host dashboard e tela de detalhe mostram:
- status
- comandos
- outputs
- conclusao
- evidencias

## Fluxo futuro com agente autonomo
Mesmo sem acoplamento a MCP, a camada deve aceitar chamadas de:
- UI humana
- assistente interno
- MCP server
- integracao externa tool-based

Contrato conceitual:

```txt
channel -> policy gate -> capability resolver -> execution runner -> audit log
```

Onde `channel` pode ser:
- manual_ui
- local_ai
- remote_ai
- mcp
- automation_api

## Como executar tecnicamente
Existem 3 opcoes.

### Opcao A - Reusar sessao SSH existente do terminal
Nao recomendada para o MVP.

Problemas:
- mistura troubleshooting com sessao interativa do usuario
- aumenta risco de interferencia
- dificulta auditoria isolada

### Opcao B - Abrir sessao SSH tecnica isolada
Recomendada.

Vantagens:
- execucao separada do terminal do usuario
- trilha limpa
- timeout proprio
- menos acoplamento

### Opcao C - Executar via Agent
Faz sentido no futuro, principalmente para hosts que dependem de agent route.

Recomendacao:
- desenhar a camada de execucao com interface abstrata
- no MVP implementar `SSH isolated runner`
- preparar contrato para `Agent runner` depois

## Interface interna sugerida

```ts
interface DiagnosticExecutionRunner {
  run(params: {
    hostId: number
    requestedById: number
    steps: Array<{
      id: string
      type: 'command' | 'script'
      command?: string
      scriptRef?: string
      timeoutSeconds: number
    }>
  }): Promise<{
    steps: Array<{
      id: string
      type: 'command' | 'script'
      exitCode: number | null
      stdout: string
      stderr: string
      startedAt: Date
      finishedAt: Date
    }>
  }>
}
```

## Provider de IA e canal de ferramenta
Nao amarrar o modulo a um provider especifico.

Camadas recomendadas:

```txt
AI Provider Adapter
  - OpenAI
  - Claude
  - Local AI

Tool Channel Adapter
  - Internal assistant
  - MCP
  - Future API automation
```

Todos devem consumir as mesmas capacidades internas:
- `listPlaybooks`
- `getPlaybook`
- `requestRun`
- `getRun`
- `requestSummary`
- `requestAction` futuro

## Autorizacao
Antes de executar, validar:
- usuario tem acesso ao host
- usuario pode abrir sessao nesse host
- playbook esta habilitado
- categoria do playbook esta permitida para o tenant
- playbook e permitido para o papel/grupo do usuario
- host suporta o target do playbook quando isso for verificavel
- canal solicitante esta habilitado
- modo de autonomia permitido para aquele tenant/host
- acao requerida cabe no escopo daquela IA/tool

## Politica de autonomia
Estados recomendados:
- `disabled`
- `read_only`
- `approval_required`
- `autonomous`

Aplicacao recomendada por:
- tenant
- grupo
- host
- categoria de capability
- provider de IA

## Auditoria
Eventos sugeridos:
- `DIAGNOSTIC_PLAYBOOK_RUN_REQUESTED`
- `DIAGNOSTIC_PLAYBOOK_RUN_APPROVED`
- `DIAGNOSTIC_PLAYBOOK_RUN_STARTED`
- `DIAGNOSTIC_PLAYBOOK_COMMAND_EXECUTED`
- `DIAGNOSTIC_PLAYBOOK_RUN_FINISHED`
- `DIAGNOSTIC_PLAYBOOK_RUN_FAILED`
- `DIAGNOSTIC_PLAYBOOK_AI_SUMMARY_REQUESTED`
- `DIAGNOSTIC_PLAYBOOK_AI_SUMMARY_COMPLETED`
- `DIAGNOSTIC_SCRIPT_EXECUTED`
- `DIAGNOSTIC_AUTONOMOUS_ACTION_REQUESTED`
- `DIAGNOSTIC_AUTONOMOUS_ACTION_APPROVED`
- `DIAGNOSTIC_AUTONOMOUS_ACTION_EXECUTED`
- `DIAGNOSTIC_AUTONOMOUS_ACTION_BLOCKED`

Campos minimos:
- tenant
- host
- usuario solicitante
- aprovador se houver
- playbook
- risco
- status
- duracao

## Redacao e protecao de dados
Aplicar em toda saida:
- truncamento por comando
- truncamento por execucao
- mascaramento por regex
- bloqueio de binario bruto
- opcionalmente whitelist de tamanho por categoria

Nunca enviar para IA:
- passwords
- tokens
- PEM
- refs do 1Password resolvidas
- dumps integrais
- logs enormes sem corte

## Scripts
Scripts fazem sentido quando:
- encapsulam logica de diagnostico
- produzem JSON consistente
- reduzem duplicacao
- simplificam fallback e parsing

Regras:
- versionados
- com hash
- auditados
- tamanho limitado
- sem escrita em disco por padrao
- sem shell arbitrario livre

## Relacao com IA
IA entra depois da coleta.

Fluxo recomendado:
- backend salva outputs sanitizados
- agenda job assincrono
- usa camada ja existente de IA local/rede
- gera:
  - resumo
  - evidencias
  - hipoteses
  - proximos passos

IA nao deve executar comandos novos no MVP.

## Evolucao para acoes
Diagnostico e remediation devem compartilhar infraestrutura, mas nao o mesmo risco semantico.

Recomendacao:
- manter `diagnostic runs` separados de `action runs`
- permitir que a IA passe de diagnostico para proposta de acao
- exigir gate de policy antes de qualquer step modificador

## UI recomendada

### Host Dashboard
Adicionar card ou aba `Diagnosticos` com:
- playbooks recomendados
- ultimas execucoes
- botao `Executar diagnostico`

### Modal de execucao
Conteudo minimo:
- nome do playbook
- categoria
- risco
- comandos
- timeout
- aviso de coleta
- botao confirmar

### Tela detalhe
Mostrar:
- status geral
- tempo de execucao
- comandos executados
- saida por comando
- resumo IA
- evidencias
- exportar

## Estrategia de rollout

### Fase 1
Catalogo estatico + UI de listagem.

### Fase 2
Execucao manual confirmada, sem IA.

### Fase 3
Analise por IA assincrona.

### Fase 4
Permissoes mais granulares, Agent runner e filtros mais ricos.

### Fase 5
Exposicao via MCP.

## MVP recomendado
Implementar apenas:
- 4 playbooks Linux low-risk
- runner SSH isolado
- execucao sequencial
- persistencia do resultado
- detalhe por host
- resumo IA opcional e assincrono

Playbooks iniciais:
- rede basica
- CPU/memoria/processos
- disco/filesystem
- MySQL basico

## Decisao recomendada
1. Criar o modulo interno primeiro.
2. Nao depender de MCP para entregar valor.
3. Nao usar snippets como base principal.
4. Nao permitir que a IA invente comandos.
5. Usar MCP depois apenas para expor a capacidade com governanca.
6. Evoluir para `steps` com `script` apenas quando houver ganho real de composicao.
7. Tratar autonomia como policy configuravel, nunca como comportamento implicito do provider.
