# Worklog Lite

Registro curto do andamento recente para manter contexto operacional.

Formato:
- data
- frente
- status atual
- proximo passo natural

## 2026-07-29

### Alta disponibilidade — provisionamento pelo agente
- status atual:
  - adicionada ação governada `INSTALL_RELEASE`, com URL, SHA-256, lease,
    journal e validações repetidas no agente
  - interface permite instalar a release apenas em standby pronto e sem VIP
  - harness do agente cobre pacote válido, checksum inválido, papel/VIP e
    promoção isolada com `RUN_INSTALL=false`
  - ensaio real concluído em `192.168.1.100`, mantendo `192.168.1.101` como
    primário e único dono da VIP `192.168.1.105`
  - ambos os nós alinhados na release `2.0.29`, health profundo HTTP 200,
    agentes ativos, MySQL com atraso zero e Redis do standby conectado
- limite preservado:
  - a ação instala/promove a release, mas não transporta segredos nem altera
    banco, replicação, containers ou Keepalived silenciosamente
- proximo passo natural:
  - canal cifrado e descartável implementado para seis segredos compartilhados,
    com RSA por agente, aplicação atômica e backup local
  - habilitar HTTPS no laboratório para homologar o transporte real; HTTP fica
    bloqueado deliberadamente para esta ação
  - HTTPS provisório habilitado na VIP e nos dois nós, com certificado
    autoassinado de sete dias e agentes migrados para o endpoint HTTPS
  - Keepalived ajustado para validar corretamente o redirect local HTTP→HTTPS;
    VIP confirmada somente no primário
  - depois, adicionar gates separados para reinício e validação de estado antes
    de automatizar tráfego
  - release `2.0.30` fechada após rolling update, E2E cifrado, rollback,
    falhas de chave/certificado e switchover planejado real
  - estado final: `.100` PRIMARY e dono único da VIP; `.101` STANDBY, MySQL
    lag zero e Redis conectado; ambos em `2.0.30`
  - interface final simplificada com `Promover este nó` e
    `Retornar como standby` como ações principais; validações técnicas ficam
    recolhidas por padrão
  - fluxo assistido registra o preflight/rejoin e apresenta o comando
    contextualizado, mantendo fencing e shell privilegiado como etapas
    explícitas do operador
  - Journal de operações recolhido por padrão e Configurações expandida
  - harness real pela VIP HTTPS passou em desktop e mobile, sem findings,
    erros de console ou divergências entre API e interface
  - artefato final SHA-256: atualizar após a última geração do pacote

## 2026-04-06

### PRDs e contexto
- status atual:
  - criado `docs/PRD-map-lite.md`
  - PRDs secundarios movidos para `docs/prd-archive/`
  - leitura padrao consolidada em `PRD-lite -> PRD-map-lite -> PRD especifico`
- proximo passo natural:
  - manter mapa atualizado quando uma frente mudar de `ativa` para `historico controlado`

### Backend
- status atual:
  - saneamento do `typecheck` do backend concluido
  - `npm run typecheck -w apps/backend` passando
- proximo passo natural:
  - preservar esse estado em novos cortes

### Port forwarding
- status atual:
  - porta preferida x porta ativa implementadas
  - fallback automatico implementado
  - UX do terminal e do painel mostrando forwarding ativo
  - template salvo relacionado ao tunel ativo com mais clareza
- proximo passo natural:
  - refinamentos visuais e contextuais se aparecerem duvidas no uso real

### Sessao compartilhada
- status atual:
  - sessao propria e sessao ao vivo implementadas
  - pedido de controle, grant, deny e revoke implementados
  - owner pode retomar controle
  - auditoria multiusuario enriquecida
- proximo passo natural:
  - retomada do viewer sem novo link
  - refinamentos de UX na transicao de controle

### Dashboard pessoal e admin
- status atual:
  - dashboard pessoal implementado com favoritos, recentes e metricas principais
  - dashboard admin de adocao implementado no primeiro corte com drill-down de usuario
  - contadores de sessoes ativas passaram a limpar sessoes SSH stale antes da exibicao
- proximo passo natural:
  - comparativos com periodo anterior
  - filtros mais ricos

### Sessoes SSH
- status atual:
  - heartbeat persistido por sessao SSH adicionado
  - limpeza recorrente de sessoes stale aplicada em `Inicio`, `Dashboard`, `Sessoes SSH` e limites de sessao
  - auditorias `RUNNING` orfas passam a ser reparadas junto da limpeza recorrente
- proximo passo natural:
  - avaliar job periodico dedicado se houver volume alto ou necessidade de SLA mais curto de limpeza

### Agentes
- status atual:
  - instrucoes de Windows, Linux e macOS melhoradas
  - tela passou a refletir binarios realmente publicados no servidor
- proximo passo natural:
  - exibir suporte/plataforma real por arquitetura quando houver multiplos artefatos
  - melhorar onboarding/diagnostico do agente

### Bastions
- status atual:
  - PRD de bastions criado
  - foco definido em visibilidade de uso, bastion efetivo por host/grupo e reaproveitamento futuro de PEM cadastrada
  - fase 1 de UX implementada:
    - backend expõe bastion efetivo do host e origem (`host`, `group`, `none`)
    - tela de Hosts permite selecionar `Bastion / Jump server` diretamente no host
    - tela de Hosts mostra badge/tooltip com bastion efetivo
    - tela de Bastions mostra uso por hosts diretos, grupos e hosts herdados
    - exclusao de bastion em uso retorna mensagem com contagens de impacto
  - fase 2 iniciada:
    - bastion pode reutilizar PEM cadastrada no sistema via `systemPemKeyId`
    - fluxo legado de colar PEM no bastion foi mantido como opcional
    - terminal, SFTP e teste de conexao usam PEM cadastrada antes da PEM legada
    - terminal diferencia erro no bastion de erro no host final
    - verificação de host key permanece obrigatoria para o host final; trust-store dedicado para bastions ficou para fase de seguranca
- proximo passo natural:
  - completar `PEM + senha` para bastion, se a mesma semantica dos hosts for necessaria
  - implementar trust-store de host key para bastions
  - avaliar migracao assistida de PEMs legadas para PEMs cadastradas

### Snippets e Vault Secrets
- status atual:
  - PRD de snippets criado
  - PRD de Vault Secrets criado
  - decisao consolidada: snippets referenciam secrets, mas nao armazenam senha em claro
  - backend foundation do Vault implementado com schema, API, criptografia, ACL minima e auditoria sem valor sensivel
  - UI minima de Secrets implementada com listagem sem valor, criacao, edicao de metadados, rotacao, revogacao, exclusao definitiva e orientacoes de seguranca
  - snippets agora reconhecem `{{secret:alias}}`, exibem aliases usados e resolvem o valor server-side no gateway SSH com auditoria mascarada
  - cadastro/edicao de snippets valida aliases acessiveis visualmente
  - stdout passa por redaction defensivo em memoria com TTL curto apos uso de secret
  - snippets alertam padroes obvios de segredo literal, como `mysql -pSENHA`, `password=`, `curl -u usuario:senha` e `PGPASSWORD=`
- proximo passo natural:
  - avaliar se alguns alertas devem virar bloqueio por politica

## 2026-04-08

### Tenancy e plataforma
- status atual:
  - separacao inicial entre `ADMIN` do tenant e `platform admin` implementada
  - gestao de tenants adicionada no backend e no frontend
  - tela `Empresas` criada para `platform admin`
  - script de bootstrap para promover o primeiro `platform admin` adicionado
- proximo passo natural:
  - endurecer resolucao pre-login do tenant e revisar isolamento operacional cross-tenant

### Licenciamento e entitlements
- status atual:
  - licenca expandida com `maxHosts`, entitlements por modulo e providers de integracao
  - bloqueio real aplicado para `hosts`, `snippets`, `acessos locais`, `integracoes`, `agents`, `secrets` e `feedback`
  - configuracao da licenca passou a ser editavel pela UI de `Configuracoes`
  - dashboard admin ganhou resumo de licenciamento do tenant
- proximo passo natural:
  - distinguir futuramente entitlements comerciais de toggles operacionais do tenant

### Feedback
- status atual:
  - modulo completo de feedback implementado com envio pelo usuario, inbox admin e resposta curta
  - feedback pode ser habilitado ou desligado por tenant via entitlement
  - exclusao de feedback passou a ser `soft delete` com `quem` e `quando`
  - tela admin recebeu busca, contexto do feedback e tendencia recolhida por periodo/status
  - terminal passou a expor feedback na barra de acoes, sem botao flutuante intrusivo
- proximo passo natural:
  - adicionar notificacao/badge para usuario quando houver atualizacao de status ou resposta

### UX e operacao
- status atual:
  - dashboard pessoal esclarece janela movel de `ultimos 30 dias` e tendencia em `4 periodos`
  - gestao de usuarios ganhou `transfer list` para grupos, copia de grupos de outro usuario e resumo de associacoes
  - hosts respeitam limite de licenca tambem no botao de criacao
  - documentacao operacional expandida com `DEPLOY-lite` e PRDs novos para playback, onboarding de agentes, tenancy, licensing e feedback
- proximo passo natural:
  - seguir refinando onboarding de agentes e automacoes operacionais por tenant/integracao

## 2026-04-22
- tela administrativa de playbooks preparada para o conceito de `steps`, ainda salvando em `commands` por compatibilidade
- documentado backlog para evolucao futura de `steps` no backend e posterior suporte governado a `script`

### MCP
- status atual:
  - PRD de MCP consolidado com foco em `MCP Server` read-only como primeiro corte
  - backlog inicial quebrado para hosts, dashboards, sessoes, auditoria e diagnosticos
  - direcao registrada para evolucao futura de tools governadas e autonomia controlada, sem shell arbitrario
  - modulo backend inicial implementado com discovery, auth por JWT ou token tecnico estatico, allowlist por capability e rate limit basico
  - guia operacional inicial criado com exemplos via `curl`
  - tokens MCP persistidos por tenant, tela admin, uso rapido e logs filtrados por token implementados
  - ponte JSON-RPC implementada para discovery, resources e tools iniciais
  - `ActionRun` conectado ao MCP com resources de leitura e tools governadas para solicitar, cancelar e aprovar
- proximo passo natural:
  - ampliar governanca por token/capability com politicas mais finas
  - avaliar `reject_action_run` e filtros/resource views por status
  - aproximar ainda mais o payload do protocolo MCP completo

### Acesso SSH operacional por IA
- status atual:
  - direcao consolidada para acesso SSH por IA com sessao tecnica, modos de acesso e policy
  - decisao registrada para nao expor shell livre diretamente ao provider ou ao MCP
- proximo passo natural:
  - modelar `ActionRun` e policy de aprovacao
  - separar dominio de acao do dominio de diagnostico

### Diagnostic Playbooks
- status atual:
  - catalogo inicial de 4 playbooks low-risk implementado no dashboard do host
  - `DiagnosticRun` com execucao real em runner SSH isolado para hosts `DIRECT`
  - persistencia de comandos, status, truncamento e redaction implementada
  - detalhe da execucao implementado com saida por comando
  - resumo por IA assincrono implementado com risco, confianca, achados e proximos passos
  - regeneracao do resumo por IA implementada sem rerodar o playbook
  - dashboard do host mostra status da execucao, status da IA, risco resumido e filtros rapidos
  - ajuda contextual implementada no dashboard do host e no detalhe da execucao
  - guia operacional curto criado para escolha de playbook e leitura de estados
- proximo passo natural:
  - ampliar runner para rotas via agent
  - adicionar exportacao de resultado
  - criar visao administrativa do catalogo e das execucoes

## 2026-07-20

### Hosts, inventario e performance
- status atual:
  - adicionada migration `apps/backend/prisma/migrations/20260720100000_add_inventory_tree_order_index/migration.sql`
  - `InventoryNode` recebeu indice `inventory_nodes_tenant_deleted_depth_name_idx` em `apps/backend/prisma/schema.prisma`
  - `InventoryRepository.findTree` e `findVisibleTree` passaram a usar `FORCE INDEX` para a ordenacao da arvore por `depth, name, id`
  - criado harness `tools/backend/hosts-dependency-index-check.cjs` para validar indice e `EXPLAIN` sem `filesort`
  - `tools/frontend/hosts-cdp-perf.cjs` foi ampliado para medir botoes/menus de acao por host e validar acoes basicas
  - `apps/frontend/src/views/HostsView.vue` passou a montar o menu de acoes do host sob demanda, preservando visual e comportamento
  - `apps/frontend/src/views/HostsView.vue` passou a indexar forwardings por host antes de montar os metadados visuais, evitando varredura `hosts x forwardings` durante render
  - `apps/frontend/src/views/HostsView.vue` passou a precomputar `visibleHostViewItems` para a pagina atual, concentrando meta visual, presenca, status de rota, contagem de forwardings e titulos de conexao fora dos loops principais
  - `apps/frontend/src/views/HostsView.vue` reduziu `NTooltip` redundante em botoes repetidos por host e trocou badges pequenos repetidos por `host-lite-tag`, mantendo labels, `title` e `aria-label`
  - `apps/frontend/src/views/HostsView.vue` passou a cachear labels/tooltips/links resolvidos no view model dos hosts visiveis, reduzindo chamadas de display dentro do template
  - `apps/frontend/src/views/HostsView.vue` adicionou fechamento externo robusto do menu de acoes e incluiu o estado do menu nas dependencias de `v-memo`
  - criado `apps/frontend/src/services/hosts-cache-warmup.service.ts` para aquecer em background, apos autenticacao, `hosts/sidebar-bootstrap`, `inventory:list` e as primeiras paginas padrao de Hosts em cards/lista
  - criado `apps/frontend/src/services/cache-diagnostics.service.ts`, expondo snapshots locais/dev do registry de cache para harnesses sem payload sensivel
  - `apps/frontend/src/services/inventory.service.ts` passou a usar cache curto registrado como `inventory:list`, com invalidacao em criacao, edicao, movimento, exclusao de pasta e movimento de host
  - eventos realtime de ACL passaram a limpar tambem `inventory:list`, evitando arvore aquecida com escopo antigo
  - `tools/frontend/hosts-cdp-perf.cjs` passou a fechar o menu de acoes com evento real de mouse via CDP, em vez de `document.body.click()`
  - `tools/frontend/hosts-cdp-perf.cjs` passou a emitir `apiSummary`, `cacheSummary` e deltas de cache por interacao warm/cold
  - snapshots de cache dos harnesses ficam compactos por padrao; `CACHE_DIAGNOSTICS_DETAIL=1` habilita o payload bruto para debug pontual
- validacao executada:
  - `npm run db:generate -w apps/backend`
  - `npm run db:deploy -w apps/backend`
  - `node tools/backend/hosts-dependency-index-check.cjs`
  - `node --check tools/frontend/hosts-cdp-perf.cjs`
  - `npm run typecheck`
  - `FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9339 PERF_MODES=normal,list-minimal,no-presence REPORT_PATH=/tmp/nodeaccess-hosts-perf-actions-fixed.json node tools/frontend/hosts-cdp-perf.cjs`
  - `FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9339 PERF_MODES=normal,list-minimal,no-presence REPORT_PATH=/tmp/nodeaccess-hosts-perf-forwardings.json node tools/frontend/hosts-cdp-perf.cjs`
  - `FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9339 PERF_MODES=normal,list-minimal,no-presence REPORT_PATH=/tmp/nodeaccess-hosts-perf-viewmodel.json node tools/frontend/hosts-cdp-perf.cjs`
  - `FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9339 PERF_MODES=normal,list-minimal,no-presence REPORT_PATH=/tmp/nodeaccess-hosts-perf-lite-tooltips.json node tools/frontend/hosts-cdp-perf.cjs`
  - `FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9339 PERF_MODES=normal,list-minimal,no-presence REPORT_PATH=/tmp/nodeaccess-hosts-perf-lite-tags.json node tools/frontend/hosts-cdp-perf.cjs`
  - `FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9339 PERF_MODES=normal,list-minimal,no-presence REPORT_PATH=/tmp/nodeaccess-hosts-perf-display-cache-final.json node tools/frontend/hosts-cdp-perf.cjs`
  - `node --check tools/frontend/hosts-cdp-perf.cjs`
  - `FRONTEND_BASE=http://127.0.0.1:5174 CDP_BASE=http://127.0.0.1:9339 PERF_MODES=normal POST_CLICK_WAIT_MS=900 REPORT_PATH=/tmp/nodeaccess-hosts-cache-audit-5174.json node tools/frontend/hosts-cdp-perf.cjs`
  - `npm run typecheck -w apps/frontend`
- rollback:
  - remover o `FORCE INDEX (inventory_nodes_tenant_deleted_depth_name_idx)` de `apps/backend/src/modules/inventory/inventory.repository.ts`
  - remover o indice do modelo `InventoryNode` em `apps/backend/prisma/schema.prisma`
  - criar migration reversa com `DROP INDEX inventory_nodes_tenant_deleted_depth_name_idx ON inventory_nodes;` se a migration ja tiver sido aplicada
  - reverter os blocos de menu sob demanda e os atributos `data-host-actions-button` / `data-host-dashboard-button` em `apps/frontend/src/views/HostsView.vue`
  - reverter `hostForwardingsByHostId` em `apps/frontend/src/views/HostsView.vue` se for necessario voltar ao filtro direto por host
  - reverter `visibleHostViewItems` em `apps/frontend/src/views/HostsView.vue` para os loops diretos em `paginatedFilteredHosts`, se for necessario isolar regressao visual
  - reverter `hostLiteTagClass`, estilos `.host-lite-tag*` e voltar os badges pequenos repetidos para `NTag` se houver divergencia visual
  - remover campos cacheados de display em `VisibleHostViewItem`/`HostRenderMeta` se for necessario voltar os labels/tooltips para chamadas diretas no template
  - remover `attachHostActionMenuOutsideClick`/`detachHostActionMenuOutsideClick` e o estado do menu em `v-memo` se o fechamento externo causar regressao
  - remover `initHostsCacheWarmup()` de `apps/frontend/src/App.vue` e excluir `apps/frontend/src/services/hosts-cache-warmup.service.ts` se o warmup pos-login causar carga indesejada
  - voltar `apps/frontend/src/services/inventory.service.ts` para chamada direta de `/inventory` e remover `inventoryList` de `apps/frontend/src/services/cache-ttl.service.ts` se houver regressao de frescor na arvore
  - remover ou ignorar os harnesses `tools/backend/hosts-dependency-index-check.cjs` e os novos checks em `tools/frontend/hosts-cdp-perf.cjs`
- observacao:
  - o banco deixou de ser o gargalo principal no inventario; o long task restante ainda vem da montagem DOM/lista de hosts
  - a reducao de tooltips/badges reduziu componentes repetidos, mas a contagem bruta de DOM do harness permaneceu em torno de 1771 nos 24 hosts renderizados
  - apos cache de display, a contagem em 24 hosts caiu para cerca de 1673 nos cenarios medidos e o menu de acoes abriu/fechou corretamente no harness
- proximo passo natural:
  - reduzir custo dos elementos sempre visiveis por host, especialmente tags, botoes, tooltips e detalhes calculados por item, sem alterar layout/design

### Avatar de perfil
- status atual:
  - criado `apps/frontend/src/components/AvatarCropModal.vue`
  - criado `apps/frontend/src/services/avatar-image-processing.ts`
  - criado teste `apps/frontend/src/services/avatar-image-processing.test.ts`
  - `apps/frontend/src/views/ProfileView.vue` passou a abrir crop circular com zoom/pan antes do upload
  - processamento local converte/redimensiona para imagem quadrada de avatar e limita o payload final
  - locales `apps/frontend/src/locales/pt-BR.json` e `apps/frontend/src/locales/en.json` receberam textos do fluxo
  - criado harness `tools/frontend/avatar-crop-harness.cjs`
- validacao executada:
  - `node tools/frontend/avatar-crop-harness.cjs`
  - `npx vitest run apps/frontend/src/services/avatar-image-processing.test.ts`
  - `npm run typecheck`
- rollback:
  - remover `AvatarCropModal.vue`, `avatar-image-processing.ts`, teste e harness
  - voltar `ProfileView.vue` para enviar diretamente o arquivo selecionado ao `userService.updateOwnAvatar`
  - remover chaves novas de avatar nos arquivos de locale, se nao forem mais usadas
- proximo passo natural:
  - aplicar `UserAvatar` tambem na tela Admin > Usuarios e registrar auditoria de alteracao/remocao de avatar sem guardar conteudo da imagem

### Terminal e harness de estabilidade
- status atual:
  - `apps/frontend/src/components/TerminalPane.vue` e `apps/frontend/src/views/TerminalView.vue` receberam marcadores estaveis para testes de UI
  - criado harness estatico `tools/frontend/terminal-ui-layout-harness.cjs`
  - criado harness CDP simulado `tools/frontend/terminal-cdp-simulated-flow.cjs`
  - harness cobre renderizacao xterm, resize via WebSocket falso, busca, painel de info, copiar/text mode, esconder toolbar, busca de abas e input de terminal
  - criada trilha operacional `docs/OPERATIONS-terminal-browser-stability-lite.md` para acompanhar estabilidade visual do terminal separada da capacidade headless do gateway
  - criado harness real de browser `tools/frontend/terminal-playwright-load.cjs` usando Playwright, com contexto isolado por usuario, screenshots, estagios de falha e metricas de maquina/container
  - `tools/frontend/terminal-cdp-load.cjs` permanece como diagnostico CDP manual, mas Playwright passa a ser o caminho preferido para visao de usuario
  - `apps/frontend/src/composables/useTerminal.ts` passou a emitir hooks locais de observabilidade do terminal para harness/telemetria: mounted, connecting, ready, input-ready, input-sent, command-sent, output-received, disconnected e error
  - o hook local `nodeaccess:terminal-send-input` fica restrito a dev/localhost para teste controlado sem expor conteudo em relatorio
  - `tools/frontend/terminal-playwright-load.cjs` passou a registrar `terminalReady`, `responseErrors` 4xx/5xx com URL, `commandInputMode`, timeouts e duracao por sessao
  - `tools/frontend/terminal-playwright-load.cjs` passou a suportar `SCREENSHOT_MODE`, `TERMINAL_READY_TIMEOUT_MS` e timeout controlado no fechamento do contexto Playwright
  - o harness passou a usar os hooks internos de terminal como fonte principal de readiness, reduzindo falso negativo causado por locator/scheduler do Chromium em stress visual
  - `tools/frontend/terminal-playwright-load.cjs` passou a emitir `apiSummary`, agrupando chamadas `/api/v1` por metodo e endpoint normalizado para orientar cache/lazy loading
  - `tools/frontend/terminal-playwright-load.cjs` passou a capturar `cacheSummary` e snapshots de cache por sessao entre Hosts, detalhe do host, terminal pronto e final
  - `apps/frontend/src/views/TerminalView.vue` passou a priorizar a abertura do primeiro shell antes do carregamento de capacidades secundarias (`features` e `host-link/options`)
  - a regra de multiconnect foi preservada: se ja houver aba aberta, a tela ainda aguarda as capacidades antes de decidir se pode abrir outra aba
- validacao executada:
  - `node tools/frontend/terminal-ui-layout-harness.cjs`
  - `FRONTEND_BASE=http://127.0.0.1:5173 CDP_BASE=http://127.0.0.1:9361 node tools/frontend/terminal-cdp-simulated-flow.cjs`
  - `npm run typecheck`
  - `node --check tools/frontend/terminal-playwright-load.cjs`
  - gateway headless chegou a 200 sessoes simultaneas com comandos e sem falhas na rodada local registrada
  - Playwright com 1 sessao abriu terminal e enviou comando: `/tmp/nodeaccess-terminal-playwright-load-1-debug5.json`
  - Playwright com 5 sessoes em Vite dev falhou: `/tmp/nodeaccess-terminal-playwright-load-5-v3.json`
  - `node --check tools/frontend/terminal-playwright-load.cjs`
  - `npm run typecheck -w apps/frontend`
  - Playwright contra frontend paralelo em `5174` confirmou hooks `terminal-ready`, `terminal-input-ready` e `terminal-output-received`: `/tmp/nodeaccess-terminal-playwright-hooks-1-5174.json`
  - input automatizado ainda congela a pagina no Chromium/headless local, inclusive com `COMMAND_INPUT_MODE=hook`: `/tmp/nodeaccess-terminal-playwright-hooks-hook-1-5174.json`
  - `npm run build -w apps/frontend` passou no typecheck, mas falhou no `vite build` ao copiar `favicon.svg` para `apps/frontend/dist` por `EPERM` no OneDrive/Windows
  - build production alternativo em `/tmp/nodeaccess-frontend-dist` passou com `npx vite build --outDir /tmp/nodeaccess-frontend-dist --emptyOutDir`
  - Playwright contra production preview em `4173` com 1 sessao passou: `/tmp/nodeaccess-terminal-playwright-preview-hook-1.json`
  - Playwright contra production preview em `4173` com 5 sessoes e `SESSION_TIMEOUT_MS=120000` falhou parcialmente por timeout de orcamento: `/tmp/nodeaccess-terminal-playwright-preview-hook-5.json`
  - Playwright contra production preview em `4173` com 5 sessoes e `SESSION_TIMEOUT_MS=180000` passou com 5 terminais prontos e 5 comandos enviados: `/tmp/nodeaccess-terminal-playwright-preview-hook-5-timeout180.json`
  - os 403 capturados no cenario de 5 sessoes vieram de `forwardings`, `agents` e `snippets` para usuarios sem permissao total no perfil local
  - Playwright contra production preview em `4173` com 2 sessoes passou: `/tmp/nodeaccess-terminal-playwright-preview-hook-2-timeout180.json`
  - uma repeticao de 3 sessoes falhou por tokens locais expirados (`401 /auth/refresh`), confirmando necessidade de renovar `profile.local.json` antes de rodadas longas
  - seed local reexecutado com `LOADTEST_TOKEN_EXPIRES_IN=8h`, `LOADTEST_USER_COUNT=20`, `LOADTEST_HOST_COUNT=100` e `LOADTEST_SSH_PORT=2223`
  - Playwright contra production preview em `4173` com 3 sessoes e tokens renovados passou: `/tmp/nodeaccess-terminal-playwright-preview-hook-3-renewed-timeout180.json`
  - Playwright contra production preview em `4173` com 10 sessoes passou apos corrigir assinatura de `page.waitForFunction` e usar `TERMINAL_READY_TIMEOUT_MS=180000`, `SESSION_TIMEOUT_MS=360000`, `SCREENSHOT_MODE=failure`: `/tmp/nodeaccess-terminal-playwright-preview-hook-10-ready180-fixed-timeout360.json`
  - leitura da rodada de 10: 10/10 terminais prontos, 10 comandos enviados, `timeToTerminalMs p95 159365ms`, `commandLatencyMs p95 72610ms`, CPU media 10%, memoria media 14.2%, disco `/tmp` 7.7%
  - `npm run typecheck -w apps/frontend`
  - build production alternativo em `/tmp/nodeaccess-frontend-dist` passou apos priorizar abertura do shell
  - Playwright contra production preview em `4173` com 2 sessoes passou apos a otimizacao: `/tmp/nodeaccess-terminal-playwright-priority-shell-2.json`
  - Playwright contra production preview em `4173` com 5 sessoes passou apos a otimizacao: `/tmp/nodeaccess-terminal-playwright-priority-shell-5.json`
  - leitura apos otimizacao: 2 sessoes com `timeToTerminalMs p95 25868ms`; 5 sessoes com `timeToTerminalMs p95 99137ms`, 5/5 comandos enviados e sem falhas de terminal
  - auditoria de endpoints/cache com 2 sessoes passou: `/tmp/nodeaccess-terminal-api-cache-audit-2.json`
  - leitura da auditoria: `GET /api/v1/users/me/preferences` 4x, `GET /api/v1/features` 3x, `GET /api/v1/host-links/options` 3x, `GET /api/v1/hosts/:id` 2x; chamadas abortadas ficaram associadas a navegacao, nao a falha do terminal
- rollback:
  - remover os atributos `data-terminal-action` adicionados se nao forem mais desejados
  - remover os harnesses novos em `tools/frontend/terminal-ui-layout-harness.cjs` e `tools/frontend/terminal-cdp-simulated-flow.cjs`
  - remover `tools/frontend/terminal-playwright-load.cjs` e a dependencia `playwright` se a abordagem for descartada
  - em `apps/frontend/src/views/TerminalView.vue`, voltar o `onMounted` principal a aguardar `loadTerminalCapabilities()` antes de consumir o host pendente se for necessario restaurar a ordem antiga de carregamento
- proximo passo natural:
  - repetir matriz curta de production preview em outro navegador/maquina para separar limite do Chromium local de limite do produto
  - comparar `COMMAND_INPUT_MODE=keys`, `insert`, `paste` e `hook` em production preview e navegador visivel (`HEADLESS=0`)
  - manter 1, 2, 3, 5 e 10 sessoes visuais como regressao do terminal, mantendo gateway headless para escala alta
  - avaliar code splitting/lazy loading de `SnippetsPanel`, `FileManager`, `TunnelManager` e modais pesados para reduzir custo inicial sem mudar UX
  - investigar caches adicionais com invalidacao explicita: frontend para chamadas auxiliares/403 esperados, backend para metadados estaveis e SSH apenas para dados de abertura, nunca para estado vivo da sessao
  - usar `apiSummary` para comparar antes/depois de qualquer cache novo, evitando otimizar no escuro
