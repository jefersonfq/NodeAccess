---
change_id: NA-0037
title: Retomar e unificar a plataforma de IA
type: feature
status: in_progress
created_at: 2026-08-14T12:30:00-03:00
base_branch: master
base_sha: aeedb58
branch: feature/NA-0037-20260814-ai-platform-foundation
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0037 - Plataforma de IA

## Objetivo

Consolidar providers locais e externos, assistente, auditoria, terminal,
diagnosticos, AI SSH Actions e MCP em uma arquitetura coerente, governada e
adotavel, preservando os fluxos criticos sem IA.

## Situacao anterior

Os principais blocos existem e funcionam, mas foram entregues por frentes
independentes. Configuracao, nomenclatura, provider routing, auditoria e UX nao
formam ainda uma jornada unica.

## Escopo desta frente

- inventario verificavel do estado atual;
- PRD unificado e arquitetura alvo;
- matriz de providers, finalidades e roteamento;
- decisao de acesso a dados por tools tipadas, sem SQL livre;
- plano de UX para configuracao, assistente, terminal e MCP;
- roadmap incremental com criterios de seguranca, performance e auditoria;
- primeiro corte tecnico da fundacao a definir apos validar o inventario.

## Riscos

| Risco | Impacto | Mitigacao |
|---|---|---|
| modelo executar fora de policy | critico | Tool Registry, ActionRun e revalidacao |
| vazamento de contexto/segredo | critico | minimizacao, redaction e sem SQL/DSN |
| providers disputarem finalidade | alto | router deterministico por finalidade |
| IA degradar terminal | alto | modulo opcional e palette desacoplada |
| custo/latencia imprevisivel | alto | budgets, fila, timeout, circuit breaker |
| shell MCP amplo demais | critico | perfil avancado, allowlist, TTL e kill switch |

## Evidencias iniciais

- `local-ai` resolve provider por policy, mas sem failover em runtime;
- OpenAI de auditoria e OpenAI-compatible do assistente possuem contratos
  diferentes;
- modos de escrita do assistente ainda nao criam ActionRun;
- MCP possui resources, tools, approvals e shell, mas onboarding e orientado a
  chamadas HTTP manuais;
- auditoria e diagnosticos ja oferecem base persistida para o relatorio alvo.

## Fases

1. Fundacao e clareza de providers.
2. MCP adotavel e testavel.
3. Assistente com Tool Registry.
4. Copilot do terminal.
5. Diagnosticos e relatorios.
6. Importacoes, bulk actions e autonomia governada.

## Stop criteria

- qualquer bypass de tenant, ACL, approval ou policy;
- necessidade de entregar credencial do banco ao modelo;
- dependencia de IA no carregamento ou funcionamento do terminal;
- envio externo de segredos ou buffer sem minimizacao;
- execucao de script sem preview, checksum, policy e trilha.

## Resultado do primeiro corte

- PRD unificado criado com inventario, gaps, arquitetura, UX e roadmap;
- status do assistente agora apresenta providers local/rede separadamente;
- provider selecionado, modelo, localidade e motivo de roteamento ficam visiveis;
- UI deixa explicito que prioridade configurada ainda nao e failover em runtime;
- experiencia renomeada para `Assistente NodeAccess`;
- 3 testes novos de roteamento aprovados;
- typechecks backend/frontend e build shared aprovados;
- regressao completa aprovada: 84 arquivos e 628 testes.

## Resultado do segundo corte

- autocomplete deterministico e autocomplete powered by IA definidos como recursos independentes;
- smoke test MCP somente leitura disponivel na interface imediatamente apos criar o token;
- probe usa credencial isolada, sem refresh da sessao web, sem persistencia e sem operacao mutavel;
- cache curto aplicado apenas ao catalogo de capabilities MCP, com coalescencia e invalidacao explicita;
- testes cobrem cache, allowlist, falha sanitizada e ausencia de vazamento do token.

## Resultado do terceiro corte

- registry deterministico de ferramentas somente leitura do Assistente NodeAccess;
- selecao de ferramentas por intencao e contexto explicito, evitando consultas indiscriminadas;
- resultados continuam protegidos por tenant, ACL e entitlement antes de chegar ao modelo;
- resposta informa ferramentas executadas e latencia para verificacao pelo usuario;
- uso das ferramentas e auditado sem registrar prompt, resposta ou credenciais;
- nenhuma ferramenta de escrita ou execucao foi liberada ao modelo.

## Resultado do quarto corte

- geracao de plano estruturado de diagnostico por provider local ou de rede;
- limite de oito steps, timeouts fechados e prompt defensivo somente leitura;
- classificacao server-side de cada comando pela policy do tenant;
- comandos bloqueados impedem criacao do ActionRun;
- preview explicito com host, provider, modo, risco, timeout e comandos completos;
- criacao usa o endpoint existente de ActionRun, que revalida entitlement, ACL e policy;
- geracao auditada sem armazenar objetivo, resposta do modelo ou credenciais.

## Resultado do quinto corte

- relatorio pos-diagnostico versionado com identidade, resumo e evidencias;
- host e execucao vinculados explicitamente, sem inferir sessao ou ticket inexistente;
- contadores de comandos concluidos, falhos, ignorados e com redaction;
- exportacao inclui saidas sanitizadas e checksum SHA-256 estavel do conteudo;
- checksum registrado na auditoria de exportacao;
- tela responsiva apresenta rastreabilidade e integridade antes das evidencias brutas.

## Resultado do sexto corte

- origem persistida no DiagnosticRun por sessao, ticket e/ou ActionRun;
- migration adiciona campos e indices de rastreabilidade sem alterar evidencias existentes;
- referencias validadas no mesmo tenant, host e escopo do usuario antes da gravacao;
- ticket normalizado e nenhuma associacao inferida por coincidencia textual;
- alteracao auditada e refletida imediatamente no relatorio e checksum;
- UI permite vincular, substituir ou remover referencias com feedback de erro seguro.

## Resultado do setimo corte

- publicacao explicita do relatorio no ticket Jira vinculado;
- comentario contem resultado, contadores, link confiavel e checksum;
- anexo JSON e opcional e exige confirmacao sobre envio de evidencias externas;
- outbox usa chaves idempotentes por DiagnosticRun, checksum e tipo de acao;
- retry ocorre fora da requisicao e falha do Jira nao bloqueia a interface;
- capabilities de comentario/anexo e origem da URL sao validadas antes da fila;
- enfileiramento e auditado sem registrar credenciais.

## Resultado do oitavo corte

- comparacao deterministica entre duas execucoes autorizadas do mesmo host;
- baseline escolhido explicitamente e execucao aberta tratada como depois;
- metricas, comandos e risco classificados sem inferencia causal;
- achados novos, resolvidos e persistentes comparados por texto normalizado;
- avisos quando playbook, comandos ou resumo estruturado nao forem equivalentes;
- operacao auditada sem registrar saidas ou conteudo do modelo.

## Resultado do nono corte

- historico consolidado das 30 execucoes mais recentes por host;
- totais de execucao, falhas, comandos falhos e risco alto calculados sem IA;
- linha do tempo navegavel com playbook, falhas e risco observado;
- achados recorrentes somente apos duas ocorrencias por texto normalizado;
- execucoes sem resumo continuam nos totais e geram aviso de cobertura parcial;
- consulta protegida pela ACL de conexao do host e registrada na auditoria.

## Resultado do decimo corte

- copilot do terminal com respostas tipadas em explicacao, comando ou script;
- comandos e scripts classificados pela policy server-side antes da exibicao;
- somente comando seguro de uma linha pode ser inserido, sem envio de Enter;
- insercao exige confirmacao explicita e devolve o foco ao xterm.js;
- scripts ficam restritos a copia e revisao, sem insercao automatica;
- prompt defensivo trata buffer e selecao como entrada nao confiavel;
- auditoria registra provider, tipo, risco e hash, sem conteudo operacional.

## Resultado do decimo primeiro corte

- ActionRun agora possui relatorio pos-execucao versionado e verificavel;
- avaliacao deterministica em successful, partial, failed ou incomplete;
- contadores de steps concluidos, falhos, ignorados e com redaction;
- relatorio usa somente evidencias sanitizadas ja persistidas;
- checksum SHA-256 estavel e consulta registrada na auditoria;
- UI separa explicitamente validacao deterministica de conclusao por IA.

## Resultado do decimo segundo corte

- resumo SSH separa fatos observados de hipoteses que exigem validacao;
- providers retornam indices dos comandos usados como evidencia;
- schema estrito da OpenAI e parser tolerante local compartilham o mesmo contrato;
- artefatos antigos permanecem compativeis por defaults vazios;
- UI destaca hipoteses e referencias sem mistura-las aos fatos confirmados;
- terminal, websocket e captura de auditoria nao foram alterados.

## Resultado do decimo terceiro corte

- politicas `prefer_local` e `prefer_network` executam fallback em runtime somente quando ambos os providers estao configurados;
- politicas exclusivas continuam sem fallback implicito;
- circuit breaker isolado por tenant e provider abre apos tres falhas consecutivas e possui cooldown curto;
- chamadas nao-stream possuem timeout de provider e nunca misturam respostas entre providers;
- stream so tenta o provider alternativo antes de emitir o primeiro token;
- auditoria registra finalidade, provider, resultado, latencia e tokens quando informados, sem prompt ou resposta;
- custo permanece nulo enquanto nao houver tabela de preco versionada, evitando estimativa enganosa;
- interface apresenta failover, configuracao, provider efetivo e estado do circuito.

## Resultado do decimo quarto corte

- harness Playwright funciona com Chromium local ou conexao CDP externa;
- jornada licenciada valida status, failover, providers, chat, provider efetivo e evidencia de tool somente leitura;
- jornada sem licenca confirma bloqueio do envio;
- viewport movel de 390 px e erros de pagina entram no gate;
- seletores estaveis e nome acessivel foram adicionados ao fluxo principal sem depender da estrutura interna do componente visual;
- comando reproduzivel: `npm run test:local-ai:web` com `FRONTEND_BASE` apontando para frontend ativo.

## Resultado do decimo quinto corte

- administradores licenciados podem iniciar operacoes em massa pela area do Assistente NodeAccess;
- selecao pesquisavel suporta ate 500 hosts, alinhada ao limite sincronono do backend;
- o fluxo reutiliza o modal existente de bulk actions, sem duplicar regras de negocio na IA;
- preview, bloqueios, impacto de ACL, confirmacao, resultado, exportacao, historico e rollback permanecem server-side;
- a interface declara explicitamente que a IA nao executa a alteracao;
- estados de loading, vazio, erro/retry e sucesso foram cobertos;
- harness Chromium valida selecao, preview, `confirm: true`, aplicacao e resultado;
- regressao direcionada do backend manteve os 7 testes de bulk actions aprovados.

## Resultado do decimo sexto corte

- probe guiado MCP valida autenticacao e handshake `initialize` com versao de protocolo;
- catálogos `tools/list`, `resources/list` e `prompts/list` sao exercitados separadamente;
- consulta final usa somente `search_hosts`, respeita a allowlist do token e limita o resultado;
- erro JSON-RPC invalida o passo mesmo quando o servidor responde HTTP 200;
- falhas continuam sanitizadas e o token nunca entra no relatorio do teste;
- modal de uso apresenta endpoint e configuracao HTTP copiavel com header de autorizacao;
- shell, ActionRun e qualquer escrita permanecem fora do probe seguro;
- 13 testes direcionados de cache, probe e guardas MCP aprovados.

## Resultado do decimo setimo corte

- Ollama local certificado com inferencia real no modelo `qwen2.5-coder:3b`;
- OpenAI e OpenAI-compatible externos permanecem explicitamente nao certificados por ausencia de credencial/configuracao no ambiente, sem substituir essa prova por mock;
- failover validado sobre transporte HTTP real para 429, 503, timeout, fallback, circuit breaker, cooldown e recuperacao do provider primario;
- falhas classificadas em `rate_limited`, `timeout`, `unavailable` ou `other`, sem persistir corpo de erro do provider;
- agregado diario persistente por tenant, provider, modelo e finalidade registra requisicoes, sucesso/falha, circuit open, categorias de falha, tokens e latencia;
- tabela `ai_model_prices` versionada por provider/modelo/versao e vigencia foi criada antes de qualquer custo ser exposto;
- modelo sem preco cadastrado usa `pricing_version=unpriced` e custo nulo, sem estimativa implicita;
- migration `20260814170000_add_ai_provider_usage_and_pricing` aplicada com sucesso no banco de desenvolvimento;
- Claude Code certificado como cliente MCP HTTP conectado e Codex certificado por discovery real das 12 tools; configuracoes e token temporarios foram removidos ao final;
- Chromium/Playwright certificado sobre OpenSSH real: host key, conexao, comando, retorno no xterm.js e analise contextual pelo Ollama;
- harness E2E reproduzivel em `tools/frontend/real-ai-ssh-playwright.cjs` e controles do copilot receberam nome acessivel e seletores estaveis;
- host SSH temporario ficou soft-deleted para preservar FKs de auditoria, com credencial removida; container, processos e entitlements temporarios foram restaurados.

## Validacao consolidada

- regressao completa: 91 arquivos e 669 testes aprovados;
- build do pacote shared aprovado;
- typecheck do backend aprovado;
- typecheck e build de producao do frontend aprovados;
- harness Playwright/Chromium do Assistente aprovado com failover, chat, tools, bulk governado, mobile e bloqueio de licenca;
- teste de observabilidade tornou os thresholds explicitos no cenario de historico para nao depender do CPU real da maquina de teste;
- migration de telemetria e precificacao validada e aplicada no corte 17.

## Resultado do decimo oitavo corte

- painel administrativo de consumo por 7, 30 ou 90 dias, com estado de loading,
  vazio, erro/retry e layout responsivo;
- uso agregado por provider/modelo exibe requisicoes, sucesso, falhas, latencia,
  tokens e categorias operacionais sem prompt, resposta ou tenant em labels;
- custo total somente e apresentado quando todas as requisicoes possuem preco
  versionado; qualquer linha sem preco deixa o total explicitamente indisponivel;
- metricas Prometheus de tentativas e duracao usam apenas labels de baixa
  cardinalidade (`provider`, `status` e `error_kind`);
- contexto do terminal remove ANSI, limita comprimento, mascara credenciais e e
  delimitado como entrada nao confiavel contra prompt injection;
- desconexao do navegador cancela o stream no provider, SSE respeita backpressure
  e erros publicos nao revelam corpo ou detalhe interno do provider;
- Helm ganhou Ollama opcional, desabilitado por padrao, com Service, probes,
  recursos, persistencia e execucao non-root; `helm lint` e `helm template`
  aprovados com o recurso ligado e desligado;
- testes direcionados de local AI aprovados, incluindo HTTP real, timeout,
  failover, cancelamento e sanitizacao; typechecks shared/backend/frontend aprovados.

## Validacao consolidada apos o corte 18

- regressao completa: 92 arquivos e 677 testes aprovados;
- build de producao do frontend aprovado;
- build do pacote shared e typechecks backend/frontend aprovados;
- `helm lint` e renderizacao do chart com Ollama opcional aprovados;
- a primeira execucao da regressao em sandbox teve `listen EPERM` nos quatro
  testes HTTP locais; a repeticao autorizada fora dessa restricao aprovou os
  677 testes, confirmando ausencia de regressao funcional.

## Resultado do decimo nono corte

- limite mensal opcional de solicitacoes de IA configuravel por tenant;
- reserva transacional antes da chamada ao provider, com bloqueio concorrente por
  tenant e mes UTC via `SELECT ... FOR UPDATE`;
- chat, stream, plano de diagnostico e copilot do terminal compartilham o mesmo
  enforcement, sem caminhos alternativos fora do budget;
- limite atingido responde HTTP 429 e gera auditoria somente com periodo, consumo
  e limite, sem prompt ou resposta;
- migration `20260814203000_add_local_ai_budget_counter` aplicada no banco local;
- API, gateway e frontend agora possuem flags de ativacao no chart, todas
  preservando os defaults anteriores, permitindo composicao modular;
- Ollama certificado em cluster Kind efemero com imagem `0.11.4`, pod non-root,
  PVC, pull do modelo `smollm2:135m`, inferencia real, upgrade, rollback e
  persistencia do modelo e do mesmo PVC apos recriacao do pod;
- harness reproduzivel: `npm run test:helm-ollama-certification`, usando
  `KIND_BIN`, `KUBECTL_BIN` e `HELM_BIN` quando os binarios nao estao no PATH;
- cluster, namespace e recursos temporarios removidos automaticamente ao final.

## Validacao consolidada apos o corte 19

- regressao completa: 92 arquivos e 679 testes aprovados;
- build de producao frontend e typechecks backend/frontend aprovados;
- build do pacote shared e validacao do Prisma aprovados;
- migration de budget aplicada com sucesso no MySQL de desenvolvimento;
- harness completo do chart aprovado para renders minimo, producao e Traefik,
  guard de migration, datastores externos e hooks de conectividade;
- certificacao Kind/Ollama retornou
  `install=true`, `inference=true`, `persistence=true`, `upgrade=true`,
  `rollback=true` e `nonRoot=true`.
