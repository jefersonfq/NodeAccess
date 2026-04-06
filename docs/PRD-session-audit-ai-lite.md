# PRD Session Audit AI Lite

## Objetivo
Definir como integrar IA ao dominio de `Auditoria de Sessao SSH` de forma progressiva, opt-in e segura, sem degradar o terminal nem criar dependencia obrigatoria de fornecedor externo.

## Estado atual
Ja existe uma base funcional implementada:
- configuracao opcional da integracao OpenAI no admin
- licenciamento separado de IA da auditoria
- jobs assincronos pos-sessao
- resumo estruturado persistido
- reprocessamento manual por template
- artefatos separados por job/template
- UI de auditoria com visibilidade condicionada a licenca e integracao

O que continua fora do caminho critico:
- login
- terminal
- captura base da auditoria
- download da sessao

## Problema
O NodeAccess ja captura e apresenta auditoria de sessao, mas ainda nao possui um desenho de produto e arquitetura para:
- resumir sessoes de forma automatica
- permitir analise sob demanda com instrucoes
- acompanhar sessoes em janelas quase em tempo real
- preparar controles futuros de guardrail e bloqueio
- ativar IA apenas quando a integracao estiver configurada, licenciada e saudavel

Sem isso, existe risco de:
- acoplar IA ao caminho critico do terminal
- quebrar o produto quando o provedor externo falhar
- misturar auditoria obrigatoria com enriquecimento opcional
- abrir custo operacional antes da hora

## Principios
- a auditoria base nao depende de IA
- a fonte de verdade continua sendo o stream bruto da sessao
- IA entra como enriquecimento derivado
- toda integracao deve ser `opt-in`
- falha de IA nunca deve derrubar:
  - login
  - terminal
  - captura da auditoria
  - download da sessao
- o gateway SSH nao deve chamar modelo diretamente
- o primeiro corte deve ser assincrono

## Capacidades de IA
### 1. Resumo pos-sessao
Gerar resumo apos o encerramento da sessao.

Exemplos:
- resumo executivo
- lista de comandos mais relevantes
- risco estimado
- evidencias observadas
- proximos passos sugeridos

### 2. Analise sob demanda
Permitir que um admin ou operador dispare uma analise da sessao com um template ou instrucao.

Exemplos:
- `resuma em formato CAB`
- `extraia alteracoes de rede`
- `liste comandos destrutivos`
- `gere nota para ticket`

### 3. Analise near-real-time
Processar janelas curtas da sessao durante a execucao.

Exemplos:
- alertas
- resumo parcial
- classificacao de risco da janela atual

### 4. Guardrails futuros
Preparar base para:
- `observe`
- `warn`
- `confirm`
- `block`

Guardrails sao fase posterior. Nao fazem parte do primeiro corte obrigatorio.

## Escopos de uso
### Modo `post-session`
- recomendado para MVP
- menor risco
- menor custo
- ideal para gerar resumo e classificacao inicial

### Modo `on-demand`
- recomendado logo apos o MVP
- alto valor de produto
- permite prompts e templates sem tocar no runtime do terminal

### Modo `near-real-time`
- recomendado so depois que o pipeline assincrono estiver estavel
- deve operar por janela, nunca por evento unitario em hot path

### Modo `enforcement`
- somente futuro
- opt-in por tenant
- nunca prometer cobertura perfeita de shell arbitrario

## Integracao com IA
### Requisitos
- provider configuravel por tenant ou por instalacao
- credenciais cifradas
- healthcheck e status visivel no admin
- feature flag tecnica global
- licenciamento separado da auditoria base

### Recomendacao de provider
Comecar com um adaptador unico:
- `OpenAiProvider`

Depois, se houver necessidade real:
- `AnthropicProvider`
- `LocalModelProvider`
- `CustomGatewayProvider`

### Recomendacao de API
Para os jobs assincronos:
- usar `Responses API`
- preferencialmente em `background mode` para jobs longos

Para respostas estruturadas:
- usar `Structured Outputs`

Para experiencias de latencia ultra-baixa:
- avaliar `Realtime API` apenas quando houver caso de uso real e maduro

## Modelo de ativacao
### Kill switch tecnico
`.env`
- `FEATURE_SESSION_AUDIT_AI`

### Licenca
No tenant/licenca:
- `sessionAuditAiEnabled`
- opcional futuro:
  - `sessionAuditAiRealtimeEnabled`
  - `sessionAuditAiGuardrailsEnabled`

### Integracao configurada
Entidade de configuracao deve guardar:
- `provider`
- `enabled`
- `encryptedApiKey`
- `baseUrl` opcional
- `defaultModel`
- `healthStatus`
- `lastHealthcheckAt`
- `createdAt`
- `updatedAt`

### Regra efetiva
A IA so roda quando:
1. `FEATURE_SESSION_AUDIT_AI = true`
2. licenca do tenant habilita IA
3. integracao existe e esta `enabled`
4. provider esta `healthy` ou ao menos `configured`
5. a acao solicitada e permitida pela politica daquele tenant

### Regra de exibicao na UI
- sem licenca de IA: componentes de IA nao aparecem
- com licenca, mas sem integracao configurada: UI pode mostrar estado indisponivel, sem acao
- com integracao configurada e saudavel: acoes de IA ficam habilitadas
- artefatos e resumos antigos podem continuar visiveis mesmo se a integracao for desligada depois

## Regras de resiliencia
- se a IA falhar, a auditoria base continua normal
- se o provider estiver indisponivel:
  - jobs ficam `FAILED` ou `RETRY_PENDING`
  - nada deve quebrar na UI principal
- se o tenant desabilitar IA:
  - novas analises nao iniciam
  - artefatos antigos continuam visiveis
- se a credencial for removida:
  - jobs futuros falham de forma controlada

## Arquitetura recomendada
### Componentes
1. `SSH Gateway`
- sem chamadas de IA
- apenas publica auditoria

2. `Session Audit Module`
- continua dono da auditoria
- expoe APIs de consulta
- aciona jobs derivados

3. `Session AI Service`
- orquestra chamadas de IA
- escolhe provider
- versiona prompts/templates

4. `Session AI Worker`
- executa jobs assincronos
- consome sessoes encerradas ou janelas
- grava artefatos

5. `AI Provider Adapter`
- interface unica
- implementacao inicial: `OpenAiProvider`

## Pipeline recomendado
### Pos-sessao
1. sessao encerra
2. auditoria muda para `COMPLETED`
3. worker agenda `summary job`
4. provider recebe contexto resumido e/ou chunks relevantes
5. resultado vira artefato persistido
6. UI mostra resumo e status
7. o resumo principal da sessao nao deve ser sobrescrito por qualquer reprocessamento manual

### Sob demanda
1. usuario escolhe template ou escreve instrucao
2. sistema cria `ai job`
3. worker executa
4. resultado aparece como artefato separado na sessao auditada

### Near-real-time
1. worker agrega janela curta
2. cria job leve de classificacao
3. publica alerta ou resumo parcial
4. nunca bloqueia o terminal no MVP

## Entidades sugeridas
### `SessionAuditAiIntegration`
- `id`
- `tenantId`
- `provider`
- `enabled`
- `encryptedSecret`
- `secretIv`
- `baseUrl`
- `defaultModel`
- `healthStatus`
- `healthMessage`
- `lastHealthcheckAt`
- `createdAt`
- `updatedAt`

### `SessionAuditAiJob`
- `id`
- `sessionAuditId`
- `tenantId`
- `requestedByUserId`
- `kind`
- `triggerSource`
- `provider`
- `model`
- `promptVersion`
- `status`
- `errorMessage`
- `startedAt`
- `finishedAt`
- `createdAt`
- `updatedAt`

### `SessionAuditAiArtifact`
- `id`
- `sessionAuditId`
- `jobId`
- `template`
- `summaryText`
- `summaryJson`
- `riskLevel`
- `createdAt`

## Templates iniciais
- `summary-v1`
- `cab-v1`
- `risk-v1`

Templates novos devem entrar como expansao de catalogo, nao como quebra do fluxo base.

## Proximos passos recomendados
1. filtros e comparacao de artefatos por template
2. prompts/instrucoes customizadas sob demanda
3. resumo orientado a ticket
4. analise near-real-time por janela
5. guardrails opt-in

### `SessionAuditAiJob`
- `id`
- `sessionAuditId`
- `kind`
- `status`
- `provider`
- `model`
- `promptTemplateId`
- `requestedByUserId`
- `windowStartedAt`
- `windowEndedAt`
- `responseId`
- `errorCode`
- `errorMessage`
- `createdAt`
- `startedAt`
- `finishedAt`

### `SessionAuditAiArtifact`
- `id`
- `sessionAuditId`
- `jobId`
- `kind`
- `status`
- `storageKey`
- `metadataJson`
- `createdAt`
- `updatedAt`

### `SessionAuditPromptTemplate`
- `id`
- `tenantId`
- `name`
- `kind`
- `instruction`
- `outputSchemaJson`
- `enabled`
- `createdAt`
- `updatedAt`

## Tipos de artefato
- `summary`
- `risk_summary`
- `command_classification`
- `window_summary`
- `ticket_note`
- `user_prompt_result`

## Tipos de job
- `POST_SESSION_SUMMARY`
- `POST_SESSION_RISK_SCAN`
- `WINDOW_SUMMARY`
- `ON_DEMAND_PROMPT`
- `TICKET_NOTE`

## Prompting e seguranca
- prompts de sistema devem ser versionados
- prompts de usuario nao devem ter acesso livre a segredos
- limitar contexto enviado:
  - janelas
  - resumo da sessao
  - comandos derivados
  - chunks relevantes
- evitar enviar sessao inteira para todo tipo de job
- sempre registrar:
  - template usado
  - modelo usado
  - provider
  - versao do prompt

## UX/Admin
### Configuracao da integracao
Tela admin deve permitir:
- habilitar/desabilitar IA
- escolher provider
- informar credencial
- escolher modelo default
- testar conexao
- ver status da integracao

### Sessao auditada
Tela da sessao deve permitir:
- ver status do resumo por IA
- ver resumo pronto
- rerodar analise
- escolher template
- fazer pergunta sobre a sessao

### Feedback esperado
- `IA desabilitada por configuracao`
- `IA nao licenciada`
- `integracao nao configurada`
- `integracao com falha`
- `analise em processamento`
- `analise concluida`

## Ordem recomendada de implementacao
### Corte 1
- PRD lite
- schema e migrations de integracao e jobs
- API admin de configuracao
- tela admin de integracao
- healthcheck

### Corte 2
- worker de resumo pos-sessao
- artefato `summary`
- UI para mostrar resumo pronto

### Corte 3
- templates e analise sob demanda
- artefato `user_prompt_result`

### Corte 4
- janela near-real-time
- alertas e resumo parcial

### Corte 5
- guardrails e confirmacao

## Recomendacao de primeiro passo
O primeiro passo mais seguro e aderente a SOLID e:
- criar o contrato de integracao e a tela de configuracao
- sem acionar IA no fluxo de auditoria ainda

Motivo:
- separa configuracao de execucao
- valida licenca, credencial e status
- nao mexe no caminho critico
- deixa o sistema preparado sem risco de regressao funcional

## Fora do escopo imediato
- bloqueio de comando em tempo real
- chat live dentro do terminal
- microservico dedicado de IA logo no inicio
- retenção e billing por token no MVP
