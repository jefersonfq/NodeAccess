# PRD Lite - Terminal Macros

Versao curta para evolucao de snippets em automacoes de terminal.

## Objetivo
- permitir execucao de comandos mais flexiveis que snippets simples
- suportar sequencias de comandos e automacoes guiadas por output do terminal
- aproximar a experiencia de macros do MobaXterm sem introduzir uma DSL complexa cedo demais

## Motivacao
- hoje snippets sao apenas `name + command + description + scope`
- o painel apenas envia texto bruto ao terminal ativo
- usuarios precisam automatizar login interativo, bastion com prompts, comandos repetitivos e fluxos operacionais simples

## Escopo fase 1
- manter snippet simples atual como tipo `command`
- adicionar tipo `sequence` para comandos sequenciais
- permitir execucao manual de macro pelo usuario
- mostrar preview dos passos antes de executar
- status:
  - implementado no frontend sem migration
  - compatibilidade mantida via serializacao no campo `command`

## Escopo fase 2
- adicionar tipo `expect-send`
- cada passo pode esperar um texto ou regex simples no output do terminal
- ao detectar match, envia o comando configurado
- timeout por passo com falha controlada
- status:
  - `expect-send` simples implementado no frontend
  - matching atual por texto com comparacao case-insensitive
  - timeout e cancelamento manual ja disponiveis
  - feedback visual de macro ativa e historico curto ja disponiveis

## Estado atual implementado
- `command`, `sequence` e `expect-send` funcionando no frontend
- criacao, edicao, preview e execucao a partir de `SnippetsView` e `SnippetsPanel`
- macros rodando apenas no terminal ativo
- timeout fixo por etapa
- cancelamento manual da macro ativa
- linha do tempo visual por passo: `executado`, `aguardando`, `pendente`
- historico curto em memoria da execucao atual
- sem alteracao de schema ou migration nesta fase

## Proximo corte recomendado
- permitir timeout configuravel por passo no tipo `expect-send`
- expor falha por passo com motivo claro na UI
- avaliar persistencia estruturada do tipo no backend quando a UX estabilizar

## Fora do escopo inicial
- DSL livre para automacao
- loops, branches e condicionais arbitrarias
- armazenamento de segredos puros em texto livre
- execucao automatica sem acao explicita do usuario
- macros globais com permissao administrativa complexa

## Modelo conceitual
- `command`: comando unico enviado ao terminal
- `sequence`: lista ordenada de comandos
- `expect-send`: lista ordenada de passos com `expect`, `send`, `timeoutMs` e regra basica de continuidade
- observacao atual:
  - na implementacao presente, `timeoutMs` ainda nao e configuravel por passo
  - o timeout atual e fixo no frontend

## Regras de seguranca
- execucao deve ser sempre manual na primeira versao
- macro deve rodar apenas no terminal explicitamente focado/selecionado
- output esperado nao pode gerar loop automatico
- segredos devem usar referencia futura ou input manual, nao texto puro padrao
- a UI deve deixar claro quando a macro vai esperar output antes de continuar

## UX recomendada
- separar snippet simples de macro no formulario
- exibir badge por tipo: `command`, `sequence`, `expect-send`
- mostrar resumo visual dos passos
- permitir teste manual e cancelamento
- destacar risco quando houver match por prompt sensivel como `password`, `otp`, `token`

## Arquivos provaveis
- backend:
  - `apps/backend/prisma/schema.prisma`
  - `apps/backend/src/modules/snippets/*`
- frontend:
  - `apps/frontend/src/services/snippet.service.ts`
  - `apps/frontend/src/components/SnippetsPanel.vue`
  - `apps/frontend/src/views/SnippetsView.vue`
  - `apps/frontend/src/composables/useTerminal.ts`
  - `apps/frontend/src/views/TerminalView.vue`

## Ordem recomendada
1. suportar tipos `command` e `sequence`
2. melhorar UI de criacao e execucao
3. suportar `expect-send` simples
4. adicionar feedback visual de execucao, timeout e cancelamento
5. permitir timeout configuravel por passo
6. avaliar telemetria/auditoria de execucao

## Riscos
- match fragil por output do terminal
- automacao disparada em sessao errada
- macro travada em timeout
- mistura de snippet simples com automacao sem clareza de UX
