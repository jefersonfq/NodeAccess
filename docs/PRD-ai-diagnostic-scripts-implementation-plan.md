# Plano de Implementacao - Diagnostic Playbooks

## Objetivo
Transformar o desenho tecnico de `Diagnostic Playbooks` em backlog executavel, incremental e de baixo risco para o NodeAccess.

## Premissas
- primeira entrega sem MCP
- primeira entrega sem comandos arbitrarios
- primeira entrega com confirmacao humana
- primeira entrega com playbooks low-risk
- execucao em sessao SSH tecnica isolada
- analise por IA assincrona e opcional

## Ordem recomendada

### Fase 0 - Contratos e dados
Objetivo: preparar a base sem afetar a UX principal.

#### Backend
- criar schemas compartilhados para:
  - `DiagnosticPlaybook`
  - `DiagnosticRun`
  - `DiagnosticRunCommand`
  - enums de `category`, `riskLevel`, `runStatus`, `commandStatus`
- definir DTOs:
  - `ListDiagnosticPlaybooksQuery`
  - `CreateDiagnosticRunDto`
  - `DiagnosticRunPublic`
  - `DiagnosticRunDetail`

#### Banco
- criar tabelas:
  - `diagnostic_playbooks`
  - `diagnostic_runs`
  - `diagnostic_run_commands`
- adicionar indices por:
  - `tenant_id`
  - `host_id`
  - `playbook_id`
  - `requested_by_id`
  - `status`
  - `created_at`

#### Seeds
- preparar seed inicial para playbooks globais low-risk:
  - `linux-network-baseline`
  - `linux-cpu-memory-baseline`
  - `linux-disk-baseline`
  - `linux-mysql-baseline`

#### Entrega
- migracao criada
- tipos compartilhados criados
- seed base criada

## Fase 1 - Catalogo read-only
Objetivo: listar playbooks por host sem executar nada.

#### Backend
- criar modulo:
  - `apps/backend/src/modules/diagnostic-playbooks`
- implementar:
  - `GET /diagnostic-playbooks`
  - `GET /diagnostic-playbooks/:id`
- filtrar por:
  - tenant
  - enabled
  - target compativel quando houver criterio suficiente

#### Frontend
- criar service:
  - `apps/frontend/src/services/diagnostic-playbook.service.ts`
- adicionar no dashboard do host:
  - card ou aba `Diagnosticos`
  - listagem de playbooks disponiveis
  - categoria
  - risco
  - descricao curta

#### UX
- ainda sem botao de executar real
- exibir claramente:
  - low risk
  - somente leitura
  - necessita confirmacao na proxima fase

#### Entrega
- usuario consegue ver catalogo de playbooks do host

## Fase 2 - Execucao manual confirmada
Objetivo: permitir rodar playbook de forma controlada.

#### Backend
- implementar:
  - `POST /diagnostic-runs`
  - `GET /diagnostic-runs/:id`
  - `GET /hosts/:id/diagnostic-runs`
- criar `diagnostic-playbook.execution.ts`
- criar interface `DiagnosticExecutionRunner`
- implementar runner inicial:
  - `SshIsolatedDiagnosticRunner`
- execucao:
  - sequencial
  - timeout por comando
  - timeout total por run
  - limite de output por comando
  - limite de output total

#### Auditoria
- registrar:
  - `DIAGNOSTIC_PLAYBOOK_RUN_REQUESTED`
  - `DIAGNOSTIC_PLAYBOOK_RUN_STARTED`
  - `DIAGNOSTIC_PLAYBOOK_COMMAND_EXECUTED`
  - `DIAGNOSTIC_PLAYBOOK_RUN_FINISHED`
  - `DIAGNOSTIC_PLAYBOOK_RUN_FAILED`

#### Frontend
- modal `Executar diagnostico`
- mostrar:
  - nome do playbook
  - categoria
  - risco
  - comandos
  - timeout
  - aviso de coleta
- detalhe da execucao:
  - status
  - inicio/fim
  - comandos executados
  - exit code
  - output resumido

#### Guardrails
- sem reexecucao automatica
- sem paralelismo no MVP
- sem editar playbook pela UI no MVP

#### Entrega
- usuario autorizado executa playbook manualmente
- resultado fica salvo e consultavel

## Fase 3 - Redacao e endurecimento
Objetivo: proteger dados antes de abrir analise por IA.

#### Backend
- criar `diagnostic-playbook.redaction.ts`
- aplicar:
  - regex de mascaramento
  - truncamento por comando
  - truncamento global
  - deteccao simples de binario
- marcar em cada comando:
  - se houve redacao
  - se houve truncamento

#### Frontend
- indicar visualmente:
  - `saida truncada`
  - `dados mascarados`

#### Entrega
- resultados protegidos antes da IA

## Fase 4 - Analise por IA assincrona
Objetivo: gerar conclusao sem colocar IA no caminho critico.

#### Backend
- criar `diagnostic-playbook.ai.ts`
- criar job assincrono para:
  - receber run sanitizado
  - chamar provider existente de IA local/rede
  - salvar:
    - resumo executivo
    - evidencias
    - hipoteses
    - proximos passos
- status:
  - `pending`
  - `completed`
  - `failed`

#### Frontend
- card de resumo IA na tela de detalhe
- estados:
  - aguardando analise
  - analise pronta
  - erro ao analisar

#### Guardrails
- sem executar comandos sugeridos
- sem usar IA para decidir comandos do run atual

#### Entrega
- run finalizado pode receber analise assincrona

## Fase 5 - UX do host dashboard
Objetivo: tornar o modulo utilizavel no dia a dia.

#### Frontend
- refinar aba/card `Diagnosticos` no dashboard do host
- mostrar:
  - playbooks recomendados
  - ultimas execucoes
  - ultimo status
  - ultimo resumo IA
  - CTA principal `Executar diagnostico`
- adicionar filtros:
  - categoria
  - status
  - periodo

#### Entrega
- experiencia do host fica fluida e reutilizavel

## Fase 6 - Permissoes e governanca
Objetivo: preparar escala e administracao.

#### Backend
- adicionar politicas por tenant:
  - modulo habilitado
  - categorias habilitadas
  - analise por IA habilitada
- preparar permissoes futuras:
  - `diagnostics:view`
  - `diagnostics:run`
  - `diagnostics:approve`
  - `diagnostics:manage_playbooks`

#### Frontend
- tela admin simples:
  - playbooks ativos
  - categorias habilitadas
  - IA ligada/desligada

#### Entrega
- modulo administravel por tenant

## Fase 7 - Evolucoes tecnicas
Objetivo: preparar proxmos passos sem bloquear o MVP.

Itens futuros:
- runner via Agent
- suporte a Windows
- suporte a playbooks medium-risk com aprovacao
- exportacao de resultado
- comparativo entre execucoes
- recomendacao de playbook por IA
- exposicao via MCP

## Backlog tecnico por area

### Shared
- criar schemas e tipos publicos
- criar enums comuns

### Backend API
- rotas
- controller
- service
- repository
- authorization
- audit

### Backend Execution
- runner abstrato
- runner SSH isolado
- timeout
- truncamento
- redacao

### Banco
- migracoes
- indices
- seeds

### Frontend
- service
- card/aba no host dashboard
- modal de confirmacao
- tela de detalhe do run

### IA
- job assincrono
- prompts por categoria
- persistencia de resumo

## Critico para nao errar
- nao usar snippets como pilar do modulo
- nao compartilhar a sessao interativa do usuario com o diagnostico
- nao executar comandos gerados livremente por IA
- nao mandar segredo em claro para o modelo
- nao bloquear terminal/host dashboard se o modulo falhar

## MVP minimo recomendavel
Escopo minimo para primeira entrega de valor:
- banco + schemas
- 4 playbooks seeded
- catalogo no dashboard do host
- execucao manual confirmada
- runner SSH isolado
- persistencia do resultado
- detalhe da execucao

IA pode entrar logo depois, como fase seguinte, se a base de execucao estiver estavel.

## Proxima acao recomendada
Abrir implementacao pela Fase 0 e Fase 1:
- schemas compartilhados
- migracao
- seed
- listagem de playbooks no dashboard do host

Essa ordem minimiza risco e deixa o modulo visivel cedo, sem ainda abrir superficie de execucao.
