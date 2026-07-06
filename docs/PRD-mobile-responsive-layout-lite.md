# PRD Lite - Layout Mobile e Responsividade

Versao curta para evolucao da interface do NodeAccess em telas menores.

## Objetivo
- permitir uso funcional do NodeAccess em mobile e tablet
- melhorar responsividade das telas administrativas e operacionais
- manter consistencia visual com o desktop atual
- reduzir friccao para consultas rapidas fora da estacao principal
- preparar o terminal web para uma experiencia mobile controlada, sem comprometer estabilidade

## Contexto
- o frontend atual usa Vue 3, TypeScript, Vite, Naive UI, Tailwind CSS e xterm.js
- a stack permite criar layouts responsivos sem troca tecnologica
- algumas telas ja usam breakpoints responsivos com `sm`, `md`, `lg` e `xl`
- o layout principal ainda e orientado a desktop, com sidebar lateral fixa
- o terminal web exige cuidado especial por causa de teclado virtual, foco, resize, copy/paste e paineis laterais

## Problema
O produto funciona bem em desktop, mas o uso em telas menores pode ter limitacoes:
- sidebar ocupa espaco excessivo
- tabelas largas podem depender de scroll horizontal pouco claro
- formularios e filtros podem ficar densos demais
- telas administrativas podem perder hierarquia visual
- terminal em mobile pode sofrer com teclado virtual, foco e resize do xterm
- paineis auxiliares do terminal podem competir com a area principal

## Publico-alvo
- administradores que precisam consultar status, auditoria, sessoes e configuracoes rapidamente
- operadores que precisam localizar hosts, copiar comandos ou verificar logs fora do desktop
- usuarios tecnicos que eventualmente precisam abrir uma sessao via tablet ou celular

## Principio de produto
Mobile deve ser primeiro funcional e confiavel, depois completo.

Prioridade inicial:
- consulta
- navegacao
- leitura de status
- copia de comandos
- filtros simples
- auditoria e acompanhamento

Terminal mobile deve ser tratado como fluxo proprio, com UX focada e validacao tecnica especifica.

## Escopo fase 1 - Base responsiva global
- adaptar `AppLayout` para telas menores
- substituir sidebar fixa por drawer ou menu compacto em mobile
- manter sidebar lateral no desktop
- garantir que o conteudo tenha largura minima controlada e scroll previsivel
- revisar espacamentos, paddings e altura util em mobile
- definir padrao visual para headers, filtros, cards, tabelas e acoes em telas pequenas
- garantir foco visivel e navegacao basica por teclado onde aplicavel

## Escopo fase 2 - Telas prioritarias
Adaptar primeiro as telas de maior impacto:
- Dashboard
- Hosts
- Terminal
- Session Audit
- Sessions
- Native SSH Gateway
- Session Command Policies

Objetivos por tela:
- Dashboard:
  - cards empilhados
  - metricas legiveis
  - secoes com prioridade visual clara
- Hosts:
  - lista mobile em cards compactos
  - busca e filtros acessiveis
  - acoes principais visiveis
  - copiar comando de conexao com poucos toques
- Terminal:
  - modo focado/fullscreen
  - toolbar reduzida
  - paineis auxiliares em drawer
  - tratamento de resize quando teclado virtual abre/fecha
- Auditoria/Sessoes:
  - filtros compactos
  - cards ou lista resumida em mobile
  - drill-down claro para detalhe

## Escopo fase 3 - Terminal mobile
- revisar comportamento do xterm.js em mobile e tablet
- validar foco, teclado virtual e altura dinamica da viewport
- ajustar fit/resize do terminal apos mudanca de orientacao
- criar toolbar mobile com acoes essenciais:
  - conectar/desconectar
  - copiar/colar quando suportado
  - snippets
  - arquivos
  - tunel
  - compartilhar sessao, se licenciado
- mover paineis laterais para drawer ou bottom sheet
- avaliar gestos ou botoes para teclas especiais:
  - Ctrl
  - Esc
  - Tab
  - setas
  - comandos rapidos

## Fora do escopo inicial
- redesenho completo do produto
- criar app nativo
- trocar Naive UI ou Tailwind
- reimplementar o terminal
- suportar todas as operacoes avancadas do desktop no primeiro corte mobile
- alterar autenticacao, autorizacao, websocket ou fluxo SSH sem necessidade tecnica clara

## UX recomendada
- desktop continua denso e operacional
- mobile prioriza leitura, decisao rapida e acoes essenciais
- evitar esconder informacao critica atras de muitas camadas
- usar drawer para navegacao global
- usar listas/cards mobile quando tabela ficar ilegivel
- manter CTA principal evidente em cada tela
- evitar botoes pequenos demais para toque
- preservar estados de loading, vazio, erro e sucesso
- garantir que textos nao estourem containers em telas estreitas

## Acessibilidade
- manter labels em formularios
- garantir foco visivel em botoes, menus e filtros
- nao depender apenas de cor para status
- garantir tamanho minimo razoavel para alvos de toque
- permitir fechamento de drawer/modal por botao claro e tecla Esc quando aplicavel
- revisar ordem de foco em menus e paineis mobile

## Requisitos tecnicos
- usar breakpoints do Tailwind e CSS local existente
- preservar padroes de Vue 3 e Naive UI ja usados no projeto
- evitar dependencias novas no primeiro corte
- manter componentes pequenos quando houver extracao
- validar `vue-tsc --noEmit`
- validar visualmente em larguras aproximadas:
  - 360px
  - 390px
  - 768px
  - 1024px
  - desktop atual

## Riscos
- quebrar densidade e eficiencia do desktop ao otimizar mobile
- tabelas administrativas ficarem incompletas em cards
- terminal mobile gerar bugs de foco ou resize
- drawers competirem com modais existentes
- botoes e menus ficarem pequenos para uso touch
- excesso de adaptacao visual aumentar manutencao

## Guardrails
- preservar desktop como experiencia principal para operacao pesada
- implementar por tela, em mudancas pequenas e reversiveis
- validar uma tela antes de replicar padrao para outras
- nao acoplar regra de negocio a logica visual de responsividade
- nao alterar fluxo SSH/websocket apenas para ajuste visual
- tratar terminal mobile como etapa separada da responsividade geral

## Criterios de aceite
- layout principal funciona sem overflow lateral inesperado em 390px
- navegacao global fica acessivel em mobile sem ocupar permanentemente a tela
- telas priorizadas permitem consultar dados e executar acoes principais em mobile
- tabelas largas possuem alternativa legivel ou scroll horizontal intencional
- terminal nao perde foco de forma recorrente ao abrir teclado virtual
- resize/orientacao nao deixa terminal em estado visual quebrado
- typecheck do frontend passa

## Arquivos provaveis
- frontend:
  - `apps/frontend/src/layouts/AppLayout.vue`
  - `apps/frontend/src/views/DashboardView.vue`
  - `apps/frontend/src/views/HostsView.vue`
  - `apps/frontend/src/views/TerminalView.vue`
  - `apps/frontend/src/components/TerminalPane.vue`
  - `apps/frontend/src/views/admin/SessionAuditView.vue`
  - `apps/frontend/src/views/admin/SessionAuditDetailView.vue`
  - `apps/frontend/src/views/admin/SessionsView.vue`
  - `apps/frontend/src/views/admin/NativeSshGatewayView.vue`
  - `apps/frontend/src/views/admin/SessionCommandPoliciesView.vue`

## Recomendacao de execucao
1. Criar base mobile no `AppLayout`.
2. Adaptar `Dashboard` e `Hosts` como referencia visual.
3. Validar padrao em mobile/tablet/desktop.
4. Aplicar nas telas admin principais.
5. Tratar `Terminal` em um ciclo proprio com testes de xterm.js.

## Status
- documentado para retomada futura
- sem implementacao iniciada neste PRD
